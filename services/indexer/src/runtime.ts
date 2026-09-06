import type { IndexerPipeline } from './pipeline.js';
import type { EventSourceMetrics, AtEventSource } from './stream/event-source.js';

export interface IndexerRuntimeOptions {
    pipeline: IndexerPipeline;
    source: AtEventSource;
    heartbeat?: (cursor: number | null, observedAt: Date) => Promise<void>;
    heartbeatIntervalMs?: number;
    maxSourceLagMs?: number;
}

export const isEventSourceCurrent = (metrics: EventSourceMetrics, maxLagMs = 30_000): boolean =>
    metrics.connected && metrics.lagMilliseconds !== null && metrics.lagMilliseconds <= maxLagMs;

export class IndexerRuntime {
    private started = false;
    private stopped = false;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private readonly options: IndexerRuntimeOptions) {}

    private async heartbeat(cursor: number | null): Promise<void> {
        const metrics = this.options.source.getMetrics();
        if (isEventSourceCurrent(metrics, this.options.maxSourceLagMs)) {
            await this.options.heartbeat?.(cursor, new Date(Date.now() - metrics.lagMilliseconds!));
        }
    }

    async start(): Promise<void> {
        if (this.started) throw new Error('Indexer runtime is already started.');
        this.started = true;
        const cursor = await this.options.pipeline.loadCheckpoint();
        await this.heartbeat(cursor);
        if (this.options.heartbeat) {
            this.heartbeatTimer = setInterval(() => {
                const processed = this.options.pipeline.getCheckpointSeq();
                void this.heartbeat(processed < 0 ? cursor : processed)
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
                await this.heartbeat(result.checkpointSeq);
            },
            async controlCursor => {
                await this.options.pipeline.acknowledgeControlCursor(
                    controlCursor,
                );
                await this.heartbeat(controlCursor);
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
