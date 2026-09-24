import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
    DurableNotificationService,
    type DeliveryProviderResult,
    type EmailProvider,
    type PushProvider,
} from './durable-notification-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const ownerDid = 'did:plc:notification-owner';
const helperDid = 'did:plc:notification-helper';
const requestUri =
    `at://${ownerDid}/app.patchwork.aid.post/notification-request`;

class FakeEmailProvider implements EmailProvider {
    readonly sends: Array<{
        to: string;
        subject: string;
        text: string;
        idempotencyKey: string;
    }> = [];
    readonly results: DeliveryProviderResult[] = [];

    async send(input: {
        to: string;
        subject: string;
        text: string;
        idempotencyKey: string;
    }): Promise<DeliveryProviderResult> {
        this.sends.push(input);
        return this.results.shift() ?? {
            accepted: true,
            providerMessageId: `email-${this.sends.length}`,
        };
    }
}

class FakePushProvider implements PushProvider {
    readonly sends: Array<{
        endpoint: string;
        p256dh: string;
        auth: string;
        payload: string;
        idempotencyKey: string;
    }> = [];
    readonly results: DeliveryProviderResult[] = [];

    async send(input: {
        endpoint: string;
        p256dh: string;
        auth: string;
        payload: string;
        idempotencyKey: string;
    }): Promise<DeliveryProviderResult> {
        this.sends.push(input);
        return this.results.shift() ?? {
            accepted: true,
            providerMessageId: `push-${this.sends.length}`,
        };
    }
}

