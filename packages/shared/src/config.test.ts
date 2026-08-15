import { describe, expect, it } from 'vitest';
import {
    loadApiConfig,
    loadIndexerConfig,
    validateProductionConfig,
    validateProductionServiceConfig,
    validateAtAuthRuntimeConfig,
    validateModerationWorkerRuntimeConfig,
    checkServiceHealth,
} from './config.js';

const productionAttachmentConfig = {
    ATTACHMENT_OBJECT_ENDPOINT: 'http://objects:9000',
    ATTACHMENT_OBJECT_ACCESS_KEY: 'attachment-access',
    ATTACHMENT_OBJECT_SECRET_KEY: 'attachment-secret',
    ATTACHMENT_OBJECT_BUCKET: 'private-attachments',
    ATTACHMENT_SIGNING_KEY: 'attachment-signing-key-at-least-32-characters',
    ATTACHMENT_CLAMD_HOST: 'clamav',
};

const productionNotificationConfig = {
    NOTIFICATION_EMAIL_PROVIDER_URL: 'https://email.example.test/send',
    NOTIFICATION_EMAIL_PROVIDER_TOKEN: 'email-provider-secret',
    NOTIFICATION_EMAIL_FROM: 'notifications@example.test',
    NOTIFICATION_VAPID_SUBJECT: 'mailto:security@example.test',
    NOTIFICATION_VAPID_PUBLIC_KEY: 'test-vapid-public-key',
    NOTIFICATION_VAPID_PRIVATE_KEY: 'test-vapid-private-key',
    NOTIFICATION_PROVIDER_WEBHOOK_TOKEN: 'provider-webhook-secret',
};

describe('config schema', () => {
    it('fails fast with a clear message for invalid DID', () => {
        const previous = process.env.ATPROTO_SERVICE_DID;
        process.env.ATPROTO_SERVICE_DID = 'not-a-did';

        expect(() => loadApiConfig()).toThrowError(/ATPROTO_SERVICE_DID/);

        if (previous === undefined) {
            delete process.env.ATPROTO_SERVICE_DID;
        } else {
            process.env.ATPROTO_SERVICE_DID = previous;
        }
    });

    it('requires API_DATABASE_URL (or DATABASE_URL) when API_DATA_SOURCE is postgres', () => {
        const previousSource = process.env.API_DATA_SOURCE;
        const previousApiDatabaseUrl = process.env.API_DATABASE_URL;
        const previousDatabaseUrl = process.env.DATABASE_URL;
        const previousDid = process.env.ATPROTO_SERVICE_DID;

        process.env.API_DATA_SOURCE = 'postgres';
        process.env.API_DATABASE_URL = '';
        process.env.DATABASE_URL = '';
        process.env.ATPROTO_SERVICE_DID = 'did:example:test-service';

        expect(() => loadApiConfig()).toThrowError(
            /API_DATABASE_URL \(or DATABASE_URL\) is required/,
        );

        process.env.API_DATA_SOURCE = previousSource;

        if (previousApiDatabaseUrl === undefined) {
            delete process.env.API_DATABASE_URL;
        } else {
            process.env.API_DATABASE_URL = previousApiDatabaseUrl;
        }

        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }

        if (previousDid === undefined) {
            delete process.env.ATPROTO_SERVICE_DID;
        } else {
            process.env.ATPROTO_SERVICE_DID = previousDid;
        }
    });

    it('requires an API key only for Jetstream v2 replay', () => {
        const previousVersion = process.env.INDEXER_JETSTREAM_VERSION;
        const previousKey = process.env.JETSTREAM_API_KEY;
        const previousDid = process.env.ATPROTO_SERVICE_DID;

        try {
            process.env.ATPROTO_SERVICE_DID = 'did:example:test-service';
            process.env.INDEXER_JETSTREAM_VERSION = 'v1';
            delete process.env.JETSTREAM_API_KEY;
            expect(() => loadIndexerConfig()).not.toThrow();

            process.env.INDEXER_JETSTREAM_VERSION = 'v2';
            expect(() => loadIndexerConfig()).toThrow(/JETSTREAM_API_KEY/);

            process.env.JETSTREAM_API_KEY = 'test-replay-key';
            expect(loadIndexerConfig().JETSTREAM_API_KEY).toBe(
                'test-replay-key',
            );
        } finally {
            if (previousVersion === undefined) {
                delete process.env.INDEXER_JETSTREAM_VERSION;
            } else {
                process.env.INDEXER_JETSTREAM_VERSION = previousVersion;
            }
            if (previousKey === undefined) {
                delete process.env.JETSTREAM_API_KEY;
            } else {
                process.env.JETSTREAM_API_KEY = previousKey;
            }
            if (previousDid === undefined) {
                delete process.env.ATPROTO_SERVICE_DID;
            } else {
                process.env.ATPROTO_SERVICE_DID = previousDid;
            }
        }
    });
});

