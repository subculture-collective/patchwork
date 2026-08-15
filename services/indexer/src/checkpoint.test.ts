import { describe, expect, it, beforeEach } from 'vitest';
import {
    buildPhase3FixtureFirehoseEvents,
    SliCollector,
} from '@patchwork/shared';
import { InMemoryCheckpointStore } from './checkpoint.js';
import { IndexerPipeline } from './pipeline.js';
import { MetricsCollector, renderPrometheusRuntimeMetrics } from './metrics.js';

describe('InMemoryCheckpointStore', () => {
    let store: InMemoryCheckpointStore;

    beforeEach(() => {
        store = new InMemoryCheckpointStore();
    });

    it('returns null when no checkpoint has been saved', async () => {
        const checkpoint = await store.load();
        expect(checkpoint).toBeNull();
    });

    it('saves and loads a checkpoint', async () => {
        const saved = await store.save(42);
        expect(saved.cursor).toBe(42);
        expect(saved.source).toBe('jetstream-v1-time-us');
        expect(saved.sequence).toBe(1);
        expect(saved.savedAt).toBeTruthy();

        const loaded = await store.load();
        expect(loaded).not.toBeNull();
        expect(loaded!.cursor).toBe(42);
        expect(loaded!.sequence).toBe(1);
    });

    it('labels v2 sequence checkpoints without accepting a v1 label', async () => {
        const v2 = new InMemoryCheckpointStore('jetstream-v2-seq');
        expect((await v2.save(42)).source).toBe('jetstream-v2-seq');
    });

    it('increments sequence on successive saves', async () => {
        await store.save(10);
        await store.save(20);
        const third = await store.save(30);

        expect(third.sequence).toBe(3);
        expect(third.cursor).toBe(30);

        const loaded = await store.load();
        expect(loaded!.sequence).toBe(3);
        expect(loaded!.cursor).toBe(30);
    });

    it('overwrites cursor on save', async () => {
        await store.save(100);
        await store.save(200);

        const loaded = await store.load();
        expect(loaded!.cursor).toBe(200);
    });

    it('health returns null lag when no checkpoint exists', async () => {
        const health = await store.health();
        expect(health.healthy).toBe(true);
        expect(health.lagSeconds).toBeNull();
        expect(health.lastCheckpoint).toBeNull();
    });

    it('health returns lag seconds after a checkpoint save', async () => {
        await store.save(5);
        const health = await store.health();

        expect(health.healthy).toBe(true);
        expect(health.lagSeconds).not.toBeNull();
        // Should be very small since we just saved
        expect(health.lagSeconds!).toBeGreaterThanOrEqual(0);
        expect(health.lagSeconds!).toBeLessThan(5);
        expect(health.lastCheckpoint).not.toBeNull();
        expect(health.lastCheckpoint!.cursor).toBe(5);
    });
});

describe('IndexerPipeline with CheckpointStore', () => {
    it('uses InMemoryCheckpointStore by default', async () => {
        const pipeline = new IndexerPipeline();
        const cursor = await pipeline.loadCheckpoint();
        expect(cursor).toBeNull();
    });

    it('accepts a custom checkpoint store', async () => {
        const store = new InMemoryCheckpointStore();
        await store.save(99);

        const pipeline = new IndexerPipeline({ checkpointStore: store });
        const cursor = await pipeline.loadCheckpoint();
        expect(cursor).toBe(99);
    });

    it('saves checkpoint on ingestAndCheckpoint when interval is met', async () => {
        const store = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });

        await pipeline.ingestAndCheckpoint(
            buildPhase3FixtureFirehoseEvents(),
        );

        const checkpoint = await store.load();
        expect(checkpoint).not.toBeNull();
        expect(checkpoint!.cursor).toBe(5);
    });

    it('does not save checkpoint if interval is not met', async () => {
        const store = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1000,
        });

        await pipeline.ingestAndCheckpoint(
            buildPhase3FixtureFirehoseEvents(),
        );

        const checkpoint = await store.load();
        // 5 events < 1000 interval, so no checkpoint saved
        expect(checkpoint).toBeNull();
    });

    it('force saves checkpoint via saveCheckpoint()', async () => {
        const store = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1000,
        });

        pipeline.ingest(buildPhase3FixtureFirehoseEvents());
        await pipeline.saveCheckpoint();

        const checkpoint = await store.load();
        expect(checkpoint).not.toBeNull();
        expect(checkpoint!.cursor).toBe(5);
    });

    it('exposes checkpoint store via getCheckpointStore()', () => {
        const store = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({ checkpointStore: store });
        expect(pipeline.getCheckpointStore()).toBe(store);
    });
});

