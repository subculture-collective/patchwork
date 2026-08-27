import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const composeEnvironment = {
    ...process.env,
    PATCHWORK_POSTGRES_PASSWORD: 'test-production-password',
    PATCHWORK_STAGING_POSTGRES_PASSWORD: 'test-staging-password',
    ATPROTO_SERVICE_DID: 'did:web:patchwork.test',
    STAGING_ATPROTO_SERVICE_DID: 'did:web:staging.patchwork.test',
    PATCHWORK_PUBLIC_ORIGIN: 'https://patchwork.test',
    STAGING_PUBLIC_ORIGIN: 'https://staging.patchwork.test',
    API_TRUSTED_PROXIES: '10.0.0.0/8',
    STAGING_API_TRUSTED_PROXIES: '10.0.0.0/8',
    VITE_API_BASE_URL: 'https://patchwork.test/api',
    STAGING_VITE_API_BASE_URL: 'https://staging.patchwork.test/api',
    ATPROTO_OAUTH_CLIENT_ID: 'https://patchwork.test/oauth/client-metadata.json',
    ATPROTO_OAUTH_REDIRECT_URI: 'https://patchwork.test/oauth/callback',
    STAGING_ATPROTO_OAUTH_CLIENT_ID:
        'https://staging.patchwork.test/oauth/client-metadata.json',
    STAGING_ATPROTO_OAUTH_REDIRECT_URI:
        'https://staging.patchwork.test/oauth/callback',
    ATPROTO_ACCOUNT_PDS_URL: 'http://pds.internal.test:3000',
    ATPROTO_SESSION_ENCRYPTION_KEY: 'test-production-encryption-key',
    STAGING_ATPROTO_SESSION_ENCRYPTION_KEY: 'test-staging-encryption-key',
    MODERATION_SERVICE_TOKEN: 'test-production-service-token',
    STAGING_MODERATION_SERVICE_TOKEN: 'test-staging-service-token',
    PATCHWORK_ATTACHMENT_ACCESS_KEY: 'test-production-object-access',
    PATCHWORK_ATTACHMENT_SECRET_KEY:
        'test-production-object-secret-that-is-long',
    PATCHWORK_ATTACHMENT_SIGNING_KEY:
        'test-production-signing-key-that-is-long',
    STAGING_PATCHWORK_ATTACHMENT_ACCESS_KEY:
        'test-staging-object-access',
    STAGING_PATCHWORK_ATTACHMENT_SECRET_KEY:
        'test-staging-object-secret-that-is-long',
    STAGING_PATCHWORK_ATTACHMENT_SIGNING_KEY:
        'test-staging-signing-key-that-is-long',
    NOTIFICATION_EMAIL_PROVIDER_URL:
        'https://email.example.test/send',
    NOTIFICATION_EMAIL_PROVIDER_TOKEN: 'production-email-token',
    NOTIFICATION_EMAIL_FROM: 'notifications@example.test',
    NOTIFICATION_VAPID_SUBJECT: 'mailto:security@example.test',
    NOTIFICATION_VAPID_PUBLIC_KEY: 'production-vapid-public',
    NOTIFICATION_VAPID_PRIVATE_KEY: 'production-vapid-private',
    NOTIFICATION_PROVIDER_WEBHOOK_TOKEN: 'production-webhook-token',
    STAGING_NOTIFICATION_EMAIL_PROVIDER_URL:
        'https://email-staging.example.test/send',
    STAGING_NOTIFICATION_EMAIL_PROVIDER_TOKEN: 'staging-email-token',
    STAGING_NOTIFICATION_EMAIL_FROM:
        'notifications-staging@example.test',
    STAGING_NOTIFICATION_VAPID_SUBJECT:
        'mailto:security-staging@example.test',
    STAGING_NOTIFICATION_VAPID_PUBLIC_KEY: 'staging-vapid-public',
    STAGING_NOTIFICATION_VAPID_PRIVATE_KEY: 'staging-vapid-private',
    STAGING_NOTIFICATION_PROVIDER_WEBHOOK_TOKEN:
        'staging-webhook-token',
    PATCHWORK_PM_TILES_DIRECTORY: '/tmp/tiles',
    PATCHWORK_PM_TILES_FILENAME: 'us.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pmtiles',
    STAGING_PATCHWORK_PM_TILES_DIRECTORY: '/tmp/tiles',
    STAGING_PATCHWORK_PM_TILES_FILENAME: 'us.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pmtiles',
    VITE_MAP_TILE_URL: '/tiles/us.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pmtiles',
    STAGING_VITE_MAP_TILE_URL: '/tiles/us.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pmtiles',
    JETSTREAM_API_KEY: 'test-v2-replay-key',
};

interface ComposeService {
    command?: string[];
    depends_on?: Record<string, { condition?: string }>;
    environment?: Record<string, string>;
    healthcheck?: { test?: string[] };
}

const renderCompose = (filename: string) => {
    const output = execFileSync(
        'docker',
        ['compose', '-f', filename, 'config', '--format', 'json'],
        { cwd: repositoryRoot, env: composeEnvironment, encoding: 'utf8' },
    );
    return JSON.parse(output) as { services: Record<string, ComposeService> };
};

