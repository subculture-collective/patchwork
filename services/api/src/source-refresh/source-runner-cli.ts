import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { runCplSourceRefresh } from './chicago-public-library-run.js';
import { parsePausedSources, resolveSource, sourceRegistry } from './source-registry.js';

export function parseSourceRunnerArguments(args: readonly string[]) {
    if (args.length === 1 && args[0] === '--list') return { list: true as const };
    const fields = new Map<string, string>();
    for (const arg of args) {
        const match = /^--(source|output|mode)=(.+)$/.exec(arg);
        if (!match || fields.has(match[1]!)) throw new Error('Use --list or --source=<id> --output=<directory> --mode=preview|persist.');
        fields.set(match[1]!, match[2]!);
    }
    const mode = fields.get('mode');
    if (fields.size !== 3 || (mode !== 'preview' && mode !== 'persist')) {
        throw new Error('Source, evidence directory and explicit preview/persist mode are required.');
    }
    const source = resolveSource(fields.get('source')!);
    return { list: false, source, outputDir: resolve(fields.get('output')!), mode } as const;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    let pool: Pool | undefined;
    try {
        const args = parseSourceRunnerArguments(process.argv.slice(2));
        const paused = parsePausedSources(process.env.PATCHWORK_SOURCE_REFRESH_PAUSED);
        if (args.list) {
            console.log(JSON.stringify([...sourceRegistry.values()].map(source => ({
                ...source, paused: paused.has(source.id),
            })), null, 2));
        } else {
            // Dispatch is compiled/reviewed, never an arbitrary endpoint from catalog metadata.
            if (args.source.adapter !== 'chicago-public-library') throw new Error('No qualified runtime adapter for source.');
            if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
            pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
            const result = await runCplSourceRefresh({ pool, ...args, paused });
            console.log(JSON.stringify({ sourceId: args.source.id, ...result }, null, 2));
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Source refresh failed.');
        process.exitCode = 1;
    } finally { await pool?.end(); }
}
