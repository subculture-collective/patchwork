import { AuthoringReceiptService } from './authoring-receipts.js';
import { createAccountRequestsHandler } from './http/account-requests-handler.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CONTRACT_VERSION,
    loadApiConfig,
    validateProductionConfig,
    validateAtAuthRuntimeConfig,
    checkServiceHealth,
    type ServiceHealth,
    type HealthCheck,
    SliCollector,
    acceptPolicyConsentSchema,
} from '@patchwork/shared';
import { createPostgresPool } from './db/discovery-events.js';
import {
    createFixtureQueryService,
    PostgresProjectionQueryService,
    assessProjectionReadiness,
} from './query-service.js';
import { AtClientError } from '@patchwork/at-client';
import { createAtAuthRuntime } from './auth/runtime.js';
import {
    oauthCallbackLandingPath,
    serializeSessionCookie,
} from './auth/at-auth-service.js';
import { AidPostCommandService } from './records/aid-post-command-service.js';
import { DirectoryResourceCommandService } from './records/directory-resource-command-service.js';
import { VolunteerProfileCommandService } from './records/volunteer-profile-command-service.js';
import { PostgresVolunteerPrivateProfileStore } from './db/volunteer-private-profile-store.js';
import { ZodError } from 'zod';
import { createLifecycleService } from './lifecycle-service.js';
import { getCorsHeaders } from './cors.js';
import { selectLimiter, extractClientIp } from './rate-limiter.js';
import { PostgresBlockRepository } from './db/block-repository.js';
import { PostgresReportRepository } from './db/report-repository.js';
import { PostgresLifecycleRepository } from './db/lifecycle-repository.js';
import { PostgresRoleRepository } from './db/role-repository.js';
import { BlockService } from './block-service.js';
import { AccountPrivacyService } from './account-privacy-service.js';
import {
    AccountOnboardingService,
    isConsentExemptPath,
} from './account-onboarding-service.js';
import { ReportService } from './report-service.js';
import {
    AuthorizationError,
    requireCapability,
} from './authorization-guard.js';
import { createLifecycleTransitionHandler } from './http/lifecycle-transition-handler.js';
import {
    createAccountPrivacyHandler,
    isAccountPrivacyRoute,
} from './http/account-privacy-handler.js';
import {
    createAccountOnboardingHandler,
    isAccountOnboardingRoute,
} from './http/account-onboarding-handler.js';
import {
    createOrganizationHandler,
    isOrganizationRoute,
} from './http/organization-handler.js';
import { OrganizationService } from './organization-service.js';
import {
    createVerificationHandler,
    isVerificationRoute,
} from './http/verification-handler.js';
import { VerificationCaseService } from './verification-case-service.js';
import {
    createCoordinationHandler,
    isCoordinationRoute,
} from './http/coordination-handler.js';
import { CoordinationService } from './coordination-service.js';
import { CoordinationSchedulingService } from './coordination-scheduling-service.js';
import {
    createCoordinationSchedulingHandler,
    isCoordinationSchedulingRoute,
} from './http/coordination-scheduling-handler.js';
import { DurableGroupService } from './durable-group-service.js';
import { createGroupHandler, isGroupRoute } from './http/group-handler.js';
import { DurableChatService } from './durable-chat-service.js';
import { createChatHandler, isChatRoute } from './http/chat-handler.js';
import {
    createAttachmentHandler,
    isAttachmentRoute,
} from './http/attachment-handler.js';
import { AttachmentService } from './attachment-service.js';
import { MinioPrivateObjectStore } from './private-object-store.js';
import { ClamdMalwareScanner } from './clamd-scanner.js';
import {
    DurableNotificationService,
    HttpEmailProvider,
    VapidPushProvider,
} from './durable-notification-service.js';
import {
    createNotificationHandler,
    isNotificationRoute,
} from './http/notification-handler.js';
import {
    createExactLocationSignalHandler,
    isExactLocationSignalRoute,
} from './http/exact-location-signal-handler.js';
import { ExactLocationSignalService } from './exact-location-signal-service.js';
import { MaintenanceModeService } from './maintenance-mode-service.js';
import {
    createMaintenanceHandler,
    isBlockedByMaintenance,
    isMaintenanceRoute,
} from './http/maintenance-handler.js';
import {
    createDurableSafetyHandler,
    isDurableSafetyRoute,
} from './http/durable-safety-handler.js';
import { createMethodRouter } from './http/router.js';
import { readJsonBody } from './http/json-body.js';
import {
    authenticateOptionalRequest,
    authenticateRequest,
} from './http/authenticated-request.js';
import { createDiscoveryHandler } from './http/discovery-handler.js';
import { createGracefulShutdown } from './http/graceful-shutdown.js';
import { createModerationGateway } from './http/moderation-gateway.js';
import { createPublicSubmissionSafetyGate } from './public-submission-safety.js';
import {
    idempotencyKeyFromRequest,
    withIdempotencyKey,
} from './http/idempotent-request.js';
import {
    IdempotencyError,
    PostgresIdempotencyExecutor,
    type IdempotentResponse,
} from './http/idempotency-store.js';
import { securityHeaders } from './http/security-headers.js';
import {
    assertCsrfProtection,
    createCsrfToken,
    serializeCsrfCookie,
} from './http/csrf.js';
import {
    ensureRequestId,
    PublicHttpError,
    writeJsonResponse,
    writePublicError,
} from './http/error-response.js';
import { createPdsSignupService } from './auth/pds-signup-service.js';
import { SignupInviteService } from './signup-invite-service.js';
import {
    createSignupInviteHandler,
    isSignupInviteRoute,
} from './http/signup-invite-handler.js';
import { PostgresRetentionService } from './db/retention-service.js';
import {
    startRetentionScheduler,
    type RetentionScheduler,
} from './db/retention-scheduler.js';
import { RetentionMetrics } from './db/retention-metrics.js';

const config = loadApiConfig();

// Production startup guard — fail fast if misconfigured
validateProductionConfig(config);
validateAtAuthRuntimeConfig(config);

const databaseUrl = config.API_DATABASE_URL ?? config.DATABASE_URL;
const postgresPool =
    config.API_DATA_SOURCE === 'postgres' && databaseUrl
        ? createPostgresPool(databaseUrl)
        : undefined;

if (postgresPool) {
    const projectionSchema = await postgresPool.query<{
        projection_table: string | null;
        directory_projection_table: string | null;
        volunteer_projection_table: string | null;
        state_table: string | null;
        organization_table: string | null;
        verification_table: string | null;
        coordination_table: string | null;
        attachment_table: string | null;
        notification_table: string | null;
        maintenance_table: string | null;
        group_table: string | null;
        chat_table: string | null;
    }>(
        `SELECT
            to_regclass('indexer_aid_post_projections')::TEXT AS projection_table,
            to_regclass('indexer_directory_resource_projections')::TEXT
                AS directory_projection_table,
            to_regclass('indexer_volunteer_profile_projections')::TEXT
                AS volunteer_projection_table,
            to_regclass('indexer_projection_state')::TEXT AS state_table,
            to_regclass('organizations')::TEXT AS organization_table,
            to_regclass('verification_applications')::TEXT
                AS verification_table,
            to_regclass('coordination_offers')::TEXT
                AS coordination_table,
            to_regclass('attachment_scan_attempts')::TEXT
                AS attachment_table,
            to_regclass('notification_intents')::TEXT
                AS notification_table,
            to_regclass('platform_maintenance_state')::TEXT
                AS maintenance_table,
            to_regclass('groups')::TEXT AS group_table,
            to_regclass('chat_messages')::TEXT AS chat_table`,
    );
    if (
        !projectionSchema.rows[0]?.projection_table ||
        !projectionSchema.rows[0]?.directory_projection_table ||
        !projectionSchema.rows[0]?.volunteer_projection_table ||
        !projectionSchema.rows[0]?.organization_table ||
        !projectionSchema.rows[0]?.verification_table ||
        !projectionSchema.rows[0]?.coordination_table ||
        !projectionSchema.rows[0]?.attachment_table ||
        !projectionSchema.rows[0]?.notification_table ||
        !projectionSchema.rows[0]?.maintenance_table ||
        !projectionSchema.rows[0]?.group_table ||
        !projectionSchema.rows[0]?.chat_table ||
        !projectionSchema.rows[0]?.state_table
    ) {
        await postgresPool.end();
        throw new Error(
            'FATAL: indexer projection schema is missing; run indexer migrations before API startup.',
        );
    }
}

const projectionQueryService =
    postgresPool ? new PostgresProjectionQueryService(postgresPool) : undefined;
const queryService = projectionQueryService ?? createFixtureQueryService();

if (projectionQueryService && postgresPool) {
    const startupFreshness = await projectionQueryService.getFreshness();
    const startupReadiness = assessProjectionReadiness(
        startupFreshness,
        config.API_MAX_PROJECTION_LAG_SECONDS,
    );
    if (!startupReadiness.ready) {
        await postgresPool.end();
        throw new Error(
            `FATAL: ${startupReadiness.reason}; start a healthy indexer before the API.`,
        );
    }
}

const blockService =
    postgresPool ? new BlockService(new PostgresBlockRepository(postgresPool)) : undefined;
const reportService =
    postgresPool ?
        new ReportService(new PostgresReportRepository(postgresPool))
    :   undefined;
const lifecycleRepository =
    postgresPool ? new PostgresLifecycleRepository(postgresPool) : undefined;
