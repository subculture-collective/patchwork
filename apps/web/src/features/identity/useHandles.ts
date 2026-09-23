import { useEffect, useMemo, useState } from 'react';
import { webDataMode } from '../../app/runtime';
import { fetchHandlesViaApi } from '../api-client';

const BATCH_SIZE = 50;
/** Shared across components for the page lifetime; null = no verified handle. */
const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<void>>();

const load = (dids: readonly string[]): Promise<void> => {
    const missing = dids.filter((did) => !cache.has(did) && !inFlight.has(did));
    if (missing.length === 0) {
        return Promise.all(
            dids.flatMap((did) => {
                const pending = inFlight.get(did);
                return pending ? [pending] : [];
            }),
        ).then(() => undefined);
    }
    const batches: Promise<void>[] = [];
    for (let index = 0; index < missing.length; index += BATCH_SIZE) {
        const batch = missing.slice(index, index + BATCH_SIZE);
        const request = fetchHandlesViaApi(batch).then((result) => {
            for (const did of batch) {
                // Leave failed batches uncached so a later render can retry.
                if (result.ok) cache.set(did, result.data[did] ?? null);
                inFlight.delete(did);
            }
        });
        batch.forEach((did) => inFlight.set(did, request));
        batches.push(request);
    }
    return Promise.all(batches).then(() => undefined);
};

/**
 * Verified handles for the given DIDs. Missing entries mean the handle is
 * unknown (or still loading); callers fall back to a shortened DID.
 */
export const useHandles = (dids: readonly string[]): Record<string, string> => {
    const key = useMemo(
        () => [...new Set(dids.filter((did) => did.startsWith('did:')))].sort().join(','),
        [dids],
    );
    const [, setVersion] = useState(0);

    useEffect(() => {
        if (!key || webDataMode === 'fixture') return undefined;
        let active = true;
        void load(key.split(',')).then(() => {
            if (active) setVersion((version) => version + 1);
        });
        return () => {
            active = false;
        };
    }, [key]);

    const handles: Record<string, string> = {};
    for (const did of key ? key.split(',') : []) {
        const handle = cache.get(did);
        if (handle) handles[did] = handle;
    }
    return handles;
};

/** "did:plc:abcdefghijk…" → "did:plc:abcd…hijk" for compact display. */
export const shortenDid = (did: string): string => {
    const match = /^(did:[a-z]+:)(.+)$/.exec(did);
    if (!match) return did;
    const [, prefix, id] = match;
    return id && id.length > 12 ? `${prefix}${id.slice(0, 4)}…${id.slice(-4)}` : did;
};
