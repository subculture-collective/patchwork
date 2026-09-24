import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

// Exercise the real shell control flow and filesystem publication. Stub only
// PostgreSQL executables so this suite can never contact a developer database.
const harness = () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'patchwork-recovery-test-'));
    temporary.push(directory);
    const bin = resolve(directory, 'bin');
    const backups = resolve(directory, 'backups');
    const journal = resolve(directory, 'calls');
    mkdirSync(bin); mkdirSync(backups); writeFileSync(journal, '');
    const executable = (name: string, body: string) => writeFileSync(resolve(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o700 });
    executable('pg_dump', `
if [[ "$*" == '--version' ]]; then echo 'pg_dump (PostgreSQL) 16.0'; exit; fi
while [[ $# -gt 0 ]]; do
    if [[ "$1" == '-f' ]]; then printf 'test archive bytes' > "$2"; exit; fi
    shift
done
exit 1`);
    executable('pg_restore', `
if [[ "$1" == '--list' ]]; then exit "\${TEST_INVALID_ARCHIVE:-0}"; fi
printf 'restore\\n' >> "$TEST_JOURNAL"`);
    executable('psql', `
case "$*" in
    *server_version_num*) echo "\${TEST_SERVER_MAJOR:-16}" ;;
    *pg_tables*) echo "\${TEST_TABLE_COUNT:-0}" ;;
    *'SELECT (SELECT count'*) echo "\${TEST_SESSIONS_REMAINING:-0}" ;;
    *'SELECT 1'*) echo 1 ;;
    *) cat >> "$TEST_JOURNAL" ;;
esac`);
    const run = (script: string, args: string[] = [], overrides: Record<string, string> = {}) => spawnSync('bash', [resolve(root, 'scripts', script), ...args], {
        encoding: 'utf8',
        timeout: 10_000,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BACKUP_DIR: backups,
            PATCHWORK_BACKUP_METRICS_FILE: resolve(backups, 'backup.prom'),
            PGDATABASE: 'patchwork_test', TEST_JOURNAL: journal, SKIP_CONFIRM: 'yes',
            REQUIRE_EMPTY_DATABASE: 'yes', ...overrides },
    });
    const archive = () => {
        const file = resolve(backups, 'test.dump');
        writeFileSync(file, 'test archive bytes');
        const checksum = createHash('sha256').update(readFileSync(file)).digest('hex');
        writeFileSync(`${file}.sha256`, `${checksum}  test.dump\n`);
        return file;
    };
    return { backups, journal, run, archive };
};

describe('backup and restore controls', () => {
    it('publishes a validated archive with matching metadata/checksum and success metrics', () => {
        const h = harness();
        expect(h.run('backup-postgres.sh').status).toBe(0);
        const files = readdirSync(h.backups);
        const dump = files.find(name => name.endsWith('.dump'))!;
        expect(dump).toBeDefined();
        expect(files.some(name => name.startsWith('.backup.'))).toBe(false);
        const digest = createHash('sha256').update(readFileSync(resolve(h.backups, dump))).digest('hex');
        expect(readFileSync(resolve(h.backups, `${dump}.sha256`), 'utf8')).toBe(`${digest}  ${dump}\n`);
        expect(JSON.parse(readFileSync(resolve(h.backups, `${dump}.json`), 'utf8'))).toMatchObject({ sha256: digest, database: 'patchwork_test' });
        expect(readFileSync(resolve(h.backups, 'backup.prom'), 'utf8')).toMatch(/patchwork_backup_last_attempt_success\{[^}]+\} 1/);
    });

    it.each<Record<string, string>>([{ TEST_INVALID_ARCHIVE: '1' }, { TEST_SERVER_MAJOR: '15' }])('does not publish an invalid or incompatible backup (%j)', overrides => {
        const h = harness();
        expect(h.run('backup-postgres.sh', [], overrides).status).not.toBe(0);
        expect(readdirSync(h.backups).filter(name => name.includes('.dump') || name.startsWith('.backup.'))).toEqual([]);
    });

    it('refuses a corrupted archive before invoking restore', () => {
        const h = harness();
        const file = h.archive();
        writeFileSync(file, 'corrupted');
        expect(h.run('restore-postgres.sh', [file]).status).not.toBe(0);
        expect(readFileSync(h.journal, 'utf8')).toBe('');
    });

    it('refuses a nonempty restore target before invoking restore', () => {
        const h = harness();
        expect(h.run('restore-postgres.sh', [h.archive()], { TEST_TABLE_COUNT: '1' }).status).toBe(3);
        expect(readFileSync(h.journal, 'utf8')).toBe('');
    });

    it('invalidates restored credentials and refuses success if sessions remain', () => {
        const h = harness();
        const file = h.archive();
        const result = h.run('restore-postgres.sh', [file]);
        expect(result.status).toBe(0);
        const calls = readFileSync(h.journal, 'utf8');
        expect(calls).toContain('restore\n');
        for (const table of ['patchwork_browser_sessions', 'at_oauth_state', 'at_oauth_sessions']) {
            expect(calls).toContain(`DELETE FROM ${table};`);
        }
        expect(result.stdout).toContain('"sessions_remaining":0');
        const failed = h.run('restore-postgres.sh', [file], { TEST_SESSIONS_REMAINING: '1' });
        expect(failed.status).toBe(5);
        expect(failed.stdout).not.toContain('"status":"success"');
    });
});
