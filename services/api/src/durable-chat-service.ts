import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const conversationSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('direct'), connectionId: z.string().uuid() }).strict(),
    z.object({ kind: z.literal('group'), roomId: z.string().uuid() }).strict(),
]);
const sendSchema = z.object({
    conversationId: z.string().uuid(),
    clientMessageId: z.string().uuid(),
    body: z.string().trim().min(1).max(2000),
}).strict();
const readSchema = z.object({
    conversationId: z.string().uuid(),
    throughMessageId: z.string().uuid(),
}).strict();
const redactSchema = z.object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
}).strict();
const reportSchema = z.object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    reason: z.enum(['abuse', 'harassment', 'spam', 'fraud', 'privacy', 'other']),
}).strict();

interface ConversationRow {
    conversation_id: string;
    kind: 'direct' | 'group';
    connection_id: string | null;
    room_id: string | null;
    status: 'active' | 'closed';
    version: number;
    created_at: Date | string;
    updated_at: Date | string;
    closed_at: Date | string | null;
}
interface MessageRow {
    message_id: string;
    sequence: string | number;
    conversation_id: string;
    author_did: string | null;
    body: string | null;
    status: 'active' | 'redacted';
    client_message_id: string;
    created_at: Date | string;
    redacted_at: Date | string | null;
}
interface Authorization {
    conversation: ConversationRow;
    participants: string[];
    title: string;
    counterpartDid?: string;
    groupId?: string;
    roomName?: string;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const plusDays = (date: Date, days: number): Date => new Date(date.getTime() + days * 86_400_000);
const iso = (value: Date | string | null): string | null => value === null ? null : new Date(value).toISOString();

export class DurableChatService {
    constructor(private readonly pool: Pool) {}

    async listConversations(actorDid: string): Promise<{ conversations: Record<string, unknown>[] }> {
        await this.assertAccountActive(this.pool, actorDid);
        const result = await this.pool.query<ConversationRow>(
            `SELECT DISTINCT c.* FROM chat_conversations c
             LEFT JOIN coordination_connections connection
                ON connection.connection_id=c.connection_id
             LEFT JOIN group_rooms room ON room.room_id=c.room_id
             LEFT JOIN group_memberships member ON member.group_id=room.group_id
             WHERE (c.kind='direct' AND $1 IN (connection.requester_did,connection.helper_did))
                OR (c.kind='group' AND member.member_did=$1 AND member.status='active')
             ORDER BY c.updated_at DESC,c.conversation_id`, [actorDid]);
        const conversations: Record<string, unknown>[] = [];
        for (const row of result.rows) {
            const authorization = await this.authorize(this.pool, row, actorDid);
            const state = await this.pool.query<{
                last_sequence: string | null; last_message_at: Date | string | null;
                last_read_sequence: string | null; unread: string;
            }>(
                `SELECT MAX(m.sequence)::text AS last_sequence,
                        MAX(m.created_at) AS last_message_at,
                        COALESCE(s.last_read_sequence,0)::text AS last_read_sequence,
                        COUNT(*) FILTER (WHERE m.sequence>COALESCE(s.last_read_sequence,0)
                            AND m.author_did IS DISTINCT FROM $2)::text AS unread
                 FROM chat_messages m
                 LEFT JOIN chat_participant_state s
                    ON s.conversation_id=m.conversation_id AND s.participant_did=$2
                 WHERE m.conversation_id=$1 GROUP BY s.last_read_sequence`,
                [row.conversation_id, actorDid]);
            conversations.push(this.renderConversation(authorization, state.rows[0]));
        }
        return { conversations };
    }

