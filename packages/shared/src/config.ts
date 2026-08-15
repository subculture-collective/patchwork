import { z } from 'zod';
import { DID_PATTERN } from './schemas.js';

const nodeEnvSchema = z
    .enum(['development', 'test', 'production'])
    .default('development');

const baseSchema = z.object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const atprotoSchema = z.object({
    ATPROTO_SERVICE_DID: z
        .string()
        .regex(DID_PATTERN, 'ATPROTO_SERVICE_DID must be a valid DID string.'),
    ATPROTO_PDS_URL: z.string().url().default('https://bsky.social'),
});

const webSchema = baseSchema.extend({
    VITE_APP_NAME: z.string().min(1).default('Patchwork'),
    VITE_API_BASE_URL: z.string().url().default('http://localhost:4000'),
});

const optionalUrlField = z
    .preprocess(
        (value: unknown) =>
            typeof value === 'string' && value.trim() === '' ?
                undefined
            :   value,
        z.string().url().optional(),
    )
    .optional();

const optionalSecretField = z
    .preprocess(
        (value: unknown) =>
            typeof value === 'string' && value.trim() === '' ?
                undefined
            :   value,
        z.string().min(1).optional(),
    )
    .optional();

const apiSchema = baseSchema.merge(atprotoSchema).extend({
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PUBLIC_ORIGIN: z.string().url().default('http://localhost:5173'),
    ATPROTO_ACCOUNT_PDS_URL: z.string().url().default('http://localhost:3000'),
    API_TRUSTED_PROXIES: z
        .string()
        .default('')
        .transform(value =>
            value
                .split(',')
                .map(entry => entry.trim())
                .filter(Boolean),
        ),
    API_MAX_PROJECTION_LAG_SECONDS: z.coerce
        .number()
        .int()
        .min(1)
        .max(86_400)
        .default(300),
    API_RETENTION_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(60)
        .max(86_400)
        .default(3_600),
    API_ATTACHMENT_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(10)
        .max(3_600)
        .default(30),
    API_NOTIFICATION_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(5)
        .max(3_600)
        .default(15),
    API_MODERATION_SERVICE_URL: optionalUrlField,
    MODERATION_SERVICE_TOKEN: optionalSecretField,
    ATTACHMENT_OBJECT_ENDPOINT: optionalUrlField,
    ATTACHMENT_OBJECT_ACCESS_KEY: optionalSecretField,
    ATTACHMENT_OBJECT_SECRET_KEY: optionalSecretField,
    ATTACHMENT_OBJECT_BUCKET: optionalSecretField,
    ATTACHMENT_SIGNING_KEY: optionalSecretField,
    ATTACHMENT_CLAMD_HOST: optionalSecretField,
    ATTACHMENT_CLAMD_PORT: z.coerce
        .number()
        .int()
        .min(1)
        .max(65_535)
        .default(3310),
    NOTIFICATION_EMAIL_PROVIDER_URL: optionalUrlField,
    NOTIFICATION_EMAIL_PROVIDER_TOKEN: optionalSecretField,
    NOTIFICATION_EMAIL_FROM: optionalSecretField,
    NOTIFICATION_VAPID_SUBJECT: optionalSecretField,
    NOTIFICATION_VAPID_PUBLIC_KEY: optionalSecretField,
    NOTIFICATION_VAPID_PRIVATE_KEY: optionalSecretField,
    NOTIFICATION_PROVIDER_WEBHOOK_TOKEN: optionalSecretField,
    API_DATA_SOURCE: z.enum(['fixture', 'postgres']).default('fixture'),
    API_DATABASE_URL: optionalUrlField,
    DATABASE_URL: optionalUrlField,
    ATPROTO_OAUTH_CLIENT_ID: optionalUrlField,
    ATPROTO_OAUTH_REDIRECT_URI: optionalUrlField,
    ATPROTO_SESSION_ENCRYPTION_KEY: optionalSecretField,
});

