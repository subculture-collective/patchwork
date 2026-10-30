import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./quarantine-fixture-browser-artifacts.mjs', import.meta.url));
const guard = fileURLToPath(new URL('./check-playwright-artifacts.mjs', import.meta.url));
const setup = t => {
    const root = mkdtempSync(join(tmpdir(), 'patchwork-fixture-policy-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const artifacts = join(root, 'apps/web/test-results');
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(join(artifacts, 'failure.txt'), 'fixture-private-value');
    return { root, artifacts };
};
const run = (root, args, extra = {}, command = script) => spawnSync(process.execPath, [command, ...args], {
    cwd: root, env: { PATH: process.env.PATH, CI: 'true', TMPDIR: tmpdir(), ...extra }, encoding: 'utf8',
});

test('withholds fixture diagnostics privately and leaves no build/upload-root artifacts', t => {
    const { root, artifacts } = setup(t);
    assert.equal(run(root, ['--check']).status, 0);
    assert.equal(run(root, ['--check'], { VITE_API_BASE_URL: '/api' }).status, 0);
    const result = run(root, ['--quarantine']);
    assert.equal(result.status, 0, result.stderr);
    const destination = result.stdout.match(/withheld at (.+); unreviewed/)[1];
    t.after(() => rmSync(destination, { recursive: true, force: true }));
    assert.equal(statSync(destination).mode & 0o777, 0o700);
    assert.equal(readFileSync(join(destination, 'test-results/failure.txt'), 'utf8'), 'fixture-private-value');
    assert.equal(existsSync(artifacts), false);
    assert.equal(run(root, [], {}, guard).status, 0);
    assert.doesNotMatch(result.stdout, /fixture-private-value|redaction check passed/);
});

test('credentialed or external configuration cannot enter the quarantine path or expose values', t => {
    const { root, artifacts } = setup(t);
    for (const key of ['PATCHWORK_E2E_BASE_URL', 'PATCHWORK_E2E_REQUESTER_STATE',
        'PATCHWORK_E2E_HELPER_STATE', 'PATCHWORK_E2E_MAINTAINER_STATE',
        'PATCHWORK_E2E_EXACT_LATITUDE', 'PATCHWORK_E2E_PRIVATE_MARKER',
        'VITE_API_BASE_URL', 'PATCHWORK_DEV_API_TARGET']) {
        for (const mode of ['--check', '--quarantine']) {
            const result = run(root, [mode], { [key]: 'credential-do-not-log' });
            assert.notEqual(result.status, 0, key);
            assert.doesNotMatch(result.stdout + result.stderr, /credential-do-not-log/);
            assert.equal(existsSync(artifacts), true);
        }
    }
    assert.notEqual(run(root, ['--quarantine'], { PATCHWORK_E2E_STAGING_LIFECYCLE: 'true' }).status, 0);
});

test('withholding works across filesystems and refuses a destination inside the workspace', t => {
    const { root, artifacts } = setup(t);
    assert.notEqual(run(root, ['--quarantine'], { TMPDIR: root }).status, 0);
    assert.equal(existsSync(artifacts), true);
    if (!existsSync('/dev/shm') || statSync('/dev/shm').dev === statSync(root).dev) return t.skip('Separate tmpfs unavailable');
    const result = run(root, ['--quarantine'], { TMPDIR: '/dev/shm' });
    assert.equal(result.status, 0, result.stderr);
    const destination = result.stdout.match(/withheld at (.+); unreviewed/)[1];
    t.after(() => rmSync(destination, { recursive: true, force: true }));
    assert.equal(readFileSync(join(destination, 'test-results/failure.txt'), 'utf8'), 'fixture-private-value');
    assert.equal(existsSync(artifacts), false);
});

test('the strict guard still rejects unreviewed and sensitive provider artifacts', t => {
    const { root, artifacts } = setup(t);
    assert.notEqual(run(root, [], {}, guard).status, 0);
    assert.notEqual(run(root, [], { PATCHWORK_ARTIFACT_REDACTION_TERMS: 'fixture-private-value' }, guard).status, 0);
    assert.equal(existsSync(artifacts), true);
});
