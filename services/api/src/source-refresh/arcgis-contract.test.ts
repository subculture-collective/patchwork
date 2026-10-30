import { expect, it } from 'vitest';
import { parseArcgisCount, parseArcgisIds, parseArcgisPage, type ArcgisContract } from './arcgis-contract.js';
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value));
const contract: ArcgisContract = { idField: 'OBJECTID', fields: { OBJECTID: 'esriFieldTypeOID', NAME: 'esriFieldTypeString' }, minRecords: 1, maxRecords: 100, maxPageBytes: 10_000 };
const feature = (id: number) => ({ attributes: { OBJECTID: id, NAME: 'Clínica' }, geometry: { x: -87, y: 41 } });
const page = () => ({ geometryType: 'esriGeometryPoint', spatialReference: { wkid: 4326 }, fields: Object.entries(contract.fields).map(([name, type]) => ({ name, type })), features: [feature(2), feature(1)] });
it('matches count, stable object IDs and complete pages in deterministic order', () => {
    expect(parseArcgisCount(bytes({ count: 2 }), contract)).toBe(2);
    expect(parseArcgisIds(bytes({ objectIdFieldName: 'OBJECTID', objectIds: [2, 1] }), contract, 2)).toEqual([1, 2]);
    expect(parseArcgisPage(bytes(page()), contract, [1, 2]).map(f => f.attributes.NAME)).toEqual(['Clínica', 'Clínica']);
    expect(parseArcgisPage(bytes(page()), contract, [1, 2])[0]!.attributes.OBJECTID).toBe(1);
});
it.each([{ count: 0 }, { count: 101 }, { count: 2, error: {} }, { error: { code: 500 } }])('rejects invalid count envelopes %j', value => {
    expect(() => parseArcgisCount(bytes(value), contract)).toThrow();
});
it.each([[1], [1, 1], [1, 3], [1, Number.MAX_SAFE_INTEGER + 1]].map(ids => ({ ids })))('rejects incomplete, duplicated or unexpected IDs $ids', ({ ids }) => {
    const value = page(); value.features = ids.map(feature);
    expect(() => parseArcgisPage(bytes(value), contract, [1, 2])).toThrow();
});
it('rejects enumeration mismatch, transfer limits, schema drift and coordinate ambiguity', () => {
    expect(() => parseArcgisIds(bytes({ objectIdFieldName: 'OTHER', objectIds: [1, 2] }), contract, 2)).toThrow();
    expect(() => parseArcgisIds(bytes({ objectIdFieldName: 'OBJECTID', objectIds: [1, 1] }), contract, 2)).toThrow();
    for (const value of [{ ...page(), exceededTransferLimit: true }, { ...page(), fields: [] }, { ...page(), spatialReference: { wkid: 3857 } }, { ...page(), geometryType: 'esriGeometryPolygon' }]) {
        expect(() => parseArcgisPage(bytes(value), contract, [1, 2])).toThrow();
    }
    const value = page(); value.features[0]!.geometry.x = 181;
    expect(() => parseArcgisPage(bytes(value), contract, [1, 2])).toThrow();
});
it('rejects malformed bytes and preserves explicit missing geometry for adapter policy', () => {
    expect(() => parseArcgisCount(Buffer.from([0xff]), contract)).toThrow();
    expect(() => parseArcgisCount(bytes({ count: 1 }), { ...contract, maxPageBytes: 1 })).toThrow();
    const value = { ...page(), features: [{ ...feature(1), geometry: null }] };
    expect(parseArcgisPage(bytes(value), contract, [1])[0]!.geometry).toBeNull();
});
