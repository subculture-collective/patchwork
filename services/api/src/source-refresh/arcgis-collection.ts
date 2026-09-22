import { parseArcgisCount, parseArcgisIds, parseArcgisPage, validateArcgisContract, type ArcgisContract, type ArcgisFeature } from './arcgis-contract.js';
import { evidenceByteLimit } from './evidence-storage.js';
import { fetchPublisherBytes } from './publisher-transport.js';
import { PublisherValidationError } from './publisher-validation-error.js';

export interface ArcgisCollectionPolicy {
    /** Reviewed adapter-owned query URL; never supplied by a public request. */
    queryUrl: string;
    contract: ArcgisContract;
    pageSize: number;
    maxPages: number;
    maxTotalBytes: number;
    timeoutMs: number;
}
export interface ArcgisCapture {
    role: 'count-before' | 'ids-before' | 'features' | 'ids-after' | 'count-after';
    requestedIds: number[];
    requestUrl: string;
    retrievedAt: string;
    raw: Uint8Array;
    contentType: string;
    etag: string | null;
    lastModified: string | null;
}
export function validateArcgisCollectionPolicy(policy: ArcgisCollectionPolicy) {
    validateArcgisContract(policy.contract);
    evidenceByteLimit(policy.maxTotalBytes);
    const url = new URL(policy.queryUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
        || !/\/(?:MapServer|FeatureServer)\/\d+\/query$/.test(url.pathname)
        || !Number.isSafeInteger(policy.pageSize) || policy.pageSize < 1 || policy.pageSize > 1000
        || !Number.isSafeInteger(policy.maxPages) || policy.maxPages < 1 || policy.maxPages > 1000
        || !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 900_000) {
        throw new Error('Invalid ArcGIS collection policy.');
    }
}
export function arcgisRequestUrl(policy: ArcgisCollectionPolicy, role: ArcgisCapture['role'], ids: readonly number[] = []) {
    const url = new URL(policy.queryUrl);
    url.searchParams.set('f', 'json');
    if (role === 'features') {
        url.searchParams.set('objectIds', ids.join(','));
        url.searchParams.set('outFields', Object.keys(policy.contract.fields).join(','));
        url.searchParams.set('outSR', '4326');
        url.searchParams.set('returnGeometry', 'true');
    } else {
        url.searchParams.set('where', '1=1');
        url.searchParams.set(role.startsWith('count') ? 'returnCountOnly' : 'returnIdsOnly', 'true');
    }
    return url.href;
}

/** Complete advertised ID coverage, not an atomic database snapshot or publication approval. */
export async function collectArcgisPoints(policy: ArcgisCollectionPolicy, options: {
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    onEvidence?: (capture: ArcgisCapture) => Promise<void>;
} = {}) {
    validateArcgisCollectionPolicy(policy);
    const timeout = AbortSignal.timeout(policy.timeoutMs);
    const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
    const captures: ArcgisCapture[] = []; let totalBytes = 0;
    const capture = async (role: ArcgisCapture['role'], requestedIds: number[] = []) => {
        signal.throwIfAborted();
        const budget = Math.min(policy.contract.maxPageBytes, policy.maxTotalBytes - totalBytes);
        if (budget < 1) throw new PublisherValidationError('ArcGIS collection exhausted its byte budget.');
        const requestUrl = arcgisRequestUrl(policy, role, requestedIds);
        const result = await fetchPublisherBytes({ url: requestUrl, maxBytes: budget, contentTypes: ['application/json'], signal }, options.fetcher);
        const evidence: ArcgisCapture = { role, requestedIds, requestUrl, retrievedAt: new Date().toISOString(),
            raw: result.raw, contentType: result.contentType, etag: result.etag, lastModified: result.lastModified };
        totalBytes += evidence.raw.byteLength;
        await options.onEvidence?.(evidence);
        signal.throwIfAborted();
        captures.push(evidence);
        return evidence.raw;
    };
    const count = parseArcgisCount(await capture('count-before'), policy.contract);
    if (Math.ceil(count / policy.pageSize) > policy.maxPages) throw new PublisherValidationError('ArcGIS collection exceeds its page budget.');
    const ids = parseArcgisIds(await capture('ids-before'), policy.contract, count);
    const features: ArcgisFeature[] = [];
    for (let offset = 0; offset < ids.length; offset += policy.pageSize) {
        const requested = ids.slice(offset, offset + policy.pageSize);
        features.push(...parseArcgisPage(await capture('features', requested), policy.contract, requested));
    }
    const after = parseArcgisIds(await capture('ids-after'), policy.contract, count);
    const afterCount = parseArcgisCount(await capture('count-after'), policy.contract);
    if (afterCount !== count || ids.some((id, index) => id !== after[index])) {
        throw new PublisherValidationError('ArcGIS membership changed during collection.');
    }
    return { features, captures, totalBytes, count, consistency: 'stable-object-id-set' as const };
}
