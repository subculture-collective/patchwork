import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parsePublicResourceCatalog, type PublicResourceCatalogInput } from '../db/public-resource-catalog.js';
import { hashRefreshValue } from '../db/public-resource-refresh.js';

export const CPL_DATASET_ID = 'x8fc-8rcq';
export const CPL_DATASET_URL = 'https://data.cityofchicago.org/d/x8fc-8rcq';
export const CPL_API_URL = 'https://data.cityofchicago.org/resource/x8fc-8rcq.json?$limit=500';
const MAX_BYTES = 1_000_000;
const MIN_ROWS = 75;
const MAX_ROWS = 100;

const nonempty = z.string().trim().min(1);
const pointSchema = z.union([
    z.object({ coordinates: z.tuple([z.coerce.number(), z.coerce.number()]) }).passthrough()
        .transform(value => ({ longitude: value.coordinates[0], latitude: value.coordinates[1] })),
    z.object({ latitude: z.coerce.number(), longitude: z.coerce.number() }).passthrough()
        .transform(value => ({ longitude: value.longitude, latitude: value.latitude })),
]);
const websiteSchema = z.union([
    nonempty,
    z.object({ url: nonempty }).passthrough().transform(value => value.url),
]);
const rawRowSchema = z.object({
    name: nonempty.optional(),
    name_: nonempty.optional(),
    address: nonempty,
    city: nonempty,
    state: nonempty,
    zip: z.union([nonempty, z.number().int().transform(String)]),
    phone: nonempty,
    website: websiteSchema,
    hours_of_operation: nonempty,
    location: pointSchema,
}).passthrough().superRefine((value, context) => {
    if (!value.name && !value.name_) context.addIssue({ code: 'custom', message: 'Branch name is required.' });
});

type CplCatalog = PublicResourceCatalogInput;
export interface CplEvidenceManifest {
    version: 1;
    publisher: 'City of Chicago';
    datasetId: typeof CPL_DATASET_ID;
    requestUrl: typeof CPL_API_URL;
    responseUrl: string;
    retrievedAt: string;
    contentType: string;
    etag: string | null;
    lastModified: string | null;
    rawSha256: string;
    rawBytes: number;
    rowCount: number;
    normalizedSha256: string;
}

const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const safeTimestamp = (value: string) => value.replaceAll(':', '').replace('.000Z', 'Z');

function branchIdentity(website: string) {
    const url = new URL(website);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('CPL website must use HTTP or HTTPS.');
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'chipublib.org') throw new Error('CPL website must use the official chipublib.org hostname.');
    const match = url.pathname.match(/^\/locations\/(\d{1,3})\/?$/);
    if (!match) throw new Error('CPL website must contain a stable numeric branch location identifier.');
    return { id: match[1]!, website: `https://www.chipublib.org/locations/${match[1]!}/` };
}

