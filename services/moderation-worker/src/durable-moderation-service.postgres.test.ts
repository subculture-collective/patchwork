import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DurableModerationWorkerService } from './durable-moderation-service.js';
import { PostgresModerationQueueStore } from './postgres-queue-store.js';
import { PostgresModerationAuditStore } from './postgres-audit-store.js';
import { createModerationRuntime } from './moderation-runtime.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('DurableModerationWorkerService', () => {
    const pool = new Pool({ connectionString: databaseUrl });

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
    });

    beforeEach(async () => {
        await pool.query(
            'TRUNCATE moderation_audit_records, moderation_queue_items RESTART IDENTITY CASCADE',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('survives service restart with queue state and audit history', async () => {
        const subjectUri =
            'at://did:plc:alice/app.patchwork.aid.post/durable-service';
        const createService = () =>
            new DurableModerationWorkerService(
                new PostgresModerationQueueStore(pool),
                new PostgresModerationAuditStore(pool),
            );
        const first = createService();
        await first.enqueue({
            subjectUri,
            reason: 'user-report:spam',
            requestedAt: '2026-07-11T23:20:00.000Z',
        });
        await first.applyPolicy({
            subjectUri,
            actorDid: 'did:plc:moderator',
            action: 'delist',
            reason: 'Confirmed spam',
            occurredAt: '2026-07-11T23:21:00.000Z',
            idempotencyKey: 'durable-service-policy-1',
        });

        const restarted = createService();
        await expect(restarted.getState(subjectUri)).resolves.toMatchObject({
            queueStatus: 'resolved',
            visibility: 'delisted',
        });
        await expect(restarted.listAudit(subjectUri)).resolves.toHaveLength(1);
    });

    it('constructs the production PostgreSQL runtime after schema verification', async () => {
        const runtime = await createModerationRuntime({
            nodeEnv: 'production',
            pool,
        });
        expect(runtime.mode).toBe('postgres');
        await runtime.close();
    });
});
