import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const intervalSchema = z.object({
    connectionId: z.string().uuid(),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(100),
    expectedVersion: z.number().int().positive().optional(),
}).strict();

const decisionSchema = z.object({
    connectionId: z.string().uuid(),
    action: z.enum(['accept', 'decline', 'cancel']),
    expectedVersion: z.number().int().positive(),
}).strict();

const hash = (value: string): string =>
    createHash('sha256').update(value).digest('hex');
const plusDays = (date: Date, days: number): Date =>
    new Date(date.getTime() + days * 86_400_000);

interface ConnectionRow {
    connection_id: string;
    request_uri: string;
    requester_did: string;
    helper_did: string;
    status: string;
    current_status: string;
}

interface WindowRow {
    window_id: string;
    connection_id: string;
    proposer_did: string;
    recipient_did: string;
    start_at: Date | string;
    end_at: Date | string;
    originating_timezone: string;
    status: 'proposed' | 'confirmed' | 'declined' | 'cancelled' | 'expired';
    version: number;
    proposal_expires_at: Date | string;
    reminder_eligible_at: Date | string;
    reminder_sent_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

const toIso = (value: Date | string | null): string | null =>
    value === null ? null : new Date(value).toISOString();

const timeZoneOffsetMinutes = (instant: Date, timeZone: string): number => {
    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            timeZoneName: 'longOffset',
        });
    } catch {
        throw new PublicHttpError(400, 'INVALID_TIMEZONE', 'The timezone is not a supported IANA timezone.');
    }
    const name = formatter.formatToParts(instant)
        .find(part => part.type === 'timeZoneName')?.value;
    if (name === 'GMT' || name === 'UTC') return 0;
    const match = name?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (!match) {
        throw new PublicHttpError(400, 'INVALID_TIMEZONE', 'The timezone offset could not be validated.');
    }
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
};

const suppliedOffsetMinutes = (value: string): number => {
    if (value.endsWith('Z')) return 0;
    const match = value.match(/([+-])(\d{2}):(\d{2})$/);
    if (!match) throw new PublicHttpError(400, 'INVALID_INTERVAL', 'A UTC offset is required.');
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
};

export class CoordinationSchedulingService {
    constructor(private readonly pool: Pool) {}

    async list(actorDid: string): Promise<{ windows: Record<string, unknown>[] }> {
        const rows = await this.pool.query<WindowRow & ConnectionRow>(
            `SELECT w.*, c.request_uri, c.requester_did, c.helper_did,
                    c.status AS connection_status, r.current_status
             FROM coordination_windows w
             JOIN coordination_connections c USING (connection_id)
             JOIN request_workflows r ON r.post_uri = c.request_uri
             WHERE $1 IN (c.requester_did, c.helper_did)
             ORDER BY w.start_at, w.window_id`,
            [actorDid],
        );
        const visible: Record<string, unknown>[] = [];
        for (const row of rows.rows) {
            await this.assertSafety(this.pool, {
                connection_id: row.connection_id,
                request_uri: row.request_uri,
                requester_did: row.requester_did,
                helper_did: row.helper_did,
                status: (row as unknown as { connection_status: string }).connection_status,
                current_status: row.current_status,
            }, actorDid, false);
            visible.push(this.render(row));
        }
        return { windows: visible };
    }