describe('validateModerationWorkerRuntimeConfig', () => {
    it('requires a service credential in production', () => {
        expect(() =>
            validateModerationWorkerRuntimeConfig({ NODE_ENV: 'production' }),
        ).toThrow(/MODERATION_SERVICE_TOKEN/);
        expect(() =>
            validateModerationWorkerRuntimeConfig({
                NODE_ENV: 'production',
                MODERATION_SERVICE_TOKEN: 'configured-secret',
            }),
        ).not.toThrow();
    });
});

describe('validateAtAuthRuntimeConfig', () => {
    it('allows fixture auth only in test mode', () => {
        expect(() =>
            validateAtAuthRuntimeConfig({
                NODE_ENV: 'test',
                ATPROTO_SERVICE_DID: 'did:example:test-service',
                API_DATA_SOURCE: 'fixture',
            }),
        ).not.toThrow();
    });

    it('rejects fixture auth outside tests', () => {
        expect(() =>
            validateAtAuthRuntimeConfig({
                NODE_ENV: 'development',
                ATPROTO_SERVICE_DID: 'did:example:test-service',
                API_DATA_SOURCE: 'fixture',
            }),
        ).toThrow(/API_DATA_SOURCE=postgres/);
    });

    it('requires OAuth metadata and encryption configuration', () => {
        expect(() =>
            validateAtAuthRuntimeConfig({
                NODE_ENV: 'development',
                ATPROTO_SERVICE_DID: 'did:example:test-service',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
                API_MODERATION_SERVICE_URL: 'http://moderation:4200',
                MODERATION_SERVICE_TOKEN: 'service-secret',
            }),
        ).toThrow(/ATPROTO_OAUTH_CLIENT_ID/);
    });

    it('accepts a complete persistent OAuth configuration', () => {
        expect(() =>
            validateAtAuthRuntimeConfig({
                NODE_ENV: 'development',
                ATPROTO_SERVICE_DID: 'did:example:test-service',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
                ATPROTO_OAUTH_CLIENT_ID:
                    'https://patchwork.example/oauth/client-metadata.json',
                ATPROTO_OAUTH_REDIRECT_URI:
                    'https://patchwork.example/oauth/callback',
                ATPROTO_SESSION_ENCRYPTION_KEY: 'encoded-key',
            }),
        ).not.toThrow();
    });
});

