import type { EventBatch, RawEvent, SnapshotOpts } from '@bsky/jetstream';
import { describe, expect, it, vi } from 'vitest';
import { runJetstreamV2Backfill } from './v2-backfill.js';

const collection = 'app.patchwork.aid.post';

describe('runJetstreamV2Backfill', () => {
    it('snapshots commits globally and controls only for discovered DIDs', async () => {
        const snapshots: SnapshotOpts[] = [];
        const commit = {
            did: 'did:plc:alice',
            seq: 10,
            time: '2026-08-15T12:00:00.000Z',
            kind: 'commit',
            commit: {
                operation: 'create',
                collection,
                rkey: 'one',
                rev: '3jzfcijpj2z2a',
                cid: 'bafy-record',
                record: { $type: collection, title: 'Help' },
            },
        } as unknown as RawEvent;
        const control = {
            did: 'did:plc:alice',
            seq: 11,
            time: '2026-08-15T12:00:01.000Z',
            kind: 'sync',
            sync: { did: 'did:plc:alice', rev: '3jzfcijpj2z2b' },
        } as unknown as RawEvent;
        const client = {
            liveRawBatches: () =>
                (async function* () {
                    yield {
                        events: [
                            {
                                did: 'did:plc:head',
                                seq: 20,
                                time: '2026-08-15T12:00:02.000Z',
                                kind: 'identity',
                                identity: { did: 'did:plc:head' },
                            } as unknown as RawEvent,
                        ],
                        lastCursor: 20,
                    } as unknown as EventBatch<RawEvent>;
                })(),
            snapshotRawBatches: (options: SnapshotOpts) => {
                snapshots.push(options);
                return (async function* (): AsyncGenerator<
                    EventBatch<RawEvent>
                > {
                    yield {
                        events: options.kinds?.includes('commit')
                            ? [commit]
                            : [control],
                        lastCursor: 20,
                    };
                })();
            },
        };
        const onCommit = vi.fn().mockResolvedValue(undefined);
        const onControl = vi.fn().mockResolvedValue(undefined);
        const saveCheckpoint = vi.fn().mockResolvedValue(undefined);

        await expect(
            runJetstreamV2Backfill({
                client,
                collections: [collection],
                onCommit,
                onControl,
                saveCheckpoint,
            }),
        ).resolves.toEqual({
            headSeq: 20,
            commits: 1,
            controls: 1,
            relevantDids: 1,
        });
        expect(snapshots).toEqual([
            expect.objectContaining({
                afterSeq: 0,
                beforeSeq: 20,
                collections: [collection],
                kinds: ['commit'],
            }),
            expect.objectContaining({
                afterSeq: 0,
                beforeSeq: 20,
                dids: ['did:plc:alice'],
                kinds: ['identity', 'account', 'sync'],
            }),
        ]);
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onControl).toHaveBeenCalledTimes(1);
        expect(saveCheckpoint).toHaveBeenCalledWith(20);
    });

    it('skips snapshot commits outside the requested collections', async () => {
        const commit = (did: string, seq: number, commitCollection: string) => ({
            did, seq, time: '2026-08-15T12:00:00.000Z', kind: 'commit',
            commit: {
                operation: 'create', collection: commitCollection, rkey: `r${seq}`,
                rev: '3jzfcijpj2z2a', cid: 'bafy-record', record: { $type: commitCollection },
            },
        }) as unknown as RawEvent;
        const snapshots: SnapshotOpts[] = [];
        const client = {
            liveRawBatches: () => (async function* () {
                yield { events: [{ did: 'did:plc:head', seq: 30, time: '2026-08-15T12:00:02.000Z',
                    kind: 'identity', identity: { did: 'did:plc:head' } } as unknown as RawEvent], lastCursor: 30 };
            })(),
            snapshotRawBatches: (options: SnapshotOpts) => {
                snapshots.push(options);
                return (async function* (): AsyncGenerator<EventBatch<RawEvent>> {
                    yield {
                        events: options.kinds?.includes('commit')
                            ? [commit('did:plc:mallory', 10, 'app.patchwork.moderation.report'),
                                commit('did:plc:alice', 11, collection)]
                            : [],
                        lastCursor: 30,
                    };
                })();
            },
        };
        const onCommit = vi.fn().mockResolvedValue(undefined);

        await expect(runJetstreamV2Backfill({
            client, collections: [collection], onCommit,
            onControl: vi.fn(), saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        })).resolves.toMatchObject({ commits: 1, relevantDids: 1 });
        expect(onCommit).toHaveBeenCalledTimes(1);
        expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ seq: 11 }));
        expect(snapshots[1]).toMatchObject({ dids: ['did:plc:alice'] });
    });

    it('does not request network-wide controls when no commit DID exists', async () => {
        const snapshotRawBatches = vi.fn(() =>
            (async function* (): AsyncGenerator<EventBatch<RawEvent>> {
                yield { events: [], lastCursor: 40 };
            })(),
        );
        const client = {
            liveRawBatches: () =>
                (async function* () {
                    yield {
                        events: [
                            {
                                did: 'did:plc:head',
                                seq: 40,
                                time: '2026-08-15T12:00:00.000Z',
                                kind: 'identity',
                                identity: { did: 'did:plc:head' },
                            } as unknown as RawEvent,
                        ],
                        lastCursor: 40,
                    };
                })(),
            snapshotRawBatches,
        };
        const saveCheckpoint = vi.fn().mockResolvedValue(undefined);

        await runJetstreamV2Backfill({
            client,
            collections: [collection],
            onCommit: vi.fn(),
            onControl: vi.fn(),
            saveCheckpoint,
        });

        expect(snapshotRawBatches).toHaveBeenCalledTimes(1);
        expect(saveCheckpoint).toHaveBeenCalledWith(40);
    });
});