/** Converts complete publisher bytes to a catalog; it does not write or infer service assertions. */
export function normalizeCplPublisherBytes(raw: Uint8Array, retrievedAt: Date, baselineIds: ReadonlySet<string>) {
    if (!Number.isFinite(retrievedAt.getTime())) throw new Error('Invalid retrieval time.');
    if (raw.byteLength === 0 || raw.byteLength > MAX_BYTES) throw new Error('CPL response exceeds the permitted evidence size.');
    let input: unknown;
    try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { throw new Error('CPL response is not valid UTF-8 JSON.'); }
    if (!Array.isArray(input)) throw new Error('CPL response must be a JSON array.');
    if (input.length < MIN_ROWS || input.length > MAX_ROWS) throw new Error('CPL response row count is outside the complete-feed boundary.');
    const resources = input.map((value, index) => {
        const parsed = rawRowSchema.safeParse(value);
        if (!parsed.success) throw new Error(`CPL row ${index + 1} does not match the publisher contract.`);
        const row = parsed.data;
        const identity = branchIdentity(row.website);
        const postalCode = String(row.zip).match(/^\d{5}/)?.[0];
        if (!postalCode || !/^60\d{3}$/.test(postalCode)) throw new Error(`CPL branch ${identity.id} has an invalid Chicago ZIP code.`);
        if (row.city.toLowerCase() !== 'chicago' || row.state.toUpperCase() !== 'IL') throw new Error(`CPL branch ${identity.id} is outside Chicago, Illinois.`);
        if (row.location.latitude < 41.5 || row.location.latitude > 42.1
            || row.location.longitude < -88 || row.location.longitude > -87.4) {
            throw new Error(`CPL branch ${identity.id} has coordinates outside the Chicago boundary.`);
        }
        const phoneDigits = row.phone.replace(/\D/g, '');
        if (phoneDigits.length !== 10) throw new Error(`CPL branch ${identity.id} has an invalid public phone number.`);
        const hours = row.hours_of_operation.replace(/\s+/g, ' ').trim();
        if (hours.length > 200) throw new Error(`CPL branch ${identity.id} hours exceed the catalog limit.`);
        return {
            id: `cpl-${identity.id}`,
            name: `${(row.name ?? row.name_)!.trim()} — Chicago Public Library`,
            category: 'library' as const,
            streetAddress: row.address.trim(), city: 'Chicago', state: 'IL' as const, postalCode,
            latitude: row.location.latitude, longitude: row.location.longitude,
            phone: row.phone.trim(), website: identity.website, usualHours: hours,
            claimStatus: 'unclaimed' as const,
            publicAccess: 'Public library. Check the official branch page for current hours, accessibility and service requirements.',
            sourceId: 'cpl', countyId: '17031', coordinateBasis: 'publisher-address' as const,
        };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(resources.map(resource => resource.id));
    if (ids.size !== resources.length) throw new Error('CPL response contains duplicate branch identifiers.');
    if (baselineIds.size > 0) {
        const retained = [...baselineIds].filter(id => ids.has(id)).length;
        if (retained / baselineIds.size < 0.9) throw new Error('CPL response is missing more than 10% of baseline branches.');
    }
    const digest = hash(raw);
    const retrievedDate = retrievedAt.toISOString().slice(0, 10);
    const catalog: PublicResourceCatalogInput = {
        scope: { name: 'Chicago Public Library locations', countyIds: ['17031'], sourceUrl: CPL_DATASET_URL },
        sources: { cpl: { name: 'City of Chicago — Libraries: Locations, Contact Information, and Usual Hours of Operation',
            url: CPL_DATASET_URL, apiUrl: CPL_API_URL, retrievedAt: retrievedDate, sha256: digest } },
        resources,
    };
    parsePublicResourceCatalog(catalog);
    return catalog;
}

async function writeImmutable(path: string, content: Uint8Array | string) {
    try { await writeFile(path, content, { flag: 'wx' }); }
    catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
        const existing = await readFile(path);
        const expected = typeof content === 'string' ? Buffer.from(content) : Buffer.from(content);
        if (!existing.equals(expected)) throw new Error(`Evidence path already contains different bytes: ${path}`);
    }
}

/** Writes raw evidence and derived artifacts only after the full response validates. */
export async function retainCplEvidence(outputDir: string, raw: Uint8Array, catalog: CplCatalog, manifest: CplEvidenceManifest) {
    const evidenceDir = join(outputDir, 'raw');
    const runsDir = join(outputDir, 'runs');
    await mkdir(evidenceDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });
    const run = `${safeTimestamp(manifest.retrievedAt)}-${manifest.rawSha256.slice(0, 12)}`;
    const rawPath = join(evidenceDir, `${manifest.rawSha256}.json`);
    const manifestPath = join(runsDir, `${run}.manifest.json`);
    const catalogPath = join(runsDir, `${run}.catalog.json`);
    await writeImmutable(rawPath, raw);
    await writeImmutable(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeImmutable(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    return { rawPath, manifestPath, catalogPath };
}

async function readBoundedBody(response: Response) {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > MAX_BYTES) {
                await reader.cancel();
                throw new Error('CPL response exceeds the permitted evidence size.');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const raw = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
    return raw;
}

export async function fetchCplPublisherEvidence(options: {
    outputDir: string;
    baselineIds: ReadonlySet<string>;
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
}) {
    const fetcher = options.fetch ?? globalThis.fetch;
    const retrievedAt = (options.now ?? (() => new Date()))();
    const response = await fetcher(CPL_API_URL, { redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { accept: 'application/json', 'user-agent': 'Patchwork resource source refresh/0.1' } });
    if (!response.ok) throw new Error(`CPL publisher request failed with HTTP ${response.status}.`);
    if (response.url && response.url !== CPL_API_URL) throw new Error('CPL publisher response URL changed unexpectedly.');
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (contentType !== 'application/json') throw new Error('CPL publisher response is not application/json.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) throw new Error('CPL response exceeds the permitted evidence size.');
    const raw = await readBoundedBody(response);
    const catalog = normalizeCplPublisherBytes(raw, retrievedAt, options.baselineIds);
    const manifest: CplEvidenceManifest = {
        version: 1, publisher: 'City of Chicago', datasetId: CPL_DATASET_ID,
        requestUrl: CPL_API_URL, responseUrl: response.url || CPL_API_URL,
        retrievedAt: retrievedAt.toISOString(), contentType,
        etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'),
        rawSha256: hash(raw), rawBytes: raw.byteLength, rowCount: catalog.resources.length,
        normalizedSha256: hashRefreshValue(catalog),
    };
    const paths = await retainCplEvidence(options.outputDir, raw, catalog, manifest);
    return { catalog, manifest, paths };
}
