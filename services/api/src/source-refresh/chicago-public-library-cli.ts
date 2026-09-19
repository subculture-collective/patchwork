import { resolve } from 'node:path';
import snapshot from '../db/seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { fetchCplPublisherEvidence } from './chicago-public-library.js';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error('Usage: resources:refresh:cpl <evidence-output-directory>');
const baselineIds = new Set(snapshot.resources.filter(resource => resource.sourceId === 'cpl').map(resource => resource.id));

fetchCplPublisherEvidence({ outputDir: resolve(args[0]!), baselineIds })
    .then(result => console.log(JSON.stringify({ status: 'validated', ...result.manifest, paths: result.paths }, null, 2)))
    .catch(error => {
        console.error(error instanceof Error ? error.message : 'CPL source refresh failed.');
        process.exitCode = 1;
    });