const authoringReceiptService = postgresPool ? new AuthoringReceiptService(postgresPool) : undefined;
const lifecycleService = createLifecycleService(lifecycleRepository,
    authoringReceiptService ? (uri, cid) => authoringReceiptService.projection(uri, cid) : undefined);
const roleRepository =
    postgresPool ? new PostgresRoleRepository(postgresPool) : undefined;
const atAuthRuntime =
    config.NODE_ENV === 'test' ?
        undefined
    :   createAtAuthRuntime(config, postgresPool!);

const authenticateSessionRequest =
    atAuthRuntime && roleRepository ?
        (request: IncomingMessage) =>
            authenticateRequest(request, {
                resolveSession: token => atAuthRuntime.service.current(token),
                resolveRole: did => roleRepository.resolve(did),
            })
    :   undefined;
const accountOnboardingService =
    postgresPool ? new AccountOnboardingService(postgresPool) : undefined;
const organizationService =
    postgresPool ? new OrganizationService(postgresPool) : undefined;
const verificationCaseService =
    postgresPool ? new VerificationCaseService(postgresPool) : undefined;
const coordinationService =
    postgresPool ? new CoordinationService(postgresPool) : undefined;
const coordinationSchedulingService =
    postgresPool ? new CoordinationSchedulingService(postgresPool) : undefined;
const durableGroupService =
    postgresPool ? new DurableGroupService(postgresPool) : undefined;
const durableChatService =
    postgresPool ? new DurableChatService(postgresPool) : undefined;
const maintenanceModeService =
    postgresPool ?
        new MaintenanceModeService(
            postgresPool,
            process.env['PATCHWORK_MAINTENANCE_MODE'] === 'true',
        )
    :   undefined;
if (maintenanceModeService) {
    await maintenanceModeService.ensureReady();
}
const exactLocationSignalService =
    postgresPool ?
        new ExactLocationSignalService(
            postgresPool,
            () => maintenanceModeService?.isActive() ?? true,
        )
    :   undefined;
const attachmentService =
    postgresPool &&
    config.ATTACHMENT_OBJECT_ENDPOINT &&
    config.ATTACHMENT_OBJECT_ACCESS_KEY &&
    config.ATTACHMENT_OBJECT_SECRET_KEY &&
    config.ATTACHMENT_OBJECT_BUCKET &&
    config.ATTACHMENT_SIGNING_KEY &&
    config.ATTACHMENT_CLAMD_HOST ?
        new AttachmentService(
            postgresPool,
            new MinioPrivateObjectStore(
                config.ATTACHMENT_OBJECT_BUCKET,
                {
                    endpoint: config.ATTACHMENT_OBJECT_ENDPOINT,
                    accessKey: config.ATTACHMENT_OBJECT_ACCESS_KEY,
                    secretKey: config.ATTACHMENT_OBJECT_SECRET_KEY,
                },
            ),
            new ClamdMalwareScanner(
                config.ATTACHMENT_CLAMD_HOST,
                config.ATTACHMENT_CLAMD_PORT,
            ),
            config.ATTACHMENT_SIGNING_KEY,
            `${config.API_PUBLIC_ORIGIN.replace(/\/$/, '')}/api`,
        )
    :   undefined;
if (attachmentService) {
    await attachmentService.ensureReady();
}
const notificationProviders = {
    ...(config.NOTIFICATION_EMAIL_PROVIDER_URL &&
        config.NOTIFICATION_EMAIL_PROVIDER_TOKEN && config.NOTIFICATION_EMAIL_FROM ? {
        email: new HttpEmailProvider(config.NOTIFICATION_EMAIL_PROVIDER_URL,
            config.NOTIFICATION_EMAIL_PROVIDER_TOKEN, config.NOTIFICATION_EMAIL_FROM),
    } : {}),
    ...(config.NOTIFICATION_VAPID_SUBJECT && config.NOTIFICATION_VAPID_PUBLIC_KEY &&
        config.NOTIFICATION_VAPID_PRIVATE_KEY ? {
        push: new VapidPushProvider({ subject: config.NOTIFICATION_VAPID_SUBJECT,
            publicKey: config.NOTIFICATION_VAPID_PUBLIC_KEY,
            privateKey: config.NOTIFICATION_VAPID_PRIVATE_KEY }),
    } : {}),
};
const notificationService =
    postgresPool ?
        new DurableNotificationService(
            postgresPool,
            notificationProviders,
            { publicWebOrigin: config.API_PUBLIC_ORIGIN.replace(/\/$/, '') },
        )
    :   undefined;
const authenticateApiRequest =
    authenticateSessionRequest ?
        async (request: IncomingMessage) => {
            const authenticated = await authenticateSessionRequest(request);
            const pathname = new URL(
                request.url ?? '/',
                'http://localhost',
            ).pathname;
            if (
                accountOnboardingService &&
                !isConsentExemptPath(pathname)
            ) {
                await accountOnboardingService.requireCurrentConsent(
                    authenticated.principal.did,
                );
            }
            return authenticated;
        }
    :   undefined;
const authenticateOptionalApiRequest =
    atAuthRuntime && roleRepository ?
        (request: IncomingMessage) =>
            authenticateOptionalRequest(request, {
                resolveSession: token => atAuthRuntime.service.current(token),
                resolveRole: did => roleRepository.resolve(did),
            })
    :   async () => undefined;

const moderationGateway =
    config.API_MODERATION_SERVICE_URL && config.MODERATION_SERVICE_TOKEN ?
        createModerationGateway({
            baseUrl: config.API_MODERATION_SERVICE_URL,
            serviceToken: config.MODERATION_SERVICE_TOKEN,
        })
    :   undefined;
const publicSubmissionSafetyGate =
    moderationGateway ?
        createPublicSubmissionSafetyGate(moderationGateway)
    : postgresPool ?
        {
            review: async () => {
                throw new PublicHttpError(
                    503,
                    'SUBMISSION_SAFETY_UNAVAILABLE',
                    'Publication safety checks are unavailable. Nothing was published.',
                );
            },
        }
    :   undefined;
const idempotencyExecutor =
    postgresPool ? new PostgresIdempotencyExecutor(postgresPool) : undefined;
const pdsSignupService = createPdsSignupService({
    pdsUrl: config.ATPROTO_ACCOUNT_PDS_URL,
    adminPassword: config.ATPROTO_ACCOUNT_PDS_ADMIN_PASSWORD,
});
const signupInviteService = postgresPool ? new SignupInviteService(postgresPool) : undefined;
const signupInviteHandler =
    signupInviteService && authenticateSessionRequest ?
        createSignupInviteHandler({
            service: signupInviteService,
            authenticate: authenticateSessionRequest,
            publicOrigin: config.API_PUBLIC_ORIGIN,
        })
    :   undefined;

const executeIdempotentMutation = async (
    request: IncomingMessage,
    actorDid: string,
    body: unknown,
    effect: (
        commandBody: Record<string, unknown>,
        idempotencyKey: string,
    ) => Promise<IdempotentResponse>,
    field: 'commandId' | 'idempotencyKey' | null = 'commandId',
): Promise<IdempotentResponse> => {
    if (!idempotencyExecutor) {
        throw new PublicHttpError(
            503,
            'IDEMPOTENCY_STORE_UNAVAILABLE',
            'Durable command processing is unavailable.',
        );
    }
    const idempotencyKey = idempotencyKeyFromRequest(request);
    const commandBody =
        field ?
            withIdempotencyKey(body, idempotencyKey, field)
        :   { ...(body as Record<string, unknown>) };
    return idempotencyExecutor.execute(
        {
            actorDid,
            method: request.method ?? 'POST',
            pathname: new URL(request.url ?? '/', 'http://localhost').pathname,
            idempotencyKey,
            body: commandBody,
        },
        () => effect(commandBody, idempotencyKey),
    );
};

const createAidPostCommandService =
    atAuthRuntime ?
        async (sessionToken: string) => {
            // Restore OAuth before the idempotency executor takes the
            // per-account transaction lock. OAuth refresh may persist a
            // rotated session under that same lock.
            const client = await atAuthRuntime.aidPostClient(sessionToken);
            return new AidPostCommandService(
                async () => client,
                {
                    reconcileDeletion: async command => {
                        const result =
                            await lifecycleRepository!.reconcileDeletion(
                                command,
                            );
                        await attachmentService?.deleteForSubject(
                            command.actorDid,
                            command.postUri,
                            new Date(command.occurredAt),
                        );
                        return result;
                    },
                },
                lifecycleRepository,
                publicSubmissionSafetyGate,
            );
        }
    :   undefined;
const createDirectoryResourceCommandService =
    atAuthRuntime ?
        async (sessionToken: string) => {
            // Keep OAuth restoration outside the idempotent mutation
            // transaction for the same lock-ordering reason as aid posts.
            const client =
                await atAuthRuntime.directoryResourceClient(sessionToken);
            return new DirectoryResourceCommandService(
                async () => client,
                publicSubmissionSafetyGate,
            );
        }
    :   undefined;
const volunteerPrivateProfileStore =
    postgresPool ?
        new PostgresVolunteerPrivateProfileStore(postgresPool)
    :   undefined;
const createVolunteerProfileCommandService =
    atAuthRuntime && volunteerPrivateProfileStore ?
        async (sessionToken: string) => {
            const client =
                await atAuthRuntime.volunteerProfileClient(sessionToken);
            return new VolunteerProfileCommandService(
                async () => client,
                volunteerPrivateProfileStore,
                publicSubmissionSafetyGate,
            );
        }
    :   undefined;