const apiSchemaWithRefinements = apiSchema.superRefine((value, context) => {
    if (
        value.API_DATA_SOURCE === 'postgres' &&
        !value.API_DATABASE_URL &&
        !value.DATABASE_URL
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['API_DATABASE_URL'],
            message:
                'API_DATABASE_URL (or DATABASE_URL) is required when API_DATA_SOURCE=postgres.',
        });
    }
    const attachmentFields = [
        'ATTACHMENT_OBJECT_ENDPOINT',
        'ATTACHMENT_OBJECT_ACCESS_KEY',
        'ATTACHMENT_OBJECT_SECRET_KEY',
        'ATTACHMENT_OBJECT_BUCKET',
        'ATTACHMENT_SIGNING_KEY',
        'ATTACHMENT_CLAMD_HOST',
    ] as const;
    const configured = attachmentFields.filter(field => Boolean(value[field]));
    if (
        configured.length > 0 &&
        configured.length !== attachmentFields.length
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ATTACHMENT_OBJECT_ENDPOINT'],
            message:
                'All private attachment object-store, signing, and ClamAV fields are required together.',
        });
    }
    if (
        value.ATTACHMENT_SIGNING_KEY &&
        value.ATTACHMENT_SIGNING_KEY.length < 32
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ATTACHMENT_SIGNING_KEY'],
            message: 'ATTACHMENT_SIGNING_KEY must be at least 32 characters.',
        });
    }
    const notificationFields = [
        'NOTIFICATION_EMAIL_PROVIDER_URL',
        'NOTIFICATION_EMAIL_PROVIDER_TOKEN',
        'NOTIFICATION_EMAIL_FROM',
        'NOTIFICATION_VAPID_SUBJECT',
        'NOTIFICATION_VAPID_PUBLIC_KEY',
        'NOTIFICATION_VAPID_PRIVATE_KEY',
        'NOTIFICATION_PROVIDER_WEBHOOK_TOKEN',
    ] as const;
    const configuredNotifications = notificationFields.filter(field =>
        Boolean(value[field]),
    );
    if (
        configuredNotifications.length > 0 &&
        configuredNotifications.length !== notificationFields.length
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['NOTIFICATION_EMAIL_PROVIDER_URL'],
            message:
                'All email, Web Push, and provider-feedback notification fields are required together.',
        });
    }
});

const indexerSchema = baseSchema.merge(atprotoSchema).extend({
    INDEXER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    INDEXER_FIREHOSE_URL: z
        .string()
        .url()
        .default('wss://jetstream2.us-east.bsky.network/subscribe'),
    INDEXER_JETSTREAM_VERSION: z.enum(['v1', 'v2']).default('v1'),
    INDEXER_PROJECTION_MODE: z.enum(['live', 'v2-shadow']).default('live'),
});

const moderationWorkerSchema = baseSchema.merge(atprotoSchema).extend({
    MODERATION_PORT: z.coerce.number().int().min(1).max(65535).default(4200),
    MODERATION_WORKER_CONCURRENCY: z.coerce
        .number()
        .int()
        .min(1)
        .max(64)
        .default(2),
    MODERATION_RETENTION_INTERVAL_SECONDS: z.coerce
        .number()
        .int()
        .min(60)
        .max(86_400)
        .default(3_600),
    MODERATION_SERVICE_TOKEN: optionalSecretField,
});

type AnySchema = z.ZodTypeAny;

const formatZodErrors = (error: z.ZodError): string => {
    return error.issues
        .map(issue => {
            const path =
                issue.path.length === 0 ? '<root>' : issue.path.join('.');
            return `${path}: ${issue.message}`;
        })
        .join('; ');
};

/**
 * Dynamically load workspace .env files in Node.js environments only.
 * Uses createRequire so the static import graph stays browser-safe for Vite/Rollup.
 */
const loadEnvFiles = (): void => {
    if (typeof globalThis.process?.versions?.node !== 'string') return;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { createRequire } = globalThis.process.getBuiltinModule?.('node:module')
            ?? { createRequire: undefined };
        if (createRequire) {
            const req = createRequire(import.meta.url);
            req('./env-file.js').loadWorkspaceEnvFiles();
        }
    } catch { /* not available in this runtime */ }
};

const parseEnv = <T extends AnySchema>(
    scope: string,
    schema: T,
): z.infer<T> => {
    loadEnvFiles();
    const result = schema.safeParse(process.env);

    if (!result.success) {
        throw new Error(
            `Invalid ${scope} configuration: ${formatZodErrors(result.error)}`,
        );
    }

    return result.data;
};

