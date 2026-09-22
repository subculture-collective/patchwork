import { mkdtemp, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { retainArcgisCollection, replayArcgisEvidence } from './arcgis-evidence.js';
import { type ArcgisCollectionPolicy } from './arcgis-collection.js';
const roots: string[] = [];
const temporary = async () => { const root = await mkdtemp(join(tmpdir(), 'arcgis-evidence-')); roots.push(root); return root; };
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const policy: ArcgisCollectionPolicy = { queryUrl: 'https://publisher.example/MapServer/0/query',
    contract: { idField: 'OID', fields: { OID: 'esriFieldTypeOID' }, minRecords: 1, maxRecords: 2, maxPageBytes: 2000 }, pageSize: 1, maxPages: 2, maxTotalBytes: 10_000, timeoutMs: 2000 };
const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    const value = url.searchParams.has('returnCountOnly') ? { count: 1 } : url.searchParams.has('returnIdsOnly')
        ? { objectIdFieldName: 'OID', objectIds: [1] }
        : { geometryType: 'esriGeometryPoint', spatialReference: { wkid: 4326 }, fields: [{ name: 'OID', type: 'esriFieldTypeOID' }], features: [{ attributes: { OID: 1 }, geometry: null }] };
    return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
};
it('replays a copied complete evidence set without renewing retrieval time', async () => {
    const root = await temporary(); const copy = await temporary();
    const retained = await retainArcgisCollection(root, 'fixture-v1', policy, { fetcher });
    await cp(root, copy, { recursive: true });
    const replay = await replayArcgisEvidence(copy, retained.manifestSha256, 'fixture-v1', policy);
    expect(replay.features).toEqual(retained.features);
    expect(replay.firstRetrievedAt).toBe(retained.manifest.captures[0]!.retrievedAt);
    expect(replay.lastRetrievedAt).toBe(retained.manifest.captures.at(-1)!.retrievedAt);
    expect(await readdir(join(root, 'arcgis-captures'))).not.toHaveLength(0);
});
it('rejects source/policy mismatch, corrupt blobs and manifest tampering', async () => {
    const root = await temporary(); const retained = await retainArcgisCollection(root, 'fixture-v1', policy, { fetcher });
    await expect(replayArcgisEvidence(root, retained.manifestSha256, 'other', policy)).rejects.toThrow('source or policy');
    await expect(replayArcgisEvidence(root, retained.manifestSha256, 'fixture-v1', { ...policy, pageSize: 2 })).rejects.toThrow('source or policy');
    const path = join(root, retained.manifest.captures[0]!.blob.key); const original = await readFile(path);
    await writeFile(path, 'corrupt');
    await expect(replayArcgisEvidence(root, retained.manifestSha256, 'fixture-v1', policy)).rejects.toThrow();
    await writeFile(path, original);
    await writeFile(join(root, 'arcgis-runs', retained.manifestSha256 + '.json'), '{}');
    await expect(replayArcgisEvidence(root, retained.manifestSha256, 'fixture-v1', policy)).rejects.toThrow('manifest hash');
});
it('keeps failed-response evidence but never publishes a complete manifest', async () => {
    const root = await temporary();
    await expect(retainArcgisCollection(root, 'fixture-v1', policy, { fetcher: async () => new Response('{"error":{"code":500}}', { headers: { 'content-type': 'application/json' } }) })).rejects.toThrow();
    expect(await readdir(join(root, 'arcgis-captures'))).toHaveLength(1);
    expect(await readdir(root)).not.toContain('arcgis-runs');
});