const lifecycleTransitionHandler =
    authenticateApiRequest && postgresPool ?
        createLifecycleTransitionHandler({
            service: lifecycleService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const durableSafetyHandler =
    authenticateApiRequest && blockService && reportService ?
        createDurableSafetyHandler({
            blockService,
            reportService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const accountPrivacyHandler =
    authenticateApiRequest && postgresPool ?
        createAccountPrivacyHandler({
            service: new AccountPrivacyService(postgresPool),
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
            clearSessionCookies: response => {
                response.setHeader('set-cookie', [
                    serializeSessionCookie(
                        '',
                        config.NODE_ENV === 'production',
                        0,
                    ),
                    serializeCsrfCookie(
                        '',
                        config.NODE_ENV === 'production',
                        0,
                    ),
                ]);
            },
        })
    :   undefined;
const accountRequestsHandler = authoringReceiptService && authenticateApiRequest
    ? createAccountRequestsHandler(authoringReceiptService, authenticateApiRequest) : undefined;
const accountOnboardingHandler =
    authenticateSessionRequest &&
    accountOnboardingService &&
    postgresPool ?
        createAccountOnboardingHandler({
            service: accountOnboardingService,
            authenticate: authenticateSessionRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const organizationHandler =
    authenticateApiRequest && organizationService ?
        createOrganizationHandler({
            service: organizationService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const verificationHandler =
    authenticateApiRequest && verificationCaseService ?
        createVerificationHandler({
            service: verificationCaseService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const coordinationHandler =
    authenticateApiRequest && coordinationService ?
        createCoordinationHandler({
            service: coordinationService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const coordinationSchedulingHandler =
    authenticateApiRequest && coordinationSchedulingService ?
        createCoordinationSchedulingHandler({
            service: coordinationSchedulingService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const groupHandler =
    authenticateApiRequest && durableGroupService ?
        createGroupHandler({
            service: durableGroupService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const chatHandler =
    authenticateApiRequest && durableChatService ?
        createChatHandler({
            service: durableChatService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const exactLocationSignalHandler =
    authenticateApiRequest && exactLocationSignalService ?
        createExactLocationSignalHandler({
            service: exactLocationSignalService,
            authenticate: authenticateApiRequest,
        })
    :   undefined;
const attachmentHandler =
    authenticateApiRequest && attachmentService ?
        createAttachmentHandler({
            service: attachmentService,
            authenticate: authenticateApiRequest,
        })
    :   undefined;
const notificationHandler =
    authenticateApiRequest && notificationService ?
        createNotificationHandler({
            service: notificationService,
            authenticate: authenticateApiRequest,
            providerFeedbackToken:
                config.NOTIFICATION_PROVIDER_WEBHOOK_TOKEN,
        })
    :   undefined;
const maintenanceHandler =
    authenticateApiRequest && maintenanceModeService ?
        createMaintenanceHandler({
            service: maintenanceModeService,
            authenticate: authenticateApiRequest,
            executeIdempotent: executeIdempotentMutation,
        })
    :   undefined;
const discoveryHandler = createDiscoveryHandler({
    service: queryService,
    authenticateOptional: authenticateOptionalApiRequest,
});

const sliCollector = new SliCollector();
const retentionMetrics = new RetentionMetrics();

const healthChecks: HealthCheck[] = [];

// Add database health check when using postgres
if (postgresPool) {
    healthChecks.push({
        name: 'database',
        check: async () => {
            try {
                const client = await postgresPool.connect();
                try {
                    await client.query('SELECT 1');
                    return { status: 'ok' as const };
                } finally {
                    client.release();
                }
            } catch (error) {
                return {
                    status: 'degraded' as const,
                    message:
                        error instanceof Error ?
                            error.message
                        :   'Database unreachable',
                };
            }
        },
    });
    healthChecks.push({
        name: 'projections',
        check: async () => {
            try {
                const freshness = await projectionQueryService!.getFreshness();
                const readiness = assessProjectionReadiness(
                    freshness,
                    config.API_MAX_PROJECTION_LAG_SECONDS,
                );
                if (!readiness.ready) {
                    return {
                        status: 'not_ready' as const,
                        message: readiness.reason,
                    };
                }
                return { status: 'ok' as const };
            } catch {
                return {
                    status: 'not_ready' as const,
                    message: 'Projection schema is unavailable',
                };
            }
        },
    });
    healthChecks.push({
        name: 'chat',
        check: async () => {
            try {
                // Read the durable table, not merely its catalog entry, so a
                // broken chat dependency is visible to readiness probes.
                await postgresPool.query('SELECT 1 FROM chat_conversations LIMIT 1');
                return { status: 'ok' as const };
            } catch {
                return {
                    status: 'not_ready' as const,
                    message: 'Durable chat storage is unavailable',
                };
            }
        },
    });
}

const buildHealthPayload = async (): Promise<{
    payload: ServiceHealth;
    httpStatus: number;
}> => {
    if (healthChecks.length === 0) {
        return {
            payload: {
                service: 'api',
                status: 'ok',
                contractVersion: CONTRACT_VERSION,
                did: config.ATPROTO_SERVICE_DID,
            },
            httpStatus: 200,
        };
    }
    const result = await checkServiceHealth(healthChecks);
    return {
        payload: {
            service: 'api',
            status: result.status,
            contractVersion: CONTRACT_VERSION,
            did: config.ATPROTO_SERVICE_DID,
            checks: result.checks,
        },
        httpStatus: 200,
    };
};

const buildReadinessPayload = async (): Promise<{
    payload: ServiceHealth;
    httpStatus: number;
}> => {
    if (healthChecks.length === 0) {
        return {
            payload: {
                service: 'api',
                status: 'ok',
                contractVersion: CONTRACT_VERSION,
                did: config.ATPROTO_SERVICE_DID,
            },
            httpStatus: 200,
        };
    }
    const result = await checkServiceHealth(healthChecks);
    const httpStatus = result.status === 'not_ready' ? 503 : 200;
    return {
        payload: {
            service: 'api',
            status: result.status,
            contractVersion: CONTRACT_VERSION,
            did: config.ATPROTO_SERVICE_DID,
            checks: result.checks,
        },
        httpStatus,
    };
};

let attachmentDeletionFailuresTotal = 0;
let attachmentDeletionFailuresPending = 0;
let attachmentPipelineSweepFailuresTotal = 0;
let notificationDeliveryPending = 0;
let notificationDeliveryRetrying = 0;
let notificationDeliveryDeadLetters = 0;
let notificationDeliveryOldestPendingSeconds = 0;
let notificationDeliverySweepFailuresTotal = 0;

const renderPrometheusMetrics = (): string => {
    const uptimeSeconds = Math.floor(process.uptime());

    const baseMetrics = [
        '# HELP patchwork_service_up Service health status (1 = up).',
        '# TYPE patchwork_service_up gauge',
        'patchwork_service_up{project="patchwork",service="api",component="stitch"} 1',
        '# HELP patchwork_process_uptime_seconds Process uptime in seconds.',
        '# TYPE patchwork_process_uptime_seconds counter',
        `patchwork_process_uptime_seconds{project="patchwork",service="api",component="stitch"} ${uptimeSeconds}`,
    ].join('\n');

    const sliMetrics = sliCollector.renderPrometheus('api');

    const attachmentMetrics = [
        '# HELP patchwork_attachment_deletion_failures_total Object deletion attempts that failed.',
        '# TYPE patchwork_attachment_deletion_failures_total counter',
        `patchwork_attachment_deletion_failures_total{project="patchwork",service="api",component="stitch"} ${attachmentDeletionFailuresTotal}`,
        '# HELP patchwork_attachment_deletion_failures_pending Durable object deletion jobs with a recorded failure.',
        '# TYPE patchwork_attachment_deletion_failures_pending gauge',
        `patchwork_attachment_deletion_failures_pending{project="patchwork",service="api",component="stitch"} ${attachmentDeletionFailuresPending}`,
        '# HELP patchwork_attachment_pipeline_sweep_failures_total Attachment pipeline sweeps that failed before completion.',
        '# TYPE patchwork_attachment_pipeline_sweep_failures_total counter',
        `patchwork_attachment_pipeline_sweep_failures_total{project="patchwork",service="api",component="stitch"} ${attachmentPipelineSweepFailuresTotal}`,
    ].join('\n');

    const notificationMetrics = [
        '# HELP patchwork_notification_delivery_pending Pending external notification deliveries.',
        '# TYPE patchwork_notification_delivery_pending gauge',
        `patchwork_notification_delivery_pending{project="patchwork",service="api",component="stitch"} ${notificationDeliveryPending}`,
        '# HELP patchwork_notification_delivery_retrying External notification deliveries waiting for retry.',
        '# TYPE patchwork_notification_delivery_retrying gauge',
        `patchwork_notification_delivery_retrying{project="patchwork",service="api",component="stitch"} ${notificationDeliveryRetrying}`,
        '# HELP patchwork_notification_delivery_dead_letters External notification deliveries exhausted or permanently rejected.',
        '# TYPE patchwork_notification_delivery_dead_letters gauge',
        `patchwork_notification_delivery_dead_letters{project="patchwork",service="api",component="stitch"} ${notificationDeliveryDeadLetters}`,
        '# HELP patchwork_notification_delivery_oldest_pending_seconds Age of the oldest pending external notification delivery.',
        '# TYPE patchwork_notification_delivery_oldest_pending_seconds gauge',
        `patchwork_notification_delivery_oldest_pending_seconds{project="patchwork",service="api",component="stitch"} ${notificationDeliveryOldestPendingSeconds}`,
        '# HELP patchwork_notification_delivery_sweep_failures_total Notification delivery sweeps that failed.',
        '# TYPE patchwork_notification_delivery_sweep_failures_total counter',
        `patchwork_notification_delivery_sweep_failures_total{project="patchwork",service="api",component="stitch"} ${notificationDeliverySweepFailuresTotal}`,
    ].join('\n');

    const maintenanceMetrics = [
        '# HELP patchwork_maintenance_mode_active New submissions and exact-location exchange are disabled.',
        '# TYPE patchwork_maintenance_mode_active gauge',
        `patchwork_maintenance_mode_active{project="patchwork",service="api",component="stitch"} ${maintenanceModeService?.isActive() ? 1 : 0}`,
    ].join('\n');

    return `${baseMetrics}\n${sliMetrics}\n${retentionMetrics.renderPrometheus()}\n${attachmentMetrics}\n${notificationMetrics}\n${maintenanceMetrics}`;
};

const writeJson = (
    response: ServerResponse,
    statusCode: number,
    body: unknown,
    extraHeaders?: Record<string, string>,
): void => {
    writeJsonResponse(response, statusCode, body, extraHeaders);
};

const writeRouteError = (response: ServerResponse, error: unknown): void => {
    if (error instanceof IdempotencyError) {
        writeJson(response, 409, {
            error: {
                code: error.code,
                message: 'The idempotency key was already used for another command.',
            },
        });
        return;
    }
    writePublicError(response, error);
};

const writeAtAuthError = (response: ServerResponse, error: unknown): void => {
    if (error instanceof PublicHttpError) {
        writeRouteError(response, error);
        return;
    }
    if (error instanceof AtClientError) {
        const statusCode =
            error.code === 'SESSION_EXPIRED' ? 401
            : error.code === 'UNAUTHORIZED' ||
              error.code === 'OAUTH_DENIED' ||
              error.code === 'ACCOUNT_DEACTIVATED' ? 403
            : error.code === 'PDS_UNAVAILABLE' ? 503
            : 400;
        writeJson(response, statusCode, {
            error: {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
            },
        });
        return;
    }
    writeJson(response, 500, {
        error: {
            code: 'AUTH_ERROR',
            message: 'AT Protocol authentication failed.',
        },
    });
};

const handleRealAuthRoute = (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (request.method === 'POST' && requestUrl.pathname === '/auth/signup') {
        void (async () => {
            try {
                if (request.headers.origin !== config.API_PUBLIC_ORIGIN) {
                    throw new PublicHttpError(
                        403,
                        'CSRF_ORIGIN_INVALID',
                        'The request origin is not allowed.',
                    );
                }
                const body = await readJsonBody(request);
                if (typeof body !== 'object' || body === null) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_REQUEST',
                        'The request body is invalid.',
                    );
                }
                const record = body as Record<string, unknown>;
                const allowedFields = new Set([
                    'handle',
                    'email',
                    'password',
                    'inviteCode',
                    'inviteToken',
                    'policyVersion',
                    'asserted18OrOlder',
                    'acceptedDocuments',
                ]);
                if (
                    Object.keys(record).some(key => !allowedFields.has(key))
                ) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_SIGNUP_INPUT',
                        'The signup input is invalid.',
                    );
                }
                const consent = acceptPolicyConsentSchema.safeParse({
                    policyVersion: record.policyVersion,
                    asserted18OrOlder: record.asserted18OrOlder,
                    acceptedDocuments: record.acceptedDocuments,
                });
                if (!consent.success) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_POLICY_CONSENT',
                        'Current policy consent and 18+ eligibility are required.',
                    );
                }
                const inviteToken = typeof record.inviteToken === 'string' ? record.inviteToken : '';
                const directInviteCode = typeof record.inviteCode === 'string' ? record.inviteCode : '';
                if ((inviteToken ? 1 : 0) + (directInviteCode ? 1 : 0) !== 1) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_SIGNUP_INPUT',
                        'Provide exactly one signup invitation.',
                    );
                }
                let signupInviteId: string | undefined;
                let pdsInviteCode = directInviteCode;
                if (inviteToken) {
                    pdsSignupService.validateAccountInput({
                        handle: typeof record.handle === 'string' ? record.handle : '',
                        email: typeof record.email === 'string' ? record.email : '',
                        password: typeof record.password === 'string' ? record.password : '',
                    });
                    if (!signupInviteService) {
                        throw new PublicHttpError(
                            503,
                            'SIGNUP_INVITATIONS_UNAVAILABLE',
                            'Invitation-based signup is temporarily unavailable.',
                        );
                    }
                    signupInviteId = await signupInviteService.requireUsable(inviteToken);
                    pdsInviteCode = await pdsSignupService.createInviteCode();
                    await signupInviteService.requireUsable(inviteToken);
                }
                const result = await pdsSignupService.createAccount({
                    handle: typeof record.handle === 'string' ? record.handle : '',
                    email: typeof record.email === 'string' ? record.email : '',
                    password: typeof record.password === 'string' ? record.password : '',
                    inviteCode: pdsInviteCode,
                });
                if (signupInviteId) {
                    await signupInviteService!.recordSuccessfulUse(signupInviteId);
                }
                if (accountOnboardingService) {
                    try {
                        await accountOnboardingService.accept(
                            result.did,
                            consent.data,
                        );
                    } catch {
                        // The managed PDS account is already user-owned and
                        // cannot be rolled back safely here. Fail closed on
                        // protected actions: the onboarding gate will require
                        // the same consent again after OAuth completes.
                        console.error(
                            JSON.stringify({
                                level: 'error',
                                event: 'signup_consent_persistence_failed',
                            }),
                        );
                    }
                }
                writeJson(response, 201, result);
            } catch (error) {
                writeRouteError(response, error);
            }
        })();
        return true;
    }

    if (!atAuthRuntime) return false;

    if (
        request.method === 'GET' &&
        requestUrl.pathname === '/oauth/client-metadata.json'
    ) {
        writeJson(response, 200, atAuthRuntime.clientMetadata);
        return true;
    }

    const authPaths = new Set([
        '/oauth/login',
        '/oauth/callback',
        '/auth/session',
        '/auth/refresh',
    ]);
    if (!authPaths.has(requestUrl.pathname)) return false;

    void (async () => {
        try {
            if (
                request.method === 'POST' &&
                requestUrl.pathname === '/oauth/login'
            ) {
                const body = await readJsonBody(request);
                const handle =
                    typeof body === 'object' &&
                    body !== null &&
                    'handle' in body &&
                    typeof body.handle === 'string' ?
                        body.handle.trim()
                    :   '';
                const returnTo =
                    typeof body === 'object' &&
                    body !== null &&
                    'returnTo' in body &&
                    typeof body.returnTo === 'string' ?
                        body.returnTo
                    :   '/';
                if (!handle) {
                    writeJson(response, 400, {
                        error: {
                            code: 'INVALID_HANDLE',
                            message: 'handle is required.',
                        },
                    });
                    return;
                }
                const result = await atAuthRuntime.service.beginLogin(
                    handle,
                    returnTo,
                );
                if (request.headers.accept?.includes('application/json')) {
                    writeJson(response, 200, result);
                    return;
                }
                response.writeHead(302, { location: result.authorizationUrl });
                response.end();
                return;
            }

            if (
                request.method === 'GET' &&
                requestUrl.pathname === '/oauth/callback'
            ) {
                const result = await atAuthRuntime.service.completeLogin(
                    requestUrl.searchParams,
                );
                const csrfToken = createCsrfToken();
                console.info(
                    JSON.stringify({
                        level: 'info',
                        event: 'oauth_callback_completed',
                    }),
                );
                response.writeHead(302, {
                    location: new URL(
                        oauthCallbackLandingPath(result.returnTo),
                        config.API_PUBLIC_ORIGIN,
                    ).toString(),
                    'set-cookie': [
                        serializeSessionCookie(
                            result.sessionToken,
                            config.NODE_ENV === 'production',
                        ),
                        serializeCsrfCookie(
                            csrfToken,
                            config.NODE_ENV === 'production',
                        ),
                    ],
                });
                response.end();
                return;
            }

            const authenticated = await authenticateApiRequest!(request);

            if (
                request.method === 'GET' &&
                requestUrl.pathname === '/auth/session'
            ) {
                writeJson(response, 200, {
                    session: {
                        ...authenticated.session,
                        role: authenticated.principal.role,
                        canManageSignupInvitations:
                            authenticated.principal.authorization.capabilities.includes(
                                'admin:system_config',
                            ),
                    },
                });
                return;
            }

            if (
                request.method === 'POST' &&
                requestUrl.pathname === '/auth/refresh'
            ) {
                const refreshed = await atAuthRuntime.service.refresh(
                    authenticated.sessionToken,
                );
                writeJson(response, 200, {
                    session: {
                        ...refreshed,
                        role: authenticated.principal.role,
                        canManageSignupInvitations:
                            authenticated.principal.authorization.capabilities.includes(
                                'admin:system_config',
                            ),
                    },
                    refreshed: true,
                });
                return;
            }

            if (
                request.method === 'DELETE' &&
                requestUrl.pathname === '/auth/session'
            ) {
                await atAuthRuntime.service.logout(authenticated.sessionToken);
                response.setHeader('set-cookie', [
                    serializeSessionCookie(
                        '',
                        config.NODE_ENV === 'production',
                        0,
                    ),
                    serializeCsrfCookie('', config.NODE_ENV === 'production', 0),
                ]);
                writeJson(
                    response,
                    200,
                    { deleted: true },
                );
                return;
            }

            response.writeHead(405, { allow: 'GET, POST, DELETE' });
            response.end();
        } catch (error) {
            if (requestUrl.pathname === '/oauth/callback') {
                console.warn(
                    JSON.stringify({
                        level: 'warn',
                        event: 'oauth_callback_failed',
                        code:
                            error instanceof AtClientError ?
                                error.code
                            :   'AUTH_ERROR',
                    }),
                );
                const callbackUrl = new URL(
                    '/auth/callback',
                    config.API_PUBLIC_ORIGIN,
                );
                callbackUrl.searchParams.set(
                    'error',
                    error instanceof AtClientError ? error.code : 'AUTH_ERROR',
                );
                response.writeHead(302, { location: callbackUrl.toString() });
                response.end();
                return;
            }
            if (error instanceof AtClientError) {
                writeAtAuthError(response, error);
                return;
            }
            writeRouteError(response, error);
        }
    })();
    return true;
};

const writeAidPostCommandError = (
    response: ServerResponse,
    error: unknown,
): void => {
    if (error instanceof IdempotencyError) {
        writeRouteError(response, error);
        return;
    }
    if (error instanceof PublicHttpError) {
        writeRouteError(response, error);
        return;
    }
    if (error instanceof AtClientError) {
        writeAtAuthError(response, error);
        return;
    }
    if (error instanceof ZodError) {
        writeJson(response, 400, {
            error: {
                code: 'INVALID_COMMAND',
                message: 'The aid-post command payload is invalid.',
            },
        });
        return;
    }
    writeJson(response, 500, {
        error: {
            code: 'AID_POST_COMMAND_ERROR',
            message: 'The aid-post command failed.',
        },
    });
};

const writeDirectoryResourceCommandError = (
    response: ServerResponse,
    error: unknown,
): void => {
    if (
        error instanceof IdempotencyError ||
        error instanceof PublicHttpError
    ) {
        writeRouteError(response, error);
        return;
    }
    if (error instanceof AtClientError) {
        writeAtAuthError(response, error);
        return;
    }
    if (error instanceof ZodError) {
        writeJson(response, 400, {
            error: {
                code: 'INVALID_COMMAND',
                message: 'The directory-resource command payload is invalid.',
            },
        });
        return;
    }
    writeJson(response, 500, {
        error: {
            code: 'DIRECTORY_RESOURCE_COMMAND_ERROR',
            message: 'The directory-resource command failed.',
        },
    });
};

const handleDurableSafetyRoute = (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!isDurableSafetyRoute(request, requestUrl)) return false;
    if (durableSafetyHandler) {
        return durableSafetyHandler(request, response, requestUrl);
    }
    writeJson(response, 503, {
        error: {
            code: 'DURABLE_CORE_UNAVAILABLE',
            message: 'Durable safety services are unavailable.',
        },
    });
    return true;
};

const handleAidPostCommandRoute = (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!createAidPostCommandService) return false;
    if (!requestUrl.pathname.startsWith('/at/aid-posts')) return false;

    void (async () => {
        try {
            const authenticated = await authenticateApiRequest!(request);
            const sessionToken = authenticated.sessionToken;
            const aidPostCommandService =
                await createAidPostCommandService(sessionToken);

            if (
                request.method === 'GET' &&
                requestUrl.pathname === '/at/aid-posts'
            ) {
                const uri = requestUrl.searchParams.get('uri');
                if (!uri) {
                    writeJson(response, 400, {
                        error: {
                            code: 'INVALID_COMMAND',
                            message: 'uri is required.',
                        },
                    });
                    return;
                }
                const result = await aidPostCommandService.get(sessionToken, uri);
                writeJson(response, 200, result);
                return;
            }

            if (
                request.method === 'POST' &&
                requestUrl.pathname === '/at/aid-posts'
            ) {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async (commandBody, idempotencyKey) => ({
                        statusCode: 201,
                        body: await aidPostCommandService.create(
                            sessionToken,
                            commandBody,
                            idempotencyKey,
                            authenticated.principal.did,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (
                request.method === 'PUT' &&
                requestUrl.pathname === '/at/aid-posts'
            ) {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async (commandBody, idempotencyKey) => ({
                        statusCode: 200,
                        body: await aidPostCommandService.update(
                            sessionToken,
                            commandBody,
                            idempotencyKey,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (
                request.method === 'POST' &&
                requestUrl.pathname === '/at/aid-posts/status/reconcile'
            ) {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async commandBody => ({
                        statusCode: 200,
                        body: await aidPostCommandService.reconcileStatus(
                            sessionToken,
                            commandBody,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (
                request.method === 'POST' &&
                requestUrl.pathname === '/at/aid-posts/close'
            ) {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async commandBody => ({
                        statusCode: 200,
                        body: await aidPostCommandService.close(
                            sessionToken,
                            commandBody,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (
                request.method === 'DELETE' &&
                requestUrl.pathname === '/at/aid-posts'
            ) {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async commandBody => {
                        await aidPostCommandService.delete(
                            sessionToken,
                            commandBody,
                        );
                        return { statusCode: 204, body: null };
                    },
                    null,
                );
                response.writeHead(result.statusCode);
                response.end();
                return;
            }

            response.writeHead(405, {
                allow: 'GET, POST, PUT, DELETE',
            });
            response.end();
        } catch (error) {
            writeAidPostCommandError(response, error);
        }
    })();
    return true;
};

const handleDirectoryResourceCommandRoute = (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!createDirectoryResourceCommandService) return false;
    if (requestUrl.pathname !== '/at/directory-resources') return false;

    void (async () => {
        try {
            const authenticated = await authenticateApiRequest!(request);
            const sessionToken = authenticated.sessionToken;
            const directoryResourceCommandService =
                await createDirectoryResourceCommandService(sessionToken);

            if (request.method === 'GET') {
                const uri = requestUrl.searchParams.get('uri');
                if (!uri) {
                    writeJson(response, 400, {
                        error: {
                            code: 'INVALID_COMMAND',
                            message: 'uri is required.',
                        },
                    });
                    return;
                }
                const result = await directoryResourceCommandService.get(
                    sessionToken,
                    uri,
                );
                writeJson(response, 200, result);
                return;
            }

            if (request.method === 'POST') {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async (commandBody, idempotencyKey) => ({
                        statusCode: 201,
                        body: await directoryResourceCommandService.create(
                            sessionToken,
                            commandBody,
                            idempotencyKey,
                            authenticated.principal.did,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (request.method === 'PUT') {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async (commandBody, idempotencyKey) => ({
                        statusCode: 200,
                        body: await directoryResourceCommandService.update(
                            sessionToken,
                            commandBody,
                            idempotencyKey,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (request.method === 'DELETE') {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    authenticated.principal.did,
                    body,
                    async commandBody => {
                        await directoryResourceCommandService.delete(
                            sessionToken,
                            commandBody,
                        );
                        return { statusCode: 204, body: null };
                    },
                    null,
                );
                response.writeHead(result.statusCode);
                response.end();
                return;
            }

            response.writeHead(405, {
                allow: 'GET, POST, PUT, DELETE',
            });
            response.end();
        } catch (error) {
            writeDirectoryResourceCommandError(response, error);
        }
    })();
    return true;
};

const handleVolunteerProfileCommandRoute = (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!createVolunteerProfileCommandService) return false;
    if (requestUrl.pathname !== '/at/volunteer-profile') return false;

    void (async () => {
        try {
            const authenticated = await authenticateApiRequest!(request);
            const sessionToken = authenticated.sessionToken;
            const ownerDid = authenticated.principal.did;
            const service =
                await createVolunteerProfileCommandService(sessionToken);

            if (request.method === 'GET') {
                const uri = requestUrl.searchParams.get('uri');
                if (!uri) {
                    writeJson(response, 400, {
                        error: {
                            code: 'INVALID_COMMAND',
                            message: 'uri is required.',
                        },
                    });
                    return;
                }
                writeJson(
                    response,
                    200,
                    await service.get(sessionToken, ownerDid, uri),
                );
                return;
            }

            if (request.method === 'POST') {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    ownerDid,
                    body,
                    async (commandBody, idempotencyKey) => ({
                        statusCode: 201,
                        body: await service.create(
                            sessionToken,
                            ownerDid,
                            commandBody,
                            idempotencyKey,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (request.method === 'PUT') {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    ownerDid,
                    body,
                    async (commandBody, idempotencyKey) => ({
                        statusCode: 200,
                        body: await service.update(
                            sessionToken,
                            ownerDid,
                            commandBody,
                            undefined,
                            idempotencyKey,
                        ),
                    }),
                    null,
                );
                writeJson(response, result.statusCode, result.body);
                return;
            }

            if (request.method === 'DELETE') {
                const body = await readJsonBody(request);
                const result = await executeIdempotentMutation(
                    request,
                    ownerDid,
                    body,
                    async commandBody => {
                        await service.delete(
                            sessionToken,
                            ownerDid,
                            commandBody,
                        );
                        return { statusCode: 204, body: null };
                    },
                    null,
                );
                response.writeHead(result.statusCode);
                response.end();
                return;
            }

            response.writeHead(405, {
                allow: 'GET, POST, PUT, DELETE',
            });
            response.end();
        } catch (error) {
            writeDirectoryResourceCommandError(response, error);
        }
    })();
    return true;
};

const moderationApiRoutes = new Map<string, 'GET' | 'POST'>([
    ['/moderation/queue', 'GET'],
    ['/moderation/policy/apply', 'POST'],
    ['/moderation/state', 'POST'],
    ['/moderation/audit', 'POST'],
]);

const handleModerationGatewayRoute = (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    const method = moderationApiRoutes.get(requestUrl.pathname);
    if (!method) return false;
    if (request.method !== method) {
        writeJson(
            response,
            405,
            { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' } },
            { allow: method },
        );
        return true;
    }
    void (async () => {
        try {
            if (!authenticateApiRequest || !moderationGateway) {
                throw new PublicHttpError(
                    503,
                    'MODERATION_SERVICE_UNAVAILABLE',
                    'The moderation service is unavailable.',
                );
            }
            const authenticated = await authenticateApiRequest(request);
            requireCapability(
                authenticated.principal.authorization,
                'moderate:content',
            );
            const result =
                method === 'GET' ?
                    await moderationGateway.readQueue(authenticated.principal.did)
                :   await executeIdempotentMutation(
                        request,
                        authenticated.principal.did,
                        await readJsonBody(request),
                        commandBody =>
                            moderationGateway.command({
                                path: requestUrl.pathname,
                                actorDid: authenticated.principal.did,
                                body: commandBody,
                            }),
                        requestUrl.pathname === '/moderation/policy/apply' ?
                            'idempotencyKey'
                        :   'commandId',
                    );
            writeJson(response, result.statusCode, result.body);
        } catch (error) {
            if (error instanceof AuthorizationError) {
                writeJson(response, error.statusCode, {
                    error: { code: error.code, message: 'Insufficient capability.' },
                });
                return;
            }
            if (error instanceof AtClientError) {
                writeAtAuthError(response, error);
                return;
            }
            writeRouteError(response, error);
        }
    })();
    return true;
};

interface ApiRouteResult {
    statusCode: number;
    body: unknown;
    contentType?: string;
}

type ApiRouteHandler = (
    requestUrl: URL,
) => ApiRouteResult | Promise<ApiRouteResult>;

const contractRoutes = [
    '/oauth/client-metadata.json',
    '/auth/signup',
    '/admin/signup-invitations',
    '/admin/signup-invitations/revoke',
    '/oauth/login',
    '/oauth/callback',
    '/auth/session',
    '/auth/refresh',
    '/at/aid-posts',
    '/at/aid-posts/close',
    '/at/aid-posts/status/reconcile',
    '/at/directory-resources',
    '/at/volunteer-profile',
    '/query/aid-post',
    '/query/directory-resource',
    '/query/map',
    '/query/feed',
    '/query/directory',
    '/query/volunteers',
    '/aid/post/transition',
    '/aid/post/lifecycle',
    '/aid/post/assign',
    '/aid/post/accept',
    '/aid/post/decline',
    '/aid/post/handoff',
    '/blocks',
    '/reports',
    '/moderation/queue',
    '/moderation/policy/apply',
    '/moderation/state',
    '/moderation/audit',
    '/account/export',
    '/account/deactivate',
    '/account/requests',
    '/account/onboarding',
    '/account/consent',
    '/account/preferences',
    '/organizations',
    '/organizations/profile',
    '/organizations/mine',
    '/organization-invitations',
    '/organization-invitations/accept',
    '/organizations/invitations',
    '/organizations/members',
    '/organizations/members/role',
    '/organizations/stewardships',
    '/organizations/stewardships/reconfirm',
    '/organizations/audit',
    '/verification/mine',
    '/verification/applications',
    '/verification/appeals',
    '/verification/review',
    '/verification/decisions',
    '/verification/appeal-decisions',
    '/verification/exact-address/requests',
    '/verification/exact-address/review',
    '/verification/exact-address/decisions',
    '/coordination/mine',
    '/coordination/offers',
    '/coordination/offer-decisions',
    '/coordination/connections',
    '/coordination/matches',
    '/coordination/windows',
    '/coordination/window-decisions',
    '/inbox',
    '/inbox/read',
    '/outcomes',
    '/outcomes/mine',
    '/groups',
    '/groups/invitations',
    '/groups/invitation-responses',
    '/groups/invitation-revocations',
    '/groups/member-removals',
    '/groups/role-changes',
    '/groups/departures',
    '/groups/ownership-transfers',
    '/groups/closures',
    '/groups/rooms',
    '/groups/room-closures',
    '/chat/conversations',
    '/chat/messages',
    '/chat/read',
    '/chat/messages/redactions',
    '/chat/reports',
    '/location/session',
    '/location/consent',
    '/location/signal',
    '/location/revoke',
    '/attachments',
    '/attachments/uploads',
    '/attachments/access',
    '/attachments/review',
    '/attachments/:attachmentId',
    '/attachments/uploads/:attachmentId',
    '/attachments/content/:attachmentId',
    '/notifications',
    '/notifications/read',
    '/notifications/read-all',
    '/notifications/archive',
    '/notifications/channels',
    '/notifications/email',
    '/notifications/email/confirm',
    '/notifications/push',
    '/internal/notifications/provider-feedback',
    '/status',
    '/maintenance',
    '/maintenance/declare',
    '/maintenance/resume',
    '/health',
    '/health/ready',
    '/metrics',
    '/contracts',
] as const;

const routeHandlers: Readonly<Record<string, ApiRouteHandler>> = {
    '/health': async () => {
        const { payload, httpStatus } = await buildHealthPayload();
        return { statusCode: httpStatus, body: payload };
    },
    '/health/ready': async () => {
        const { payload, httpStatus } = await buildReadinessPayload();
        return { statusCode: httpStatus, body: payload };
    },
    '/metrics': () => ({
        statusCode: 200,
        body: renderPrometheusMetrics(),
        contentType: 'text/plain; version=0.0.4',
    }),
    '/contracts': () => ({
        statusCode: 200,
        body: {
            contractVersion: CONTRACT_VERSION,
            routes: contractRoutes,
        },
    }),
    '/account/export': () => ({
        statusCode: 503,
        body: {
            error: {
                code: 'ACCOUNT_PRIVACY_UNAVAILABLE',
                message: 'Account privacy services are unavailable.',
            },
        },
    }),
    '/account/deactivate': () => ({
        statusCode: 503,
        body: {
            error: {
                code: 'ACCOUNT_PRIVACY_UNAVAILABLE',
                message: 'Account privacy services are unavailable.',
            },
        },
    }),
    '/aid/post/lifecycle': () => ({
        statusCode: 503,
        body: {
            error: {
                code: 'LIFECYCLE_STORE_UNAVAILABLE',
                message: 'Durable lifecycle state is unavailable.',
            },
        },
    }),
    '/query/map': requestUrl => queryService.queryMap(requestUrl.searchParams),
    '/query/feed': requestUrl =>
        queryService.queryFeed(requestUrl.searchParams),
    '/query/directory': requestUrl =>
        queryService.queryDirectory(requestUrl.searchParams),
    '/query/volunteers': requestUrl =>
        queryService.queryVolunteers(requestUrl.searchParams),
};

const readPaths = new Set([
    '/health',
    '/health/ready',
    '/metrics',
    '/contracts',
    '/query/aid-post',
    '/query/directory-resource',
    '/query/map',
    '/query/feed',
    '/query/directory',
    '/query/volunteers',
    '/account/export',
]);

const routeRouter = createMethodRouter(
    Object.entries(routeHandlers).map(([pathname, handler]) => ({
        method: readPaths.has(pathname) ? 'GET' : 'POST',
        pathname,
        handler,
    })),
);

export const createApiServer = () => {
    return createServer((request, response) => {
        ensureRequestId(response);
        const requestUrl = new URL(request.url ?? '/', 'http://localhost');
        const requestStartedAt = Date.now();
        response.once('finish', () => {
            sliCollector.recordRequest(
                requestUrl.pathname,
                Date.now() - requestStartedAt,
            );
            if (response.statusCode >= 500) {
                sliCollector.recordError(requestUrl.pathname);
            }
            sliCollector.recordHttpOutcome(requestUrl.pathname, response.statusCode);
        });

        // --- CORS headers on every response ---
        const origin = request.headers.origin as string | undefined;
        const corsHeaders = getCorsHeaders(
            origin,
            config.NODE_ENV,
            config.API_PUBLIC_ORIGIN,
        );
        for (const [key, value] of Object.entries(corsHeaders)) {
            response.setHeader(key, value);
        }
        for (const [key, value] of Object.entries(securityHeaders(config.NODE_ENV))) {
            response.setHeader(key, value);
        }

        // --- Handle OPTIONS preflight ---
        if (request.method === 'OPTIONS') {
            response.writeHead(204);
            response.end();
            return;
        }

        try {
            assertCsrfProtection(request, config.API_PUBLIC_ORIGIN);
        } catch (error) {
            writePublicError(response, error);
            return;
        }

        // --- Rate limiting ---
        const clientIp = extractClientIp(
            request.headers as Record<string, string | string[] | undefined>,
            request.socket.remoteAddress,
            config.API_TRUSTED_PROXIES,
        );
        const limiter = selectLimiter(request.method, requestUrl.pathname);
        const rateResult = limiter.check(clientIp);
        if (!rateResult.allowed) {
            const retryAfterSec = Math.ceil(rateResult.retryAfterMs / 1000);
            console.log(
                JSON.stringify({
                    level: 'warn',
                    event: 'rate_limit_exceeded',
                    clientIp,
                    pathname: requestUrl.pathname,
                    retryAfterMs: rateResult.retryAfterMs,
                }),
            );
            response.writeHead(429, {
                'content-type': 'application/json',
                'retry-after': String(retryAfterSec),
            });
            response.end(
                JSON.stringify({
                    error: {
                        code: 'RATE_LIMITED',
                        message: 'Too many requests. Please try again later.',
                        retryAfterMs: rateResult.retryAfterMs,
                    },
                }),
            );
            return;
        }

        if (handleRealAuthRoute(request, response, requestUrl)) {
            return;
        }

        if (signupInviteHandler?.(request, response, requestUrl)) {
            return;
        }
        if (isSignupInviteRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'SIGNUP_INVITATIONS_UNAVAILABLE',
                    message: 'Signup invitation management is unavailable.',
                },
            });
            return;
        }

        if (maintenanceHandler?.(request, response, requestUrl)) {
            return;
        }
        if (isMaintenanceRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'MAINTENANCE_STATE_UNAVAILABLE',
                    message: 'Service status is unavailable.',
                },
            });
            return;
        }
        if (
            maintenanceModeService?.isActive() &&
            isBlockedByMaintenance(request, requestUrl)
        ) {
            writeJson(response, 503, {
                error: {
                    code: 'MAINTENANCE_MODE_ACTIVE',
                    message:
                        maintenanceModeService.status().publicMessage,
                },
            });
            return;
        }

        if (handleAidPostCommandRoute(request, response, requestUrl)) {
            return;
        }

        if (
            handleVolunteerProfileCommandRoute(
                request,
                response,
                requestUrl,
            )
        ) {
            return;
        }

        if (
            handleDirectoryResourceCommandRoute(request, response, requestUrl)
        ) {
            return;
        }

        if (handleDurableSafetyRoute(request, response, requestUrl)) {
            return;
        }

        if (accountRequestsHandler?.(request, response, requestUrl)) return;
        if (requestUrl.pathname === '/account/requests') {
            writeJson(response, 503, { error: { code: 'ACCOUNT_REQUESTS_UNAVAILABLE', message: 'Your requests are temporarily unavailable.' } });
            return;
        }
        if (accountOnboardingHandler?.(request, response, requestUrl)) {
            return;
        }
        if (isAccountOnboardingRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'ACCOUNT_ONBOARDING_UNAVAILABLE',
                    message: 'Account onboarding is unavailable.',
                },
            });
            return;
        }

        if (accountPrivacyHandler?.(request, response, requestUrl)) {
            return;
        }

        if (organizationHandler?.(request, response, requestUrl)) {
            return;
        }

        if (verificationHandler?.(request, response, requestUrl)) {
            return;
        }
        if (coordinationSchedulingHandler?.(request, response, requestUrl)) {
            return;
        }
        if (groupHandler?.(request, response, requestUrl)) {
            return;
        }
        if (chatHandler?.(request, response, requestUrl)) {
            return;
        }
        if (coordinationHandler?.(request, response, requestUrl)) {
            return;
        }
        if (
            exactLocationSignalHandler?.(request, response, requestUrl)
        ) {
            return;
        }
        if (attachmentHandler?.(request, response, requestUrl)) {
            return;
        }
        if (notificationHandler?.(request, response, requestUrl)) {
            return;
        }
        if (isNotificationRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'NOTIFICATION_SERVICE_UNAVAILABLE',
                    message: 'Notifications are unavailable.',
                },
            });
            return;
        }
        if (isAttachmentRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'ATTACHMENT_SERVICE_UNAVAILABLE',
                    message: 'Private attachments are unavailable.',
                },
            });
            return;
        }
        if (isExactLocationSignalRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'LOCATION_SIGNAL_SERVICE_UNAVAILABLE',
                    message: 'Location exchange is unavailable.',
                },
            });
            return;
        }
        if (isCoordinationRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'COORDINATION_SERVICE_UNAVAILABLE',
                    message: 'Coordination services are unavailable.',
                },
            });
            return;
        }
        if (isCoordinationSchedulingRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'COORDINATION_SCHEDULING_UNAVAILABLE',
                    message: 'Coordination scheduling is unavailable.',
                },
            });
            return;
        }
        if (isGroupRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'GROUP_SERVICE_UNAVAILABLE',
                    message: 'Groups are unavailable.',
                },
            });
            return;
        }
        if (isChatRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'CHAT_SERVICE_UNAVAILABLE',
                    message: 'Chat is unavailable.',
                },
            });
            return;
        }
        if (isVerificationRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'VERIFICATION_SERVICE_UNAVAILABLE',
                    message: 'Verification services are unavailable.',
                },
            });
            return;
        }
        if (isOrganizationRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'ORGANIZATION_SERVICE_UNAVAILABLE',
                    message: 'Organization services are unavailable.',
                },
            });
            return;
        }
        if (isAccountPrivacyRoute(request, requestUrl)) {
            writeJson(response, 503, {
                error: {
                    code: 'ACCOUNT_PRIVACY_UNAVAILABLE',
                    message: 'Account privacy services are unavailable.',
                },
            });
            return;
        }

        if (handleModerationGatewayRoute(request, response, requestUrl)) {
            return;
        }

        if (lifecycleTransitionHandler?.(request, response, requestUrl)) {
            return;
        }

        if (discoveryHandler(request, response, requestUrl)) {
            return;
        }

        if (
            !postgresPool &&
            request.method === 'POST' &&
            requestUrl.pathname === '/aid/post/transition'
        ) {
            void readJsonBody(request)
                .then(body => lifecycleService.transitionFromBody(body))
                .then(result => {
                    writeJson(response, result.statusCode, result.body);
                })
                .catch(error => writeRouteError(response, error));
            return;
        }

        if (
            request.method === 'POST' &&
            requestUrl.pathname === '/aid/post/assign'
        ) {
            void readJsonBody(request)
                .then(async body => {
                    if (!postgresPool) return lifecycleService.assignRequest(body);
                    if (!authenticateApiRequest) {
                        throw new AtClientError(
                            'SESSION_EXPIRED',
                            'AT authentication is unavailable.',
                        );
                    }
                    const authenticated = await authenticateApiRequest(request);
                    return executeIdempotentMutation(
                        request,
                        authenticated.principal.did,
                        body,
                        commandBody =>
                            lifecycleService.assignRequest(
                                commandBody,
                                authenticated.principal.authorization,
                            ),
                    );
                })
                .then(result => {
                    writeJson(response, result.statusCode, result.body);
                })
                .catch(error => {
                    if (error instanceof AtClientError) {
                        writeAtAuthError(response, error);
                        return;
                    }
                    writeRouteError(response, error);
                });
            return;
        }

        if (
            request.method === 'POST' &&
            requestUrl.pathname === '/aid/post/accept'
        ) {
            void readJsonBody(request)
                .then(async body => {
                    if (!postgresPool) return lifecycleService.acceptAssignment(body);
                    if (!authenticateApiRequest) {
                        throw new AtClientError(
                            'SESSION_EXPIRED',
                            'AT authentication is unavailable.',
                        );
                    }
                    const authenticated = await authenticateApiRequest(request);
                    return executeIdempotentMutation(
                        request,
                        authenticated.principal.did,
                        body,
                        commandBody =>
                            lifecycleService.acceptAssignment(
                                commandBody,
                                authenticated.principal.authorization,
                            ),
                    );
                })
                .then(result => {
                    writeJson(response, result.statusCode, result.body);
                })
                .catch(error => {
                    if (error instanceof AtClientError) {
                        writeAtAuthError(response, error);
                        return;
                    }
                    writeRouteError(response, error);
                });
            return;
        }

        if (
            request.method === 'POST' &&
            requestUrl.pathname === '/aid/post/decline'
        ) {
            void readJsonBody(request)
                .then(async body => {
                    if (!postgresPool) return lifecycleService.declineAssignment(body);
                    if (!authenticateApiRequest) {
                        throw new AtClientError(
                            'SESSION_EXPIRED',
                            'AT authentication is unavailable.',
                        );
                    }
                    const authenticated = await authenticateApiRequest(request);
                    return executeIdempotentMutation(
                        request,
                        authenticated.principal.did,
                        body,
                        commandBody =>
                            lifecycleService.declineAssignment(
                                commandBody,
                                authenticated.principal.authorization,
                            ),
                    );
                })
                .then(result => {
                    writeJson(response, result.statusCode, result.body);
                })
                .catch(error => {
                    if (error instanceof AtClientError) {
                        writeAtAuthError(response, error);
                        return;
                    }
                    writeRouteError(response, error);
                });
            return;
        }

        if (
            request.method === 'POST' &&
            requestUrl.pathname === '/aid/post/handoff'
        ) {
            void readJsonBody(request)
                .then(async body => {
                    if (!postgresPool) return lifecycleService.completeHandoff(body);
                    if (!authenticateApiRequest) {
                        throw new AtClientError(
                            'SESSION_EXPIRED',
                            'AT authentication is unavailable.',
                        );
                    }
                    const authenticated = await authenticateApiRequest(request);
                    return executeIdempotentMutation(
                        request,
                        authenticated.principal.did,
                        body,
                        commandBody =>
                            lifecycleService.completeHandoff(
                                commandBody,
                                authenticated.principal.authorization,
                            ),
                    );
                })
                .then(result => {
                    writeJson(response, result.statusCode, result.body);
                })
                .catch(error => {
                    if (error instanceof AtClientError) {
                        writeAtAuthError(response, error);
                        return;
                    }
                    writeRouteError(response, error);
                });
            return;
        }

        const route = routeRouter.resolve(request.method, requestUrl.pathname);
        if (route.kind === 'method-not-allowed') {
            writeJson(
                response,
                405,
                {
                    error: {
                        code: 'METHOD_NOT_ALLOWED',
                        message: 'The requested method is not allowed for this route.',
                    },
                },
                { allow: route.allow.join(', ') },
            );
            return;
        }
        if (route.kind === 'matched') {
            void Promise.resolve()
                .then(() => route.handler(requestUrl))
                .then(result => {
                    if (result.contentType) {
                        response.writeHead(result.statusCode, {
                            'content-type': result.contentType,
                        });
                        response.end(String(result.body));
                        return;
                    }

                    writeJson(response, result.statusCode, result.body);
                })
                .catch(error => writeRouteError(response, error));
            return;
        }

        writeJson(response, 404, {
            error: {
                code: 'UNSUPPORTED_ROUTE',
                message: `Route not found: ${requestUrl.pathname}`,
            },
        });
    });
};

