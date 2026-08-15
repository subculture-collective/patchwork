import type { Jetstream, ReplayOpts, TypedEvent } from '@bsky/jetstream';
import { describe, expect, it } from 'vitest';
import { JetstreamV2EventSource } from './jetstream-v2-source.js';

const collection = 'app.patchwork.aid.post';

const waitFor = async (predicate: () => boolean): Promise<void> => {
    const deadline = Date.now() + 1_000;
    while (!predicate()) {
        if (Date.now() >= deadline) throw new Error('Timed out.');
        await new Promise(resolve => setTimeout(resolve, 5));
    }
};

describe('JetstreamV2EventSource', () => {
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
});
