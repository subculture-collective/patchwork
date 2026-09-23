import { describe, expect, it, vi } from 'vitest';
import { createHandleCache } from './identity-handle-cache.js';
import type { IdentityResolverFn } from './identity-handler.js';

const resolverFor = (handles: Record<string, string | undefined>) =>
    vi.fn<IdentityResolverFn>(async (did) => {
        if (!(did in handles)) throw new Error('unresolvable');
        const handle = handles[did];
        return handle ? { did, handle } : { did };
    });

describe('handle cache', () => {
    it('returns verified handles, de-duplicates and reuses cached results', async () => {
        const resolve = resolverFor({ 'did:plc:a': 'alice.example', 'did:plc:b': undefined });
        const lookup = createHandleCache(resolve);
        await expect(lookup(['did:plc:a', 'did:plc:a', 'did:plc:b', 'did:plc:c'])).resolves.toEqual({
            'did:plc:a': 'alice.example',
        });
        expect(resolve).toHaveBeenCalledTimes(3);
        await lookup(['did:plc:a', 'did:plc:b', 'did:plc:c']);
        expect(resolve).toHaveBeenCalledTimes(3);
    });

    it('expires positive and negative entries on their own schedules', async () => {
        let clock = 0;
        const resolve = resolverFor({ 'did:plc:a': 'alice.example' });
        const lookup = createHandleCache(resolve, {
            ttlMs: 1000,
            negativeTtlMs: 100,
            now: () => clock,
        });
        await lookup(['did:plc:a', 'did:plc:missing']);
        clock = 500;
        await lookup(['did:plc:a', 'did:plc:missing']);
        expect(resolve.mock.calls.map(([did]) => did)).toEqual([
            'did:plc:a',
            'did:plc:missing',
            'did:plc:missing',
        ]);
        clock = 1500;
        await lookup(['did:plc:a']);
        expect(resolve).toHaveBeenCalledTimes(4);
    });

    it('ignores a resolver answer for a different DID', async () => {
        const lookup = createHandleCache(
            vi.fn<IdentityResolverFn>(async () => ({ did: 'did:plc:other', handle: 'other.example' })),
        );
        await expect(lookup(['did:plc:a'])).resolves.toEqual({});
    });

    it('evicts the oldest entries beyond the size limit', async () => {
        const resolve = resolverFor({ 'did:plc:a': 'a.example', 'did:plc:b': 'b.example', 'did:plc:c': 'c.example' });
        const lookup = createHandleCache(resolve, { maxEntries: 2 });
        await lookup(['did:plc:a', 'did:plc:b', 'did:plc:c']);
        await lookup(['did:plc:a']);
        expect(resolve).toHaveBeenCalledTimes(4);
    });
});
