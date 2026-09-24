import { describe, expect, it } from 'vitest';
import { buildPhase3FixtureFirehoseEvents } from '@patchwork/shared';
import { InMemoryCheckpointStore } from './checkpoint.js';
import { IndexerPipeline } from './pipeline.js';
import { IndexerRuntime } from './runtime.js';
import type {
    AtEventHandler,
    AtEventSource,
    EventSourceMetrics,
} from './stream/event-source.js';

class FakeEventSource implements AtEventSource {
    startedAt: number | null | undefined;
    stopped = false;
    lagMilliseconds: number | null = 0;
    handler: AtEventHandler | null = null;

    async start(cursor: number | null, onEvent: AtEventHandler): Promise<void> {
        this.startedAt = cursor;
        this.handler = onEvent;
    }

    async emit(event: unknown): Promise<void> {
        if (!this.handler) throw new Error('Source has not started.');
        await this.handler(event);
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }

    getMetrics(): EventSourceMetrics {
        return {
            connected: !this.stopped,
            connectionsTotal: 1,
            reconnectsTotal: 0,
            malformedFramesTotal: 0,
            oversizedFramesTotal: 0,
            duplicateFramesTotal: 0,
            outOfOrderFramesTotal: 0,
            lagMilliseconds: this.lagMilliseconds,
            lastAcknowledgedCursor: this.startedAt ?? null,
        };
    }
}

describe('IndexerRuntime', () => {
    it('resumes the source and checkpoints accepted events during shutdown', async () => {
        const checkpointStore = new InMemoryCheckpointStore();
        await checkpointStore.save(41);
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 100,
        });
        const source = new FakeEventSource();
        const runtime = new IndexerRuntime({ pipeline, source });

        await runtime.start();
        expect(source.startedAt).toBe(41);

        const event = {
            ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>),
            seq: 42,
        };
        await source.emit(event);
        await runtime.stop();

        expect(source.stopped).toBe(true);
        expect((await checkpointStore.load())?.cursor).toBe(42);
    });

    it('records durable heartbeats at startup and after accepted events', async () => {
        const checkpointStore = new InMemoryCheckpointStore();
        await checkpointStore.save(50);
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 100,
        });
        const source = new FakeEventSource();
        const heartbeats: Array<number | null> = [];
        const runtime = new IndexerRuntime({
            pipeline,
            source,
            heartbeat: async cursor => {
                heartbeats.push(cursor);
            },
            heartbeatIntervalMs: 60_000,
        });

        await runtime.start();
        await source.emit({
            ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>),
            seq: 51,
        });
        await runtime.stop();

        expect(heartbeats).toEqual([50, 51]);
    });
    it('does not renew freshness while replaying old events or before a source observation', async () => {
        const pipeline = new IndexerPipeline({ checkpointStore: new InMemoryCheckpointStore() });
        const source = new FakeEventSource();
        source.lagMilliseconds = null;
        const heartbeats: Array<number | null> = [];
        const runtime = new IndexerRuntime({ pipeline, source, heartbeat: async cursor => { heartbeats.push(cursor); } });
        await runtime.start();
        source.lagMilliseconds = 60_000;
        await source.emit({ ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>), seq: 51 });
        expect(heartbeats).toEqual([]);
        source.lagMilliseconds = 0;
        await source.emit({ ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>), seq: 52 });
        expect(heartbeats).toEqual([52]);
        await runtime.stop();
    });

});
