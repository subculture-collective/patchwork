import type { IdentityResolverFn } from './identity-handler.js';

interface CacheEntry {
    handle: string | null;
    expiresAt: number;
}

export interface HandleCacheOptions {
    /** How long a verified handle is reused. */
    ttlMs?: number;
    /** How long a failed or unverified lookup is remembered. */
    negativeTtlMs?: number;
    /** Upper bound on cached DIDs; oldest entries are evicted first. */
    maxEntries?: number;
    /** Parallel lookups per batch. */
    concurrency?: number;
    timeoutMs?: number;
    now?: () => number;
}

/**
 * Batch DID → handle lookups with an in-memory cache, so lists of members
 * can show "@alice.bsky.social" without a resolver call per row per view.
 * Only verified handles are returned; misses are cached briefly.
 */
export const createHandleCache = (
    resolve: IdentityResolverFn,
    {
        ttlMs = 60 * 60 * 1000,
        negativeTtlMs = 10 * 60 * 1000,
        maxEntries = 5000,
        concurrency = 6,
        timeoutMs = 5000,
        now = Date.now,
    }: HandleCacheOptions = {},
) => {
    const entries = new Map<string, CacheEntry>();

    const remember = (did: string, handle: string | null) => {
        entries.delete(did);
        entries.set(did, {
            handle,
            expiresAt: now() + (handle ? ttlMs : negativeTtlMs),
        });
        while (entries.size > maxEntries) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            entries.delete(oldest);
        }
    };

    const lookup = async (did: string): Promise<string | null> => {
        try {
            const identity = await resolve(did, AbortSignal.timeout(timeoutMs));
            return identity.did === did && identity.handle
                ? identity.handle
                : null;
        } catch {
            return null;
        }
    };

    return async (dids: readonly string[]): Promise<Record<string, string>> => {
        const result: Record<string, string> = {};
        const pending: string[] = [];
        for (const did of new Set(dids)) {
            const cached = entries.get(did);
            if (cached && cached.expiresAt > now()) {
                if (cached.handle) result[did] = cached.handle;
            } else {
                pending.push(did);
            }
        }
        for (let index = 0; index < pending.length; index += concurrency) {
            const slice = pending.slice(index, index + concurrency);
            const handles = await Promise.all(slice.map(lookup));
            slice.forEach((did, position) => {
                const handle = handles[position] ?? null;
                remember(did, handle);
                if (handle) result[did] = handle;
            });
        }
        return result;
    };
};

export type HandleLookup = ReturnType<typeof createHandleCache>;
