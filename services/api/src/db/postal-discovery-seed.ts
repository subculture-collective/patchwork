import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { lookupPostalArea } from '@patchwork/at-lexicons';
import areas from './seed-data/request-postal-areas.json' with { type: 'json' };
import { publicResourceCatalog, publicResourceSeed } from './public-resource-catalog.js';

export const POSTAL_SEED_VERSION = 'postal-public-resources-2026-09-06-v1';
const oldVersions = ['chicagoland-demo-2026-09-04-v2', 'chicagoland-fictional-2026-09-06-v1'];
const did = 'did:plc:patchwork-showcase-system';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const requests = [
    ['food', 'Grocery pickup', 'A neighbor needs help collecting groceries.'],
    ['transport', 'Ride to an appointment', 'A neighbor needs a daytime ride and a return pickup.'],
    ['childcare', 'After-school supplies', 'A household is gathering notebooks and backpacks.'],
    ['shelter', 'Blankets and household basics', 'A neighbor could use blankets and kitchen basics.'],
    ['medical', 'Collecting mobility supplies', 'A household needs help transporting a folded mobility aid.'],
    ['other', 'Help with a small move', 'A neighbor needs a hand carrying lightweight boxes.'],
    ['food', 'Pantry delivery', 'A household needs help collecting a pantry parcel.'],
    ['other', 'Phone setup and forms', 'A neighbor would like help setting up a phone and filling out forms.'],
] as const;

