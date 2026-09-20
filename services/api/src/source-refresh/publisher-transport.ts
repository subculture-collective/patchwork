import { evidenceByteLimit } from './evidence-storage.js';
import { PublisherValidationError } from './publisher-validation-error.js';

export interface PublisherRequest {
    /** Operator-reviewed URL from adapter code. Never accept a URL from a public request. */
    url: string;
    maxBytes: number;
    contentTypes: readonly string[];
    timeoutMs?: number;
}

/** Transport only: adapters still prove complete-feed, stable-ID and geography contracts. */
export async function fetchPublisherBytes(request: PublisherRequest, fetcher = globalThis.fetch) {
    const url = new URL(request.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Publisher URL must be credential-free HTTPS.');
    evidenceByteLimit(request.maxBytes);
    const timeoutMs = request.timeoutMs ?? 20_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000
        || request.contentTypes.length < 1 || request.contentTypes.some(type => !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type))) {
        throw new Error('Invalid publisher transport policy.');
    }
    const response = await fetcher(request.url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: request.contentTypes.join(', '), 'user-agent': 'Patchwork resource source refresh/0.1' } });
    try {
        if (!response.ok) throw new Error(`Publisher request failed with HTTP ${response.status}.`);
        if (response.url && response.url !== request.url) throw new PublisherValidationError('Publisher response URL changed unexpectedly.');
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!request.contentTypes.includes(contentType)) throw new PublisherValidationError(`Publisher response must be ${request.contentTypes.join(' or ')}.`);
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > request.maxBytes)) {
            throw new PublisherValidationError('Publisher response exceeds the permitted evidence size.');
        }
        const metadata = (name: string) => {
            const value = response.headers.get(name);
            if (value !== null && value.length > 1000) throw new PublisherValidationError('Publisher metadata exceeds its permitted size.');
            return value;
        };
        const etag = metadata('etag'); const lastModified = metadata('last-modified');
        const chunks: Uint8Array[] = []; let length = 0;
        if (response.body) {
            const reader = response.body.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    length += value.byteLength;
                    if (length > request.maxBytes) throw new PublisherValidationError('Publisher response exceeds the permitted evidence size.');
                    chunks.push(value);
                }
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        if (length === 0) throw new PublisherValidationError('Publisher response is empty.');
        const raw = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
        return { raw, responseUrl: response.url || request.url, contentType, etag, lastModified };
    } finally {
        if (response.body && !response.body.locked) await response.body.cancel().catch(() => {});
    }
}
