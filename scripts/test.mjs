import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [suite = 'unit', ...args] = process.argv.slice(2);
if (!['unit', 'postgres', 'attachments'].includes(suite)) {
    throw new Error(`Unknown test suite: ${suite}`);
}
const root = fileURLToPath(new URL('../', import.meta.url));
// Workspace scripts supply a scope. Additional file filters narrow that scope
// instead of becoming OR filters that accidentally run the whole workspace.
if (/^(apps|services|packages)\/[^/]+\/src$/.test(args[0] ?? '') && args[1] && !args[1].startsWith('-')) {
    const scope = args.shift();
    for (let index = 0; index < args.length && !args[index].startsWith('-'); index++) {
        args[index] = `${scope}/${args[index].replace(/^src\//, '')}`;
    }
}

const result = spawnSync(process.execPath, [
    `${root}node_modules/vitest/vitest.mjs`, 'run', '--config', 'vitest.config.ts', ...args,
], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PATCHWORK_TEST_SUITE: suite },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
