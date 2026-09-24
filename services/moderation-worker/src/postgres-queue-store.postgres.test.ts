import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ModerationQueueItem } from '@patchwork/shared';
import { PostgresModerationQueueStore } from './postgres-queue-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const item = (suffix: string): ModerationQueueItem => ({
    queueId: `queue-${suffix}`,
    subjectUri: `at://did:plc:alice/app.patchwork.aid.post/${suffix}`,
    subjectType: 'aid-post',
    reasons: ['user-report:spam'],
    latestReason: 'user-report:spam',
    reportCount: 1,
    queueStatus: 'queued',
    visibility: 'visible',
    appealState: 'none',
    createdAt: '2026-07-11T23:00:00.000Z',
    requestedAt: '2026-07-11T23:00:00.000Z',
    updatedAt: '2026-07-11T23:00:00.000Z',
    context: {},
});

describe('PostgresModerationQueueStore', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const store = new PostgresModerationQueueStore(pool);

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

    it('claims distinct work across concurrent workers', async () => {
        await store.enqueue(item('claim-a'));
        await store.enqueue(item('claim-b'));

        const [first, second] = await Promise.all([
            store.claim({
                workerId: 'worker-a',
                now: '2026-07-11T23:01:00.000Z',
                leaseMs: 30_000,
            }),
            store.claim({
                workerId: 'worker-b',
                now: '2026-07-11T23:01:00.000Z',
                leaseMs: 30_000,
            }),
        ]);

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first?.subjectUri).not.toBe(second?.subjectUri);
        expect(new Set([first?.subjectUri, second?.subjectUri]).size).toBe(2);
    });

    it('clears a resolved-case retention deadline when a new report reopens it', async () => {
        const reopened = item('reopened');
        await store.enqueue(reopened);
        await pool.query(
            `UPDATE moderation_queue_items
             SET queue_status = 'resolved', retention_until = '2026-07-18T00:00:00Z'
             WHERE subject_uri = $1`,
            [reopened.subjectUri],
        );

        await store.enqueue({
            ...reopened,
            reportCount: 2,
            requestedAt: '2026-07-12T00:00:00.000Z',
            updatedAt: '2026-07-12T00:00:00.000Z',
        });

        const stored = await pool.query<{
            queue_status: string;
            retention_until: Date | null;
        }>(
            `SELECT queue_status, retention_until FROM moderation_queue_items
             WHERE subject_uri = $1`,
            [reopened.subjectUri],
        );
        expect(stored.rows[0]).toEqual({
            queue_status: 'queued',
            retention_until: null,
        });
    });

    it('requeues failures after backoff and excludes terminal failures', async () => {
        const queued = item('retry');
        await store.enqueue(queued);
        await store.claim({
            workerId: 'worker-a',
            now: '2026-07-11T23:01:00.000Z',
            leaseMs: 30_000,
        });

        await store.fail({
            subjectUri: queued.subjectUri,
            workerId: 'worker-a',
            now: '2026-07-11T23:01:05.000Z',
            failureCode: 'POLICY_PROVIDER_UNAVAILABLE',
            nextAttemptAt: '2026-07-11T23:02:00.000Z',
            terminal: false,
        });
        await expect(
            store.claim({
                workerId: 'worker-b',
                now: '2026-07-11T23:01:59.000Z',
                leaseMs: 30_000,
            }),
        ).resolves.toBeNull();
        const retried = await store.claim({
            workerId: 'worker-b',
            now: '2026-07-11T23:02:00.000Z',
            leaseMs: 30_000,
        });
        expect(retried?.subjectUri).toBe(queued.subjectUri);

        await store.fail({
            subjectUri: queued.subjectUri,
            workerId: 'worker-b',
            now: '2026-07-11T23:02:05.000Z',
            failureCode: 'MAX_ATTEMPTS_EXCEEDED',
            terminal: true,
        });
        await expect(
            store.claim({
                workerId: 'worker-c',
                now: '2026-07-12T00:00:00.000Z',
                leaseMs: 30_000,
            }),
        ).resolves.toBeNull();
    });

    it('acknowledges work only for the lease owner and prevents reprocessing', async () => {
        const queued = item('ack');
        await store.enqueue(queued);
        await store.claim({
            workerId: 'worker-a',
            now: '2026-07-11T23:03:00.000Z',
            leaseMs: 30_000,
        });

        await expect(
            store.ack({
                subjectUri: queued.subjectUri,
                workerId: 'worker-b',
                now: '2026-07-11T23:03:05.000Z',
            }),
        ).rejects.toThrow('MODERATION_LEASE_NOT_OWNED');
        await store.ack({
            subjectUri: queued.subjectUri,
            workerId: 'worker-a',
            now: '2026-07-11T23:03:05.000Z',
        });
        await expect(
            store.claim({
                workerId: 'worker-c',
                now: '2026-07-12T00:00:00.000Z',
                leaseMs: 30_000,
            }),
        ).resolves.toBeNull();
    });

    it('recovers work after a crashed worker lease expires', async () => {
        const queued = item('expired-lease');
        await store.enqueue(queued);
        await store.claim({
            workerId: 'crashed-worker',
            now: '2026-07-11T23:04:00.000Z',
            leaseMs: 30_000,
        });

        await expect(
            store.claim({
                workerId: 'recovery-worker',
                now: '2026-07-11T23:04:29.999Z',
                leaseMs: 30_000,
            }),
        ).resolves.toBeNull();
        await expect(
            store.claim({
                workerId: 'recovery-worker',
                now: '2026-07-11T23:04:30.000Z',
                leaseMs: 30_000,
            }),
        ).resolves.toMatchObject({ subjectUri: queued.subjectUri });
    });
});