    async createConversation(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = conversationSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_CHAT_SCOPE', 'The conversation scope is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.assertAccountActive(client, actorDid);
            const existing = await client.query<ConversationRow>(
                parsed.data.kind === 'direct' ?
                    `SELECT * FROM chat_conversations WHERE connection_id=$1 FOR UPDATE` :
                    `SELECT * FROM chat_conversations WHERE room_id=$1 FOR UPDATE`,
                [parsed.data.kind === 'direct' ? parsed.data.connectionId : parsed.data.roomId]);
            let row = existing.rows[0];
            let created = false;
            if (!row) {
                const id = randomUUID();
                const inserted = await client.query<ConversationRow>(
                    `INSERT INTO chat_conversations (conversation_id,kind,connection_id,
                        room_id,status,retention_until,created_at,updated_at)
                     VALUES ($1,$2,$3,$4,'active',$5,$6,$6) RETURNING *`,
                    [id, parsed.data.kind,
                     parsed.data.kind === 'direct' ? parsed.data.connectionId : null,
                     parsed.data.kind === 'group' ? parsed.data.roomId : null,
                     plusDays(now, 365), now]);
                row = inserted.rows[0]!;
                created = true;
            }
            const authorization = await this.authorize(client, row, actorDid);
            await this.ensureParticipantStates(client, row.conversation_id,
                authorization.participants, now);
            if (created) await this.audit(client, row.conversation_id, null,
                actorDid, 'conversation-created', now);
            await client.query('COMMIT');
            return { conversation: this.renderConversation(authorization), created };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async listMessages(actorDid: string, input: {
        conversationId: string; before?: number; limit?: number;
    }): Promise<{ messages: Record<string, unknown>[]; nextCursor: number | null }> {
        if (!z.string().uuid().safeParse(input.conversationId).success)
            throw new PublicHttpError(400, 'INVALID_CONVERSATION', 'The conversation is invalid.');
        const limit = Math.min(100, Math.max(1, input.limit ?? 30));
        if ((input.before !== undefined && (!Number.isSafeInteger(input.before) || input.before <= 0)))
            throw new PublicHttpError(400, 'INVALID_CHAT_CURSOR', 'The message cursor is invalid.');
        const row = await this.loadConversation(this.pool, input.conversationId);
        await this.authorize(this.pool, row, actorDid);
        const result = await this.pool.query<MessageRow & { receipt_state: string | null }>(
            `SELECT m.*,CASE WHEN m.author_did=$2 THEN (
                    SELECT CASE WHEN COUNT(*)=0 THEN NULL
                        WHEN BOOL_AND(authored.state='read') THEN 'read'
                        ELSE 'delivered' END
                    FROM chat_message_receipts authored
                    WHERE authored.message_id=m.message_id
                ) ELSE r.state END AS receipt_state FROM chat_messages m
             LEFT JOIN chat_message_receipts r
                ON r.message_id=m.message_id AND r.recipient_did=$2
             WHERE m.conversation_id=$1 AND ($3::bigint IS NULL OR m.sequence<$3)
             ORDER BY m.sequence DESC LIMIT $4`,
            [input.conversationId, actorDid, input.before ?? null, limit + 1]);
        const hasMore = result.rows.length > limit;
        const page = result.rows.slice(0, limit).reverse();
        return {
            messages: page.map((message) => this.renderMessage(message)),
            nextCursor: hasMore && page[0] ? Number(page[0].sequence) : null,
        };
    }

    async send(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = sendSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_CHAT_MESSAGE', 'The message is invalid or exceeds 2,000 characters.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const conversation = await this.loadConversation(client, parsed.data.conversationId, true);
            const authorization = await this.authorize(client, conversation, actorDid);
            const recent = await client.query(
                `SELECT 1 FROM chat_messages WHERE author_did=$1 AND status='active'
                 AND created_at>$2::timestamptz-INTERVAL '1 minute' OFFSET 19 LIMIT 1`, [actorDid, now]);
            if (recent.rowCount) throw new PublicHttpError(429, 'CHAT_RATE_LIMITED', 'Too many messages were sent. Try again shortly.');
            await this.ensureParticipantStates(client, conversation.conversation_id,
                authorization.participants, now);
            const inserted = await client.query<MessageRow>(
                `INSERT INTO chat_messages (message_id,conversation_id,author_did,body,
                    status,client_message_id,created_at,retention_until)
                 VALUES ($1,$2,$3,$4,'active',$5,$6,$7)
                 ON CONFLICT (conversation_id,author_did,client_message_id) DO NOTHING
                 RETURNING *`,
                [randomUUID(), conversation.conversation_id, actorDid, parsed.data.body,
                 parsed.data.clientMessageId, now, plusDays(now, 365)]);
            let message = inserted.rows[0];
            const created = Boolean(message);
            if (!message) {
                const duplicate = await client.query<MessageRow>(
                    `SELECT * FROM chat_messages WHERE conversation_id=$1
                     AND author_did=$2 AND client_message_id=$3`,
                    [conversation.conversation_id, actorDid, parsed.data.clientMessageId]);
                message = duplicate.rows[0];
            }
            if (!message) throw new PublicHttpError(409, 'CHAT_DUPLICATE_UNAVAILABLE', 'The duplicate message is unavailable.');
            if (created) {
                const recipients = authorization.participants.filter((did) => did !== actorDid);
                for (const recipient of recipients) {
                    await client.query(
                        `INSERT INTO chat_message_receipts (message_id,recipient_did,state,
                            delivered_at,updated_at,retention_until)
                         VALUES ($1,$2,'delivered',$3,$3,$4) ON CONFLICT DO NOTHING`,
                        [message.message_id, recipient, now, plusDays(now, 365)]);
                    await this.notify(client, conversation, recipient, message.message_id, now);
                }
                await client.query(`UPDATE chat_conversations SET updated_at=$2 WHERE conversation_id=$1`,
                    [conversation.conversation_id, now]);
                await this.audit(client, conversation.conversation_id,
                    message.message_id, actorDid, 'message-sent', now);
            }
            await client.query('COMMIT');
            return { message: this.renderMessage(message), created };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async markRead(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = readSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_CHAT_READ', 'The read marker is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const conversation = await this.loadConversation(client, parsed.data.conversationId, true);
            const authorization = await this.authorize(client, conversation, actorDid);
            const target = await client.query<MessageRow>(
                `SELECT * FROM chat_messages WHERE message_id=$1 AND conversation_id=$2`,
                [parsed.data.throughMessageId, conversation.conversation_id]);
            const message = target.rows[0];
            if (!message) throw new PublicHttpError(404, 'CHAT_MESSAGE_NOT_FOUND', 'The message was not found.');
            await this.ensureParticipantStates(client, conversation.conversation_id, [actorDid], now);
            await client.query(
                `UPDATE chat_participant_state SET last_read_sequence=GREATEST(last_read_sequence,$3),updated_at=$4
                 WHERE conversation_id=$1 AND participant_did=$2`,
                [conversation.conversation_id, actorDid, Number(message.sequence), now]);
            await client.query(
                `UPDATE chat_message_receipts r SET state='read',read_at=COALESCE(read_at,$3),updated_at=$3
                 FROM chat_messages m WHERE r.message_id=m.message_id
                 AND r.recipient_did=$2 AND m.conversation_id=$1 AND m.sequence<=$4`,
                [conversation.conversation_id, actorDid, now, Number(message.sequence)]);
            await this.audit(client, conversation.conversation_id, message.message_id,
                actorDid, 'messages-read', now);
            await client.query('COMMIT');
            return { conversationId: conversation.conversation_id,
                lastReadSequence: Number(message.sequence), participants: authorization.participants.length };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async redact(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = redactSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_CHAT_REDACTION', 'The redaction request is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const conversation = await this.loadConversation(client, parsed.data.conversationId, true);
            await this.authorize(client, conversation, actorDid);
            const result = await client.query<MessageRow>(
                `UPDATE chat_messages SET body=NULL,status='redacted',redacted_at=$4
                 WHERE message_id=$1 AND conversation_id=$2 AND author_did=$3
                   AND status='active' AND created_at>$4::timestamptz-INTERVAL '24 hours' RETURNING *`,
                [parsed.data.messageId, conversation.conversation_id, actorDid, now]);
            const message = result.rows[0];
            if (!message) throw new PublicHttpError(404, 'CHAT_MESSAGE_NOT_REDACTABLE', 'The message cannot be redacted.');
            await this.audit(client, conversation.conversation_id, message.message_id,
                actorDid, 'message-redacted', now);
            await client.query('COMMIT');
            return { message: this.renderMessage(message) };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async report(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = reportSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_CHAT_REPORT', 'The report is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const conversation = await this.loadConversation(client, parsed.data.conversationId, true);
            await this.authorize(client, conversation, actorDid);
            const result = await client.query<MessageRow>(
                `SELECT * FROM chat_messages WHERE message_id=$1 AND conversation_id=$2 FOR UPDATE`,
                [parsed.data.messageId, conversation.conversation_id]);
            const message = result.rows[0];
            if (!message || message.status !== 'active' || !message.body || message.author_did === actorDid)
                throw new PublicHttpError(404, 'CHAT_MESSAGE_NOT_REPORTABLE', 'The message cannot be reported.');
            const subjectUri = `patchwork:chat-message:${message.message_id}`;
            const report = await client.query<{ report_id: string | number }>(
                `INSERT INTO abuse_reports (command_id,reporter_did,subject_uri,
                    subject_did,reason,details,status,retention_until,created_at)
                 VALUES ($1,$2,$3,$4,$5,NULL,'pending',$6,$7) RETURNING report_id`,
                [randomUUID(), actorDid, subjectUri, message.author_did,
                 `chat-${parsed.data.reason}`, plusDays(now, 30), now]);
            const reportId = report.rows[0]!.report_id;
            const digest = hash(message.body);
            await client.query(
                `INSERT INTO chat_abuse_report_evidence (report_id,conversation_id,
                    message_id,message_author_did,body_sha256,body_character_count,
                    message_created_at,retention_until)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [reportId, conversation.conversation_id, message.message_id,
                 message.author_did, digest, message.body.length,
                 message.created_at, plusDays(now, 30)]);
            await client.query(
                `INSERT INTO moderation_queue_items (subject_uri,queue_id,subject_type,
                    reasons,latest_reason,report_count,queue_status,visibility,
                    appeal_state,context,created_at,requested_at,updated_at)
                 VALUES ($1,$2,'conversation',$3::jsonb,$4,1,'queued','visible','none',$5::jsonb,$6,$6,$6)
                 ON CONFLICT (subject_uri) DO UPDATE SET
                    reasons=moderation_queue_items.reasons || EXCLUDED.reasons,
                    latest_reason=EXCLUDED.latest_reason,
                    report_count=moderation_queue_items.report_count+1,
                    queue_status='queued',requested_at=EXCLUDED.requested_at,
                    updated_at=EXCLUDED.updated_at`,
                [subjectUri, `chat-report-${message.message_id}`,
                 JSON.stringify([`chat-${parsed.data.reason}`]), `chat-${parsed.data.reason}`,
                 JSON.stringify({ targetId: message.message_id, contentSha256: digest,
                     characterCount: message.body.length }), now]);
            await this.audit(client, conversation.conversation_id, message.message_id,
                actorDid, 'message-reported', now);
            await client.query('COMMIT');
            return { report: { id: String(reportId), status: 'pending' } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async runSweep(now = new Date()): Promise<{ closed: number; deletedMessages: number }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const closed = await client.query(
                `UPDATE chat_conversations c SET status='closed',version=version+1,
                    closed_at=$1,updated_at=$1
                 WHERE c.status='active' AND (
                    (c.kind='direct' AND NOT EXISTS (
                        SELECT 1 FROM coordination_connections connection
                        JOIN request_workflows request ON request.post_uri=connection.request_uri
                        WHERE connection.connection_id=c.connection_id
                          AND connection.status='active'
                          AND request.current_status IN ('assigned','in_progress')))
                    OR (c.kind='group' AND NOT EXISTS (
                        SELECT 1 FROM group_rooms room JOIN groups g USING (group_id)
                        WHERE room.room_id=c.room_id AND room.status='active' AND g.status='active'))
                 )`, [now]);
            const deleted = await client.query(`DELETE FROM chat_messages WHERE retention_until<=$1`, [now]);
            await client.query('COMMIT');
            return { closed: closed.rowCount ?? 0, deletedMessages: deleted.rowCount ?? 0 };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    private async loadConversation(client: Pick<Pool | PoolClient, 'query'>,
        id: string, lock = false): Promise<ConversationRow> {
        const result = await client.query<ConversationRow>(
            `SELECT * FROM chat_conversations WHERE conversation_id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
        const row = result.rows[0];
        if (!row) throw new PublicHttpError(404, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
        return row;
    }

    private async authorize(client: Pick<Pool | PoolClient, 'query'>,
        conversation: ConversationRow, actorDid: string): Promise<Authorization> {
        await this.assertAccountActive(client, actorDid);
        if (conversation.status !== 'active')
            throw new PublicHttpError(409, 'CHAT_CONVERSATION_CLOSED', 'The conversation is closed.');
        await this.assertModerationVisible(client, `patchwork:chat:${conversation.conversation_id}`, 'CHAT_MODERATED');
        if (conversation.kind === 'direct') {
            const result = await client.query<{
                requester_did: string; helper_did: string; status: string;
                request_uri: string; current_status: string;
            }>(
                `SELECT connection.requester_did,connection.helper_did,
                        connection.status,connection.request_uri,request.current_status
                 FROM coordination_connections connection
                 JOIN request_workflows request ON request.post_uri=connection.request_uri
                 WHERE connection.connection_id=$1`, [conversation.connection_id]);
            const row = result.rows[0];
            if (!row || ![row.requester_did, row.helper_did].includes(actorDid))
                throw new PublicHttpError(404, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
            if (row.status !== 'active' || !['assigned', 'in_progress'].includes(row.current_status))
                throw new PublicHttpError(409, 'CHAT_CONNECTION_INACTIVE', 'The accepted connection is no longer active.');
            await this.assertAccountActive(client, row.requester_did);
            await this.assertAccountActive(client, row.helper_did);
            await this.assertNotBlocked(client, row.requester_did, row.helper_did);
            await this.assertModerationVisible(client, row.request_uri, 'CHAT_REQUEST_MODERATED');
            const counterpartDid = actorDid === row.requester_did ? row.helper_did : row.requester_did;
            return { conversation, participants: [row.requester_did, row.helper_did],
                title: counterpartDid, counterpartDid };
        }
        const result = await client.query<{
            group_id: string; group_name: string; owner_did: string;
            group_status: string; room_name: string; room_status: string;
            linked_request_uri: string | null; member_status: string | null;
        }>(
            `SELECT g.group_id,g.name AS group_name,g.owner_did,
                    g.status AS group_status,room.name AS room_name,
                    room.status AS room_status,room.linked_request_uri,
                    actor.status AS member_status
             FROM group_rooms room JOIN groups g USING (group_id)
             LEFT JOIN group_memberships actor
                ON actor.group_id=g.group_id AND actor.member_did=$2
             WHERE room.room_id=$1`, [conversation.room_id, actorDid]);
        const scope = result.rows[0];
        if (!scope || scope.member_status !== 'active')
            throw new PublicHttpError(404, 'CHAT_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
        if (scope.group_status !== 'active' || scope.room_status !== 'active')
            throw new PublicHttpError(409, 'CHAT_ROOM_CLOSED', 'The group room is closed.');
        await this.assertModerationVisible(client, `patchwork:group:${scope.group_id}`, 'CHAT_GROUP_MODERATED');
        const members = await client.query<{ member_did: string }>(
            `SELECT member_did FROM group_memberships
             WHERE group_id=$1 AND status='active' ORDER BY joined_at,member_did`, [scope.group_id]);
        for (const member of members.rows) {
            await this.assertAccountActive(client, member.member_did);
            await this.assertNotBlocked(client, actorDid, member.member_did);
            if (scope.linked_request_uri)
                await this.assertRequestVisible(client, scope.linked_request_uri, member.member_did);
        }
        return { conversation, participants: members.rows.map((row) => row.member_did),
            title: `${scope.group_name} — ${scope.room_name}`,
            groupId: scope.group_id, roomName: scope.room_name };
    }

    private async assertAccountActive(client: Pick<Pool | PoolClient, 'query'>, did: string): Promise<void> {
        if ((await client.query(`SELECT 1 FROM account_deactivations WHERE did_hash=$1`, [hash(did)])).rowCount)
            throw new PublicHttpError(409, 'CHAT_PARTICIPANT_DEACTIVATED', 'A participant account is no longer active.');
        await this.assertModerationVisible(client, did, 'CHAT_PARTICIPANT_MODERATED');
    }

    private async assertNotBlocked(client: Pick<Pool | PoolClient, 'query'>, one: string, two: string): Promise<void> {
        if (one === two) return;
        const result = await client.query(
            `SELECT 1 FROM user_blocks WHERE deleted_at IS NULL
             AND ((blocker_did=$1 AND subject_did=$2) OR (blocker_did=$2 AND subject_did=$1))`, [one, two]);
        if (result.rowCount) throw new PublicHttpError(409, 'CHAT_PARTICIPANTS_BLOCKED', 'The participants cannot chat.');
    }

    private async assertModerationVisible(client: Pick<Pool | PoolClient, 'query'>,
        subject: string, code: string): Promise<void> {
        const result = await client.query(
            `SELECT 1 FROM moderation_queue_items WHERE subject_uri=$1
             AND (visibility<>'visible' OR queue_status='queued'
                OR appeal_state IN ('pending','under-review'))`, [subject]);
        if (result.rowCount) throw new PublicHttpError(409, code, 'Chat is unavailable for this scope.');
    }

    private async assertRequestVisible(client: Pick<Pool | PoolClient, 'query'>,
        requestUri: string, did: string): Promise<void> {
        const result = await client.query<{ requester_did: string }>(
            `SELECT requester_did FROM request_workflows WHERE post_uri=$1`, [requestUri]);
        const row = result.rows[0];
        if (!row) throw new PublicHttpError(404, 'CHAT_REQUEST_NOT_VISIBLE', 'The linked request is unavailable.');
        const participant = row.requester_did === did || (await client.query(
            `SELECT 1 FROM coordination_connections WHERE request_uri=$1
             AND status='active' AND $2 IN (requester_did,helper_did)`, [requestUri, did])).rowCount;
        if (!participant) throw new PublicHttpError(404, 'CHAT_REQUEST_NOT_VISIBLE', 'The linked request is unavailable.');
        await this.assertNotBlocked(client, row.requester_did, did);
        await this.assertModerationVisible(client, requestUri, 'CHAT_REQUEST_MODERATED');
    }

    private async ensureParticipantStates(client: PoolClient, conversationId: string,
        participants: string[], now: Date): Promise<void> {
        for (const participant of participants) await client.query(
            `INSERT INTO chat_participant_state (conversation_id,participant_did,
                joined_at,updated_at,retention_until) VALUES ($1,$2,$3,$3,$4)
             ON CONFLICT (conversation_id,participant_did) DO UPDATE
                SET retention_until=GREATEST(chat_participant_state.retention_until,
                    EXCLUDED.retention_until)`,
            [conversationId, participant, now, plusDays(now, 365)]);
    }

    private async audit(client: PoolClient, conversationId: string,
        messageId: string | null, actorDid: string | null, action: string, now: Date): Promise<void> {
        await client.query(
            `INSERT INTO chat_audit_events (conversation_id,message_id,actor_did,
                action,occurred_at,retention_until) VALUES ($1,$2,$3,$4,$5,$6)`,
            [conversationId, messageId, actorDid, action, now, plusDays(now, 365)]);
    }

    private async notify(client: PoolClient, conversation: ConversationRow,
        recipientDid: string, messageId: string, now: Date): Promise<void> {
        const title = 'New message';
        const body = 'Open Patchwork to read a new message.';
        const key = `chat:${messageId}:${recipientDid}`;
        const actionUrl = `/chat?conversation=${encodeURIComponent(conversation.conversation_id)}`;
        const metadata = JSON.stringify({ conversationId: conversation.conversation_id,
            kind: conversation.kind });
        await client.query(
            `INSERT INTO activity_inbox_items (item_id,recipient_did,item_type,title,
                summary,action_url,source_key,metadata,occurred_at,retention_until)
             VALUES ($1,$2,'chat',$3,$4,$9,$5,$6::jsonb,$7,$8)
             ON CONFLICT (recipient_did,source_key) DO NOTHING`,
            [randomUUID(), recipientDid, title, body, key, metadata, now, plusDays(now, 365), actionUrl]);
        await client.query(
            `SELECT patchwork_enqueue_notification($1,'message_received',$2,$3,
                'normal',$7,$4::jsonb,$5,$6)`,
            [recipientDid, title, body, metadata, key, now, actionUrl]);
    }

    private renderConversation(authorization: Authorization, state?: {
        last_sequence: string | null; last_message_at: Date | string | null;
        last_read_sequence: string | null; unread: string;
    }): Record<string, unknown> {
        const row = authorization.conversation;
        return { id: row.conversation_id, kind: row.kind,
            connectionId: row.connection_id, roomId: row.room_id,
            title: authorization.title, counterpartDid: authorization.counterpartDid,
            groupId: authorization.groupId, roomName: authorization.roomName,
            status: row.status, version: row.version,
            unreadCount: Number(state?.unread ?? 0),
            lastSequence: state?.last_sequence ? Number(state.last_sequence) : null,
            lastReadSequence: Number(state?.last_read_sequence ?? 0),
            lastMessageAt: iso(state?.last_message_at ?? null),
            createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
            closedAt: iso(row.closed_at) };
    }

    private renderMessage(row: MessageRow & { receipt_state?: string | null }): Record<string, unknown> {
        return { id: row.message_id, sequence: Number(row.sequence),
            conversationId: row.conversation_id, authorDid: row.author_did,
            body: row.status === 'active' ? row.body : null, status: row.status,
            deliveryState: row.receipt_state ?? null,
            createdAt: iso(row.created_at), redactedAt: iso(row.redacted_at) };
    }
}
