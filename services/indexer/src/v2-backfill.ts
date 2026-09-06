import {
    Jetstream,
    typedEventFromRaw,
    type CollectionFilter,
    type EventBatch,
    type RawEvent,
    type SnapshotOpts,
    type TypedEvent,
} from '@bsky/jetstream';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import {
    loadIndexerConfig,
    recordNsid,
    validateProductionServiceConfig,
} from '@patchwork/shared';
import {
    InMemoryCheckpointStore,
    PostgresCheckpointStore,
} from './checkpoint.js';
import { PostgresDeadLetterStore } from './db/dead-letter-store.js';
import { PostgresJetstreamControlStore } from './db/jetstream-control-store.js';
import { PostgresLifecycleEventReconciler } from './db/lifecycle-reconciler.js';
import { PostgresProjectionStore } from './db/projection-store.js';
import { IndexerPipeline } from './pipeline.js';
import { sdkServiceUrl, toAtEvent } from './stream/jetstream-v2-source.js';

const MAX_DIDS_PER_FILTER = 10_000;

interface BackfillClient {
    liveRawBatches(options: {
        kinds: ['identity'];
        signal?: AbortSignal;
    }): AsyncIterable<EventBatch<RawEvent>>;
    snapshotRawBatches(
        options: SnapshotOpts,
    ): AsyncIterable<EventBatch<RawEvent>>;
}

interface BackfillOptions {
    client: BackfillClient;
    collections: readonly string[];
    onCommit(event: Extract<TypedEvent, { kind: 'commit' }>): Promise<void>;
    onControl(event: Exclude<TypedEvent, { kind: 'commit' }>): Promise<void>;
    saveCheckpoint(cursor: number): Promise<void>;
    signal?: AbortSignal;
}

const chunks = <T>(values: readonly T[], size: number): T[][] => {
    const result: T[][] = [];
    for (let offset = 0; offset < values.length; offset += size) {
        result.push(values.slice(offset, offset + size));
    }
    return result;
};

const captureHead = async (
    client: BackfillClient,
    signal?: AbortSignal,
): Promise<number> => {
    for await (const batch of client.liveRawBatches({
        kinds: ['identity'],
        signal,
    })) {
        const event = batch.events[0];
        if (event) return event.seq;
    }
    throw new Error('Jetstream v2 live head closed before yielding a cursor.');
};

export const runJetstreamV2Backfill = async (
    options: BackfillOptions,
): Promise<{
    headSeq: number;
    commits: number;
    controls: number;
    relevantDids: number;
}> => {
    const headSeq = await captureHead(options.client, options.signal);
    const relevantDids = new Set<string>();
    let commits = 0;
    let controls = 0;

    for await (const batch of options.client.snapshotRawBatches({
        afterSeq: 0,
        beforeSeq: headSeq,
        collections: options.collections.map(
            (collection) => collection as CollectionFilter,
        ),
        kinds: ['commit'],
        signal: options.signal,
    })) {
        for (const raw of batch.events) {
            if (raw.kind !== 'commit') continue;
            relevantDids.add(raw.did);
            const event = typedEventFromRaw(raw, new Map());
            if (event.kind !== 'commit') continue;
            await options.onCommit(event);
            commits += 1;
        }
    }

    for (const didGroup of chunks([...relevantDids], MAX_DIDS_PER_FILTER)) {
        for await (const batch of options.client.snapshotRawBatches({
            afterSeq: 0,
            beforeSeq: headSeq,
            dids: didGroup as SnapshotOpts['dids'],
            kinds: ['identity', 'account', 'sync'],
            signal: options.signal,
        })) {
            for (const raw of batch.events) {
                if (raw.kind === 'commit') continue;
                await options.onControl(raw);
                controls += 1;
            }
        }
    }

    await options.saveCheckpoint(headSeq);
    return { headSeq, commits, controls, relevantDids: relevantDids.size };
};

