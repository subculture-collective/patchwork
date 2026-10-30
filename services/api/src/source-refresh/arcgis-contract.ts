import { z } from 'zod';
import { evidenceByteLimit } from './evidence-storage.js';
import { PublisherValidationError } from './publisher-validation-error.js';

const objectId = z.number().int().nonnegative().safe();
const spatialReference = z.object({ wkid: z.literal(4326), latestWkid: z.literal(4326).optional() }).strict();
const point = z.object({ x: z.number().finite().min(-180).max(180), y: z.number().finite().min(-90).max(90),
    spatialReference: spatialReference.optional() }).strict().nullable();
export interface ArcgisContract {
    idField: string;
    fields: Readonly<Record<string, 'esriFieldTypeOID' | 'esriFieldTypeString' | 'esriFieldTypeInteger' | 'esriFieldTypeDouble'>>;
    minRecords: number;
    maxRecords: number;
    maxPageBytes: number;
}
export function validateArcgisContract(contract: ArcgisContract) {
    evidenceByteLimit(contract.maxPageBytes);
    if (!Number.isSafeInteger(contract.minRecords) || !Number.isSafeInteger(contract.maxRecords)
        || contract.minRecords < 1 || contract.maxRecords < contract.minRecords || contract.maxRecords > 100_000
        || Object.keys(contract.fields).length > 128 || contract.fields[contract.idField] !== 'esriFieldTypeOID'
        || Object.entries(contract.fields).some(([name, type]) => !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name)
            || !['esriFieldTypeOID', 'esriFieldTypeString', 'esriFieldTypeInteger', 'esriFieldTypeDouble'].includes(type))) {
        throw new Error('Invalid ArcGIS source contract.');
    }
}
export function arcgisJson(raw: Uint8Array, maxBytes: number): unknown {
    evidenceByteLimit(maxBytes);
    if (!raw.byteLength || raw.byteLength > maxBytes) throw new PublisherValidationError('ArcGIS response exceeds its byte budget.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
    catch { throw new PublisherValidationError('ArcGIS response requires valid UTF-8 JSON.'); }
}
function validated<T>(operation: () => T): T {
    try { return operation(); }
    catch { throw new PublisherValidationError('ArcGIS response violates the reviewed completeness or schema contract.'); }
}
export function parseArcgisCount(raw: Uint8Array, contract: ArcgisContract): number {
    validateArcgisContract(contract);
    return validated(() => z.object({ count: z.number().int().min(contract.minRecords).max(contract.maxRecords) }).strict()
        .parse(arcgisJson(raw, contract.maxPageBytes)).count);
}
export function parseArcgisIds(raw: Uint8Array, contract: ArcgisContract, count: number): number[] {
    validateArcgisContract(contract);
    return validated(() => {
        z.number().int().min(contract.minRecords).max(contract.maxRecords).parse(count);
        const result = z.object({ objectIdFieldName: z.literal(contract.idField),
            objectIds: z.array(objectId).length(count), exceededTransferLimit: z.literal(false).optional() }).strict()
            .parse(arcgisJson(raw, contract.maxPageBytes));
        if (new Set(result.objectIds).size !== count) throw new Error('Duplicate object IDs.');
        return result.objectIds.sort((a, b) => a - b);
    });
}
export function parseArcgisPage(raw: Uint8Array, contract: ArcgisContract, expectedIds: readonly number[]) {
    validateArcgisContract(contract);
    return validated(() => {
        z.array(objectId).min(1).max(1000).parse(expectedIds);
        if (new Set(expectedIds).size !== expectedIds.length) throw new Error('Duplicate requested IDs.');
        const attributes = z.object(Object.fromEntries(Object.entries(contract.fields).map(([name, type]) => [name,
            type === 'esriFieldTypeOID' ? objectId : type === 'esriFieldTypeString' ? z.string().max(32_768).nullable()
                : type === 'esriFieldTypeInteger' ? z.number().int().safe().nullable() : z.number().finite().nullable(),
        ]))).strict();
        const page = z.object({ geometryType: z.literal('esriGeometryPoint'), spatialReference,
            exceededTransferLimit: z.literal(false).optional(),
            fields: z.array(z.object({ name: z.string(), type: z.string() })).max(128),
            features: z.array(z.object({ attributes, geometry: point }).strict()).length(expectedIds.length),
            error: z.never().optional(),
        }).parse(arcgisJson(raw, contract.maxPageBytes));
        const fields = Object.entries(contract.fields);
        if (page.fields.length !== fields.length || new Set(page.fields.map(field => field.name)).size !== fields.length
            || fields.some(([name, type]) => !page.fields.some(field => field.name === name && field.type === type))) throw new Error('Field schema changed.');
        const expected = new Set(expectedIds);
        for (const feature of page.features) {
            if (!expected.delete(feature.attributes[contract.idField] as number)) throw new Error('Unexpected or duplicate feature.');
        }
        if (expected.size) throw new Error('Missing features.');
        return page.features.sort((a, b) => (a.attributes[contract.idField] as number) - (b.attributes[contract.idField] as number));
    });
}
export type ArcgisFeature = ReturnType<typeof parseArcgisPage>[number];