describe('durable notification outbox', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    let email: FakeEmailProvider;
    let push: FakePushProvider;
    let service: DurableNotificationService;

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE notification_delivery_attempts,
                      notification_push_subscriptions,
                      notification_email_endpoints,
                      notification_intents,
                      moderation_notification_events,
                      coordination_offer_events,
                      coordination_connections,
                      coordination_offers,
                      request_transition_events,
                      request_workflows,
                      verification_appeals,
                      verification_applications,
                      abuse_reports,
                      account_preference_audit,
                      account_preferences
             RESTART IDENTITY CASCADE`,
        );
        await pool.query(
            `INSERT INTO account_preferences (
                did, privacy, notifications, visibility, language, location,
                created_at, updated_at
             ) VALUES (
                $1, 'community',
                '{"inApp":true,"email":true,"push":true}',
                'authenticated', 'en',
                '{"sharing":"approximate","noPermanentAddress":false}',
                NOW(), NOW()
             )`,
            [ownerDid],
        );
        await pool.query(
            `INSERT INTO request_workflows (
                post_uri, requester_did, current_status, create_command_id,
                created_at, updated_at
             ) VALUES ($1, $2, 'open', $3, NOW(), NOW())`,
            [requestUri, ownerDid, randomUUID()],
        );
        email = new FakeEmailProvider();
        push = new FakePushProvider();
        service = new DurableNotificationService(
            pool,
            { email, push },
            { publicWebOrigin: 'https://patchwork.test' },
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('commits domain events and deduplicated notification intents atomically across restart', async () => {
        const offerId = randomUUID();
        await pool.query(
            `INSERT INTO coordination_offers (
                offer_id, request_uri, requester_did, offerer_did, note,
                status, offered_at, expires_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, NULL, 'pending', NOW(),
                NOW() + INTERVAL '1 hour', NOW()
             )`,
            [offerId, requestUri, ownerDid, helperDid],
        );

        const client = await pool.connect();
        await client.query('BEGIN');
        await client.query(
            `INSERT INTO coordination_offer_events (
                offer_id, actor_did, action, next_status, public_summary,
                private_details, occurred_at
             ) VALUES (
                $1, $2, 'offered', 'pending', 'Offer created.',
                '{"requestUri":"safe"}', NOW()
             )`,
            [offerId, helperDid],
        );
        expect(
            (
                await client.query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count
                       FROM notification_intents`,
                )
            ).rows[0]?.count,
        ).toBe('1');
        await client.query('ROLLBACK');
        client.release();
        expect(
            (
                await pool.query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count
                       FROM notification_intents`,
                )
            ).rows[0]?.count,
        ).toBe('0');

        await pool.query(
            `INSERT INTO coordination_offer_events (
                offer_id, actor_did, action, next_status, public_summary,
                private_details, occurred_at
             ) VALUES (
                $1, $2, 'offered', 'pending', 'Offer created.',
                '{"requestUri":"safe"}', NOW()
             )`,
            [offerId, helperDid],
        );
        await pool.query(
            `SELECT patchwork_enqueue_notification(
                $1, 'offer_received', 'Duplicate', 'Duplicate intent.',
                'normal', '/inbox', '{}'::jsonb,
                'coordination-event:2', NOW()
             )`,
            [ownerDid],
        );
        const first = await service.list(ownerDid);
        expect(first).toMatchObject({
            total: 1,
            unread: 1,
            items: [
                {
                    type: 'offer_received',
                    title: 'New offer',
                    templateVersion: 'v1',
                    actionUrl: '/inbox',
                },
            ],
        });
        expect(JSON.stringify(first)).not.toMatch(
            /exactLatitude|exactLongitude|private_details|note/u,
        );

        const restarted = new DurableNotificationService(pool);
        expect(
            await restarted.markRead(ownerDid, first.items[0]!.id, true),
        ).toBe(true);
        expect(await restarted.list(ownerDid, { filter: 'unread' }))
            .toMatchObject({ unread: 0, items: [] });
        expect(
            await restarted.markRead(ownerDid, first.items[0]!.id, false),
        ).toBe(true);
        expect(await restarted.archive(ownerDid, first.items[0]!.id))
            .toBe(true);
        expect(await restarted.list(ownerDid, { filter: 'archived' }))
            .toMatchObject({ items: [{ archived: true }] });
    });

    it('verifies destinations, delivers safe external payloads, and records provider idempotency', async () => {
        const verification = await service.requestEmailVerification(
            ownerDid,
            'Owner@Example.test',
        );
        expect(verification.expiresAt).toBeTruthy();
        const link = email.sends[0]!.text.match(/https:\/\/\S+/u)?.[0];
        const token = link ?
            new URL(link).searchParams.get('emailToken')
        :   null;
        expect(token).toBeTruthy();
        expect(await service.confirmEmail(ownerDid, token!)).toBe(true);
        await service.registerPush(ownerDid, {
            endpoint: 'https://push.example.test/subscription/one',
            p256dh: 'p256dh-public-key-material',
            auth: 'auth-secret-material',
            userAgent: 'private browser details',
        });
        email.sends.length = 0;

        await pool.query(
            `SELECT patchwork_enqueue_notification(
                $1, 'lifecycle_changed', 'Request status updated',
                'Your request moved to a new lifecycle state.',
                'normal', '/inbox',
                '{"postUri":"at://safe/request","status":"resolved"}',
                'delivery-safe-one', NOW()
             )`,
            [ownerDid],
        );
        expect(await service.materializeChannels()).toBe(1);
        expect(await service.runDeliverySweep()).toMatchObject({
            processed: 2,
            delivered: 2,
            failed: 0,
        });
        expect(email.sends).toHaveLength(1);
        expect(push.sends).toHaveLength(1);
        expect(email.sends[0]).toMatchObject({
            to: 'owner@example.test',
            subject: 'Request status updated',
        });
        expect(JSON.parse(push.sends[0]!.payload)).toEqual({
            title: 'Request status updated',
            body: 'Your request moved to a new lifecycle state.',
            actionUrl: '/inbox',
        });
        const observable = JSON.stringify([email.sends, push.sends]);
        expect(observable).not.toMatch(
            /exact|latitude|longitude|street|contact|private|did:plc/u,
        );
        const attempts = await pool.query<{
            channel: string;
            status: string;
            attempt_count: number;
            provider_idempotency_key: string;
        }>(
            `SELECT channel, status, attempt_count,
                    provider_idempotency_key
               FROM notification_delivery_attempts
              ORDER BY channel`,
        );
        expect(attempts.rows).toEqual([
            expect.objectContaining({
                channel: 'email',
                status: 'sent',
                attempt_count: 1,
            }),
            expect.objectContaining({
                channel: 'push',
                status: 'sent',
                attempt_count: 1,
            }),
        ]);
        expect(new Set(
            attempts.rows.map(row => row.provider_idempotency_key),
        ).size).toBe(2);
    });

    it('atomically covers offer, connection, lifecycle, verification, appeal, expiry, and moderation sources', async () => {
        const offerId = randomUUID();
        await pool.query(
            `INSERT INTO coordination_offers (
                offer_id, request_uri, requester_did, offerer_did, note,
                status, offered_at, expires_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, NULL, 'accepted', NOW(),
                NOW() + INTERVAL '1 hour', NOW()
             )`,
            [offerId, requestUri, ownerDid, helperDid],
        );
        await pool.query(
            `
             INSERT INTO coordination_offer_events (
                offer_id, actor_did, action, next_status, public_summary,
                private_details, occurred_at
             ) VALUES
                ($1, $3, 'offered', 'pending', 'Offer created.',
                 '{}'::jsonb, NOW()),
                ($1, $2, 'accepted', 'accepted', 'Offer accepted.',
                 '{}'::jsonb, NOW()),
                ($1, $2, 'connection-completed', 'completed',
                 'Connection completed.', '{}'::jsonb, NOW()),
                ($1, $2, 'expired', 'expired', 'Offer expired.',
                 '{}'::jsonb, NOW()),
                ($1, $2, 'connection-cancelled', 'cancelled',
                 'Connection cancelled.', '{}'::jsonb, NOW())`,
            [offerId, ownerDid, helperDid],
        );
        await pool.query(
            `INSERT INTO request_transition_events (
                command_id, post_uri, actor_did, from_status, to_status,
                reason, occurred_at
             ) VALUES (
                $1, $2, $3, 'open', 'triaged', NULL, NOW()
             )`,
            [randomUUID(), requestUri, ownerDid],
        );

        const applicationId = randomUUID();
        const appealId = randomUUID();
        await pool.query(
            `INSERT INTO verification_applications (
                application_id, applicant_did, subject_type,
                organization_id, subject_ref, status, submitted_at,
                updated_at
             ) VALUES (
                $1, $2, 'volunteer', NULL, $2, 'pending', NOW(), NOW()
             )`,
            [applicationId, ownerDid],
        );
        await pool.query(
            `
             UPDATE verification_applications
                SET status = 'approved', decided_at = NOW(),
                    expires_at = NOW() + INTERVAL '1 year',
                    updated_at = NOW()
              WHERE application_id = $1`,
            [applicationId],
        );
        await pool.query(
            `
             INSERT INTO verification_appeals (
                appeal_id, application_id, applicant_did, reason, status,
                submitted_at
             ) VALUES (
                $3, $1, $2, 'Please review this decision.', 'pending', NOW()
             )`,
            [applicationId, ownerDid, appealId],
        );
        await pool.query(
            `
             UPDATE verification_appeals
                SET status = 'upheld', resolved_at = NOW(),
                    resolved_by_did = 'did:plc:moderator'
              WHERE appeal_id = $1`,
            [appealId],
        );
        await pool.query(
            `
             UPDATE verification_applications
                SET status = 'expired', updated_at = NOW()
              WHERE application_id = $1`,
            [applicationId],
        );
        await pool.query(
            `INSERT INTO abuse_reports (
                command_id, reporter_did, subject_uri, reason, details,
                status, retention_until, created_at
             ) VALUES (
                $1, $2, $3, 'safety', 'private report body', 'pending',
                NOW() + INTERVAL '30 days', NOW()
             )`,
            [randomUUID(), ownerDid, requestUri],
        );
        await pool.query(
            `
             UPDATE abuse_reports
                SET status = 'resolved'
              WHERE command_id = $1`,
            [
                (
                    await pool.query<{ command_id: string }>(
                        `SELECT command_id
                           FROM abuse_reports
                          WHERE reporter_did = $1
                          ORDER BY report_id DESC LIMIT 1`,
                        [ownerDid],
                    )
                ).rows[0]!.command_id,
            ],
        );

        const rows = await pool.query<{
            recipient_did: string;
            notification_type: string;
            metadata: Record<string, unknown>;
        }>(
            `SELECT recipient_did, notification_type, metadata
               FROM notification_intents
              ORDER BY created_at, notification_id`,
        );
        expect(rows.rows.map(row => row.notification_type)).toEqual(
            expect.arrayContaining([
                'offer_received',
                'offer_accepted',
                'offer_expired',
                'connection_started',
                'connection_completed',
                'connection_cancelled',
                'lifecycle_changed',
                'verification_submitted',
                'verification_decided',
                'appeal_submitted',
                'appeal_decided',
                'account_expiry',
                'moderation_action',
            ]),
        );
        expect(rows.rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    recipient_did: ownerDid,
                    notification_type: 'offer_received',
                }),
                expect.objectContaining({
                    recipient_did: helperDid,
                    notification_type: 'offer_accepted',
                }),
            ]),
        );
        expect(JSON.stringify(rows.rows)).not.toMatch(
            /private report body|reason|details|exactLatitude|exactLongitude/u,
        );
        const before = rows.rowCount;
        await pool.query(
            `SELECT patchwork_enqueue_notification(
                $1, 'moderation_action', 'Duplicate', 'Duplicate intent.',
                'normal', '/notifications', '{}'::jsonb,
                (
                    SELECT deduplication_key
                      FROM notification_intents
                     WHERE notification_type = 'moderation_action'
                     LIMIT 1
                ),
                NOW()
             )`,
            [ownerDid],
        );
        expect(
            (
                await pool.query<{ count: number }>(
                    `SELECT COUNT(*)::int AS count
                       FROM notification_intents`,
                )
            ).rows[0]?.count,
        ).toBe(before);
    });

    it('retries across restart, dead-letters permanent failures, and cleans invalid subscriptions', async () => {
        await service.registerPush(ownerDid, {
            endpoint: 'https://push.example.test/subscription/retry',
            p256dh: 'p256dh-public-key-material',
            auth: 'auth-secret-material',
        });
        await pool.query(
            `SELECT patchwork_enqueue_notification(
                $1, 'appeal_decided', 'Appeal decided',
                'A moderator resolved your verification appeal.',
                'normal', '/verification', '{}'::jsonb,
                'retry-one', NOW()
             )`,
            [ownerDid],
        );
        push.results.push({
            accepted: false,
            retryable: true,
            errorCode: 'push-timeout',
        });
        expect(await service.runDeliverySweep()).toMatchObject({
            processed: 1,
            failed: 1,
        });
        await pool.query(
            `UPDATE notification_delivery_attempts
                SET next_attempt_at = NOW()
              WHERE status = 'retry'`,
        );
        const restarted = new DurableNotificationService(
            pool,
            { push },
            { publicWebOrigin: 'https://patchwork.test' },
        );
        expect(await restarted.runDeliverySweep()).toMatchObject({
            processed: 1,
            delivered: 1,
        });
        expect(push.sends[0]!.idempotencyKey)
            .toBe(push.sends[1]!.idempotencyKey);

        await pool.query(
            `SELECT patchwork_enqueue_notification(
                $1, 'moderation_action', 'Report status updated',
                'A moderator updated the status of your report.',
                'normal', '/notifications', '{}'::jsonb,
                'invalid-push-one', NOW()
             )`,
            [ownerDid],
        );
        push.results.push({
            accepted: false,
            invalidTarget: true,
            errorCode: 'push-http-410',
        });
        expect(await restarted.runDeliverySweep()).toMatchObject({
            processed: 1,
            failed: 1,
        });
        const subscriptions = await pool.query<{
            revoked_at: Date | null;
            invalid_reason_code: string | null;
        }>(
            `SELECT revoked_at, invalid_reason_code
               FROM notification_push_subscriptions`,
        );
        expect(subscriptions.rows[0]).toMatchObject({
            revoked_at: expect.any(Date),
            invalid_reason_code: 'push-http-410',
        });

        await pool.query(
            `UPDATE notification_push_subscriptions
                SET revoked_at = NULL, invalid_reason_code = NULL`,
        );
        await pool.query(
            `SELECT patchwork_enqueue_notification(
                $1, 'account_expiry', 'Verification expired',
                'Your verification expired and may be renewed.',
                'high', '/verification', '{}'::jsonb,
                'permanent-failure-one', NOW()
             )`,
            [ownerDid],
        );
        push.results.push({
            accepted: false,
            retryable: false,
            errorCode: 'push-http-403',
        });
        expect(await restarted.runDeliverySweep()).toMatchObject({
            processed: 1,
            failed: 1,
        });
        expect(await restarted.getOperatorMetrics()).toMatchObject({
            deadLetter: 1,
        });
    });

    it('delivers each urgent moderation event to configured moderator channels exactly once across restart', async () => {
        const moderatorDid = 'did:plc:urgent-moderator';
        await pool.query(
            `INSERT INTO platform_roles (did, role, updated_by, updated_at)
             VALUES ($1, 'moderator', 'did:plc:test-admin', NOW())
             ON CONFLICT (did) DO UPDATE SET role = 'moderator'`,
            [moderatorDid],
        );
        await pool.query(
            `INSERT INTO account_preferences (
                did, privacy, notifications, visibility, language, location,
                created_at, updated_at
             ) VALUES (
                $1, 'community',
                '{"inApp":true,"email":false,"push":true}',
                'authenticated', 'en',
                '{"sharing":"approximate","noPermanentAddress":false}',
                NOW(), NOW()
             )
             ON CONFLICT (did) DO UPDATE SET
                notifications = EXCLUDED.notifications,
                updated_at = NOW()`,
            [moderatorDid],
        );
        await service.registerPush(moderatorDid, {
            endpoint: 'https://push.example.test/subscription/urgent-moderator',
            p256dh: 'urgent-moderator-p256dh-key-material',
            auth: 'urgent-moderator-auth-material',
        });
        await pool.query(
            `INSERT INTO moderation_notification_events (
                subject_uri, priority, reason_codes, deduplication_key,
                created_at, retention_until
             ) VALUES (
                'at://did:plc:alice/app.patchwork.aid.post/urgent',
                'urgent', '["emergency-intent"]'::jsonb,
                'urgent-submission:test', NOW(), NOW() + INTERVAL '30 days'
             )`,
        );

        expect(await service.runDeliverySweep()).toMatchObject({
            processed: 1,
            delivered: 1,
        });
        expect(push.sends).toHaveLength(1);
        expect(push.sends[0]?.payload).toContain('Urgent moderation review');

        const restarted = new DurableNotificationService(
            pool,
            { email, push },
            { publicWebOrigin: 'https://patchwork.test' },
        );
        expect(await restarted.runDeliverySweep()).toEqual({
            processed: 0,
            delivered: 0,
            failed: 0,
        });
        expect(push.sends).toHaveLength(1);
        const consumed = await pool.query<{ consumed_at: Date }>(
            `SELECT consumed_at FROM moderation_notification_events
              WHERE deduplication_key = 'urgent-submission:test'`,
        );
        expect(consumed.rows[0]?.consumed_at).toBeInstanceOf(Date);
        await pool.query('DELETE FROM platform_roles WHERE did = $1', [moderatorDid]);
    });

    it('prevents endpoint takeover and rejects private notification metadata', async () => {
        await service.requestEmailVerification(
            ownerDid,
            'owned@example.test',
        );
        await expect(
            service.requestEmailVerification(
                helperDid,
                'owned@example.test',
            ),
        ).rejects.toThrow('NOTIFICATION_EMAIL_ALREADY_REGISTERED');

        const endpoint =
            'https://push.example.test/subscription/owned';
        await service.registerPush(ownerDid, {
            endpoint,
            p256dh: 'owner-p256dh-public-key-material',
            auth: 'owner-auth-secret',
        });
        await pool.query(
            `INSERT INTO account_preferences (
                did, privacy, notifications, visibility, language, location,
                created_at, updated_at
             ) VALUES (
                $1, 'community',
                '{"inApp":true,"email":false,"push":true}',
                'authenticated', 'en',
                '{"sharing":"approximate","noPermanentAddress":false}',
                NOW(), NOW()
             )`,
            [helperDid],
        );
        await expect(
            service.registerPush(helperDid, {
                endpoint,
                p256dh: 'helper-p256dh-public-key-material',
                auth: 'helper-auth-secret',
            }),
        ).rejects.toThrow('PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT');
        const owner = await pool.query<{ owner_did: string }>(
            `SELECT owner_did
               FROM notification_push_subscriptions
              WHERE endpoint = $1`,
            [endpoint],
        );
        expect(owner.rows).toEqual([{ owner_did: ownerDid }]);

        await expect(
            pool.query(
                `SELECT patchwork_enqueue_notification(
                    $1, 'moderation_action', 'Unsafe metadata',
                    'Open Patchwork for details.', 'normal',
                    '/notifications',
                    '{"nested":{"exactLatitude":41.88}}'::jsonb,
                    'unsafe-private-metadata', NOW()
                 )`,
                [ownerDid],
            ),
        ).rejects.toMatchObject({ code: '23514' });
    });
});