describe.each(['docker-compose.yml', 'docker-compose.staging.yml'])(
    '%s persistent topology',
    filename => {
        it(
            'requires secrets, orders all migrations, and probes dependency readiness',
            () => {
                const raw = readFileSync(
                    resolve(repositoryRoot, filename),
                    'utf8',
                );
                expect(raw).not.toContain('did:example');
                expect(raw).not.toContain('API_DATA_SOURCE:-');
                expect(raw).toContain('VITE_MAP_TILE_URL: ${');
                expect(raw).toContain(
                    filename === 'docker-compose.yml' ?
                        'API_TRUSTED_PROXIES: ${API_TRUSTED_PROXIES:?'
                    :   'API_TRUSTED_PROXIES: ${STAGING_API_TRUSTED_PROXIES:?',
                );
                for (const imageVariable of [
                    'PATCHWORK_API_IMAGE',
                    'PATCHWORK_INDEXER_IMAGE',
                    'PATCHWORK_MODERATION_IMAGE',
                    'PATCHWORK_WEB_IMAGE',
                ]) {
                    expect(raw).toContain(`image: \${${imageVariable}:-`);
                }

                const { services } = renderCompose(filename);
                for (const migration of [
                    'patchwork-api-migrations',
                    'patchwork-indexer-migrations',
                    'patchwork-moderation-migrations',
                ]) {
                    expect(services[migration]?.command?.join(' ')).toContain(
                        'db:migrate',
                    );
                }
                expect(
                    services['patchwork-api']?.depends_on?.[
                        'patchwork-api-migrations'
                    ]?.condition,
                ).toBe('service_completed_successfully');
                expect(
                    services['patchwork-api']?.depends_on?.[
                        'patchwork-objects'
                    ]?.condition,
                ).toBe('service_healthy');
                expect(
                    services['patchwork-api']?.depends_on?.[
                        'patchwork-clamav'
                    ]?.condition,
                ).toBe('service_healthy');
                for (const runtime of [
                    'patchwork-api',
                    'patchwork-spool',
                    'patchwork-thimble',
                    'patchwork-web',
                ]) {
                    const healthcheck =
                        services[runtime]?.healthcheck?.test?.join(' ');
                    expect(healthcheck).toContain(
                        runtime === 'patchwork-web' ?
                            '/srv/patchwork-map/'
                        :   '/health/ready',
                    );
                    if (runtime === 'patchwork-web') {
                        expect(healthcheck).toContain(
                            'wget -qO- http://127.0.0.1/',
                        );
                    }
                }
                expect(services['patchwork-web']?.environment).toMatchObject({
                    VITE_MAP_TILE_URL:
                        '/tiles/us.0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.pmtiles',
                });
                expect(
                    services['patchwork-objects']?.healthcheck?.test?.join(' '),
                ).toContain('/minio/health/live');
                expect(
                    services['patchwork-clamav']?.healthcheck?.test?.join(' '),
                ).toContain('clamdscan --ping');
                const api = services['patchwork-api']?.environment;
                expect(api).toMatchObject({
                    API_DATA_SOURCE: 'postgres',
                    PATCHWORK_ENV:
                        filename === 'docker-compose.yml' ?
                            'production'
                        :   'staging',
                    ATPROTO_ACCOUNT_PDS_URL:
                        'http://pds.internal.test:3000',
                    ATPROTO_OAUTH_CLIENT_ID:
                        expect.stringMatching(/^https:/),
                    ATPROTO_OAUTH_REDIRECT_URI:
                        expect.stringMatching(/^https:/),
                    ATPROTO_SESSION_ENCRYPTION_KEY: expect.any(String),
                    ATTACHMENT_OBJECT_ENDPOINT: expect.stringMatching(
                        /^http:\/\/patchwork-objects:9000$/,
                    ),
                    ATTACHMENT_OBJECT_BUCKET: expect.stringContaining(
                        'private-attachments',
                    ),
                    ATTACHMENT_SIGNING_KEY: expect.any(String),
                    ATTACHMENT_CLAMD_HOST: expect.stringMatching(
                        /^patchwork-clamav$/,
                    ),
                    NOTIFICATION_EMAIL_PROVIDER_URL:
                        expect.stringMatching(/^https:/),
                    NOTIFICATION_EMAIL_PROVIDER_TOKEN:
                        expect.any(String),
                    NOTIFICATION_EMAIL_FROM: expect.stringContaining('@'),
                    NOTIFICATION_VAPID_SUBJECT:
                        expect.stringMatching(/^mailto:/),
                    NOTIFICATION_VAPID_PUBLIC_KEY: expect.any(String),
                    NOTIFICATION_VAPID_PRIVATE_KEY: expect.any(String),
                    NOTIFICATION_PROVIDER_WEBHOOK_TOKEN:
                        expect.any(String),
                });
                for (const runtime of [
                    'patchwork-api',
                    'patchwork-spool',
                    'patchwork-thimble',
                ]) {
                    expect(services[runtime]?.environment?.PATCHWORK_ENV).toBe(
                        filename === 'docker-compose.yml' ?
                            'production'
                        :   'staging',
                    );
                }
            },
            20_000,
        );
    },
);

it('builds runtime images on the AT dependency supported Node major', () => {
    const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(
        /FROM node:22\.[0-9.]+-alpine@sha256:[0-9a-f]{64} AS deps/,
    );
    expect(dockerfile).not.toContain('FROM node:20');
});

it('removes development-only dependencies from Node runtime images', () => {
    const dockerfile = readFileSync(resolve(repositoryRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('FROM source AS runtime-base');
    expect(dockerfile).toContain('npm prune --omit=dev');
    for (const target of [
        'api-runtime',
        'indexer-runtime',
        'moderation-runtime',
    ]) {
        expect(dockerfile).toContain(`FROM runtime-base AS ${target}`);
    }
});
