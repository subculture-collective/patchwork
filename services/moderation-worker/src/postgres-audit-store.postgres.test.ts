import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModerationQueueItem } from '@patchwork/shared';
import { PostgresModerationQueueStore } from './postgres-queue-store.js';
import { PostgresModerationAuditStore } from './postgres-audit-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const queued: ModerationQueueItem = {
    queueId: 'queue-policy',
    subjectUri: 'at://did:plc:alice/app.patchwork.aid.post/policy',
    subjectType: 'aid-post',
    reasons: ['user-report:spam'],
    latestReason: 'user-report:spam',
    reportCount: 1,
    queueStatus: 'queued',
    visibility: 'visible',
    appealState: 'none',
    createdAt: '2026-07-11T23:10:00.000Z',
    requestedAt: '2026-07-11T23:10:00.000Z',
    updatedAt: '2026-07-11T23:10:00.000Z',
    context: {},
};

describe('PostgresModerationAuditStore', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const queue = new PostgresModerationQueueStore(pool);
    const audit = new PostgresModerationAuditStore(pool);

    beforeAll(async () => {
        await pool.query(
            await readFile(
                new URL('./migrations/001_create_moderation_tables.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/002_durable_moderation.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/003_retention_enforcement.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('./migrations/004_submission_safety_and_urgent_events.sql', import.meta.url),
                'utf8',
            ),
        );
    });

    beforeEach(async () => {
        await pool.query(
            'TRUNCATE moderation_audit_records, moderation_queue_items RESTART IDENTITY CASCADE',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('applies policy and audit atomically with idempotent retry', async () => {
        await queue.enqueue(queued);
        const command = {
            subjectUri: queued.subjectUri,
            actorDid: 'did:plc:moderator',
            action: 'delist' as const,
            reason: 'Confirmed spam',
            occurredAt: '2026-07-11T23:11:00.000Z',
            idempotencyKey: 'policy-command-1',
        };

        await expect(audit.applyPolicyAction(command)).resolves.toMatchObject({
            applied: true,
            item: { queueStatus: 'resolved', visibility: 'delisted' },
        });
        await expect(
            new PostgresModerationAuditStore(pool).applyPolicyAction(command),
        ).resolves.toMatchObject({ applied: false });
        await expect(audit.getAuditTrail(queued.subjectUri)).resolves.toHaveLength(1);
        const stored = await pool.query<{
            queue_status: string;
            visibility: string;
            retention_until: Date;
        }>(
            `SELECT queue_status, visibility, retention_until FROM moderation_queue_items
             WHERE subject_uri = $1`,
            [queued.subjectUri],
        );
        expect(stored.rows[0]).toEqual({
            queue_status: 'resolved',
            visibility: 'delisted',
            retention_until: new Date('2026-07-18T23:11:00.000Z'),
        });
        const auditRetention = await pool.query<{ retention_until: Date }>(
            `SELECT retention_until FROM moderation_audit_records
             WHERE idempotency_key = $1`,
            [command.idempotencyKey],
        );
        expect(auditRetention.rows[0]?.retention_until).toEqual(
            new Date('2026-07-18T23:11:00.000Z'),
        );
    });

    it('deduplicates concurrent delivery of one policy command', async () => {
        await queue.enqueue(queued);
        const command = {
            subjectUri: queued.subjectUri,
            actorDid: 'did:plc:moderator',
            action: 'suspend-visibility' as const,
            reason: 'Immediate safety risk',
            occurredAt: '2026-07-11T23:12:00.000Z',
            idempotencyKey: 'policy-command-concurrent',
        };

        const outcomes = await Promise.all([
            audit.applyPolicyAction(command),
            new PostgresModerationAuditStore(pool).applyPolicyAction(command),
        ]);

        expect(outcomes.map(outcome => outcome.applied).sort()).toEqual([
            false,
            true,
        ]);
        await expect(audit.getAuditTrail(queued.subjectUri)).resolves.toHaveLength(1);
    });
});
