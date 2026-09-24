import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const container = `patchwork-test-${randomUUID()}`;
const run = (command, args, env = process.env, capture = false) => {
    const result = spawnSync(command, args, {
        cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status}). ${capture ? result.stderr : ''}`);
    return result.stdout?.trim();
};

try {
    run('docker', ['run', '--detach', '--rm', '--name', container,
        '--publish', '127.0.0.1::5432', '--env', 'POSTGRES_DB=patchwork_test',
        '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine'], process.env, true);
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
        if (spawnSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) {
            ready = true; break;
        }
        await setTimeout(500);
    }
    if (!ready) throw new Error('Disposable PostgreSQL did not become ready.');
    const port = run('docker', ['port', container, '5432/tcp'], process.env, true).split(':').at(-1);
    const database = `postgresql://postgres@127.0.0.1:${port}/patchwork_test`;
    const env = { ...process.env, NODE_ENV: 'test', TEST_DATABASE_URL: database,
        API_DATABASE_URL: database, DATABASE_URL: database,
        ATPROTO_SERVICE_DID: 'did:example:patchwork-test', API_DATA_SOURCE: 'postgres' };
    for (const workspace of ['api', 'indexer', 'moderation-worker']) {
        run('npm', ['run', 'db:migrate', '-w', `@patchwork/${workspace}`], env);
    }
    run(process.execPath, ['scripts/test.mjs', 'postgres'], env);
} finally {
    spawnSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
}
