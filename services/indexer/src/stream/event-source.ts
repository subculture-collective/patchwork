export type AtEventHandler = (event: unknown) => Promise<void>;
export type AtCursorHandler = (cursor: number) => Promise<void>;

export interface EventSourceMetrics {
    connected: boolean;
    connectionsTotal: number;
    reconnectsTotal: number;
    malformedFramesTotal: number;
    oversizedFramesTotal: number;
    duplicateFramesTotal: number;
    outOfOrderFramesTotal: number;
    lagMilliseconds: number | null;
    lastAcknowledgedCursor: number | null;
}

export interface AtEventSource {
    start(
        cursor: number | null,
        onEvent: AtEventHandler,
        onControlCursor?: AtCursorHandler,
    ): Promise<void>;
    stop(): Promise<void>;
    getMetrics(): EventSourceMetrics;
}
