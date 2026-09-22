import { join } from 'node:path';
import { z } from 'zod';
import { collectArcgisPoints, validateArcgisCollectionPolicy, type ArcgisCapture, type ArcgisCollectionPolicy } from './arcgis-collection.js';
import { evidenceHash, readEvidenceFile, retainEvidenceBlob, restoreEvidenceBlob, writeImmutableEvidence } from './evidence-storage.js';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const source = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/);
const blob = z.object({ version: z.literal(1), encoding: z.literal('gzip'), rawSha256: sha, storedSha256: sha,
    rawBytes: z.number().int().positive().max(64 * 1024 * 1024), storedBytes: z.number().int().positive().max(64 * 1024 * 1024), key: z.string().max(200) }).strict();
const captureSchema = z.object({ role: z.enum(['count-before', 'ids-before', 'features', 'ids-after', 'count-after']),
    requestedIds: z.array(z.number().int().nonnegative().safe()).max(1000), requestUrl: z.string().url().max(20_000),
    retrievedAt: z.string().datetime(), contentType: z.literal('application/json'),
    etag: z.string().max(1000).nullable(), lastModified: z.string().max(1000).nullable(), blob }).strict();
const manifestSchema = z.object({ version: z.literal(1), sourceKey: source, policySha256: sha,
    consistency: z.literal('stable-object-id-set'), captures: z.array(captureSchema).min(5).max(1004) }).strict();
const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value));
// Explicit ordering makes equivalent adapter objects produce the same policy identity.
const policyHash = (p: ArcgisCollectionPolicy) => evidenceHash(jsonBytes([p.queryUrl, p.pageSize, p.maxPages, p.maxTotalBytes, p.timeoutMs,
    p.contract.idField, p.contract.minRecords, p.contract.maxRecords, p.contract.maxPageBytes, Object.entries(p.contract.fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]));

/** Retain each response before parsing; publish the complete run manifest only after validation. */
export async function retainArcgisCollection(root: string, sourceKey: string, policy: ArcgisCollectionPolicy,
    options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}) {
    source.parse(sourceKey);
    validateArcgisCollectionPolicy(policy);
    const captures: z.infer<typeof captureSchema>[] = [];
    const policySha256 = policyHash(policy);
    const result = await collectArcgisPoints(policy, { ...options, onEvidence: async (capture: ArcgisCapture) => {
        const { raw, ...metadata } = capture;
        const retained = captureSchema.parse({ ...metadata, blob: await retainEvidenceBlob(root, raw, policy.contract.maxPageBytes) });
        const envelope = jsonBytes({ version: 1, sourceKey, policySha256, capture: retained });
        await writeImmutableEvidence(join(root, 'arcgis-captures', evidenceHash(envelope) + '.json'), envelope);
        captures.push(retained);
    } });
    const manifest = manifestSchema.parse({ version: 1, sourceKey, policySha256, consistency: result.consistency, captures });
    const bytes = jsonBytes(manifest);
    if (bytes.length > 8 * 1024 * 1024) throw new Error('ArcGIS manifest exceeds its byte budget.');
    const manifestSha256 = evidenceHash(bytes);
    await writeImmutableEvidence(join(root, 'arcgis-runs', manifestSha256 + '.json'), bytes);
    return { manifestSha256, manifest, features: result.features, totalBytes: result.totalBytes, count: result.count };
}

/** Offline replay against the caller's reviewed policy. Hashes do not confer publisher authority. */
export async function replayArcgisEvidence(root: string, manifestSha256: string, sourceKey: string, policy: ArcgisCollectionPolicy) {
    sha.parse(manifestSha256); source.parse(sourceKey); validateArcgisCollectionPolicy(policy);
    const raw = await readEvidenceFile(join(root, 'arcgis-runs', manifestSha256 + '.json'), 8 * 1024 * 1024);
    if (evidenceHash(raw) !== manifestSha256) throw new Error('ArcGIS manifest hash mismatch.');
    const manifest = manifestSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    if (manifest.sourceKey !== sourceKey || manifest.policySha256 !== policyHash(policy)) throw new Error('ArcGIS manifest source or policy mismatch.');
    if (manifest.captures.reduce((n, c) => n + c.blob.rawBytes, 0) > policy.maxTotalBytes) throw new Error('ArcGIS replay exceeds its byte budget.');
    let offset = 0;
    const result = await collectArcgisPoints(policy, { fetcher: async input => {
        const capture = manifest.captures[offset++];
        if (!capture || capture.requestUrl !== String(input)) throw new Error('ArcGIS evidence sequence or request mismatch.');
        const bytes = await restoreEvidenceBlob(root, capture.blob, policy.contract.maxPageBytes);
        return new Response(new Uint8Array(bytes), { headers: { 'content-type': capture.contentType } });
    } });
    if (offset !== manifest.captures.length || result.captures.some((capture, index) => {
        const retained = manifest.captures[index]!;
        return capture.role !== retained.role || JSON.stringify(capture.requestedIds) !== JSON.stringify(retained.requestedIds)
            || (index > 0 && Date.parse(retained.retrievedAt) < Date.parse(manifest.captures[index - 1]!.retrievedAt));
    })) throw new Error('ArcGIS evidence sequence mismatch.');
    return { manifestSha256, features: result.features, count: result.count, totalBytes: result.totalBytes,
        firstRetrievedAt: manifest.captures[0]!.retrievedAt, lastRetrievedAt: manifest.captures.at(-1)!.retrievedAt,
        consistency: manifest.consistency };
}
