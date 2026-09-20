import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { hashRefreshValue } from '../db/public-resource-refresh.js';
import { CPL_API_URL, CPL_DATASET_ID, normalizeCplPublisherBytes } from './chicago-public-library.js';
import { evidenceHash, readEvidenceFile, restoreEvidenceBlob } from './evidence-storage.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
    version: z.literal(1), publisher: z.literal('City of Chicago'), datasetId: z.literal(CPL_DATASET_ID),
    requestUrl: z.literal(CPL_API_URL), responseUrl: z.literal(CPL_API_URL),
    retrievedAt: z.string().datetime(), contentType: z.literal('application/json'),
    etag: z.string().max(1000).nullable(), lastModified: z.string().max(1000).nullable(),
    rawSha256: sha, normalizedSha256: sha, rawBytes: z.number().int().min(1).max(1_000_000),
    rowCount: z.number().int().min(75).max(100),
}).strict();
const storageSchema = z.object({
    version: z.literal(1), adapter: z.literal('chicago-public-library'), adapterVersion: z.literal('1.0.0'),
    schemaVersion: z.literal(1), normalizedSha256: sha,
    raw: z.object({ version: z.literal(1), encoding: z.literal('gzip'), rawSha256: sha,
        rawBytes: z.number().int().positive(), storedSha256: sha, storedBytes: z.number().int().positive(), key: z.string().max(200) }).strict(),
}).strict();
async function json(path: string, limit: number): Promise<unknown> {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readEvidenceFile(path, limit)));
}

/** Read-only restore audit. No database connection, writes, or freshness renewal. */
export async function verifyCplEvidence(root: string, manifestName: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{6}(?:\.\d{3})?Z-[a-f0-9]{12}\.manifest\.json$/.test(manifestName)) {
        throw new Error('Expected a CPL manifest basename, not a path.');
    }
    const manifest = manifestSchema.parse(await json(join(root, 'runs', manifestName), 16_384));
    const run = manifestName.slice(0, -'.manifest.json'.length);
    const expectedRun = `${manifest.retrievedAt.replaceAll(':', '').replace('.000Z', 'Z')}-${manifest.rawSha256.slice(0, 12)}`;
    if (run !== expectedRun) throw new Error('Manifest filename does not match its evidence identity.');
    const raw = await readEvidenceFile(join(root, 'raw', `${manifest.rawSha256}.json`), 1_000_000);
    if (raw.length !== manifest.rawBytes || evidenceHash(raw) !== manifest.rawSha256) throw new Error('Raw evidence mismatch.');
    const catalog = await json(join(root, 'runs', `${run}.catalog.json`), 1_000_000);
    const normalized = normalizeCplPublisherBytes(raw, new Date(manifest.retrievedAt), new Set());
    if (hashRefreshValue(catalog) !== manifest.normalizedSha256
        || hashRefreshValue(normalized) !== manifest.normalizedSha256
        || normalized.resources.length !== manifest.rowCount) throw new Error('Normalized evidence mismatch.');
    let storage: z.infer<typeof storageSchema> | undefined;
    try { storage = storageSchema.parse(await json(join(root, 'runs', `${run}.storage.json`), 16_384)); }
    catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
    if (storage) {
        if (storage.raw.rawSha256 !== manifest.rawSha256 || storage.normalizedSha256 !== manifest.normalizedSha256) {
            throw new Error('Storage reference does not match manifest.');
        }
        if (!(await restoreEvidenceBlob(root, storage.raw, 1_000_000)).equals(raw)) throw new Error('Compressed replay mismatch.');
    }
    return { status: 'verified' as const, rawSha256: manifest.rawSha256, normalizedSha256: manifest.normalizedSha256,
        retrievedAt: manifest.retrievedAt, rowCount: manifest.rowCount,
        storage: storage ? 'gzip-and-legacy' as const : 'legacy-only' as const };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args.some(value => value.startsWith('-'))) {
        throw new Error('Usage: resources:evidence:verify-cpl <evidence-root> <manifest-basename>');
    }
    try { console.log(JSON.stringify(await verifyCplEvidence(resolve(args[0]!), args[1]!), null, 2)); }
    catch { console.error('CPL evidence verification failed; retained files were not modified.'); process.exitCode = 1; }
}
