import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPhase3FixtureFirehoseEvents } from '@patchwork/shared';
import { PostgresLifecycleRepository } from '../../../api/src/db/lifecycle-repository.js';
import { InMemoryCheckpointStore } from '../checkpoint.js';
import { IndexerPipeline } from '../pipeline.js';
import { PostgresLifecycleEventReconciler } from './lifecycle-reconciler.js';
import { PostgresProjectionStore } from './projection-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('stream-driven lifecycle reconciliation', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const lifecycle = new PostgresLifecycleRepository(pool);
    const rawCreate = buildPhase3FixtureFirehoseEvents()[0] as Record<
        string,
        unknown
    >;
    const postUri = String(rawCreate.uri);

    beforeAll(async () => {
        for (const migration of [
            '0003_core_operational_state.sql',
            '0004_lifecycle_timeline.sql',
            '0005_lifecycle_assignments.sql',
            '0006_assignment_responses.sql',
            '0007_lifecycle_handoffs.sql',
            '0008_platform_roles.sql',
            '0009_public_status_sync.sql',
            '0010_public_sync_state.sql',
        ]) {
            await pool.query(
                await readFile(
                    new URL(`../../../api/src/db/migrations/${migration}`, import.meta.url),
                    'utf8',
                ),
            );
        }
        await pool.query(
            await readFile(
                new URL('../migrations/0002_projection_store.sql', import.meta.url),
                'utf8',
            ),
        );
    });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE operational_audit_events, request_handoff_events,
                      request_assignment_events, request_transition_events,
                      request_workflows, indexer_projection_events,
                      indexer_projection_tombstones,
                      indexer_aid_post_projections RESTART IDENTITY CASCADE`,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('removes durable private workflow state before checkpointing a repository deletion', async () => {
        await lifecycle.register({
            commandId: 'register-stream-delete',
            postUri,
            requesterDid: String(rawCreate.authorDid),
            createdAt: '2026-07-11T11:00:00.000Z',
        });
        const checkpointStore = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore: new PostgresProjectionStore(pool),
            lifecycleReconciler: new PostgresLifecycleEventReconciler(pool),
        });
        const rawDelete = {
            ...rawCreate,
            seq: 201,
            action: 'delete',
            record: undefined,
            cid: undefined,
            deleteReason: 'deleted-upstream',
        };

        await pipeline.ingestAndCheckpoint([rawDelete]);

        expect(await lifecycle.get(postUri)).toBeUndefined();
        expect((await checkpointStore.load())?.cursor).toBe(201);
    });

    it('advances a compatible private workflow from a public resolved event', async () => {
        await lifecycle.register({
            commandId: 'register-stream-resolved',
            postUri,
            requesterDid: String(rawCreate.authorDid),
            createdAt: '2026-07-11T11:00:00.000Z',
        });
        const record = rawCreate.record as Record<string, unknown>;
        const pipeline = new IndexerPipeline({
            checkpointInterval: 1,
            projectionStore: new PostgresProjectionStore(pool),
            lifecycleReconciler: new PostgresLifecycleEventReconciler(pool),
        });

        const rawResolved = {
            ...rawCreate,
            seq: 202,
            action: 'update',
            cid: 'bafy-stream-resolved',
            record: {
                ...record,
                status: 'resolved',
                updatedAt: '2026-07-11T12:02:00.000Z',
            },
        };
        await pipeline.ingestAndCheckpoint([rawResolved]);
        await pipeline.ingestAndCheckpoint([rawResolved]);

        expect(await lifecycle.get(postUri)).toMatchObject({
            currentStatus: 'resolved',
            publicStatus: 'resolved',
            publicCid: 'bafy-stream-resolved',
            publicSyncState: 'synced',
            timeline: [
                expect.objectContaining({
                    from: 'open',
                    to: 'resolved',
                    actorDid: String(rawCreate.authorDid),
                }),
            ],
        });
    });

    it('records divergence without regressing a more advanced private workflow', async () => {
        await lifecycle.register({
            commandId: 'register-stream-divergence',
            postUri,
            requesterDid: String(rawCreate.authorDid),
            createdAt: '2026-07-11T11:00:00.000Z',
        });
        await lifecycle.transition({
            commandId: 'resolve-before-stale-public-open',
            postUri,
            actorDid: String(rawCreate.authorDid),
            actorRole: 'requester',
            fromStatus: 'open',
            toStatus: 'resolved',
            occurredAt: '2026-07-11T12:00:00.000Z',
        });
        const pipeline = new IndexerPipeline({
            checkpointInterval: 1,
            projectionStore: new PostgresProjectionStore(pool),
            lifecycleReconciler: new PostgresLifecycleEventReconciler(pool),
        });

        await pipeline.ingestAndCheckpoint([
            {
                ...rawCreate,
                seq: 203,
                cid: 'bafy-public-still-open',
            },
        ]);

        expect(await lifecycle.get(postUri)).toMatchObject({
            currentStatus: 'resolved',
            publicStatus: 'open',
            publicCid: 'bafy-public-still-open',
            publicSyncState: 'failed',
            publicSyncErrorCode: 'PUBLIC_STATUS_DIVERGED',
        });
    });

    it('does not reconcile a stale repository event that the projection rejected', async () => {
        await lifecycle.register({
            commandId: 'register-stream-ordering',
            postUri,
            requesterDid: String(rawCreate.authorDid),
            createdAt: '2026-07-11T11:00:00.000Z',
        });
        const record = rawCreate.record as Record<string, unknown>;
        const pipeline = new IndexerPipeline({
            checkpointInterval: 1,
            projectionStore: new PostgresProjectionStore(pool),
            lifecycleReconciler: new PostgresLifecycleEventReconciler(pool),
        });
        await pipeline.ingestAndCheckpoint([
            {
                ...rawCreate,
                seq: 300,
                action: 'update',
                cid: 'bafy-stream-closed',
                record: {
                    ...record,
                    status: 'closed',
                    updatedAt: '2026-07-11T12:03:00.000Z',
                },
            },
        ]);

        await pipeline.ingestAndCheckpoint([
            {
                ...rawCreate,
                seq: 250,
                action: 'update',
                cid: 'bafy-stale-resolved',
                record: {
                    ...record,
                    status: 'resolved',
                    updatedAt: '2026-07-11T12:02:30.000Z',
                },
            },
        ]);

        expect(await lifecycle.get(postUri)).toMatchObject({
            currentStatus: 'archived',
            publicStatus: 'closed',
            publicCid: 'bafy-stream-closed',
            publicSyncState: 'synced',
        });
    });

    it('keeps the cursor retryable when reconciliation fails after projection commit', async () => {
        await lifecycle.register({
            commandId: 'register-stream-retry',
            postUri,
            requesterDid: String(rawCreate.authorDid),
            createdAt: '2026-07-11T11:00:00.000Z',
        });
        const checkpointStore = new InMemoryCheckpointStore();
        const projectionStore = new PostgresProjectionStore(pool);
        const rawDelete = {
            ...rawCreate,
            seq: 401,
            action: 'delete',
            record: undefined,
            cid: undefined,
            deleteReason: 'deleted-upstream',
        };
        const failing = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore,
            lifecycleReconciler: {
                reconcile: async () => {
                    throw new Error('simulated reconciliation outage');
                },
            },
        });

        await expect(failing.ingestAndCheckpoint([rawDelete])).rejects.toThrow(
            'simulated reconciliation outage',
        );
        expect(await checkpointStore.load()).toBeNull();
        expect(await lifecycle.get(postUri)).toBeDefined();

        const recovered = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore,
            lifecycleReconciler: new PostgresLifecycleEventReconciler(pool),
        });
        await recovered.ingestAndCheckpoint([rawDelete]);

        expect(await lifecycle.get(postUri)).toBeUndefined();
        expect((await checkpointStore.load())?.cursor).toBe(401);
    });
});
