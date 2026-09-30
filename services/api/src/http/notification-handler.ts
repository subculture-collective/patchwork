import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DurableNotificationService } from '../durable-notification-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { readJsonBody } from './json-body.js';
import {
    PublicHttpError,
    writeJsonResponse,
    writePublicError,
} from './error-response.js';

const authenticatedRoutes = new Map<string, readonly string[]>([
    ['/notifications', ['GET']],
    ['/notifications/read', ['POST']],
    ['/notifications/read-all', ['POST']],
    ['/notifications/archive', ['POST']],
    ['/notifications/channels', ['GET']],
    ['/notifications/email', ['POST', 'DELETE']],
    ['/notifications/email/confirm', ['POST']],
    ['/notifications/push', ['POST', 'DELETE']],
]);
const providerFeedbackPath = '/internal/notifications/provider-feedback';
const notificationIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const isNotificationRoute = (
    request: IncomingMessage,
    requestUrl: URL,
): boolean =>
    authenticatedRoutes
        .get(requestUrl.pathname)
        ?.includes(request.method ?? '') ??
    (requestUrl.pathname === providerFeedbackPath &&
        request.method === 'POST');

const readString = (
    body: Record<string, unknown>,
    key: string,
): string => typeof body[key] === 'string' ? body[key].trim() : '';

const requireRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new PublicHttpError(
            400,
            'INVALID_NOTIFICATION_REQUEST',
            'The notification request body must be an object.',
        );
    }
    return value as Record<string, unknown>;
};

const secureTokenEqual = (provided: string, expected: string): boolean => {
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
};

const mapServiceError = (error: unknown): PublicHttpError | unknown => {
    if (!(error instanceof Error)) return error;
    const mapping: Record<
        string,
        { status: number; message: string }
    > = {
        INVALID_NOTIFICATION_FILTER: {
            status: 400,
            message: 'The notification filter is invalid.',
        },
        INVALID_NOTIFICATION_TYPE: {
            status: 400,
            message: 'The notification type is invalid.',
        },
        INVALID_NOTIFICATION_CURSOR: {
            status: 400,
            message: 'The notification cursor is invalid.',
        },
        INVALID_NOTIFICATION_EMAIL: {
            status: 400,
            message: 'The notification email address is invalid.',
        },
        NOTIFICATION_EMAIL_ALREADY_REGISTERED: {
            status: 409,
            message:
                'That notification email is already registered to another account.',
        },
        EMAIL_DELIVERY_UNAVAILABLE: {
            status: 503,
            message: 'Email notifications are unavailable.',
        },
        EMAIL_VERIFICATION_DELIVERY_FAILED: {
            status: 502,
            message: 'The confirmation email could not be accepted.',
        },
        PUSH_DELIVERY_UNAVAILABLE: {
            status: 503,
            message: 'Browser push is unavailable.',
        },
        INVALID_PUSH_SUBSCRIPTION: {
            status: 400,
            message: 'The push subscription is invalid.',
        },
        PUSH_OPT_IN_REQUIRED: {
            status: 409,
            message:
                'Enable browser push in notification preferences before subscribing.',
        },
        PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT: {
            status: 409,
            message:
                'That browser push subscription belongs to another account.',
        },
    };
    const mapped = mapping[error.message];
    if (!mapped && !error.message.startsWith('email-')) return error;
    return new PublicHttpError(
        mapped?.status ?? 502,
        error.message.toUpperCase().replaceAll('-', '_'),
        mapped?.message ?? 'The email provider rejected the request.',
    );
};

