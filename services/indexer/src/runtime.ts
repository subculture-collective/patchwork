import type { IndexerPipeline } from './pipeline.js';
import type { AtEventSource } from './stream/event-source.js';

export interface IndexerRuntimeOptions {
    pipeline: IndexerPipeline;
    source: AtEventSource;
    heartbeat?: (cursor: number | null) => Promise<void>;
    heartbeatIntervalMs?: number;
}

export class IndexerRuntime {
    private started = false;
    private stopped = false;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly options: IndexerRuntimeOptions) {}

    async start(): Promise<void> {
        if (this.started) throw new Error('Indexer runtime is already started.');
        this.started = true;
        const cursor = await this.options.pipeline.loadCheckpoint();
        await this.options.heartbeat?.(cursor);
        if (this.options.heartbeat) {
            this.heartbeatTimer = setInterval(() => {
                const processed = this.options.pipeline.getCheckpointSeq();
                void this.options
                    .heartbeat!(processed < 0 ? cursor : processed)
                    .catch(() => undefined);
            }, this.options.heartbeatIntervalMs ?? 10_000);
            this.heartbeatTimer.unref();
        }
        await this.options.source.start(
            cursor,
            async event => {
                const result =
                    await this.options.pipeline.ingestAndCheckpoint([event]);
                if (
                    result.normalizedCount + result.quarantinedCount !== 1 ||
                    result.failureCount !== result.quarantinedCount
                ) {
                    throw new Error(
                        'Live AT event was rejected by the ingestion pipeline.',
                    );
                }
                await this.options.heartbeat?.(result.checkpointSeq);
            },
            async controlCursor => {
                await this.options.pipeline.acknowledgeControlCursor(
                    controlCursor,
                );
                await this.options.heartbeat?.(controlCursor);
            },
        );
    }

    async stop(): Promise<void> {
        if (!this.started || this.stopped) return;
        this.stopped = true;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        await this.options.source.stop();
        await this.options.pipeline.saveCheckpoint();
    }
}
