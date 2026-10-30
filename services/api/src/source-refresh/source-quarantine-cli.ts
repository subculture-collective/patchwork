import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { z } from 'zod';
import { resolveSource } from './source-registry.js';
import { activeSourceQuarantine, clearSourceQuarantine } from './source-quarantine.js';

export function parseQuarantineArguments(args: readonly string[]) {
    const values = new Map<string, string>();
    for (const arg of args) {
        const match = /^--(source|quarantine|reason)=(.+)$/.exec(arg);
        if (!match || values.has(match[1]!)) throw new Error('Use --source=<id>, optionally with --quarantine=<expected-id> --reason=<review summary>.');
        values.set(match[1]!, match[2]!);
    }
    const source = resolveSource(values.get('source') ?? '');
    if (values.size === 1) return { source, action: 'inspect' as const };
    if (values.size !== 3) throw new Error('Clearing requires both the expected quarantine ID and a review reason.');
    return { source, action: 'clear' as const, quarantineId: z.string().uuid().parse(values.get('quarantine')),
        reason: z.string().trim().min(20).max(1000).parse(values.get('reason')) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    let pool: Pool | undefined;
    try {
        const args = parseQuarantineArguments(process.argv.slice(2));
        if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
        pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
        const result = args.action === 'clear'
            ? await clearSourceQuarantine(pool, args.source.id, args.quarantineId, args.reason)
            : { sourceId: args.source.id, quarantine: await activeSourceQuarantine(pool, args.source.id) ?? null };
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Quarantine operation failed.');
        process.exitCode = 1;
    } finally { await pool?.end(); }
}