export const bootstrapJetstreamV2Projection = async (): Promise<void> => {
    const config = loadIndexerConfig();
    validateProductionServiceConfig(config);
    if (
        config.INDEXER_JETSTREAM_VERSION !== 'v2' ||
        !['v2-shadow', 'v2-live'].includes(config.INDEXER_PROJECTION_MODE) ||
        !config.JETSTREAM_API_KEY
    ) {
        throw new Error(
            'FATAL: v2 backfill requires Jetstream v2, a v2 projection mode, and JETSTREAM_API_KEY.',
        );
    }
    const databaseUrl =
        process.env['DATABASE_URL'] ?? process.env['INDEXER_DATABASE_URL'];
    if (!databaseUrl) throw new Error('FATAL: DATABASE_URL is required.');
    const pool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        ...(config.INDEXER_PROJECTION_MODE === 'v2-shadow' ? { options: '-c search_path=jetstream_v2_shadow,public' } : {}),
    });
    const lock = await pool.connect();
    try {
        await lock.query('SELECT pg_advisory_lock(hashtext($1))', [`patchwork-bootstrap:${config.INDEXER_PROJECTION_MODE}`]);
        const persistedCheckpoint = new PostgresCheckpointStore(
            pool,
            'jetstream-v2-seq',
        );
        if (await persistedCheckpoint.load()) {
            console.log('[indexer:v2-backfill] checkpoint exists; skipping.');
            return;
        }
        const projectionStore = new PostgresProjectionStore(
            pool,
            `patchwork-indexer-rebuild:${config.INDEXER_PROJECTION_MODE}`,
        );
        const pipeline = new IndexerPipeline({
            checkpointStore: new InMemoryCheckpointStore('jetstream-v2-seq'),
            checkpointInterval: 100,
            projectionStore,
            deadLetterStore: new PostgresDeadLetterStore(pool),
            ...(config.INDEXER_PROJECTION_MODE === 'v2-live' ? { lifecycleReconciler: new PostgresLifecycleEventReconciler(pool) } : {}),
        });
        const controls = new PostgresJetstreamControlStore(pool);
        const result = await runJetstreamV2Backfill({
            client: new Jetstream({
                service: sdkServiceUrl(config.INDEXER_FIREHOSE_URL),
                apiKey: config.JETSTREAM_API_KEY,
            }),
            collections: [
                recordNsid.aidPost,
                recordNsid.directoryResource,
                recordNsid.volunteerProfile,
            ],
            onCommit: async (event) => {
                const ingest = await pipeline.ingestAndCheckpoint([
                    toAtEvent(event),
                ]);
                if (
                    ingest.normalizedCount + ingest.quarantinedCount !== 1 ||
                    ingest.failureCount !== ingest.quarantinedCount
                ) {
                    throw new Error(
                        'Jetstream v2 backfill commit was rejected.',
                    );
                }
            },
            onControl: async (event) => {
                if (event.kind === 'identity') {
                    await controls.identity(
                        event.seq,
                        event.did,
                        event.identity,
                    );
                } else if (event.kind === 'account') {
                    await controls.account(event.seq, event.did, event.account);
                } else {
                    await controls.sync(event.seq, event.did, event.sync);
                }
            },
            saveCheckpoint: async (cursor) => {
                await persistedCheckpoint.save(cursor);
                // Live readiness is established by current source events, not archive completion.
            },
        });
        console.log(
            `[indexer:v2-backfill] complete head=${result.headSeq} commits=${result.commits} controls=${result.controls} dids=${result.relevantDids}`,
        );
    } finally {
        await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [`patchwork-bootstrap:${config.INDEXER_PROJECTION_MODE}`]);
        lock.release();
        await pool.end();
    }
};

if (
    process.argv[1] &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
    void bootstrapJetstreamV2Projection().catch((error) => {
        const metadata = {
            name: error instanceof Error ? error.name : 'UnknownError',
            ...(typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
                ? { code: error.code }
                : {}),
        };
        console.error('[indexer:v2-backfill] failed.', metadata);
        process.exitCode = 1;
    });
}
