import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountPrivacyService } from './account-privacy-service.js';
import { DurableChatService } from './durable-chat-service.js';
import { DurableGroupService } from './durable-group-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const requester = 'did:plc:chat-requester';
const helper = 'did:plc:chat-helper';
const outsider = 'did:plc:chat-outsider';
const requestUri = `at://${requester}/app.patchwork.aid.post/chat`;
const connectionId = '51111111-1111-4111-8111-111111111111';
const baseline = new Date('2026-08-05T12:00:00.000Z');

describePostgres('DurableChatService PostgreSQL boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeEach(async () => {
        await pool.query(`TRUNCATE chat_abuse_report_evidence,chat_audit_events,
            chat_message_receipts,chat_messages,chat_participant_state,
            chat_conversations,notification_delivery_attempts,notification_intents,
            group_audit_events,group_invitations,group_rooms,group_memberships,groups,
            activity_inbox_items,coordination_connections,coordination_offers,
            abuse_reports,user_blocks,account_deactivations,moderation_queue_items,
            request_workflows RESTART IDENTITY CASCADE`);
        await pool.query(
            `INSERT INTO request_workflows (post_uri,requester_did,current_status,
                create_command_id,created_at,updated_at)
             VALUES ($1,$2,'assigned','chat-request',$3,$3)`,
            [requestUri, requester, baseline]);
        const offerId = '51111111-1111-4111-8111-111111111112';
        await pool.query(
            `INSERT INTO coordination_offers (offer_id,request_uri,requester_did,
                offerer_did,status,offered_at,expires_at,updated_at)
             VALUES ($1,$2,$3,$4,'accepted',$5,$6,$5)`,
            [offerId, requestUri, requester, helper, baseline,
             new Date('2026-08-12T12:00:00Z')]);
        await pool.query(
            `INSERT INTO coordination_connections (connection_id,offer_id,request_uri,
                requester_did,helper_did,status,accepted_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,'active',$6,$6)`,
            [connectionId, offerId, requestUri, requester, helper, baseline]);
    });

    afterAll(async () => pool.end());

    it('persists direct send, deduplication, pagination, read, reporting, redaction, and privacy-safe notifications across restart', async () => {
        const service = new DurableChatService(pool);
        const created = await service.createConversation(requester,
            { kind: 'direct', connectionId }, baseline) as {
                conversation: { id: string };
            };
        const conversationId = created.conversation.id;
        const clientMessageId = '51111111-1111-4111-8111-111111111113';
        const privateBody = 'Meet near the community garden after lunch.';
        const sent = await service.send(requester, {
            conversationId, clientMessageId, body: privateBody,
        }, new Date('2026-08-05T12:01:00Z')) as { message: { id: string }; created: boolean };
        await expect(service.send(requester, {
            conversationId, clientMessageId, body: privateBody,
        }, new Date('2026-08-05T12:01:10Z'))).resolves.toMatchObject({ created: false });

        const restarted = new DurableChatService(pool);
        await restarted.send(helper, {
            conversationId,
            clientMessageId: '51111111-1111-4111-8111-111111111114',
            body: 'I can help with that.',
        }, new Date('2026-08-05T12:02:00Z'));
        const page = await restarted.listMessages(helper, { conversationId, limit: 1 });
        expect(page.messages).toHaveLength(1);
        expect(page.nextCursor).not.toBeNull();
        const all = await restarted.listMessages(helper, { conversationId, limit: 10 });
        expect(all.messages).toHaveLength(2);
        await expect(restarted.markRead(helper, {
            conversationId, throughMessageId: sent.message.id,
        }, new Date('2026-08-05T12:03:00Z'))).resolves.toMatchObject({ lastReadSequence: 1 });
        const senderView = await restarted.listMessages(requester, { conversationId, limit: 10 });
        expect(senderView.messages.find((message) => message['id'] === sent.message.id))
            .toMatchObject({ deliveryState: 'read' });
        await expect(restarted.report(helper, {
            conversationId, messageId: sent.message.id, reason: 'privacy',
        }, new Date('2026-08-05T12:04:00Z'))).resolves.toMatchObject({ report: { status: 'pending' } });

        const externalArtifacts = JSON.stringify((await pool.query(
            `SELECT title,body,action_url,metadata FROM notification_intents
             UNION ALL SELECT title,summary,action_url,metadata FROM activity_inbox_items`,
        )).rows);
        expect(externalArtifacts).not.toContain(privateBody);
        expect(externalArtifacts).toContain(`/chat?conversation=${conversationId}`);
        expect((await pool.query("SELECT action_url FROM notification_intents WHERE notification_type = 'message_received'")).rows.every(row => row.action_url === `/chat?conversation=${conversationId}`)).toBe(true);
        const moderation = JSON.stringify((await pool.query(
            `SELECT latest_reason,context,safe_preview FROM moderation_queue_items`,
        )).rows);
        expect(moderation).not.toContain(privateBody);
        expect(moderation).toContain('contentSha256');
        const helperExport = JSON.stringify(await new AccountPrivacyService(pool).exportFor(helper));
        expect(helperExport).not.toContain(privateBody);

        await expect(restarted.redact(requester, {
            conversationId, messageId: sent.message.id,
        }, new Date('2026-08-05T12:05:00Z'))).resolves.toMatchObject({
            message: { status: 'redacted', body: null },
        });
        await pool.query(
            `INSERT INTO user_blocks (command_id,blocker_did,subject_did,created_at)
             VALUES ('chat-block',$1,$2,$3)`, [helper, requester, baseline]);
        await expect(restarted.listMessages(requester, { conversationId }))
            .rejects.toMatchObject({ code: 'CHAT_PARTICIPANTS_BLOCKED' });
        await expect(restarted.listMessages(outsider, { conversationId }))
            .rejects.toMatchObject({ code: 'CHAT_CONVERSATION_NOT_FOUND' });
    });

    it('immediately terminates group-room access after membership removal and enforces size and rate bounds', async () => {
        const groups = new DurableGroupService(pool);
        const created = await groups.create(requester, {
            name: 'Chat group', description: '', purpose: 'Coordinate safely.', visibility: 'private',
        }, baseline) as { group: { id: string; rooms: Array<{ id: string }> } };
        const invitation = await groups.invite(requester, {
            groupId: created.group.id, inviteeDid: helper, role: 'member',
        }, baseline) as { invitation: { token: string } };
        await groups.respondToInvitation(helper, { token: invitation.invitation.token,
            action: 'accept' }, baseline);
        const chat = new DurableChatService(pool);
        const conversation = await chat.createConversation(requester, {
            kind: 'group', roomId: created.group.rooms[0]!.id,
        }, baseline) as { conversation: { id: string } };
        await expect(chat.send(requester, {
            conversationId: conversation.conversation.id,
            clientMessageId: '51111111-1111-4111-8111-111111111120',
            body: 'x'.repeat(2001),
        }, baseline)).rejects.toMatchObject({ code: 'INVALID_CHAT_MESSAGE' });
        for (let index = 0; index < 20; index += 1) {
            await chat.send(requester, {
                conversationId: conversation.conversation.id,
                clientMessageId: `61111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
                body: `Bounded ${index}`,
            }, new Date('2026-08-05T12:10:00Z'));
        }
        await expect(chat.send(requester, {
            conversationId: conversation.conversation.id,
            clientMessageId: '71111111-1111-4111-8111-111111111111', body: 'Rate probe',
        }, new Date('2026-08-05T12:10:00Z'))).rejects.toMatchObject({ code: 'CHAT_RATE_LIMITED' });

        await groups.removeMember(requester, {
            groupId: created.group.id, memberDid: helper,
        }, new Date('2026-08-05T12:11:00Z'));
        await expect(chat.listMessages(helper, { conversationId: conversation.conversation.id }))
            .rejects.toMatchObject({ code: 'CHAT_CONVERSATION_NOT_FOUND' });
    });

    it('redacts authored group messages and transfers ownership during safe deactivation', async () => {
        const groups = new DurableGroupService(pool);
        const created = await groups.create(requester, {
            name: 'Continuity chat', description: '', purpose: 'Coordinate through changes.', visibility: 'private',
        }, baseline) as { group: { id: string; rooms: Array<{ id: string }> } };
        const invitation = await groups.invite(requester, {
            groupId: created.group.id, inviteeDid: helper, role: 'member',
        }, baseline) as { invitation: { token: string } };
        await groups.respondToInvitation(helper, { token: invitation.invitation.token,
            action: 'accept' }, baseline);
        const chat = new DurableChatService(pool);
        const conversation = await chat.createConversation(requester, {
            kind: 'group', roomId: created.group.rooms[0]!.id,
        }, baseline) as { conversation: { id: string } };
        await chat.send(requester, {
            conversationId: conversation.conversation.id,
            clientMessageId: '81111111-1111-4111-8111-111111111111',
            body: 'This content must be redacted on deactivation.',
        }, baseline);
        await new AccountPrivacyService(pool).deactivate(requester,
            'chat-deactivation', new Date('2026-08-06T12:00:00Z'));
        const messages = await chat.listMessages(helper, {
            conversationId: conversation.conversation.id,
        });
        expect(messages.messages).toEqual([
            expect.objectContaining({ authorDid: null, body: null, status: 'redacted' }),
        ]);
        await expect(groups.list(helper)).resolves.toMatchObject({
            groups: [expect.objectContaining({ ownerDid: helper, actorRole: 'owner' })],
        });
    });
});