/** Replaces only seed-owned discovery projections; accounts and visitor records survive. */
export async function replacePostalDiscoverySeed(pool: Pool, apply = false) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (apply) await client.query('LOCK TABLE indexer_aid_post_projections, indexer_directory_resource_projections IN SHARE ROW EXCLUSIVE MODE');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('patchwork-postal-seed'))");
        const inventory: Record<string, unknown> = {};
        for (const [table, entity] of [['indexer_aid_post_projections', 'aid-post'], ['indexer_directory_resource_projections', 'directory-resource']] as const) {
            const rows = await client.query(`SELECT record_origin, seed_version, count(*)::integer AS count FROM ${table} GROUP BY 1,2 ORDER BY 1,2`);
            inventory[entity] = rows.rows;
            const mismatch = await client.query(`SELECT count(*)::integer AS count FROM ${table} p
                WHERE p.seed_version = ANY($1::text[]) AND NOT EXISTS (
                    SELECT 1 FROM showcase_record_metadata m WHERE m.entity_type=$2 AND m.entity_key=p.uri
                    AND m.seed_version=p.seed_version AND m.origin=p.record_origin)`, [oldVersions, entity]);
            if (mismatch.rows[0].count) throw new Error(`Seed ownership mismatch: ${entity}. Nothing replaced.`);
        }
        const preview = { inventory, newRequests: areas.length * requests.length, newPublicResources: publicResourceSeed.length, seedVersion: POSTAL_SEED_VERSION };
        if (!apply) { await client.query('ROLLBACK'); return preview; }
        for (const [table, entity] of [['indexer_aid_post_projections', 'aid-post'], ['indexer_directory_resource_projections', 'directory-resource']] as const) {
            await client.query(`DELETE FROM ${table} p USING showcase_record_metadata m
                WHERE p.record_origin='synthetic' AND p.seed_version=ANY($1::text[])
                AND m.entity_type=$2 AND m.entity_key=p.uri AND m.origin='synthetic' AND m.seed_version=p.seed_version`, [oldVersions, entity]);
        }
        const now = new Date();
        const metadata = async (entity: string, uri: string, origin: 'synthetic' | 'sourced-public') => {
            const table = entity === 'aid-post' ? 'indexer_aid_post_projections' : 'indexer_directory_resource_projections';
            const occupied = await client.query(`SELECT 1 FROM ${table} p WHERE p.uri=$1 AND NOT EXISTS (SELECT 1 FROM showcase_record_metadata m WHERE m.entity_type=$2 AND m.entity_key=p.uri AND m.seed_version=$3 AND m.origin=$4 AND p.seed_version=m.seed_version AND p.record_origin=m.origin)`,[uri,entity,POSTAL_SEED_VERSION,origin]);
            if (occupied.rowCount) throw new Error('New seed key is occupied by an unowned record.');
            const collision = await client.query('SELECT 1 FROM showcase_record_metadata WHERE entity_type=$1 AND entity_key=$2 AND (seed_version<>$3 OR origin<>$4)', [entity, uri, POSTAL_SEED_VERSION, origin]);
            if (collision.rowCount) throw new Error('New seed key belongs to another record.');
            await client.query(`INSERT INTO showcase_record_metadata(entity_type,entity_key,origin,seed_version,source_name,source_url,source_retrieved_at,source_last_verified_at,non_participation_disclosure,assigned_at)
                VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9) ON CONFLICT(entity_type,entity_key) DO NOTHING`,
                [entity,uri,origin,POSTAL_SEED_VERSION,origin==='sourced-public'?publicResourceCatalog.source.name:null,origin==='sourced-public'?publicResourceCatalog.source.url:null,origin==='sourced-public'?publicResourceCatalog.source.retrievedAt:null,origin==='sourced-public',now]);
        };
        for (const [areaIndex, selected] of areas.entries()) {
            const area = lookupPostalArea(selected.postalCode);
            if (!area) throw new Error(`Unsupported seed ZIP ${selected.postalCode}`);
            for (const [index, [category, subject, detail]] of requests.entries()) {
                const uri = `at://${did}/app.patchwork.aid.post/postal-${areaIndex}-${index}`;
                const title = `${subject} · ZIP ${area.postalCode}`;
                const description = `${detail} This is a fictional request for exploring Patchwork. No real assistance is needed.`;
                await metadata('aid-post',uri,'synthetic');
                await client.query(`INSERT INTO indexer_aid_post_projections
                    (uri,collection,author_did_hash,title,description,category,urgency,status,searchable_text,latitude,longitude,precision_km,postal_code,record_created_at,record_updated_at,source_cursor,source_event_id,record_origin,seed_version)
                    VALUES($1,'app.patchwork.aid.post',$2,$3,$4,$5,$6,'open',$7,$8,$9,1,$10,$11,$11,0,$12,'synthetic',$13)
                    ON CONFLICT(uri) DO UPDATE SET postal_code=EXCLUDED.postal_code,latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude
                    WHERE indexer_aid_post_projections.seed_version=EXCLUDED.seed_version AND indexer_aid_post_projections.record_origin='synthetic'`,
                    [uri,hash(did),title,description,category,['low','medium','high'][index%3],`${title} ${description}`.toLowerCase(),area.latitude,area.longitude,area.postalCode,now,uri,POSTAL_SEED_VERSION]);
            }
        }
        for (const resource of publicResourceSeed) {
            const uri = `at://${did}/app.patchwork.directory.resource/cpl-${resource.id}`;
            await metadata('directory-resource',uri,'sourced-public');
            await client.query(`INSERT INTO indexer_directory_resource_projections
                (uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,latitude,longitude,precision_km,open_hours,eligibility_notes,operational_status,record_created_at,record_updated_at,source_cursor,source_event_id,record_origin,seed_version)
                VALUES($1,'app.patchwork.directory.resource',$2,$3,$4,'other','unverified',$5,$6,$7,$8,1,$9,$10,'open',$11,$11,0,$1,'sourced-public',$12)
                ON CONFLICT(uri) DO NOTHING`,
                [uri,hash(did),resource.name,`${resource.city}, ${resource.state} ${resource.postalCode}`,JSON.stringify({url:resource.website,...(resource.phone?{phone:resource.phone}:{})}),`${resource.name} library public computers books ${resource.postalCode}`.toLowerCase(),resource.latitude,resource.longitude,resource.usualHours,resource.publicAccess,now,POSTAL_SEED_VERSION]);
            await client.query(`INSERT INTO public_resource_listings(resource_uri,source_name,source_url,source_retrieved_at,source_snapshot,source_expires_at,street_address,postal_code,latitude,longitude,public_access)
                VALUES($1,$2,$3,$4,$5,$4::timestamptz+INTERVAL '90 days',$6,$7,$8,$9,$10) ON CONFLICT(resource_uri) DO NOTHING`,
                [uri,publicResourceCatalog.source.name,publicResourceCatalog.source.url,publicResourceCatalog.source.retrievedAt,JSON.stringify(resource),`${resource.streetAddress}, ${resource.city}, ${resource.state} ${resource.postalCode}`,resource.postalCode,resource.latitude,resource.longitude,resource.publicAccess]);
        }
        await client.query(`INSERT INTO showcase_seed_runs(seed_version,manifest_sha256,applied_at,record_count) VALUES($1,$2,$3,$4)
            ON CONFLICT(seed_version) DO UPDATE SET applied_at=EXCLUDED.applied_at`,
            [POSTAL_SEED_VERSION,hash(JSON.stringify({areas,requests,resources:publicResourceCatalog})),now,preview.newRequests+preview.newPublicResources]);
        await client.query('COMMIT');
        return preview;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
    const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
    replacePostalDiscoverySeed(pool, process.argv.includes('--apply'))
        .then(result => console.log(JSON.stringify(result,null,2)))
        .catch(error => { console.error(error instanceof Error ? error.message : 'Seed failed.'); process.exitCode=1; })
        .finally(() => pool.end());
}