describe('validateProductionConfig', () => {
    it('does nothing when NODE_ENV is not production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'development',
                ATPROTO_SERVICE_DID: 'did:example:test-service',
                API_DATA_SOURCE: 'fixture',
            }),
        ).not.toThrow();
    });

    it('throws when fixture mode is used in production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:prod.example.com',
                API_DATA_SOURCE: 'fixture',
                DATABASE_URL: 'postgresql://localhost/db',
            }),
        ).toThrowError(/API_DATA_SOURCE=fixture is not allowed in production/);
    });

    it('throws when no DATABASE_URL is set in production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:prod.example.com',
                API_DATA_SOURCE: 'postgres',
            }),
        ).toThrowError(
            /DATABASE_URL or API_DATABASE_URL must be set in production/,
        );
    });

    it('throws when ATPROTO_SERVICE_DID uses did:example: in production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:example:test-service',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/db',
            }),
        ).toThrowError(
            /ATPROTO_SERVICE_DID must not use a did:example: value in production/,
        );
    });

    it('passes with valid production config', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:patchwork.example.com',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
                API_MODERATION_SERVICE_URL: 'http://moderation:4200',
                MODERATION_SERVICE_TOKEN: 'service-secret',
                ...productionAttachmentConfig,
                ...productionNotificationConfig,
            }),
        ).not.toThrow();
    });

    it('requires the moderation service boundary in production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:patchwork.example.com',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
            }),
        ).toThrow(/API_MODERATION_SERVICE_URL/);
    });

    it('accepts API_DATABASE_URL as alternative to DATABASE_URL', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:patchwork.example.com',
                API_DATA_SOURCE: 'postgres',
                API_DATABASE_URL: 'postgresql://localhost/patchwork',
                API_MODERATION_SERVICE_URL: 'http://moderation:4200',
                MODERATION_SERVICE_TOKEN: 'service-secret',
                ...productionAttachmentConfig,
                ...productionNotificationConfig,
            }),
        ).not.toThrow();
    });

    it('requires the private object store and malware scanner in production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:patchwork.example.com',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
                API_MODERATION_SERVICE_URL: 'http://moderation:4200',
                MODERATION_SERVICE_TOKEN: 'service-secret',
            }),
        ).toThrow(/private attachment runtime requires/);
    });

    it('requires complete email, push, and feedback configuration in production', () => {
        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:patchwork.example.com',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
                API_MODERATION_SERVICE_URL: 'http://moderation:4200',
                MODERATION_SERVICE_TOKEN: 'service-secret',
                ...productionAttachmentConfig,
            }),
        ).toThrow(/durable notification delivery requires/);

        expect(() =>
            validateProductionConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:patchwork.example.com',
                API_DATA_SOURCE: 'postgres',
                DATABASE_URL: 'postgresql://localhost/patchwork',
                API_MODERATION_SERVICE_URL: 'http://moderation:4200',
                MODERATION_SERVICE_TOKEN: 'service-secret',
                ...productionAttachmentConfig,
                ...productionNotificationConfig,
                NOTIFICATION_VAPID_PRIVATE_KEY: '',
            }),
        ).toThrow(/durable notification delivery requires/);
    });
});

describe('validateProductionServiceConfig', () => {
    it('does nothing when NODE_ENV is not production', () => {
        expect(() =>
            validateProductionServiceConfig({
                NODE_ENV: 'development',
                ATPROTO_SERVICE_DID: 'did:example:test',
            }),
        ).not.toThrow();
    });

    it('throws for did:example: in production', () => {
        expect(() =>
            validateProductionServiceConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:example:bad',
            }),
        ).toThrowError(/did:example:/);
    });

    it('passes with valid production DID', () => {
        expect(() =>
            validateProductionServiceConfig({
                NODE_ENV: 'production',
                ATPROTO_SERVICE_DID: 'did:web:indexer.example.com',
            }),
        ).not.toThrow();
    });
});

describe('checkServiceHealth', () => {
    it('returns ok when all checks pass', async () => {
        const result = await checkServiceHealth([
            { name: 'db', check: () => ({ status: 'ok' }) },
            { name: 'cache', check: () => ({ status: 'ok' }) },
        ]);
        expect(result.status).toBe('ok');
        expect(result.checks['db']?.status).toBe('ok');
        expect(result.checks['cache']?.status).toBe('ok');
    });

    it('returns degraded when any check is degraded', async () => {
        const result = await checkServiceHealth([
            { name: 'db', check: () => ({ status: 'ok' }) },
            {
                name: 'cache',
                check: () => ({
                    status: 'degraded',
                    message: 'high latency',
                }),
            },
        ]);
        expect(result.status).toBe('degraded');
    });

    it('returns not_ready when any check is not_ready', async () => {
        const result = await checkServiceHealth([
            {
                name: 'db',
                check: () => ({
                    status: 'not_ready',
                    message: 'connecting',
                }),
            },
            { name: 'cache', check: () => ({ status: 'degraded' }) },
        ]);
        expect(result.status).toBe('not_ready');
    });

    it('handles async checks', async () => {
        const result = await checkServiceHealth([
            {
                name: 'db',
                check: async () => ({ status: 'ok' as const }),
            },
        ]);
        expect(result.status).toBe('ok');
    });

    it('catches errors in checks and marks them degraded', async () => {
        const result = await checkServiceHealth([
            {
                name: 'db',
                check: () => {
                    throw new Error('connection refused');
                },
            },
        ]);
        expect(result.status).toBe('degraded');
        expect(result.checks['db']?.message).toBe('connection refused');
    });

    it('returns ok for empty checks array', async () => {
        const result = await checkServiceHealth([]);
        expect(result.status).toBe('ok');
    });
});
