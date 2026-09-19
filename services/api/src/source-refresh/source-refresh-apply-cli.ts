import { Pool } from 'pg';
import { SourceRefreshService } from './source-refresh-service.js';

const args = process.argv.slice(2);
const candidate = args.find(argument=>argument.startsWith('--candidate='))?.slice('--candidate='.length);
if (args.length !== 2 || !args.includes('--apply') || !candidate) {
    throw new Error('Usage: resources:refresh:apply-contact --candidate=<uuid> --apply');
}
if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
try {
    console.log(JSON.stringify(await new SourceRefreshService(pool).applyContactCandidate(candidate),null,2));
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Source-refresh contact application failed.');
    process.exitCode=1;
} finally { await pool.end(); }