    async propose(actorDid: string, input: unknown, now = new Date()): Promise<{ window: Record<string, unknown> }> {
        const parsed = intervalSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_SCHEDULE_PROPOSAL', 'The schedule proposal is invalid.');
        const start = new Date(parsed.data.startAt);
        const end = new Date(parsed.data.endAt);
        this.validateInterval(start, end, parsed.data.startAt, parsed.data.endAt, parsed.data.timezone, now);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const connection = await this.loadConnection(client, parsed.data.connectionId, actorDid);
            const existingResult = await client.query<WindowRow>(
                `SELECT * FROM coordination_windows WHERE connection_id = $1 FOR UPDATE`,
                [connection.connection_id],
            );
            const existing = existingResult.rows[0];
            const otherDid = actorDid === connection.requester_did ? connection.helper_did : connection.requester_did;
            let action: 'proposed' | 'counter-proposed' = 'proposed';
            let row: WindowRow;
            if (existing) {
                if (existing.status !== 'proposed') {
                    throw new PublicHttpError(409, 'SCHEDULE_NOT_PROPOSABLE', 'This connection schedule cannot be replaced in its current state.');
                }
                if (existing.recipient_did !== actorDid) {
                    throw new PublicHttpError(403, 'COUNTER_PROPOSAL_FORBIDDEN', 'Only the current recipient may counter-propose.');
                }
                if (parsed.data.expectedVersion !== existing.version) {
                    throw new PublicHttpError(409, 'STALE_SCHEDULE', 'The schedule changed. Refresh before trying again.');
                }
                action = 'counter-proposed';
                const updated = await client.query<WindowRow>(
                    `UPDATE coordination_windows
                     SET proposer_did=$2, recipient_did=$3, start_at=$4, end_at=$5,
                         originating_timezone=$6, version=version+1,
                         proposal_expires_at=$7, reminder_eligible_at=$8,
                         reminder_sent_at=NULL, updated_at=$9
                     WHERE window_id=$1 RETURNING *`,
                    [existing.window_id, actorDid, otherDid, start, end, parsed.data.timezone,
                     this.proposalExpiry(start, now), this.reminderAt(start, now), now],
                );
                row = updated.rows[0]!;
            } else {
                if (parsed.data.expectedVersion !== undefined) {
                    throw new PublicHttpError(409, 'STALE_SCHEDULE', 'No current schedule exists for that version.');
                }
                const created = await client.query<WindowRow>(
                    `INSERT INTO coordination_windows (
                        window_id, connection_id, proposer_did, recipient_did,
                        start_at, end_at, originating_timezone, status, version,
                        proposal_expires_at, reminder_eligible_at,
                        retention_until, created_at, updated_at
                     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'proposed',1,$8,$9,$10,$11,$11)
                     RETURNING *`,
                    [randomUUID(), connection.connection_id, actorDid, otherDid,
                     start, end, parsed.data.timezone, this.proposalExpiry(start, now),
                     this.reminderAt(start, now), plusDays(now, 365), now],
                );
                row = created.rows[0]!;
            }
            await this.recordEvent(client, row, actorDid, action, existing?.status ?? null, now);
            await this.notify(client, row, otherDid, action === 'proposed' ? 'schedule_proposed' : 'schedule_changed', now);
            await client.query('COMMIT');
            return { window: this.render(row) };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    async decide(actorDid: string, input: unknown, now = new Date()): Promise<{ window: Record<string, unknown> }> {
        const parsed = decisionSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_SCHEDULE_DECISION', 'The schedule decision is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const connection = await this.loadConnection(client, parsed.data.connectionId, actorDid);
            const result = await client.query<WindowRow>(
                `SELECT * FROM coordination_windows WHERE connection_id=$1 FOR UPDATE`,
                [connection.connection_id],
            );
            const current = result.rows[0];
            if (!current) throw new PublicHttpError(404, 'SCHEDULE_NOT_FOUND', 'No schedule exists for this connection.');
            if (current.version !== parsed.data.expectedVersion) throw new PublicHttpError(409, 'STALE_SCHEDULE', 'The schedule changed. Refresh before trying again.');
            if (parsed.data.action === 'cancel') {
                if (current.status !== 'confirmed') throw new PublicHttpError(409, 'SCHEDULE_NOT_CONFIRMED', 'Only a confirmed schedule can be cancelled.');
            } else {
                if (current.status !== 'proposed') throw new PublicHttpError(409, 'SCHEDULE_NOT_PENDING', 'Only a pending proposal can be decided.');
                if (current.recipient_did !== actorDid) throw new PublicHttpError(403, 'SCHEDULE_DECISION_FORBIDDEN', 'Only the proposal recipient may decide it.');
                if (new Date(current.proposal_expires_at) <= now) throw new PublicHttpError(409, 'SCHEDULE_EXPIRED', 'The schedule proposal has expired.');
            }
            if (parsed.data.action === 'accept') await this.assertNoConflict(client, current);
            const status = parsed.data.action === 'accept' ? 'confirmed' : parsed.data.action === 'decline' ? 'declined' : 'cancelled';
            const updated = await client.query<WindowRow>(
                `UPDATE coordination_windows SET status=$2, version=version+1, updated_at=$3
                 WHERE window_id=$1 RETURNING *`,
                [current.window_id, status, now],
            );
            const row = updated.rows[0]!;
            await this.recordEvent(client, row, actorDid, status, current.status, now);
            const otherDid = actorDid === connection.requester_did ? connection.helper_did : connection.requester_did;
            await this.notify(client, row, otherDid, `schedule_${status}` as 'schedule_confirmed' | 'schedule_declined' | 'schedule_cancelled', now);
            await client.query('COMMIT');
            return { window: this.render(row) };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async runSweep(now = new Date()): Promise<{ expired: number; reminders: number }> {
        const client = await this.pool.connect();
        let expired = 0;
        let reminders = 0;
        try {
            await client.query('BEGIN');
            const expiredRows = await client.query<WindowRow>(
                `UPDATE coordination_windows SET status='expired', version=version+1, updated_at=$1
                 WHERE status='proposed' AND proposal_expires_at <= $1 RETURNING *`, [now]);
            for (const row of expiredRows.rows) {
                await this.recordEvent(client, row, null, 'expired', 'proposed', now);
                await this.notify(client, row, row.proposer_did, 'schedule_expired', now);
                await this.notify(client, row, row.recipient_did, 'schedule_expired', now);
            }
            expired = expiredRows.rowCount ?? 0;
            const reminderRows = await client.query<WindowRow>(
                `UPDATE coordination_windows SET reminder_sent_at=$1, updated_at=$1
                 WHERE status='confirmed' AND reminder_sent_at IS NULL
                   AND reminder_eligible_at <= $1 AND start_at > $1 RETURNING *`, [now]);
            for (const row of reminderRows.rows) {
                await this.recordEvent(client, row, null, 'reminder-eligible', 'confirmed', now);
                await this.notify(client, row, row.proposer_did, 'schedule_reminder', now);
                await this.notify(client, row, row.recipient_did, 'schedule_reminder', now);
            }
            reminders = reminderRows.rowCount ?? 0;
            await client.query('COMMIT');
            return { expired, reminders };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    private validateInterval(start: Date, end: Date, startRaw: string, endRaw: string, timezone: string, now: Date): void {
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end)
            throw new PublicHttpError(400, 'INVALID_INTERVAL', 'The schedule must end after it starts.');
        if (start <= now || end.getTime() - start.getTime() > 7 * 86_400_000)
            throw new PublicHttpError(400, 'INVALID_INTERVAL', 'The schedule must be future-dated and no longer than seven days.');
        if (timeZoneOffsetMinutes(start, timezone) !== suppliedOffsetMinutes(startRaw) ||
            timeZoneOffsetMinutes(end, timezone) !== suppliedOffsetMinutes(endRaw))
            throw new PublicHttpError(400, 'TIMEZONE_OFFSET_MISMATCH', 'The supplied offsets do not match the IANA timezone at those instants.');
    }

    private proposalExpiry(start: Date, now: Date): Date {
        return new Date(Math.min(start.getTime() - 60_000, now.getTime() + 7 * 86_400_000));
    }
    private reminderAt(start: Date, now: Date): Date {
        return new Date(Math.max(now.getTime(), start.getTime() - 3_600_000));
    }

    private async loadConnection(client: PoolClient, id: string, actorDid: string): Promise<ConnectionRow> {
        const result = await client.query<ConnectionRow>(
            `SELECT c.connection_id,c.request_uri,c.requester_did,c.helper_did,c.status,r.current_status
             FROM coordination_connections c JOIN request_workflows r ON r.post_uri=c.request_uri
             WHERE c.connection_id=$1 FOR UPDATE OF c`, [id]);
        const row = result.rows[0];
        if (!row || (actorDid !== row.requester_did && actorDid !== row.helper_did))
            throw new PublicHttpError(404, 'CONNECTION_NOT_FOUND', 'The connection was not found.');
        await this.assertSafety(client, row, actorDid, true);
        return row;
    }

    private async assertSafety(client: Pick<Pool | PoolClient, 'query'>, row: ConnectionRow, actorDid: string, requireActive: boolean): Promise<void> {
        if (actorDid !== row.requester_did && actorDid !== row.helper_did)
            throw new PublicHttpError(404, 'CONNECTION_NOT_FOUND', 'The connection was not found.');
        if (requireActive && (row.status !== 'active' || !['assigned', 'in_progress'].includes(row.current_status)))
            throw new PublicHttpError(409, 'CONNECTION_NOT_ACTIVE', 'The connection is not active.');
        const deactivated = await client.query(`SELECT 1 FROM account_deactivations WHERE did_hash=ANY($1::text[])`, [[hash(row.requester_did), hash(row.helper_did)]]);
        if (deactivated.rowCount) throw new PublicHttpError(409, 'PARTICIPANT_DEACTIVATED', 'A participant account is no longer active.');
        const blocked = await client.query(`SELECT 1 FROM user_blocks WHERE deleted_at IS NULL AND ((blocker_did=$1 AND subject_did=$2) OR (blocker_did=$2 AND subject_did=$1))`, [row.requester_did, row.helper_did]);
        if (blocked.rowCount) throw new PublicHttpError(409, 'PARTICIPANTS_BLOCKED', 'The participants cannot coordinate.');
        const moderated = await client.query(`SELECT 1 FROM moderation_queue_items WHERE subject_uri=$1 AND (visibility<>'visible' OR queue_status='queued' OR appeal_state IN ('pending','under-review'))`, [row.request_uri]);
        if (moderated.rowCount) throw new PublicHttpError(409, 'COORDINATION_QUARANTINED', 'The connection is not eligible for scheduling.');
    }

    private async assertNoConflict(client: PoolClient, row: WindowRow): Promise<void> {
        const conflict = await client.query(
            `SELECT 1 FROM coordination_windows other
             WHERE other.window_id<>$1 AND other.status='confirmed'
               AND (other.proposer_did=ANY($2::text[]) OR other.recipient_did=ANY($2::text[]))
               AND other.start_at<$4 AND $3<other.end_at LIMIT 1`,
            [row.window_id, [row.proposer_did, row.recipient_did], new Date(row.start_at), new Date(row.end_at)]);
        if (conflict.rowCount) throw new PublicHttpError(409, 'SCHEDULE_CONFLICT', 'A participant already has a confirmed overlapping schedule.');
    }

    private async recordEvent(client: PoolClient, row: WindowRow, actorDid: string | null, action: string, previous: string | null, now: Date): Promise<void> {
        await client.query(`INSERT INTO coordination_window_events (window_id,actor_did,action,previous_status,next_status,version,occurred_at,retention_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [row.window_id, actorDid, action, previous, row.status, row.version, now, plusDays(now, 365)]);
    }

    private async notify(client: PoolClient, row: WindowRow, recipientDid: string, kind: string, now: Date): Promise<void> {
        const title = kind === 'schedule_reminder' ? 'Coordination reminder' : kind === 'schedule_expired' ? 'Coordination window expired' : 'Coordination schedule updated';
        const body = kind === 'schedule_reminder' ? 'A confirmed coordination window begins soon.' : 'Open your connection to review the schedule status.';
        const key = `schedule:${row.window_id}:${row.version}:${kind}:${recipientDid}`;
        const actionUrl = `/scheduling?connection=${encodeURIComponent(row.connection_id)}`;
        await client.query(`INSERT INTO activity_inbox_items (item_id,recipient_did,item_type,title,summary,action_url,source_key,metadata,occurred_at,retention_until) VALUES ($1,$2,'scheduling',$3,$4,$9,$5,$6::jsonb,$7,$8) ON CONFLICT (recipient_did,source_key) DO NOTHING`,
            [randomUUID(), recipientDid, title, body, key, JSON.stringify({ windowId: row.window_id, connectionId: row.connection_id, status: row.status }), now, plusDays(now, 365), actionUrl]);
        await client.query(`SELECT patchwork_enqueue_notification($1,$2,$3,$4,'normal',$8,$5::jsonb,$6,$7)`,
            [recipientDid, kind, title, body, JSON.stringify({ windowId: row.window_id, connectionId: row.connection_id, status: row.status }), key, now, actionUrl]);
    }

    private render(row: WindowRow): Record<string, unknown> {
        return { id: row.window_id, connectionId: row.connection_id, proposerDid: row.proposer_did,
            recipientDid: row.recipient_did, startAt: toIso(row.start_at), endAt: toIso(row.end_at),
            timezone: row.originating_timezone, status: row.status, version: row.version,
            proposalExpiresAt: toIso(row.proposal_expires_at), reminderEligibleAt: toIso(row.reminder_eligible_at),
            reminderSentAt: toIso(row.reminder_sent_at), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) };
    }
}
