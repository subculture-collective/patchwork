import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import snapshot from '../db/seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { Pool } from 'pg';
import { previewPublicResourceRefresh } from '../db/public-resource-refresh-preview.js';
import { fetchCplPublisherEvidence } from './chicago-public-library.js';
import { SourceRefreshService } from './source-refresh-service.js';

const LOCK_KEY = 'source-refresh:cpl';
const retryable = (error: unknown) => (error instanceof TypeError && /fetch|network|socket|connect/i.test(error.message))
    || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
    || (error instanceof Error && /HTTP (429|5\d\d)\b/.test(error.message));

export async function withBoundedPublisherRetry<T>(
    operation: () => Promise<T>,
    delay: (milliseconds: number) => Promise<void>,
) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try { return await operation(); }
        catch (error) {
            if (attempt === 3 || !retryable(error)) throw error;
            await delay(attempt * 1_000);
        }
    }
    throw new Error('CPL source refresh exhausted its bounded retry attempts.');
}

export async function runCplSourceRefresh(options: {
    pool: Pool;
    outputDir: string;
    fetch?: typeof globalThis.fetch;
    now?: () => Date;
    delay?: (milliseconds: number) => Promise<void>;
}) {
    const lockClient = await options.pool.connect();
    const acquired = await lockClient.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
        [LOCK_KEY],
    );
    if (!acquired.rows[0]?.acquired) {
        lockClient.release();
        return { status: 'skipped-concurrent' as const };
    }
    try {
        const baselineIds = new Set(snapshot.resources.filter(resource => resource.sourceId === 'cpl').map(resource => resource.id));
        const delay = options.delay ?? (milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds)));
        const evidence = await withBoundedPublisherRetry(
            () => fetchCplPublisherEvidence({
                outputDir: options.outputDir, baselineIds, fetch: options.fetch, now: options.now,
            }),
            delay,
        );
        const preview = await previewPublicResourceRefresh(
            options.pool,
            evidence.catalog,
            new Date(evidence.manifest.retrievedAt),
        );
        const persisted = await new SourceRefreshService(options.pool).persistPreview('cpl', evidence.manifest, preview);
        return {
            status: 'persisted' as const,
            runId: persisted.runId,
            candidates: persisted.candidates,
            replayed: persisted.replayed,
            rawSha256: evidence.manifest.rawSha256,
            retrievedAt: evidence.manifest.retrievedAt,
            paths: evidence.paths,
        };
    } finally {
        try { await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]); }
        finally { lockClient.release(); }
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error('Usage: resources:refresh:cpl-run <evidence-output-directory>');
    if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
    const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
    try {
        console.log(JSON.stringify(await runCplSourceRefresh({ pool, outputDir: resolve(args[0]!) }), null, 2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'CPL source refresh failed.');
        process.exitCode = 1;
    } finally { await pool.end(); }
}
