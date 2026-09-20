import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { z } from 'zod';
import { directoryFromLegacyProfile, resourceProfileSchema } from '@patchwork/shared';
import { hashRefreshValue } from './public-resource-refresh.js';
import { persistResourceDirectory } from './resource-directory-store.js';

const optionsSchema = z.object({
    mode: z.enum(['preview', 'persist']).default('preview'),
    limit: z.number().int().min(1).max(100).default(25),
    afterUri: z.string().max(500).default(''),
}).strict();

/** Resumable additive backfill. Each profile is atomic; previous profiles survive a later failure. */
export async function backfillResourceDirectory(pool: Pool, input: unknown = {}) {
    const options = optionsSchema.parse(input);
    const rows = (await pool.query<{ resource_uri: string; profile: unknown; updated_at: Date; name: string }>(
        `SELECT p.resource_uri,p.profile,p.updated_at,l.source_snapshot->>'name' AS name
         FROM resource_service_profiles p JOIN public_resource_listings l USING(resource_uri)
         WHERE p.resource_uri > $1 ORDER BY p.resource_uri LIMIT $2`, [options.afterUri, options.limit + 1])).rows;
    const page = rows.slice(0, options.limit);
    const results = [];
    for (const row of page) {
        const profile = resourceProfileSchema.parse(row.profile);
        const sourceIdsByUrl = new Map<string, string>();
        // Legacy URL identities explicitly mean "this recorded URL", not a qualified publisher adapter.
        JSON.stringify(profile, (key, value: unknown) => {
            if (key === 'sourceUrl' && typeof value === 'string') sourceIdsByUrl.set(value, `legacy-url:${hashRefreshValue(value)}`);
            return value;
        });
        const graph = directoryFromLegacyProfile({ resourceUri: row.resource_uri,
            resourceName: row.name || 'Imported public resource', profile,
            observedAt: row.updated_at.toISOString(), sourceIdsByUrl });
        const result = options.mode === 'persist' ? await persistResourceDirectory(pool, graph) : undefined;
        results.push({ resourceUri: row.resource_uri, assertions: graph.assertions.length,
            ...(result ?? { preview: true }) });
    }
    return { mode: options.mode, profiles: results,
        nextAfterUri: rows.length > options.limit ? page.at(-1)!.resource_uri : null };
}

export function parseDirectoryBackfillArgs(args: readonly string[]) {
    const values: Record<string, unknown> = {};
    for (const arg of args) {
        const match = /^--(mode|limit|after-uri)=(.*)$/.exec(arg);
        if (!match) throw new Error('Use --mode=preview|persist --limit=1..100 --after-uri=<cursor>.');
        const key = match[1] === 'after-uri' ? 'afterUri' : match[1]!;
        if (key in values) throw new Error('Duplicate backfill argument.');
        values[key] = key === 'limit' ? Number(match[2]) : match[2];
    }
    return optionsSchema.parse(values);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    let pool: Pool | undefined;
    try {
        const options = parseDirectoryBackfillArgs(process.argv.slice(2));
        if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
        pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
        console.log(JSON.stringify(await backfillResourceDirectory(pool, options), null, 2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Directory backfill failed.');
        process.exitCode = 1;
    } finally { await pool?.end(); }
}
