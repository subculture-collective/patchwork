import { expect, it } from 'vitest';
import { collectArcgisPoints, type ArcgisCollectionPolicy } from './arcgis-collection.js';
const policy: ArcgisCollectionPolicy = { queryUrl: 'https://publisher.example/FeatureServer/0/query',
    contract: { idField: 'OID', fields: { OID: 'esriFieldTypeOID' }, minRecords: 1, maxRecords: 10, maxPageBytes: 2000 },
    pageSize: 1, maxPages: 2, maxTotalBytes: 10_000, timeoutMs: 1000 };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const fixture = (change = false) => {
    let enumerations = 0; const requests: URL[] = [];
    const fetcher: typeof fetch = async input => {
        const url = new URL(String(input)); requests.push(url);
        if (url.searchParams.has('returnCountOnly')) return response({ count: 2 });
        if (url.searchParams.has('returnIdsOnly')) return response({ objectIdFieldName: 'OID', objectIds: ++enumerations > 1 && change ? [1, 3] : [2, 1] });
        return response({ geometryType: 'esriGeometryPoint', spatialReference: { wkid: 4326 }, fields: [{ name: 'OID', type: 'esriFieldTypeOID' }],
            features: [{ attributes: { OID: Number(url.searchParams.get('objectIds')) }, geometry: null }] });
    };
    return { fetcher, requests };
};
it('collects sequential explicit-ID pages and checks membership again', async () => {
    const f = fixture(); const retained: string[] = [];
    const result = await collectArcgisPoints(policy, { fetcher: f.fetcher, onEvidence: async c => { retained.push(c.role); } });
    expect(result.features.map(f => f.attributes.OID)).toEqual([1, 2]);
    expect(retained).toEqual(['count-before', 'ids-before', 'features', 'features', 'ids-after', 'count-after']);
    expect(result.totalBytes).toBe(result.captures.reduce((n, c) => n + c.raw.length, 0));
    expect(f.requests[2]!.searchParams.get('outFields')).toBe('OID');
});
it('rejects membership churn despite matching counts', async () => {
    await expect(collectArcgisPoints(policy, fixture(true))).rejects.toThrow('membership changed');
});
it('stops at page and total-byte limits', async () => {
    const f = fixture();
    await expect(collectArcgisPoints({ ...policy, maxPages: 1 }, f)).rejects.toThrow('page budget');
    expect(f.requests).toHaveLength(1);
    await expect(collectArcgisPoints({ ...policy, maxTotalBytes: 11 }, fixture())).rejects.toThrow('byte budget');
});
it('retains invalid response bytes before validation and stops on storage failure', async () => {
    const raw: Uint8Array[] = [];
    await expect(collectArcgisPoints(policy, { fetcher: async () => response({ error: { code: 500 } }), onEvidence: async c => { raw.push(c.raw); } })).rejects.toThrow();
    expect(raw).toHaveLength(1);
    const f = fixture();
    await expect(collectArcgisPoints(policy, { ...f, onEvidence: async () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(f.requests).toHaveLength(1);
});
it('honors cancellation before fetch and interrupts an active request at the deadline', async () => {
    const f = fixture();
    await expect(collectArcgisPoints(policy, { ...f, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    const fetcher: typeof fetch = async (_, init) => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
    await expect(collectArcgisPoints({ ...policy, timeoutMs: 20 }, { fetcher })).rejects.toThrow();
});