export const startApiServer = () => {
    const server = createApiServer();
    let retentionScheduler: RetentionScheduler | undefined;
    let organizationScheduler: RetentionScheduler | undefined;
    let verificationScheduler: RetentionScheduler | undefined;
    let coordinationScheduler: RetentionScheduler | undefined;
    let groupScheduler: RetentionScheduler | undefined;
    let chatScheduler: RetentionScheduler | undefined;
    let exactLocationScheduler: RetentionScheduler | undefined;
    let attachmentScheduler: RetentionScheduler | undefined;
    let notificationScheduler: RetentionScheduler | undefined;
    if (postgresPool) {
        const retention = new PostgresRetentionService(postgresPool);
        retentionScheduler = startRetentionScheduler({
            intervalMs: config.API_RETENTION_INTERVAL_SECONDS * 1_000,
            enforce: async () => {
                const result = await retention.enforce();
                retentionMetrics.recordSuccess();
                console.log(
                    JSON.stringify({
                        level: 'info',
                        event: 'private_retention_completed',
                        ...result,
                    }),
                );
            },
            onError: () => {
                retentionMetrics.recordFailure();
                console.error(
                    JSON.stringify({
                        level: 'error',
                        event: 'private_retention_failed',
                    }),
                );
            },
        });
        if (organizationService) {
            organizationScheduler = startRetentionScheduler({
                intervalMs: 60 * 60 * 1_000,
                enforce: async () => {
                    const result =
                        await organizationService.runReconfirmationSweep();
                    console.log(
                        JSON.stringify({
                            level: 'info',
                            event: 'organization_reconfirmation_sweep_completed',
                            ...result,
                        }),
                    );
                },
                onError: () => {
                    console.error(
                        JSON.stringify({
                            level: 'error',
                            event: 'organization_reconfirmation_sweep_failed',
                        }),
                    );
                },
            });
        }
        if (verificationCaseService) {
            verificationScheduler = startRetentionScheduler({
                intervalMs: 60 * 60 * 1_000,
                enforce: async () => {
                    const result =
                        await verificationCaseService.runExpirySweep();
                    console.log(
                        JSON.stringify({
                            level: 'info',
                            event: 'verification_expiry_sweep_completed',
                            ...result,
                        }),
                    );
                },
                onError: () => {
                    console.error(
                        JSON.stringify({
                            level: 'error',
                            event: 'verification_expiry_sweep_failed',
                        }),
                    );
                },
            });
        }
        if (coordinationService) {
            coordinationScheduler = startRetentionScheduler({
                intervalMs: 60 * 60 * 1_000,
                enforce: async () => {
                    const result =
                        await coordinationService.runExpirySweep();
                    const scheduling =
                        await coordinationSchedulingService?.runSweep();
                    console.log(
                        JSON.stringify({
                            level: 'info',
                            event: 'coordination_expiry_sweep_completed',
                            ...result,
                            scheduling,
                        }),
                    );
                },
                onError: () => {
                    console.error(
                        JSON.stringify({
                            level: 'error',
                            event: 'coordination_expiry_sweep_failed',
                        }),
                    );
                },
            });
        }
        if (durableGroupService) {
            groupScheduler = startRetentionScheduler({
                intervalMs: 60 * 60 * 1_000,
                enforce: async () => {
                    const result = await durableGroupService.runSweep();
                    console.log(JSON.stringify({
                        level: 'info',
                        event: 'group_invitation_sweep_completed',
                        ...result,
                    }));
                },
                onError: () => {
                    console.error(JSON.stringify({
                        level: 'error',
                        event: 'group_invitation_sweep_failed',
                    }));
                },
            });
        }
        if (durableChatService) {
            chatScheduler = startRetentionScheduler({
                intervalMs: 60 * 60 * 1_000,
                enforce: async () => {
                    const result = await durableChatService.runSweep();
                    console.log(JSON.stringify({
                        level: 'info',
                        event: 'chat_lifecycle_sweep_completed',
                        ...result,
                    }));
                },
                onError: () => {
                    console.error(JSON.stringify({
                        level: 'error',
                        event: 'chat_lifecycle_sweep_failed',
                    }));
                },
            });
        }
        if (exactLocationSignalService) {
            exactLocationScheduler = startRetentionScheduler({
                intervalMs: 60 * 1_000,
                enforce: async () => {
                    exactLocationSignalService.sweep();
                },
                onError: () => {
                    console.error(
                        JSON.stringify({
                            level: 'error',
                            event: 'location_signal_sweep_failed',
                        }),
                    );
                },
            });
        }
        if (attachmentService) {
            attachmentScheduler = startRetentionScheduler({
                intervalMs:
                    config.API_ATTACHMENT_INTERVAL_SECONDS * 1_000,
                enforce: async () => {
                    const scans = await attachmentService.runScanSweep();
                    const lifecycle =
                        await attachmentService.runLifecycleReconciliation();
                    const deletions =
                        await attachmentService.runDeletionSweep();
                    attachmentDeletionFailuresTotal += deletions.failed;
                    attachmentDeletionFailuresPending =
                        deletions.failedPending;
                    const orphans =
                        await attachmentService.runOrphanReconciliation();
                    const event = {
                        level:
                            deletions.failed > 0 ? 'error' : 'info',
                        event: 'attachment_pipeline_sweep_completed',
                        scans,
                        lifecycle,
                        deletions,
                        orphans,
                    };
                    if (deletions.failed > 0) {
                        console.error(JSON.stringify(event));
                    } else {
                        console.log(JSON.stringify(event));
                    }
                },
                onError: () => {
                    attachmentPipelineSweepFailuresTotal += 1;
                    console.error(
                        JSON.stringify({
                            level: 'error',
                            event: 'attachment_pipeline_sweep_failed',
                        }),
                    );
                },
            });
        }
        if (notificationService) {
            notificationScheduler = startRetentionScheduler({
                intervalMs:
                    config.API_NOTIFICATION_INTERVAL_SECONDS * 1_000,
                enforce: async () => {
                    const delivery =
                        await notificationService.runDeliverySweep();
                    const expired =
                        await notificationService.runRetentionSweep();
                    const metrics =
                        await notificationService.getOperatorMetrics();
                    notificationDeliveryPending = metrics.pending;
                    notificationDeliveryRetrying = metrics.retrying;
                    notificationDeliveryDeadLetters =
                        metrics.deadLetter;
                    notificationDeliveryOldestPendingSeconds =
                        metrics.oldestPendingSeconds;
                    const event = {
                        level:
                            delivery.failed > 0 ? 'warn' : 'info',
                        event: 'notification_delivery_sweep_completed',
                        delivery,
                        expired,
                        metrics,
                    };
                    if (delivery.failed > 0) {
                        console.warn(JSON.stringify(event));
                    } else {
                        console.log(JSON.stringify(event));
                    }
                },
                onError: () => {
                    notificationDeliverySweepFailuresTotal += 1;
                    console.error(
                        JSON.stringify({
                            level: 'error',
                            event: 'notification_delivery_sweep_failed',
                        }),
                    );
                },
            });
        }
    }
    server.listen(config.API_PORT, config.API_HOST, () => {
        console.log(
            `[api] listening on http://${config.API_HOST}:${config.API_PORT} (contracts=${CONTRACT_VERSION}, datasource=${config.API_DATA_SOURCE})`,
        );
    });
    server.once('close', () => {
        retentionScheduler?.stop();
        organizationScheduler?.stop();
        verificationScheduler?.stop();
        coordinationScheduler?.stop();
        groupScheduler?.stop();
        chatScheduler?.stop();
        exactLocationScheduler?.stop();
        attachmentScheduler?.stop();
        notificationScheduler?.stop();
    });
    return server;
};

const isExecutedDirectly =
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isExecutedDirectly) {
    const server = startApiServer();
    const shutdown = createGracefulShutdown({
        server,
        closeResources: async () => postgresPool?.end(),
    });
    process.once('SIGTERM', () => void shutdown());
    process.once('SIGINT', () => void shutdown());
}
