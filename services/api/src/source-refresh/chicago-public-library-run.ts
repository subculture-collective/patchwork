import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import snapshot from '../db/seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { Pool } from 'pg';
import { previewPublicResourceRefresh } from '../db/public-resource-refresh-preview.js';
import { fetchCplPublisherEvidence } from './chicago-public-library.js';
import { SourceRefreshService } from './source-refresh-service.js';

import { parsePausedSources, resolveSource } from './source-registry.js';
import { recordRegisteredSourceAttempt, runSourceJob } from './source-runner.js';
export { withBoundedPublisherRetry } from './source-runner.js';

export async function runCplSourceRefresh(options: {
    pool: Pool;
    outputDir: string;
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
    delay?: (milliseconds: number) => Promise<void>;
    mode?: 'preview' | 'persist';
    paused?: ReadonlySet<string>;
}) {
    const source = resolveSource('cpl');
    const baselineIds = new Set(snapshot.resources.filter(resource => resource.sourceId === source.id).map(resource => resource.id));
    const result = await runSourceJob({
        pool: options.pool, source, mode: options.mode ?? 'persist',
        paused: options.paused ?? parsePausedSources(process.env.PATCHWORK_SOURCE_REFRESH_PAUSED),
        now: options.now, delay: options.delay,
        fetchEvidence: () => fetchCplPublisherEvidence({
            outputDir: options.outputDir, baselineIds, fetch: options.fetch, now: options.now,
        }),
        preview: evidence => {
            if (evidence.manifest.rowCount < source.minRows || evidence.manifest.rowCount > source.maxRows
                || evidence.manifest.rawBytes > source.maxBytes) {
                throw new Error('Publisher evidence is outside its registered complete-feed bounds.');
            }
            return previewPublicResourceRefresh(options.pool, evidence.catalog, new Date(evidence.manifest.retrievedAt));
        },
        persist: (evidence, preview) => new SourceRefreshService(options.pool).persistPreview(source.id, {
            ...evidence.manifest, adapter: source.adapter, adapterVersion: source.adapterVersion,
        }, preview),
    });
    if (result.status === 'persisted') return {
        status: result.status, runId: result.persisted.runId, candidates: result.persisted.candidates,
        replayed: result.persisted.replayed, rawSha256: result.evidence.manifest.rawSha256,
        retrievedAt: result.evidence.manifest.retrievedAt, paths: result.evidence.paths,
    };
    if (result.status === 'previewed') return {
        status: result.status, manifest: result.evidence.manifest, paths: result.evidence.paths, preview: result.preview,
    };
    return result;
}

/** Compatibility entry point for the original CPL operational recorder. */
export async function recordSourceRefreshAttempt(
    pool: Pool, succeeded: boolean, completedRefresh: boolean, attemptedAt = new Date(),
) {
    return recordRegisteredSourceAttempt(pool, 'cpl', succeeded, completedRefresh, attemptedAt);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error('Usage: resources:refresh:cpl-run <evidence-output-directory>');
    if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
    const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
    try {
        const result = await runCplSourceRefresh({ pool, outputDir: resolve(args[0]!) });
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'CPL source refresh failed.');
        process.exitCode = 1;
    } finally { await pool.end(); }
}
