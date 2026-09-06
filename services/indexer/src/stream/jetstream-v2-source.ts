import {
    Jetstream,
    type CollectionFilter,
    type JetstreamOpts,
    type TypedEvent,
} from '@bsky/jetstream';
import type {
    AtCursorHandler,
    AtEventHandler,
    AtEventSource,
    EventSourceMetrics,
} from './event-source.js';

interface JetstreamCommitEvent {
    did: string;
    seq: number;
    time: string;
    kind: 'commit';
    commit: {
        operation: 'create' | 'update' | 'delete';
        collection: string;
        rkey: string;
        rev: string;
        cid?: unknown;
        record?: unknown;
    };
}

interface JetstreamV2ControlHandlers {
    identity(event: Extract<TypedEvent, { kind: 'identity' }>): Promise<void>;
    account(event: Extract<TypedEvent, { kind: 'account' }>): Promise<void>;
    sync(event: Extract<TypedEvent, { kind: 'sync' }>): Promise<void>;
}

interface JetstreamV2EventSourceOptions {
    service: string;
    apiKey: string;
    collections: readonly string[];
    relevantDids?: readonly string[];
    controls: JetstreamV2ControlHandlers;
    createClient?: (options: JetstreamOpts) => Pick<Jetstream, 'replay'>;
}

export const sdkServiceUrl = (service: string): string => {
    const url = new URL(service);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.protocol === 'ws:') url.protocol = 'http:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString();
};

const initialMetrics = (): EventSourceMetrics => ({
    connected: false,
    connectionsTotal: 0,
    reconnectsTotal: 0,
    malformedFramesTotal: 0,
    oversizedFramesTotal: 0,
    duplicateFramesTotal: 0,
    outOfOrderFramesTotal: 0,
    lagMilliseconds: null,
    lastAcknowledgedCursor: null,
});

export const toAtEvent = (event: JetstreamCommitEvent): unknown => {
    const commit = event.commit;
    return {
        seq: event.seq,
        receivedAt: event.time,
        action: commit.operation,
        uri: `at://${event.did}/${commit.collection}/${commit.rkey}`,
        collection: commit.collection,
        authorDid: event.did,
        ...('cid' in commit ? { cid: String(commit.cid) } : {}),
        revision: commit.rev,
        ...('record' in commit ? { record: commit.record } : {}),
        ...(commit.operation === 'delete'
            ? { deleteReason: 'deleted-upstream' }
            : {}),
    };
};

export class JetstreamV2EventSource implements AtEventSource {
    private metrics = initialMetrics();
    private lastEventTimeMs: number | null = null;
    private abort: AbortController | null = null;
    private task: Promise<void> | null = null;
    private readonly relevantDids: Set<string>;

    constructor(private readonly options: JetstreamV2EventSourceOptions) {
        if (options.collections.length === 0) {
            throw new Error('Jetstream v2 requires collection filters.');
        }
        this.relevantDids = new Set(options.relevantDids);
    }

    async start(
        cursor: number | null,
        onEvent: AtEventHandler,
        onControlCursor?: AtCursorHandler,
    ): Promise<void> {
        if (this.task)
            throw new Error('Jetstream v2 source is already running.');
        this.abort = new AbortController();
        this.metrics = initialMetrics();
        this.lastEventTimeMs = null;
        this.metrics.lastAcknowledgedCursor = cursor;
        const clientOptions: JetstreamOpts = {
            service: sdkServiceUrl(this.options.service),
            apiKey: this.options.apiKey,
        };
        const client =
            this.options.createClient?.(clientOptions) ??
            new Jetstream(clientOptions);
        this.metrics.connected = true;
        this.metrics.connectionsTotal = 1;
        this.task = this.consume(client, onEvent, onControlCursor).finally(
            () => {
                this.metrics.connected = false;
            },
        );
        void this.task.catch((error) => {
            const metadata: { name: string; code?: string } = {
                name: error instanceof Error ? error.name : 'UnknownError',
            };
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                typeof error.code === 'string'
            ) {
                metadata.code = error.code;
            }
            console.error(
                '[indexer] Jetstream v2 replay stopped unexpectedly.',
                metadata,
            );
        });
    }

    async stop(): Promise<void> {
        if (!this.task) return;
        this.abort?.abort();
        await this.task.catch((error) => {
            if (!this.abort?.signal.aborted) throw error;
        });
        this.task = null;
        this.abort = null;
        this.metrics.connected = false;
    }

    getMetrics(): EventSourceMetrics {
        return { ...this.metrics, lagMilliseconds: this.lastEventTimeMs === null ? null : Math.max(0, Date.now() - this.lastEventTimeMs) };
    }

    private async consume(
        client: Pick<Jetstream, 'replay'>,
        onEvent: AtEventHandler,
        onControlCursor?: AtCursorHandler,
    ): Promise<void> {
        const afterSeq = this.metrics.lastAcknowledgedCursor ?? 0;
        for await (const event of client.replay({
            afterSeq,
            collections: this.options.collections.map(
                (collection) => collection as CollectionFilter,
            ),
            kinds: ['commit', 'identity', 'account', 'sync'],
            signal: this.abort!.signal,
            onError: () => {
                this.metrics.malformedFramesTotal += 1;
            },
        })) {
            const prior = this.metrics.lastAcknowledgedCursor;
            if (prior !== null && event.seq <= prior) {
                if (event.seq === prior) this.metrics.duplicateFramesTotal += 1;
                else this.metrics.outOfOrderFramesTotal += 1;
                continue;
            }
            if (event.kind === 'commit') {
                this.relevantDids.add(event.did);
                await onEvent(toAtEvent(event));
            } else {
                if (this.relevantDids.has(event.did)) {
                    await this.options.controls[event.kind](event as never);
                }
                await onControlCursor?.(event.seq);
            }
            this.lastEventTimeMs = new Date(event.time).getTime();
            this.metrics.lastAcknowledgedCursor = event.seq;
            this.metrics.lagMilliseconds = Math.max(
                0,
                Date.now() - new Date(event.time).getTime(),
            );
        }
    }
}
