import type { Jetstream, ReplayOpts, TypedEvent } from '@bsky/jetstream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JetstreamV2EventSource } from './jetstream-v2-source.js';

const collection = 'app.patchwork.aid.post';

const waitFor = async (predicate: () => boolean): Promise<void> => {
    const deadline = Date.now() + 4_000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Timed out.');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
};

describe('JetstreamV2EventSource', () => {
    afterEach(() => vi.restoreAllMocks());

    const control = (seq: number): TypedEvent => ({
        did: 'did:plc:unrelated', seq, time: new Date().toISOString(),
        kind: 'account', account: { did: 'did:plc:unrelated', active: true },
    }) as TypedEvent;

    const reconnectSource = (replay: (options?: ReplayOpts) => AsyncGenerator<TypedEvent>) =>
        new JetstreamV2EventSource({
            service: 'https://jetstream.us-east.bsky.network',
            apiKey: 'test-replay-key', collections: [collection],
            controls: {
                identity: async () => undefined,
                account: async () => undefined,
                sync: async () => undefined,
            },
            createClient: () => ({ replay }) as Pick<Jetstream, 'replay'>,
        });

    it('reconnects after failure from the last acknowledged cursor without skipping a failed handler', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const cursors: (number | undefined)[] = [];
        const source = reconnectSource(options => (async function* () {
            cursors.push(options?.afterSeq);
            if (cursors.length === 1) { yield control(43); yield control(44); }
            else yield control(44);
        })());
        let fail = true;
        const acknowledged: number[] = [];
        await source.start(42, async () => undefined, async cursor => {
            if (cursor === 44 && fail) { fail = false; throw new Error('DB unavailable'); }
            acknowledged.push(cursor);
        });
        try {
            await waitFor(() => source.getMetrics().lastAcknowledgedCursor === 44);
            expect(cursors).toEqual([42, 43]);
            expect(acknowledged).toEqual([43, 44]);
            expect(source.getMetrics()).toMatchObject({ connectionsTotal: 2, reconnectsTotal: 1 });
        } finally { await source.stop(); }
    });

    it('reconnects when replay ends without an error', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const cursors: (number | undefined)[] = [];
        const source = reconnectSource(options => (async function* () {
            cursors.push(options?.afterSeq);
            yield control(cursors.length === 1 ? 43 : 44);
        })());
        await source.start(42, async () => undefined);
        try {
            await waitFor(() => source.getMetrics().lastAcknowledgedCursor === 44);
            expect(cursors).toEqual([42, 43]);
        } finally { await source.stop(); }
    });

    it('recovers from a transport rejection using the saved startup cursor', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const cursors: (number | undefined)[] = [];
        const source = reconnectSource(options => (async function* () {
            cursors.push(options?.afterSeq);
            if (cursors.length === 1) throw new Error('network unavailable');
            yield control(43);
        })());
        await source.start(42, async () => undefined);
        try {
            await waitFor(() => source.getMetrics().lastAcknowledgedCursor === 43);
            expect(cursors).toEqual([42, 42]);
        } finally { await source.stop(); }
    });

    it('aborts active replay on shutdown without logging a failure or reconnecting', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const source = reconnectSource(options => (async function* () {
            yield control(43);
            await new Promise<void>((_resolve, reject) => {
                options!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
        })());
        await source.start(42, async () => undefined);
        await waitFor(() => source.getMetrics().lastAcknowledgedCursor === 43);
        await source.stop();
        expect(log).not.toHaveBeenCalled();
        expect(source.getMetrics()).toMatchObject({ connected: false, connectionsTotal: 1, reconnectsTotal: 0 });
    });

    it('backs off repeated failures and cancels the pending retry on shutdown', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const attempts: number[] = [];
        const source = reconnectSource(() => (async function* () {
            attempts.push(Date.now());
            throw new Error('transport unavailable');
        })());
        await source.start(42, async () => undefined);
        try {
            await waitFor(() => attempts.length === 3);
            expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(900);
            expect(attempts[2]! - attempts[1]!).toBeGreaterThanOrEqual(1_900);
            expect(source.getMetrics().connected).toBe(false);
            const stoppedAt = Date.now();
            await source.stop();
            expect(Date.now() - stoppedAt).toBeLessThan(500);
            expect(source.getMetrics()).toMatchObject({ connected: false, lastAcknowledgedCursor: 42 });
            await new Promise(resolve => setTimeout(resolve, 100));
            expect(attempts).toHaveLength(3);
        } finally { await source.stop(); }
    });

    it('replays from v2 seq zero and handles every event kind deliberately', async () => {
        const events = [
            {
                did: 'did:plc:alice',
                seq: 1,
                time: '2026-08-14T12:00:00.000Z',
                kind: 'identity',
                identity: { did: 'did:plc:alice', handle: 'alice.test' },
            },
            {
                did: 'did:plc:alice',
                seq: 2,
                time: '2026-08-14T12:00:01.000Z',
                kind: 'account',
                account: { did: 'did:plc:alice', active: false },
            },
            {
                did: 'did:plc:alice',
                seq: 3,
                time: '2026-08-14T12:00:02.000Z',
                kind: 'sync',
                sync: { did: 'did:plc:alice', rev: '3jzfcijpj2z2a' },
            },
            {
                did: 'did:plc:bob',
                seq: 4,
                time: '2026-08-14T12:00:03.000Z',
                kind: 'commit',
                commit: {
                    operation: 'create',
                    collection,
                    rkey: 'one',
                    rev: '3jzfcijpj2z2b',
                    cid: 'bafy-record',
                    record: { $type: collection, title: 'Help' },
                },
            },
        ] as unknown as TypedEvent[];
        let replayOptions: ReplayOpts | undefined;
        const controls: string[] = [];
        const controlCursors: number[] = [];
        const commits: unknown[] = [];
        const source = new JetstreamV2EventSource({
            service: 'wss://jetstream.us-east.bsky.network/subscribe',
            apiKey: 'test-replay-key',
            collections: [collection],
            relevantDids: ['did:plc:alice'],
            controls: {
                identity: async event => {
                    controls.push(`identity:${event.seq}`);
                },
                account: async event => {
                    controls.push(`account:${event.seq}`);
                },
                sync: async event => {
                    controls.push(`sync:${event.seq}`);
                },
            },
            createClient: options => {
                expect(options).toEqual({
                    service: 'https://jetstream.us-east.bsky.network/',
                    apiKey: 'test-replay-key',
                });
                return {
                    replay: (options?: ReplayOpts) => {
                        replayOptions = options;
                        return (async function* () {
                            yield* events;
                        })();
                    },
                } as Pick<Jetstream, 'replay'>;
            },
        });

        await source.start(
            null,
            async event => {
                commits.push(event);
            },
            async cursor => {
                controlCursors.push(cursor);
            },
        );
        await waitFor(() => source.getMetrics().lastAcknowledgedCursor === 4);

        expect(replayOptions).toMatchObject({
            afterSeq: 0,
            kinds: ['commit', 'identity', 'account', 'sync'],
        });
        expect(controls).toEqual(['identity:1', 'account:2', 'sync:3']);
        expect(controlCursors).toEqual([1, 2, 3]);
        expect(commits).toEqual([
            expect.objectContaining({
                seq: 4,
                action: 'create',
                uri: `at://did:plc:bob/${collection}/one`,
                cid: 'bafy-record',
            }),
        ]);
        expect(source.getMetrics().malformedFramesTotal).toBe(0);
        await source.stop();
    });

    it('uses only the supplied v2 sequence as the replay cursor', async () => {
        let afterSeq: number | undefined;
        const source = new JetstreamV2EventSource({
            service: 'https://jetstream.us-east.bsky.network',
            apiKey: 'test-replay-key',
            collections: [collection],
            controls: {
                identity: async () => undefined,
                account: async () => undefined,
                sync: async () => undefined,
            },
            createClient: () =>
                ({
                    replay: (options?: ReplayOpts) => {
                        afterSeq = options?.afterSeq;
                        return (async function* () {})();
                    },
                }) as Pick<Jetstream, 'replay'>,
        });
        await source.start(42, async () => undefined);
        await waitFor(() => !source.getMetrics().connected);
        expect(afterSeq).toBe(42);
        await source.stop();
    });

    it('acknowledges but does not persist controls for unrelated DIDs', async () => {
        const controls = vi.fn().mockResolvedValue(undefined);
        const controlCursors: number[] = [];
        const source = new JetstreamV2EventSource({
            service: 'https://jetstream.us-east.bsky.network',
            apiKey: 'test-replay-key',
            collections: [collection],
            relevantDids: [],
            controls: {
                identity: controls,
                account: controls,
                sync: controls,
            },
            createClient: () =>
                ({
                    replay: () =>
                        (async function* () {
                            yield {
                                did: 'did:plc:unrelated',
                                seq: 8,
                                time: '2026-08-14T12:00:00.000Z',
                                kind: 'identity',
                                identity: { did: 'did:plc:unrelated' },
                            } as unknown as TypedEvent;
                        })(),
                }) as Pick<Jetstream, 'replay'>,
        });

        await source.start(null, async () => undefined, async cursor => {
            controlCursors.push(cursor);
        });
        await waitFor(() => source.getMetrics().lastAcknowledgedCursor === 8);

        expect(controls).not.toHaveBeenCalled();
        expect(controlCursors).toEqual([8]);
        await source.stop();
    });

    it('logs only sanitized metadata when replay stops fatally', async () => {
        const consoleError = vi
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const source = new JetstreamV2EventSource({
            service: 'https://jetstream.us-east.bsky.network',
            apiKey: 'secret-replay-key',
            collections: [collection],
            controls: {
                identity: async () => undefined,
                account: async () => undefined,
                sync: async () => undefined,
            },
            createClient: () =>
                ({
                    replay: () =>
                        (async function* () {
                            throw Object.assign(new Error('secret-replay-key'), {
                                code: '22007',
                            });
                        })(),
                }) as Pick<Jetstream, 'replay'>,
        });

        await source.start(null, async () => undefined);
        await waitFor(() => !source.getMetrics().connected);

        expect(consoleError).toHaveBeenCalledWith(
            '[indexer] Jetstream v2 replay stopped unexpectedly.',
            { name: 'Error', code: '22007' },
        );
        expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
            'secret-replay-key',
        );
        consoleError.mockRestore();
        await source.stop();
    });
});