describe('replay/recovery integration', () => {
    it('replays events from checkpoint cursor', async () => {
        const store = new InMemoryCheckpointStore();
        const fixtures = buildPhase3FixtureFirehoseEvents();

        // First pipeline processes all events and checkpoints
        const pipeline1 = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });
        await pipeline1.ingestAndCheckpoint(fixtures.slice(0, 3));

        const checkpoint = await store.load();
        expect(checkpoint).not.toBeNull();
        expect(checkpoint!.cursor).toBe(3);

        // Second pipeline (simulating restart) loads checkpoint and replays
        const pipeline2 = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });
        const cursor = await pipeline2.loadCheckpoint();
        expect(cursor).toBe(3);

        // Replay only events after the checkpoint cursor
        const result = pipeline2.replayFromCursor(fixtures, cursor!);
        // Events with seq 4, 5 should be processed (seq > 3)
        expect(result.normalizedCount).toBe(2);
        expect(result.checkpointSeq).toBe(5);
    });

    it('restart recovery: stop, create new pipeline with same store, verify continuity', async () => {
        const store = new InMemoryCheckpointStore();
        const fixtures = buildPhase3FixtureFirehoseEvents();

        // Simulate first run: process all events
        const pipeline1 = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });
        const result1 = await pipeline1.ingestAndCheckpoint(fixtures);
        expect(result1.normalizedCount).toBe(5);
        expect(result1.checkpointSeq).toBe(5);

        // Verify checkpoint was persisted
        const checkpoint1 = await store.load();
        expect(checkpoint1!.cursor).toBe(5);
        const firstSequence = checkpoint1!.sequence;

        // Simulate restart: create new pipeline with same store
        const pipeline2 = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });

        // Load checkpoint to verify continuity
        const resumeCursor = await pipeline2.loadCheckpoint();
        expect(resumeCursor).toBe(5);

        // No new events to process — replay from cursor should yield 0 results
        const result2 = pipeline2.replayFromCursor(fixtures, resumeCursor!);
        expect(result2.normalizedCount).toBe(0);

        // Checkpoint sequence should still be the same (no new saves needed)
        const checkpoint2 = await store.load();
        expect(checkpoint2!.sequence).toBe(firstSequence);
    });

    it('handles multiple checkpoint saves across batches', async () => {
        const store = new InMemoryCheckpointStore();
        const fixtures = buildPhase3FixtureFirehoseEvents();

        const pipeline = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });

        // Ingest first two events
        await pipeline.ingestAndCheckpoint(fixtures.slice(0, 2));
        const cp1 = await store.load();
        expect(cp1!.cursor).toBe(2);
        expect(cp1!.sequence).toBe(1);

        // Ingest next two events
        await pipeline.ingestAndCheckpoint(fixtures.slice(2, 4));
        const cp2 = await store.load();
        expect(cp2!.cursor).toBe(4);
        expect(cp2!.sequence).toBe(2);

        // Ingest last event
        await pipeline.ingestAndCheckpoint(fixtures.slice(4));
        const cp3 = await store.load();
        expect(cp3!.cursor).toBe(5);
        expect(cp3!.sequence).toBe(3);
    });
});

