import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModerationQueueItem } from '@patchwork/shared';
import { runModerationMigrations } from './migrate.js';
import { PostgresModerationAuditStore } from './postgres-audit-store.js';
import { PostgresModerationQueueStore } from './postgres-queue-store.js';
import { PostgresModerationRetentionService } from './postgres-retention-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const queued = (suffix: string, at: string): ModerationQueueItem => ({
    queueId: `retention-${suffix}`,
    subjectUri: `at://did:plc:retention/app.patchwork.aid.post/${suffix}`,
    subjectType: 'aid-post',
    reasons: ['user-report:spam'],
    latestReason: 'user-report:spam',
    reportCount: 1,
    queueStatus: 'queued',
    visibility: 'visible',
    appealState: 'none',
    createdAt: at,
    requestedAt: at,
    updatedAt: at,
    context: {},
});

describe('moderation retention enforcement', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const queue = new PostgresModerationQueueStore(pool);
    const audit = new PostgresModerationAuditStore(pool);
    const retention = new PostgresModerationRetentionService(pool);

    beforeAll(async () => {
        await runModerationMigrations({ pool });
    });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE moderation_notification_events,
                      moderation_submission_reviews,
                      moderation_audit_records,
                      moderation_queue_items
             RESTART IDENTITY CASCADE`,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('expires old resolved casework while preserving active and recent cases', async () => {
        const expired = queued('expired', '2026-07-01T00:00:00Z');
        const recent = queued('recent', '2026-07-10T00:00:00Z');
        const active = queued('active', '2026-06-01T00:00:00Z');
        await queue.enqueue(expired);
        await queue.enqueue(recent);
        await queue.enqueue(active);
        await audit.applyPolicyAction({
            subjectUri: expired.subjectUri,
            actorDid: 'did:plc:moderator',
            action: 'delist',
            reason: 'confirmed',
            occurredAt: '2026-07-01T01:00:00Z',
            idempotencyKey: 'retention-expired',
        });
        await audit.applyPolicyAction({
            subjectUri: recent.subjectUri,
            actorDid: 'did:plc:moderator',
            action: 'delist',
            reason: 'confirmed',
            occurredAt: '2026-07-10T01:00:00Z',
            idempotencyKey: 'retention-recent',
        });

        await expect(
            retention.enforce(new Date('2026-07-11T00:00:00Z')),
        ).resolves.toEqual({
            auditRecords: 1,
            resolvedCases: 1,
            submissionReviews: 0,
            notificationEvents: 0,
        });

        await expect(queue.get(expired.subjectUri)).resolves.toBeNull();
        await expect(audit.getAuditTrail(expired.subjectUri)).resolves.toEqual([]);
        await expect(queue.get(recent.subjectUri)).resolves.toMatchObject({
            queueStatus: 'resolved',
        });
        await expect(queue.get(active.subjectUri)).resolves.toMatchObject({
            queueStatus: 'queued',
        });
    });
});
