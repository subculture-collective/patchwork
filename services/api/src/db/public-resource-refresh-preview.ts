import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { planPublicResourceRefresh, type RefreshListing } from './public-resource-refresh.js';

export async function previewPublicResourceRefresh(pool: Pool, catalog: unknown, now = new Date()) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = await client.query<RefreshListing>(`SELECT
            l.resource_uri AS "resourceUri", COALESCE(latest.after_value,l.source_snapshot) AS "sourceSnapshot",
            COALESCE(latest.evidence->>'url',l.source_url) AS "sourceUrl",
            COALESCE(latest.evidence->>'retrievedAt',l.source_retrieved_at::text) AS "sourceRetrievedAt",
            p.record_origin AS "recordOrigin", p.contact,
            (l.claimed_by_organization_id IS NOT NULL) AS claimed, l.listed,
            s.revision AS "profileRevision",
            EXISTS(SELECT 1 FROM resource_corrections c WHERE c.resource_uri=l.resource_uri
                AND c.status IN ('pending','needs-information')) AS "pendingCorrection",
            p.record_updated_at::text AS "recordUpdatedAt", l.updated_at::text AS "listingUpdatedAt"
            FROM public_resource_listings l
            JOIN indexer_directory_resource_projections p ON p.uri=l.resource_uri
            LEFT JOIN resource_service_profiles s ON s.resource_uri=l.resource_uri
            LEFT JOIN LATERAL (SELECT after_value,evidence FROM source_refresh_candidates
                WHERE resource_uri=l.resource_uri AND status='applied'
                ORDER BY applied_at DESC,candidate_id DESC LIMIT 1) latest ON TRUE`);
        return planPublicResourceRefresh(catalog, result.rows, now);
    } finally {
        try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error('Usage: resources:refresh:preview <catalog.json>');
    if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
    const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
    try {
        const catalog: unknown = JSON.parse(await readFile(resolve(args[0]!), 'utf8'));
        console.log(JSON.stringify(await previewPublicResourceRefresh(pool, catalog), null, 2));
    } catch {
        // Database errors can contain connection details. Keep them out of captured previews.
        console.error('Source-refresh preview failed; check the catalog and database configuration.');
        process.exitCode = 1;
    } finally { await pool.end(); }
}