describe('MetricsCollector', () => {
    it('starts at zero', () => {
        const collector = new MetricsCollector();
        expect(collector.ingestEventsTotal).toBe(0);
        expect(collector.ingestErrorsTotal).toBe(0);
    });

    it('records events and errors', () => {
        const collector = new MetricsCollector();
        collector.recordEvents(10);
        collector.recordErrors(2);

        expect(collector.ingestEventsTotal).toBe(10);
        expect(collector.ingestErrorsTotal).toBe(2);

        collector.recordEvents(5);
        expect(collector.ingestEventsTotal).toBe(15);
    });

    it('resets counters', () => {
        const collector = new MetricsCollector();
        collector.recordEvents(10);
        collector.recordErrors(2);
        collector.reset();

        expect(collector.ingestEventsTotal).toBe(0);
        expect(collector.ingestErrorsTotal).toBe(0);
    });

    it('builds snapshot with checkpoint health', () => {
        const collector = new MetricsCollector();
        collector.recordEvents(42);
        collector.recordErrors(3);

        const snapshot = collector.snapshot({
            healthy: true,
            lagSeconds: 1.5,
            lastCheckpoint: {
                cursor: 100,
                source: 'jetstream-v1-time-us',
                savedAt: new Date().toISOString(),
                sequence: 7,
            },
        });

        expect(snapshot.checkpointLagSeconds).toBe(1.5);
        expect(snapshot.checkpointSequence).toBe(7);
        expect(snapshot.checkpointCursor).toBe(100);
        expect(snapshot.checkpointHealthy).toBe(true);
        expect(snapshot.ingestEventsTotal).toBe(42);
        expect(snapshot.ingestErrorsTotal).toBe(3);
        expect(snapshot.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('builds snapshot with no checkpoint', () => {
        const collector = new MetricsCollector();
        const snapshot = collector.snapshot({
            healthy: true,
            lagSeconds: null,
            lastCheckpoint: null,
        });

        expect(snapshot.checkpointLagSeconds).toBeNull();
        expect(snapshot.checkpointSequence).toBeNull();
        expect(snapshot.checkpointCursor).toBeNull();
        expect(snapshot.checkpointHealthy).toBe(true);
    });
});

describe('renderPrometheusRuntimeMetrics', () => {
    it('keeps ingestion SLIs distinct from HTTP transport metrics', () => {
        const collector = new SliCollector();
        collector.recordRequest('/health', 2);
        const output = [
            renderPrometheusRuntimeMetrics({
                checkpointLagSeconds: 1,
                checkpointSequence: 2,
                checkpointCursor: 3,
                checkpointHealthy: true,
                ingestEventsTotal: 4,
                ingestErrorsTotal: 0,
                uptimeSeconds: 5,
            }),
            collector.renderHttpPrometheus('indexer'),
        ].join('\n');
        const series = output
            .split('\n')
            .filter(line => line && !line.startsWith('#'))
            .map(line => line.split(' ')[0]);

        expect(new Set(series).size).toBe(series.length);
        expect(output).toContain('patchwork_sli_request_total');
        expect(output).toContain('patchwork_http_request_total');
    });

    it('exposes live event-source connection and lag metrics', () => {
        const output = renderPrometheusRuntimeMetrics(
            {
                checkpointLagSeconds: 1,
                checkpointSequence: 2,
                checkpointCursor: 3,
                checkpointHealthy: true,
                ingestEventsTotal: 4,
                ingestErrorsTotal: 0,
                uptimeSeconds: 5,
            },
            {
                connected: false,
                connectionsTotal: 2,
                reconnectsTotal: 1,
                malformedFramesTotal: 3,
                oversizedFramesTotal: 4,
                duplicateFramesTotal: 5,
                outOfOrderFramesTotal: 6,
                lagMilliseconds: 750,
                lastAcknowledgedCursor: 7,
            },
        );

        expect(output).toContain('patchwork_event_source_connected');
        expect(output).toContain('patchwork_event_source_connected{project="patchwork",service="indexer",component="spool",environment="development"} 0');
        expect(output).toContain('patchwork_event_source_lag_seconds{project="patchwork",service="indexer",component="spool",environment="development"} 0.75');
        expect(output).toContain('patchwork_event_source_reconnects_total{project="patchwork",service="indexer",component="spool",environment="development"} 1');
    });

    it('renders all metrics in Prometheus exposition format', () => {
        const output = renderPrometheusRuntimeMetrics({
            checkpointLagSeconds: 2.5,
            checkpointSequence: 10,
            checkpointCursor: 500,
            checkpointHealthy: true,
            ingestEventsTotal: 1000,
            ingestErrorsTotal: 5,
            uptimeSeconds: 120,
        });

        expect(output).toContain('patchwork_service_up');
        expect(output).toContain('patchwork_process_uptime_seconds');
        expect(output).toContain('patchwork_checkpoint_lag_seconds');
        expect(output).toContain('patchwork_checkpoint_sequence');
        expect(output).toContain('patchwork_checkpoint_cursor');
        expect(output).toContain('patchwork_checkpoint_healthy');
        expect(output).toContain('patchwork_ingest_events_total');
        expect(output).toContain('patchwork_ingest_errors_total');

        // Check actual values
        expect(output).toContain('patchwork_checkpoint_lag_seconds{project="patchwork",service="indexer",component="spool",environment="development"} 2.5');
        expect(output).toContain('patchwork_checkpoint_sequence{project="patchwork",service="indexer",component="spool",environment="development"} 10');
        expect(output).toContain('patchwork_checkpoint_cursor{project="patchwork",service="indexer",component="spool",environment="development"} 500');
        expect(output).toContain('patchwork_checkpoint_healthy{project="patchwork",service="indexer",component="spool",environment="development"} 1');
        expect(output).toContain('patchwork_ingest_events_total{project="patchwork",service="indexer",component="spool",environment="development"} 1000');
        expect(output).toContain('patchwork_ingest_errors_total{project="patchwork",service="indexer",component="spool",environment="development"} 5');
    });

    it('renders -1 for null lag and cursor', () => {
        const output = renderPrometheusRuntimeMetrics({
            checkpointLagSeconds: null,
            checkpointSequence: null,
            checkpointCursor: null,
            checkpointHealthy: true,
            ingestEventsTotal: 0,
            ingestErrorsTotal: 0,
            uptimeSeconds: 0,
        });

        expect(output).toContain('patchwork_checkpoint_lag_seconds{project="patchwork",service="indexer",component="spool",environment="development"} -1');
        expect(output).toContain('patchwork_checkpoint_cursor{project="patchwork",service="indexer",component="spool",environment="development"} -1');
        expect(output).toContain('patchwork_checkpoint_sequence{project="patchwork",service="indexer",component="spool",environment="development"} 0');
    });

    it('renders 0 for unhealthy checkpoint', () => {
        const output = renderPrometheusRuntimeMetrics({
            checkpointLagSeconds: null,
            checkpointSequence: null,
            checkpointCursor: null,
            checkpointHealthy: false,
            ingestEventsTotal: 0,
            ingestErrorsTotal: 0,
            uptimeSeconds: 0,
        });

        expect(output).toContain('patchwork_checkpoint_healthy{project="patchwork",service="indexer",component="spool",environment="development"} 0');
    });
});

describe('pipeline runtime metrics integration', () => {
    it('getRuntimeMetrics returns a complete snapshot after ingestion', async () => {
        const store = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore: store,
            checkpointInterval: 1,
        });

        await pipeline.ingestAndCheckpoint(
            buildPhase3FixtureFirehoseEvents(),
        );

        const metrics = await pipeline.getRuntimeMetrics();
        expect(metrics.ingestEventsTotal).toBe(5);
        expect(metrics.ingestErrorsTotal).toBe(0);
        expect(metrics.checkpointHealthy).toBe(true);
        expect(metrics.checkpointCursor).toBe(5);
        expect(metrics.checkpointSequence).toBe(1);
        expect(metrics.checkpointLagSeconds).not.toBeNull();
        expect(metrics.checkpointLagSeconds!).toBeGreaterThanOrEqual(0);
    });

    it('getRuntimeMetrics counts errors from failed events', async () => {
        const pipeline = new IndexerPipeline({ checkpointInterval: 1 });

        pipeline.ingest([
            { seq: 1, action: 'create', collection: 'app.patchwork.aid.post' },
            { invalid: true },
        ]);

        const metrics = await pipeline.getRuntimeMetrics();
        expect(metrics.ingestErrorsTotal).toBe(2);
        expect(metrics.ingestEventsTotal).toBe(0);
    });
});
