import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import snapshot from './seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { parsePublicResourceCatalog } from './public-resource-catalog.js';
import { previewPublicResourceRefresh } from './public-resource-refresh-preview.js';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
afterAll(() => pool.end());
describe('persisted source-refresh preview', () => {
    it('reads imported evidence and active corrections without changing persisted rows', async () => {
        const id = 'refresh-preview-test';
        const sourceResource = { ...snapshot.resources[0]!, id };
        const original = parsePublicResourceCatalog({ ...snapshot, resources: [sourceResource] }).resources[0]!;
        const uri = `at://did:plc:patchwork-public-catalog/app.patchwork.directory.resource/${id}`;
        await pool.query(`INSERT INTO public_resource_listings
            (resource_uri,source_name,source_url,source_retrieved_at,source_snapshot,source_expires_at,street_address,postal_code,latitude,longitude,public_access)
            VALUES($1,$2,$3,$4,$5,$4::timestamptz+INTERVAL '90 days','1 Test Street','60608',41.85,-87.67,'Public')`,
        [uri, original.source.name, original.source.url, original.source.retrievedAt, JSON.stringify(original)]);
        await pool.query(`INSERT INTO indexer_directory_resource_projections
            (uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,operational_status,record_created_at,record_updated_at,source_cursor,source_event_id,record_origin)
            VALUES($1,'app.patchwork.directory.resource',repeat('a',64),'Refresh fixture','Chicago','other','unverified',$2,'refresh fixture','unknown',NOW(),NOW(),1,$1,'sourced-public')`,
        [uri, JSON.stringify({ url: original.website, ...(original.phone ? { phone: original.phone } : {}) })]);
        const input = { ...snapshot,
            sources: Object.fromEntries(Object.entries(snapshot.sources).map(([key, value]) => [key, { ...value, retrievedAt: '2026-09-19' }])),
            resources: [{ ...sourceResource, phone: '312-555-0199' }],
        };
        const read = async () => (await pool.query(`SELECT to_jsonb(l) AS listing, to_jsonb(p) AS projection
            FROM public_resource_listings l JOIN indexer_directory_resource_projections p ON p.uri=l.resource_uri
            WHERE l.resource_uri=$1`, [uri])).rows;
        const before = await read();
        const now = new Date('2026-09-19T12:00:00Z');
        const first = await previewPublicResourceRefresh(pool, input, now);
        expect(first.candidates[0]!.disposition).toBe('contact-automation-candidate');
        expect(await read()).toEqual(before);
        await pool.query(`INSERT INTO resource_corrections
            (resource_uri,receipt_hash,submission_hash,category,explanation,status)
            VALUES($1,repeat('f',64),repeat('f',64),'contact','Refresh conflict fixture','pending')`, [uri]);
        const pending = await previewPublicResourceRefresh(pool, input, now);
        expect(pending.candidates[0]!.disposition).toBe('review');
        expect(pending.candidates[0]!.reasons).toContain('pending-correction');
        expect(await read()).toEqual(before);
        await expect(previewPublicResourceRefresh(pool, {}, now)).rejects.toThrow();
        expect(await read()).toEqual(before);
        expect((await pool.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe('off');
    });
});
