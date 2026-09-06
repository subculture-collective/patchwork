import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CoordinationSchedulingService } from './coordination-scheduling-service.js';
import { AccountPrivacyService } from './account-privacy-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const requester = 'did:plc:schedule-requester';
const helper = 'did:plc:schedule-helper';
const outsider = 'did:plc:schedule-outsider';
const requestUri = `at://${requester}/app.patchwork.aid.post/schedule`;
const connectionId = '11111111-1111-4111-8111-111111111123';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describePostgres('CoordinationSchedulingService PostgreSQL boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const baseline = new Date('2026-07-01T12:00:00.000Z');

    beforeEach(async () => {
        await pool.query(`TRUNCATE notification_delivery_attempts,
            notification_intents, coordination_window_events,
            coordination_windows, activity_inbox_items,
            coordination_connections, coordination_offers, user_blocks,
            account_deactivations, moderation_queue_items, request_workflows
            RESTART IDENTITY CASCADE`);
        await pool.query(
            `INSERT INTO request_workflows (post_uri,requester_did,current_status,create_command_id,created_at,updated_at)
             VALUES ($1,$2,'assigned','schedule-workflow',$3,$3)`,
            [requestUri, requester, baseline],
        );
        const offerId = '11111111-1111-4111-8111-111111111122';
        await pool.query(
            `INSERT INTO coordination_offers (offer_id,request_uri,requester_did,offerer_did,status,offered_at,expires_at,updated_at)
             VALUES ($1,$2,$3,$4,'accepted',$5,$6,$5)`,
            [offerId, requestUri, requester, helper, baseline, new Date('2026-07-08T12:00:00Z')],
        );
        await pool.query(
            `INSERT INTO coordination_connections (connection_id,offer_id,request_uri,requester_did,helper_did,status,accepted_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,'active',$6,$6)`,
            [connectionId, offerId, requestUri, requester, helper, baseline],
        );
    });

    afterAll(async () => pool.end());

    it('persists propose, counter-propose, confirm, reminder, and cancellation with privacy-safe intent', async () => {
        const service = new CoordinationSchedulingService(pool);
        const proposed = await service.propose(requester, {
            connectionId,
            startAt: '2026-07-10T10:00:00-05:00',
            endAt: '2026-07-10T11:00:00-05:00',
            timezone: 'America/Chicago',
        }, baseline);
        expect(proposed.window).toMatchObject({ status: 'proposed', version: 1, startAt: '2026-07-10T15:00:00.000Z' });

        const restarted = new CoordinationSchedulingService(pool);
        const counter = await restarted.propose(helper, {
            connectionId,
            startAt: '2026-07-10T12:00:00-05:00',
            endAt: '2026-07-10T13:00:00-05:00',
            timezone: 'America/Chicago',
            expectedVersion: 1,
        }, new Date('2026-07-01T13:00:00Z'));
        expect(counter.window).toMatchObject({ proposerDid: helper, recipientDid: requester, version: 2 });
        await expect(restarted.decide(requester, { connectionId, action: 'accept', expectedVersion: 2 }, new Date('2026-07-01T14:00:00Z')))
            .resolves.toMatchObject({ window: { status: 'confirmed', version: 3 } });
        await expect(restarted.runSweep(new Date('2026-07-10T16:01:00Z')))
            .resolves.toEqual({ expired: 0, reminders: 1 });
        await expect(restarted.decide(helper, { connectionId, action: 'cancel', expectedVersion: 3 }, new Date('2026-07-10T16:02:00Z')))
            .resolves.toMatchObject({ window: { status: 'cancelled', version: 4 } });

        const notifications = await pool.query(`SELECT metadata, title, body, action_url FROM notification_intents ORDER BY created_at`);
        const serialized = JSON.stringify(notifications.rows);
        expect(serialized).not.toMatch(/latitude|longitude|streetAddress|message/i);
        expect(serialized).not.toContain('2026-07-10T17:00:00');
        expect(notifications.rows.length).toBeGreaterThanOrEqual(4);
        expect(notifications.rows.every(row => row.action_url === `/scheduling?connection=${connectionId}`)).toBe(true);
        await expect(new AccountPrivacyService(pool).exportFor(requester))
            .resolves.toMatchObject({
                data: {
                    coordination: {
                        windows: [expect.objectContaining({
                            connectionId,
                            status: 'cancelled',
                            timezone: 'America/Chicago',
                        })],
                    },
                },
            });
        await expect(restarted.list(outsider)).resolves.toEqual({ windows: [] });

        await new AccountPrivacyService(pool).deactivate(
            helper,
            'schedule-deactivate-after-export',
            new Date('2026-07-11T12:00:00Z'),
        );
        await expect(pool.query(`SELECT 1 FROM coordination_windows`))
            .resolves.toMatchObject({ rowCount: 0 });
    });

    it('rejects stale versions, timezone/DST mismatches, blocks, deactivation, and inactive connections', async () => {
        const service = new CoordinationSchedulingService(pool);
        await expect(service.propose(requester, {
            connectionId,
            startAt: '2026-11-01T01:30:00-05:00',
            endAt: '2026-11-01T02:30:00-05:00',
            timezone: 'America/Chicago',
        }, baseline)).rejects.toMatchObject({ code: 'TIMEZONE_OFFSET_MISMATCH' });

        await service.propose(requester, {
            connectionId,
            startAt: '2026-07-10T10:00:00-05:00',
            endAt: '2026-07-10T11:00:00-05:00',
            timezone: 'America/Chicago',
        }, baseline);
        await expect(service.decide(helper, { connectionId, action: 'accept', expectedVersion: 99 }))
            .rejects.toMatchObject({ code: 'STALE_SCHEDULE' });
        await pool.query(`INSERT INTO user_blocks (command_id,blocker_did,subject_did,created_at) VALUES ('schedule-block',$1,$2,NOW())`, [helper, requester]);
        await expect(service.list(requester)).rejects.toMatchObject({ code: 'PARTICIPANTS_BLOCKED' });
        await pool.query(`DELETE FROM user_blocks`);
        await pool.query(`INSERT INTO account_deactivations (did_hash,command_id,result,requested_at,retention_until) VALUES ($1,'schedule-deactivate','{}',NOW(),NOW()+INTERVAL '30 days')`, [hash(helper)]);
        await expect(service.decide(helper, { connectionId, action: 'accept', expectedVersion: 1 }))
            .rejects.toMatchObject({ code: 'PARTICIPANT_DEACTIVATED' });
    });
});
