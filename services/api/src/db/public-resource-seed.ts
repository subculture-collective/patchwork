import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { publicResourceCatalog, publicResourceSeed } from './public-resource-catalog.js';

export const PUBLIC_RESOURCE_VERSION = 'chicago-metro-public-2026-09-08-v1';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
// Local catalog identifier, not a participating AT Protocol account.
const did = 'did:plc:patchwork-public-catalog';
const preserved = new Set([
    'schema_migrations', 'indexer_schema_migrations', 'moderation_schema_migrations',
    'indexer_checkpoints', 'indexer_projection_state',
    'platform_roles', 'signup_invite_links', 'platform_maintenance_state',
    'platform_maintenance_audit', 'operational_audit_events',
]);
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Dry-run by default. Reset requires stopped writers and a verified database backup. */
export async function importPublicResources(pool: Pool, options: {
    apply?: boolean; reset?: boolean; expectedDatabase?: string; backupSha256?: string;
} = {}) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('patchwork-public-resource-import'))");
        const database = (await client.query('SELECT current_database() AS name')).rows[0].name as string;
        if (options.reset && options.apply && (options.expectedDatabase !== database || !/^[a-f0-9]{64}$/.test(options.backupSha256 ?? ''))) {
            throw new Error('Reset requires the exact database name and verified backup SHA-256.');
        }
        const tables = (await client.query<{ schemaname: string; tablename: string }>(
            "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','jetstream_v1_rollback','jetstream_v2_shadow') ORDER BY 1,2",
        )).rows;
        const cleared = tables.filter(table => !(table.schemaname === 'public' && preserved.has(table.tablename)));
        const preview = { database, catalogResources: publicResourceSeed.length, newRequests: 0,
            counties: new Set(publicResourceSeed.map(resource => resource.countyId)).size,
            resetTables: options.reset ? cleared.map(table => `${table.schemaname}.${table.tablename}`) : [],
            preservedTables: tables.filter(table => table.schemaname === 'public' && preserved.has(table.tablename)).map(table => table.tablename),
            manifestSha256: hash(JSON.stringify(publicResourceCatalog)) };
        if (!options.apply) { await client.query('ROLLBACK'); return preview; }
        if (options.reset) {
            // No CASCADE: unexpected references outside this explicit scope must fail closed.
            await client.query(`TRUNCATE ${cleared.map(table => `${quote(table.schemaname)}.${quote(table.tablename)}`).join(',')} RESTART IDENTITY`);
        }
        for (const resource of publicResourceSeed) {
            const uri = `at://${did}/app.patchwork.directory.resource/${resource.id}`;
            const source = resource.source;
            const existing = await client.query('SELECT record_origin,seed_version FROM indexer_directory_resource_projections WHERE uri=$1', [uri]);
            if (existing.rowCount) {
                if (existing.rows[0].record_origin !== 'sourced-public' || existing.rows[0].seed_version !== PUBLIC_RESOURCE_VERSION) throw new Error('Catalog key occupied by a different record.');
                continue; // Never overwrite a claimed operator edit or silently renew provenance.
            }
            await client.query(`INSERT INTO indexer_directory_resource_projections
                (uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,latitude,longitude,precision_km,open_hours,eligibility_notes,operational_status,record_created_at,record_updated_at,source_cursor,source_event_id,record_origin,seed_version)
                VALUES($1,'app.patchwork.directory.resource',$2,$3,$4,$5,'unverified',$6,$7,$8,$9,1,$10,$11,'unknown',NOW(),NOW(),0,$1,'sourced-public',$12)`,
                [uri,hash(did),resource.name,`${resource.city}, ${resource.state} ${resource.postalCode}`,resource.category,
                    JSON.stringify({url:resource.website,...(resource.phone?{phone:resource.phone}:{})}),
                    `${resource.name} ${resource.category} ${resource.city} ${resource.state} ${resource.postalCode} ${resource.publicAccess}`.toLowerCase(),
                    resource.latitude,resource.longitude,resource.usualHours,resource.publicAccess,PUBLIC_RESOURCE_VERSION]);
            await client.query(`INSERT INTO public_resource_listings(resource_uri,source_name,source_url,source_retrieved_at,source_snapshot,source_expires_at,street_address,postal_code,latitude,longitude,public_access)
                VALUES($1,$2,$3,$4,$5,$4::timestamptz+INTERVAL '90 days',$6,$7,$8,$9,$10)`,
                [uri,source.name,source.url,source.retrievedAt,JSON.stringify(resource),`${resource.streetAddress}, ${resource.city}, ${resource.state} ${resource.postalCode}`,resource.postalCode,resource.latitude,resource.longitude,resource.publicAccess]);
            await client.query(`INSERT INTO showcase_record_metadata(entity_type,entity_key,origin,seed_version,source_name,source_url,source_retrieved_at,source_last_verified_at,non_participation_disclosure,assigned_at)
                VALUES('directory-resource',$1,'sourced-public',$2,$3,$4,$5,$5,TRUE,NOW())`,
                [uri,PUBLIC_RESOURCE_VERSION,source.name,source.url,source.retrievedAt]);
        }
        await client.query(`INSERT INTO showcase_seed_runs(seed_version,manifest_sha256,applied_at,record_count) VALUES($1,$2,NOW(),$3) ON CONFLICT(seed_version) DO NOTHING`,
            [PUBLIC_RESOURCE_VERSION,preview.manifestSha256,publicResourceSeed.length]);
        await client.query('COMMIT');
        return preview;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
    const argument = (name: string) => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length+1);
    const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
    importPublicResources(pool, { apply: process.argv.includes('--apply'), reset: process.argv.includes('--reset'),
        expectedDatabase: argument('--database'), backupSha256: argument('--backup-sha256') })
        .then(result => console.log(JSON.stringify(result,null,2)))
        .catch(error => { console.error(error instanceof Error ? error.message : 'Import failed.'); process.exitCode=1; })
        .finally(() => pool.end());
}
