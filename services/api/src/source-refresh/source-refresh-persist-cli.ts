import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { SourceRefreshService } from './source-refresh-service.js';

const args = process.argv.slice(2);
if (args.length !== 3 || args.some(argument => argument.startsWith('-'))) {
    throw new Error('Usage: resources:refresh:persist <source-id> <manifest.json> <preview.json>');
}
if (!process.env.API_DATABASE_URL) throw new Error('API_DATABASE_URL is required.');
const [sourceId, manifestPath, previewPath] = args as [string,string,string];
const pool = new Pool({ connectionString: process.env.API_DATABASE_URL });
try {
    const [manifest,preview]: [unknown,unknown] = await Promise.all([
        readFile(resolve(manifestPath),'utf8').then(JSON.parse),
        readFile(resolve(previewPath),'utf8').then(JSON.parse),
    ]);
    console.log(JSON.stringify(await new SourceRefreshService(pool).persistPreview(sourceId,manifest,preview),null,2));
} catch (error) {
    console.error(error instanceof Error ? error.message : 'Source-refresh persistence failed.');
    process.exitCode=1;
} finally { await pool.end(); }