export const createNotificationHandler = (dependencies: {
    service: DurableNotificationService;
    authenticate(
        request: IncomingMessage,
    ): Promise<AuthenticatedRequest>;
    providerFeedbackToken?: string;
    emailProviderKind?: 'http' | 'brevo';
}) => (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!isNotificationRoute(request, requestUrl)) return false;
    void (async () => {
        try {
            response.setHeader('cache-control', 'no-store');
            if (requestUrl.pathname === providerFeedbackPath) {
                const authorization = request.headers.authorization ?? '';
                const token =
                    authorization.startsWith('Bearer ') ?
                        authorization.slice(7)
                    :   '';
                if (
                    !dependencies.providerFeedbackToken ||
                    !secureTokenEqual(
                        token,
                        dependencies.providerFeedbackToken,
                    )
                ) {
                    throw new PublicHttpError(
                        401,
                        'INVALID_PROVIDER_FEEDBACK_TOKEN',
                        'Provider feedback authentication failed.',
                    );
                }
                const body = requireRecord(await readJsonBody(request));
                if (dependencies.emailProviderKind === 'brevo' && !body['channel']) {
                    const mapped: Record<string, 'delivered' | 'bounced' | 'invalid'> = {
                        delivered: 'delivered', hard_bounce: 'bounced', hardBounce: 'bounced',
                        invalid: 'invalid', blocked: 'invalid', spam: 'invalid', unsubscribed: 'invalid',
                    };
                    const event = mapped[readString(body, 'event')];
                    if (!event) {
                        writeJsonResponse(response, 202, { accepted: true });
                        return;
                    }
                    const messageId = readString(body, 'message-id').replace(/^<|>$/g, '');
                    if (!messageId || messageId.length > 512 || /[\r\n]/u.test(messageId)) {
                        throw new PublicHttpError(400, 'INVALID_PROVIDER_FEEDBACK', 'The provider feedback payload is invalid.');
                    }
                    let accepted: boolean;
                    try {
                        accepted = await dependencies.service.recordProviderFeedback({
                            channel: 'email', providerMessageId: messageId, event,
                        });
                    } catch {
                        writeJsonResponse(response, 429, { accepted: false });
                        return;
                    }
                    // Brevo retries 429, but discards other 4xx and 5xx responses.
                    writeJsonResponse(response, accepted ? 202 : 429, { accepted });
                    return;
                }
                const channel = readString(body, 'channel');
                const providerMessageId = readString(
                    body,
                    'providerMessageId',
                );
                const event = readString(body, 'event');
                if (
                    !['email', 'push'].includes(channel) ||
                    !['delivered', 'bounced', 'invalid'].includes(event) ||
                    !providerMessageId
                ) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_PROVIDER_FEEDBACK',
                        'The provider feedback payload is invalid.',
                    );
                }
                const accepted =
                    await dependencies.service.recordProviderFeedback({
                        channel: channel as 'email' | 'push',
                        providerMessageId,
                        event: event as 'delivered' | 'bounced' | 'invalid',
                    });
                writeJsonResponse(response, accepted ? 202 : 404, {
                    accepted,
                });
                return;
            }

            const authenticated = await dependencies.authenticate(request);
            const actorDid = authenticated.principal.did;
            if (request.method === 'GET') {
                if (requestUrl.pathname === '/notifications/channels') {
                    writeJsonResponse(
                        response,
                        200,
                        await dependencies.service.getChannelState(actorDid),
                    );
                    return;
                }
                const rawLimit = requestUrl.searchParams.get('limit');
                writeJsonResponse(
                    response,
                    200,
                    await dependencies.service.list(actorDid, {
                        filter:
                            requestUrl.searchParams.get('filter') ?? undefined,
                        type:
                            requestUrl.searchParams.get('type') ?? undefined,
                        cursor:
                            requestUrl.searchParams.get('cursor') ?? undefined,
                        limit:
                            rawLimit === null ?
                                undefined
                            :   Number.parseInt(rawLimit, 10),
                    }),
                );
                return;
            }

            const body = requireRecord(await readJsonBody(request));
            if (requestUrl.pathname === '/notifications/read') {
                const notificationId = readString(body, 'notificationId');
                if (!notificationIdPattern.test(notificationId)) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_NOTIFICATION_ID',
                        'The notification identifier is invalid.',
                    );
                }
                const updated =
                    await dependencies.service.markRead(
                        actorDid,
                        notificationId,
                        body['read'] !== false,
                    );
                if (!updated) {
                    throw new PublicHttpError(
                        404,
                        'NOTIFICATION_NOT_FOUND',
                        'The notification was not found.',
                    );
                }
                writeJsonResponse(response, 200, { updated: true });
                return;
            }
            if (requestUrl.pathname === '/notifications/read-all') {
                writeJsonResponse(response, 200, {
                    updated:
                        await dependencies.service.markAllRead(actorDid),
                });
                return;
            }
            if (requestUrl.pathname === '/notifications/archive') {
                const notificationId = readString(body, 'notificationId');
                if (!notificationIdPattern.test(notificationId)) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_NOTIFICATION_ID',
                        'The notification identifier is invalid.',
                    );
                }
                const archived =
                    await dependencies.service.archive(
                        actorDid,
                        notificationId,
                    );
                if (!archived) {
                    throw new PublicHttpError(
                        404,
                        'NOTIFICATION_NOT_FOUND',
                        'The notification was not found.',
                    );
                }
                writeJsonResponse(response, 200, { archived: true });
                return;
            }
            if (requestUrl.pathname === '/notifications/email') {
                if (request.method === 'DELETE') {
                    writeJsonResponse(response, 200, {
                        disabled:
                            await dependencies.service.disableEmail(actorDid),
                    });
                    return;
                }
                writeJsonResponse(
                    response,
                    202,
                    await dependencies.service.requestEmailVerification(
                        actorDid,
                        readString(body, 'email'),
                    ),
                );
                return;
            }
            if (requestUrl.pathname === '/notifications/email/confirm') {
                const confirmed =
                    await dependencies.service.confirmEmail(
                        actorDid,
                        readString(body, 'token'),
                    );
                if (!confirmed) {
                    throw new PublicHttpError(
                        400,
                        'EMAIL_CONFIRMATION_INVALID',
                        'The email confirmation is invalid or expired.',
                    );
                }
                writeJsonResponse(response, 200, { confirmed: true });
                return;
            }
            if (request.method === 'DELETE') {
                writeJsonResponse(response, 200, {
                    revoked: await dependencies.service.revokePush(
                        actorDid,
                        readString(body, 'endpoint') || undefined,
                    ),
                });
                return;
            }
            const endpoint = readString(body, 'endpoint');
            const keys =
                body['keys'] &&
                typeof body['keys'] === 'object' &&
                !Array.isArray(body['keys']) ?
                    body['keys'] as Record<string, unknown>
                :   {};
            writeJsonResponse(
                response,
                201,
                await dependencies.service.registerPush(actorDid, {
                    endpoint,
                    p256dh: readString(keys, 'p256dh'),
                    auth: readString(keys, 'auth'),
                    userAgent: request.headers['user-agent'],
                }),
            );
        } catch (error) {
            writePublicError(response, mapServiceError(error));
        }
    })();
    return true;
};