export type WebConfig = z.infer<typeof webSchema>;
export type ApiConfig = z.infer<typeof apiSchemaWithRefinements>;
export type IndexerConfig = z.infer<typeof indexerSchema>;
export type ModerationWorkerConfig = z.infer<typeof moderationWorkerSchema>;

export const loadWebConfig = (): WebConfig => parseEnv('web', webSchema);
export const loadApiConfig = (): ApiConfig =>
    parseEnv('api', apiSchemaWithRefinements);
export const loadIndexerConfig = (): IndexerConfig =>
    parseEnv('indexer', indexerSchema);
export const loadModerationWorkerConfig = (): ModerationWorkerConfig =>
    parseEnv('moderation-worker', moderationWorkerSchema);

// ---------------------------------------------------------------------------
// Production startup guards
// ---------------------------------------------------------------------------

export interface ProductionConfigBase {
    NODE_ENV: string;
    ATPROTO_SERVICE_DID: string;
}

export interface ProductionApiConfig extends ProductionConfigBase {
    API_DATA_SOURCE?: string;
    API_DATABASE_URL?: string;
    DATABASE_URL?: string;
    ATPROTO_OAUTH_CLIENT_ID?: string;
    ATPROTO_OAUTH_REDIRECT_URI?: string;
    ATPROTO_SESSION_ENCRYPTION_KEY?: string;
    API_MODERATION_SERVICE_URL?: string;
    MODERATION_SERVICE_TOKEN?: string;
    ATTACHMENT_OBJECT_ENDPOINT?: string;
    ATTACHMENT_OBJECT_ACCESS_KEY?: string;
    ATTACHMENT_OBJECT_SECRET_KEY?: string;
    ATTACHMENT_OBJECT_BUCKET?: string;
    ATTACHMENT_SIGNING_KEY?: string;
    ATTACHMENT_CLAMD_HOST?: string;
    NOTIFICATION_EMAIL_PROVIDER_URL?: string;
    NOTIFICATION_EMAIL_PROVIDER_TOKEN?: string;
    NOTIFICATION_EMAIL_FROM?: string;
    NOTIFICATION_VAPID_SUBJECT?: string;
    NOTIFICATION_VAPID_PUBLIC_KEY?: string;
    NOTIFICATION_VAPID_PRIVATE_KEY?: string;
    NOTIFICATION_PROVIDER_WEBHOOK_TOKEN?: string;
}

export interface AtAuthRuntimeConfig extends ProductionApiConfig {
    API_DATA_SOURCE?: string;
}

export const validateAtAuthRuntimeConfig = (
    config: AtAuthRuntimeConfig,
): void => {
    if (config.NODE_ENV === 'test') {
        return;
    }

    if (config.API_DATA_SOURCE !== 'postgres') {
        throw new Error(
            'FATAL: real AT OAuth requires API_DATA_SOURCE=postgres outside tests.',
        );
    }

    const required: Array<keyof AtAuthRuntimeConfig> = [
        'ATPROTO_OAUTH_CLIENT_ID',
        'ATPROTO_OAUTH_REDIRECT_URI',
        'ATPROTO_SESSION_ENCRYPTION_KEY',
    ];
    const missing = required.filter(key => !config[key]);
    if (missing.length > 0) {
        throw new Error(
            `FATAL: real AT OAuth requires ${missing.join(', ')}.`,
        );
    }
};

/**
 * Validate that a config is safe for production use.
 * Throws with an actionable message if any guard fails.
 */
