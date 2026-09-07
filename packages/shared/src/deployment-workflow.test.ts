import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');

describe('immutable staging deployment contract', () => {
    it('refuses mutable tags before invoking the deployment runtime', () => {
        const directory = mkdtempSync(resolve(tmpdir(), 'patchwork-deploy-'));
        const manifest = resolve(directory, 'manifest.json');
        const envFile = resolve(directory, 'staging.env');
        const composeFile = resolve(directory, 'compose.yml');
        writeFileSync(
            manifest,
            JSON.stringify({
                gitSha: 'a'.repeat(40),
                mapTileUrl: `/tiles/us.${'b'.repeat(64)}.pmtiles`,
                images: {
                    api: 'ghcr.io/example/api:latest',
                    indexer: 'ghcr.io/example/indexer:latest',
                    moderation: 'ghcr.io/example/moderation:latest',
                    web: 'ghcr.io/example/web:latest',
                },
            }),
        );
        writeFileSync(envFile, 'IGNORED=test\n');
        writeFileSync(composeFile, 'services: {}\n');

        const result = spawnSync(
            'bash',
            [
                resolve(root, 'scripts/deploy-staging-digests.sh'),
                manifest,
                envFile,
                composeFile,
            ],
            { encoding: 'utf8', env: { ...process.env, PATCHWORK_RELEASE_STATE_DIR: directory } },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Refusing non-digest image for api.');
    });

    it('refuses a release manifest whose map artifact is not content-addressed', () => {
        const directory = mkdtempSync(resolve(tmpdir(), 'patchwork-map-release-'));
        const manifest = resolve(directory, 'manifest.json');
        const envFile = resolve(directory, 'staging.env');
        const composeFile = resolve(directory, 'compose.yml');
        writeFileSync(
            manifest,
            JSON.stringify({
                gitSha: 'a'.repeat(40),
                mapTileUrl: '/tiles/us.pmtiles',
                images: {
                    api: `ghcr.io/example/api@sha256:${'1'.repeat(64)}`,
                    indexer: `ghcr.io/example/indexer@sha256:${'2'.repeat(64)}`,
                    moderation: `ghcr.io/example/moderation@sha256:${'3'.repeat(64)}`,
                    web: `ghcr.io/example/web@sha256:${'4'.repeat(64)}`,
                },
            }),
        );
        writeFileSync(envFile, 'IGNORED=test\n');
        writeFileSync(composeFile, 'services: {}\n');

        const result = spawnSync(
            'bash',
            [
                resolve(root, 'scripts/deploy-staging-digests.sh'),
                manifest,
                envFile,
                composeFile,
            ],
            {
                encoding: 'utf8',
                env: {
                    ...process.env,
                    PATCHWORK_RELEASE_STATE_DIR: directory,
                },
            },
        );

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
            'Refusing manifest without a content-addressed map tile URL.',
        );
    });
});
