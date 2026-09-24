import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('immutable staging deployment contract', () => {
    it('builds, scans, signs, and publishes all runtime images exactly once', () => {
        const workflow = read('.github/workflows/deploy-staging.yml');
        expect(workflow).toContain('REGISTRY: git.subcult.tv/subculture-collective');
        expect(workflow).toContain('password: ${{ secrets.STAGING_REGISTRY_TOKEN }}');
        for (const target of [
            'api-runtime',
            'indexer-runtime',
            'moderation-runtime',
            'web-runtime',
        ]) {
            expect(workflow).toContain(`target: ${target}`);
        }
        expect(workflow).toContain('aquasecurity/trivy-action');
        expect(workflow).toContain('cosign sign --yes --key env://COSIGN_PRIVATE_KEY');
        expect(workflow).toContain('cosign verify --key cosign.pub');
        expect(workflow).toContain('docker push');
        expect(workflow).toContain('artifact-digests.json');
        expect(workflow).toContain('mapTileUrl');
    });

    it('deploys only digests, runs real gates, and can restore the previous manifest', () => {
        const workflow = read('.github/workflows/deploy-staging.yml');
        const deploy = read('scripts/deploy-staging-digests.sh');
        const rollback = read('scripts/rollback-staging-digests.sh');
        expect(workflow).not.toContain('environment: staging');
        expect(workflow).toContain('needs: preflight');
        expect(workflow).toContain('bash scripts/verify-gitea-source.sh');
        expect(workflow).toContain('bash scripts/check-staging-workflow-config.sh');
        expect(workflow).toContain('PATCHWORK_RELEASE_VERIFY_MODE=key');
        expect(workflow).toContain('./run-staging-release.sh');
        expect(workflow).toContain('deploy-staging-digests.sh');
        expect(workflow).toContain('at-record-lifecycle.spec.ts');
        expect(deploy).toContain('@sha256:');
        expect(deploy).toContain('--no-build');
        expect(deploy).toContain('/health/ready');
        expect(deploy).toContain('previous-artifact-digests.json');
        expect(deploy).toContain('org.opencontainers.image.revision');
        expect(deploy).toContain('/usr/share/nginx/html/assets');
        expect(deploy).toContain('curl -fsS --range 0-1023');
        expect(deploy).toContain('PATCHWORK_DEPLOY_EXTERNAL_POSTGRES');
        expect(deploy).toContain('export VITE_MAP_TILE_URL=');
        expect(deploy).toContain('export PATCHWORK_PM_TILES_FILENAME=');
        expect(rollback).toContain('previous-artifact-digests.json');
        expect(rollback).toContain('--no-build');
        expect(rollback).toContain('org.opencontainers.image.revision');
        expect(rollback).toContain('/usr/share/nginx/html/assets');
        expect(rollback).toContain('curl -fsS --range 0-1023');
        expect(rollback).toContain('export VITE_MAP_TILE_URL=');
        expect(rollback).toContain('export PATCHWORK_PM_TILES_FILENAME=');
    });

    it('contains no echo-only deployment or progressive-delivery success claims', () => {
        const ci = read('.github/workflows/ci.yml');
        expect(ci).not.toContain('PASS: All images built with immutable tags');
        expect(ci).not.toContain('Checkpoint: health-probe ......... PASS');
        expect(ci).not.toContain('Result: All checkpoints passed');
    });

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