export const validateProductionConfig = (
    config: ProductionApiConfig,
): void => {
    if (config.NODE_ENV !== 'production') {
        return; // Guards only apply in production
    }

    if (config.API_DATA_SOURCE === 'fixture') {
        throw new Error(
            'FATAL: API_DATA_SOURCE=fixture is not allowed in production. ' +
                'Set API_DATA_SOURCE=postgres and provide a DATABASE_URL.',
        );
    }

    if (!config.API_DATABASE_URL && !config.DATABASE_URL) {
        throw new Error(
            'FATAL: DATABASE_URL or API_DATABASE_URL must be set in production. ' +
                'Provide a valid PostgreSQL connection string.',
        );
    }

    if (
        config.ATPROTO_SERVICE_DID === 'did:example:test-service' ||
        config.ATPROTO_SERVICE_DID.startsWith('did:example:')
    ) {
        throw new Error(
            'FATAL: ATPROTO_SERVICE_DID must not use a did:example: value in production. ' +
                'Set it to your real service DID (e.g. did:web:your-domain.com).',
        );
    }

    if (!config.API_MODERATION_SERVICE_URL || !config.MODERATION_SERVICE_TOKEN) {
        throw new Error(
            'FATAL: API_MODERATION_SERVICE_URL and MODERATION_SERVICE_TOKEN are required in production.',
        );
    }

    const attachmentRequired: Array<keyof ProductionApiConfig> = [
        'ATTACHMENT_OBJECT_ENDPOINT',
        'ATTACHMENT_OBJECT_ACCESS_KEY',
        'ATTACHMENT_OBJECT_SECRET_KEY',
        'ATTACHMENT_OBJECT_BUCKET',
        'ATTACHMENT_SIGNING_KEY',
        'ATTACHMENT_CLAMD_HOST',
    ];
    const missingAttachments = attachmentRequired.filter(
        key => !config[key],
    );
    if (missingAttachments.length > 0) {
        throw new Error(
            `FATAL: private attachment runtime requires ${missingAttachments.join(', ')}.`,
        );
    }
    const notificationRequired: Array<keyof ProductionApiConfig> = [
        'NOTIFICATION_EMAIL_PROVIDER_URL',
        'NOTIFICATION_EMAIL_PROVIDER_TOKEN',
        'NOTIFICATION_EMAIL_FROM',
        'NOTIFICATION_VAPID_SUBJECT',
        'NOTIFICATION_VAPID_PUBLIC_KEY',
        'NOTIFICATION_VAPID_PRIVATE_KEY',
        'NOTIFICATION_PROVIDER_WEBHOOK_TOKEN',
    ];
    const missingNotifications = notificationRequired.filter(
        key => !config[key],
    );
    if (missingNotifications.length > 0) {
        throw new Error(
            `FATAL: durable notification delivery requires ${missingNotifications.join(', ')}.`,
        );
    }
};

/**
 * Validate production config for services that lack API_DATA_SOURCE
 * (indexer, moderation-worker).
 */
export const validateProductionServiceConfig = (
    config: ProductionConfigBase,
): void => {
    if (config.NODE_ENV !== 'production') {
        return;
    }

    if (
        config.ATPROTO_SERVICE_DID === 'did:example:test-service' ||
        config.ATPROTO_SERVICE_DID.startsWith('did:example:')
    ) {
        throw new Error(
            'FATAL: ATPROTO_SERVICE_DID must not use a did:example: value in production. ' +
                'Set it to your real service DID (e.g. did:web:your-domain.com).',
        );
    }
};

export const validateModerationWorkerRuntimeConfig = (config: {
    NODE_ENV: string;
    MODERATION_SERVICE_TOKEN?: string;
}): void => {
    if (config.NODE_ENV === 'production' && !config.MODERATION_SERVICE_TOKEN) {
        throw new Error(
            'FATAL: MODERATION_SERVICE_TOKEN is required in production.',
        );
    }
};

// ---------------------------------------------------------------------------
// Health-check utilities
// ---------------------------------------------------------------------------

import type { HealthStatus } from './contracts.js';

export interface HealthCheck {
    name: string;
    check: () => Promise<{ status: HealthStatus; message?: string }> | { status: HealthStatus; message?: string };
}

/**
 * Run all health checks and compute an aggregate status.
 * Returns 'ok' if all pass, 'degraded' if any are degraded, 'not_ready' if any are not_ready.
 */
export const checkServiceHealth = async (
    checks: HealthCheck[],
): Promise<{
    status: HealthStatus;
    checks: Record<string, { status: HealthStatus; message?: string }>;
}> => {
    const results: Record<string, { status: HealthStatus; message?: string }> =
        {};
    let aggregate: HealthStatus = 'ok';

    for (const { name, check } of checks) {
        try {
            const result = await check();
            results[name] = result;
            if (result.status === 'not_ready') {
                aggregate = 'not_ready';
            } else if (result.status === 'degraded' && aggregate !== 'not_ready') {
                aggregate = 'degraded';
            }
        } catch (error) {
            results[name] = {
                status: 'degraded',
                message:
                    error instanceof Error ?
                        error.message
                    :   'Health check failed',
            };
            if (aggregate !== 'not_ready') {
                aggregate = 'degraded';
            }
        }
    }

    return { status: aggregate, checks: results };
};
