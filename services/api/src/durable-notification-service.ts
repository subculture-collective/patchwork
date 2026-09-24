import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import webpush from 'web-push';
import {
    NOTIFICATION_FILTERS,
    NOTIFICATION_TYPES,
    type Notification,
    type NotificationFilter,
    type NotificationPriority,
    type NotificationType,
} from '@patchwork/shared';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_LOCK_TIMEOUT_MS = 5 * 60_000;
const EMAIL_VERIFICATION_TTL_MS = 30 * 60_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const FORBIDDEN_PAYLOAD_KEY =
    /^(?:message|conversation|password|accessJwt|refreshJwt|access_token|refresh_token|exactLatitude|exactLongitude|latitude|longitude|streetAddress|contactEmail|contactPhone|privateNotes|reason|details)$/iu;

const iso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const tokenHash = (value: string): string =>
    createHash('sha256').update(value, 'utf8').digest('hex');

const safeMetadata = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const visit = (candidate: unknown): boolean => {
        if (Array.isArray(candidate)) return candidate.every(visit);
        if (!candidate || typeof candidate !== 'object') return true;
        return Object.entries(candidate).every(
            ([key, nested]) =>
                !FORBIDDEN_PAYLOAD_KEY.test(key) && visit(nested),
        );
    };
    return visit(value);
};

const notificationFilters = new Set<string>(NOTIFICATION_FILTERS);
const notificationTypes = new Set<string>(NOTIFICATION_TYPES);

interface NotificationRow {
    notification_id: string;
    recipient_did: string;
    notification_type: NotificationType;
    template_version: string;
    title: string;
    body: string;
    priority: NotificationPriority;
    action_url: string;
    metadata: Record<string, unknown>;
    deduplication_key: string;
    occurred_at: Date | string;
    updated_at: Date | string;
    read_at: Date | string | null;
    archived_at: Date | string | null;
    language?: string;
}

interface DeliveryRow {
    delivery_id: string;
    notification_id: string;
    channel: 'email' | 'push';
    target_id: string;
    provider_idempotency_key: string;
    attempt_count: number;
    title: string;
    body: string;
    action_url: string;
    email_address: string | null;
    endpoint: string | null;
    p256dh: string | null;
    auth_secret: string | null;
    language: 'en' | 'es';
    notification_type: NotificationType;
}

type NotificationCopy = Readonly<{ title: string; body: string }>;

const spanishNotificationCopy: Readonly<
    Partial<Record<NotificationType, NotificationCopy>>
> = {
    offer_received: {
        title: 'Nueva oferta',
        body: 'Alguien se ofreció a ayudar con tu solicitud.',
    },
    offer_accepted: {
        title: 'Oferta aceptada',
        body: 'Tu oferta fue aceptada. Abre la coordinación para ver los siguientes pasos.',
    },
    offer_declined: {
        title: 'Oferta rechazada',
        body: 'Tu oferta fue rechazada.',
    },
    offer_expired: {
        title: 'Oferta vencida',
        body: 'Tu oferta venció antes de ser aceptada.',
    },
    connection_started: {
        title: 'Conexión iniciada',
        body: 'Tu conexión de ayuda mutua está lista para coordinar.',
    },
    connection_completed: {
        title: 'Entrega completada',
        body: 'La entrega de ayuda mutua se marcó como completada.',
    },
    connection_cancelled: {
        title: 'Conexión cerrada',
        body: 'La conexión de ayuda mutua ya no está activa.',
    },
    lifecycle_changed: {
        title: 'Estado de solicitud actualizado',
        body: 'Tu solicitud pasó a un nuevo estado del ciclo de vida.',
    },
    verification_submitted: {
        title: 'Verificación enviada',
        body: 'Recibimos tu solicitud privada de verificación.',
    },
    verification_decided: {
        title: 'Verificación actualizada',
        body: 'Moderación actualizó tu solicitud de verificación.',
    },
    appeal_submitted: {
        title: 'Apelación recibida',
        body: 'Tu apelación de verificación espera revisión.',
    },
    appeal_decided: {
        title: 'Apelación resuelta',
        body: 'Moderación resolvió tu apelación de verificación.',
    },
    account_expiry: {
        title: 'Verificación vencida',
        body: 'Tu verificación venció y puede renovarse.',
    },
    moderation_action: {
        title: 'Estado de denuncia actualizado',
        body: 'Moderación actualizó el estado de tu denuncia.',
    },
    attachment_action: {
        title: 'Adjunto privado revisado',
        body: 'Moderación actualizó uno de tus adjuntos privados.',
    },
    organization_action: {
        title: 'Reconfirmación de recurso pendiente',
        body: 'Un recurso bajo gestión requiere reconfirmación.',
    },
    request_created: {
        title: 'Solicitud creada',
        body: 'Tu solicitud de ayuda se creó correctamente.',
    },
    request_assigned: {
        title: 'Solicitud asignada',
        body: 'Una solicitud de ayuda fue asignada para coordinación.',
    },
    assignment_accepted: {
        title: 'Asignación aceptada',
        body: 'La asignación de ayuda fue aceptada.',
    },
    assignment_declined: {
        title: 'Asignación rechazada',
        body: 'La asignación de ayuda fue rechazada.',
    },
    handoff_completed: {
        title: 'Entrega completada',
        body: 'La entrega de ayuda se marcó como completada.',
    },
    message_received: {
        title: 'Mensaje nuevo',
        body: 'Tienes un mensaje nuevo en Patchwork.',
    },
    feedback_requested: {
        title: 'Comentarios solicitados',
        body: 'Puedes registrar comentarios estructurados sobre una entrega completada.',
    },
    shift_reminder: {
        title: 'Recordatorio de turno',
        body: 'Un turno programado comienza pronto.',
    },
    shift_conflict: {
        title: 'Conflicto de turno',
        body: 'Revisa un conflicto en tu turno programado.',
    },
    shift_no_show: {
        title: 'Turno sin asistencia',
        body: 'Un turno programado requiere revisión.',
    },
    saved_discovery_changed: { title: 'Tus elementos guardados tienen novedades', body: 'Abre Mi actividad para revisar los cambios en tus elementos guardados.' },
    system_announcement: {
        title: 'Anuncio de Patchwork',
        body: 'Hay una actualización del servicio disponible.',
    },
    schedule_proposed: {
        title: 'Agenda de coordinación actualizada',
        body: 'Abre tu conexión para revisar el estado de la agenda.',
    },
    schedule_changed: {
        title: 'Agenda de coordinación actualizada',
        body: 'Abre tu conexión para revisar el estado de la agenda.',
    },
    schedule_confirmed: {
        title: 'Agenda de coordinación actualizada',
        body: 'Abre tu conexión para revisar el estado de la agenda.',
    },
    schedule_declined: {
        title: 'Agenda de coordinación actualizada',
        body: 'Abre tu conexión para revisar el estado de la agenda.',
    },
    schedule_cancelled: {
        title: 'Agenda de coordinación actualizada',
        body: 'Abre tu conexión para revisar el estado de la agenda.',
    },
    schedule_reminder: {
        title: 'Recordatorio de coordinación',
        body: 'Una ventana de coordinación confirmada comienza pronto.',
    },
    schedule_expired: {
        title: 'Ventana de coordinación vencida',
        body: 'Abre tu conexión para revisar el estado de la agenda.',
    },
    group_invited: {
        title: 'Invitación a un grupo',
        body: 'Tienes una nueva invitación a un grupo.',
    },
    group_joined: {
        title: 'Una persona se unió a tu grupo',
        body: 'Abre el grupo para revisar sus miembros.',
    },
    group_removed: {
        title: 'Membresía de grupo finalizada',
        body: 'Ya no tienes acceso a este grupo.',
    },
    group_role_changed: {
        title: 'Rol de grupo actualizado',
        body: 'Abre el grupo para revisar tu rol actual.',
    },
    group_closed: {
        title: 'Grupo cerrado',
        body: 'Se cerró un grupo al que pertenecías.',
    },
};

export const localizedNotificationCopy = (
    type: NotificationType,
    locale: string | null | undefined,
    fallback: NotificationCopy,
): NotificationCopy =>
    locale === 'es' ? (spanishNotificationCopy[type] ?? fallback) : fallback;

export interface NotificationListResult {
    items: Notification[];
    total: number;
    unread: number;
    nextCursor?: string;
}

export interface DeliveryProviderResult {
    accepted: boolean;
    delivered?: boolean;
    providerMessageId?: string;
    retryable?: boolean;
    invalidTarget?: boolean;
    errorCode?: string;
}

export interface EmailProvider {
    send(input: {
        to: string;
        subject: string;
        text: string;
        idempotencyKey: string;
    }): Promise<DeliveryProviderResult>;
}

export interface PushProvider {
    send(input: {
        endpoint: string;
        p256dh: string;
        auth: string;
        payload: string;
        idempotencyKey: string;
    }): Promise<DeliveryProviderResult>;
}

export class HttpEmailProvider implements EmailProvider {
    constructor(
        private readonly endpoint: string,
        private readonly bearerToken: string,
        private readonly fromAddress: string,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    async send(input: {
        to: string;
        subject: string;
        text: string;
        idempotencyKey: string;
    }): Promise<DeliveryProviderResult> {
        try {
            const response = await this.fetchImpl(this.endpoint, {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    authorization: `Bearer ${this.bearerToken}`,
                    'content-type': 'application/json',
                    'idempotency-key': input.idempotencyKey,
                },
                body: JSON.stringify({
                    from: this.fromAddress,
                    to: input.to,
                    subject: input.subject,
                    text: input.text,
                }),
                signal: AbortSignal.timeout(10_000),
            });
            const payload = (await response.json().catch(() => null)) as Record<
                string,
                unknown
            > | null;
            const providerMessageId =
                typeof payload?.['id'] === 'string' ? payload['id'] : undefined;
            if (response.ok) {
                return { accepted: true, providerMessageId };
            }
            if (
                response.status === 400 ||
                response.status === 404 ||
                response.status === 422
            ) {
                return {
                    accepted: false,
                    invalidTarget: true,
                    errorCode: `email-http-${response.status}`,
                };
            }
            return {
                accepted: false,
                retryable:
                    response.status === 408 ||
                    response.status === 429 ||
                    response.status >= 500,
                errorCode: `email-http-${response.status}`,
            };
        } catch (error) {
            return {
                accepted: false,
                retryable: true,
                errorCode:
                    error instanceof Error && error.name === 'TimeoutError'
                        ? 'email-timeout'
                        : 'email-network',
            };
        }
    }
}

export class VapidPushProvider implements PushProvider {
    constructor(input: {
        subject: string;
        publicKey: string;
        privateKey: string;
    }) {
        webpush.setVapidDetails(
            input.subject,
            input.publicKey,
            input.privateKey,
        );
    }

    async send(input: {
        endpoint: string;
        p256dh: string;
        auth: string;
        payload: string;
        idempotencyKey: string;
    }): Promise<DeliveryProviderResult> {
        try {
            const response = await webpush.sendNotification(
                {
                    endpoint: input.endpoint,
                    keys: { p256dh: input.p256dh, auth: input.auth },
                },
                input.payload,
                {
                    TTL: 300,
                    urgency: 'normal',
                    topic: createHash('sha256')
                        .update(input.idempotencyKey)
                        .digest('base64url')
                        .slice(0, 32),
                },
            );
            return {
                accepted: true,
                providerMessageId:
                    response.headers.location ??
                    response.headers['x-request-id'],
            };
        } catch (error) {
            const statusCode =
                typeof error === 'object' &&
                error !== null &&
                'statusCode' in error &&
                typeof error.statusCode === 'number'
                    ? error.statusCode
                    : 0;
            if (statusCode === 404 || statusCode === 410) {
                return {
                    accepted: false,
                    invalidTarget: true,
                    errorCode: `push-http-${statusCode}`,
                };
            }
            return {
                accepted: false,
                retryable:
                    statusCode === 0 ||
                    statusCode === 408 ||
                    statusCode === 429 ||
                    statusCode >= 500,
                errorCode: statusCode
                    ? `push-http-${statusCode}`
                    : 'push-network',
            };
        }
    }
}

export class DurableNotificationService {
    constructor(
        private readonly pool: Pool,
        private readonly providers: {
            email?: EmailProvider;
            push?: PushProvider;
        } = {},
        private readonly options: {
            publicWebOrigin?: string;
        } = {},
    ) {}

    async list(
        ownerDid: string,
        input: {
            filter?: string;
            type?: string;
            cursor?: string;
            limit?: number;
        } = {},
    ): Promise<NotificationListResult> {
        const filter =
            input.filter && notificationFilters.has(input.filter)
                ? (input.filter as NotificationFilter)
                : 'all';
        if (input.filter && !notificationFilters.has(input.filter)) {
            throw new Error('INVALID_NOTIFICATION_FILTER');
        }
        if (input.type && !notificationTypes.has(input.type)) {
            throw new Error('INVALID_NOTIFICATION_TYPE');
        }
        if (input.cursor && !UUID_PATTERN.test(input.cursor)) {
            throw new Error('INVALID_NOTIFICATION_CURSOR');
        }
        const limit = Math.min(
            MAX_PAGE_SIZE,
            Math.max(1, Math.trunc(input.limit ?? DEFAULT_PAGE_SIZE)),
        );
        const predicates = ['recipient_did = $1'];
        const parameters: unknown[] = [ownerDid];
        if (filter === 'all') predicates.push('archived_at IS NULL');
        if (filter === 'unread') {
            predicates.push('archived_at IS NULL', 'read_at IS NULL');
        }
        if (filter === 'read') {
            predicates.push('archived_at IS NULL', 'read_at IS NOT NULL');
        }
        if (filter === 'archived') predicates.push('archived_at IS NOT NULL');
        if (input.type) {
            parameters.push(input.type);
            predicates.push(`notification_type = $${parameters.length}`);
        }
        if (input.cursor) {
            parameters.push(input.cursor);
            predicates.push(
                `(occurred_at, notification_id) < (
                    SELECT occurred_at, notification_id
                      FROM notification_intents
                     WHERE notification_id = $${parameters.length}
                       AND recipient_did = $1
                )`,
            );
        }
        parameters.push(limit + 1);
        const rows = await this.pool.query<NotificationRow>(
            `SELECT notification_id, recipient_did, notification_type,
                    template_version, title, body, priority, action_url,
                    metadata, deduplication_key, occurred_at, updated_at,
                    read_at, archived_at,
                    COALESCE((SELECT language FROM account_preferences
                              WHERE did = $1), 'en') AS language
               FROM notification_intents
              WHERE ${predicates.join(' AND ')}
              ORDER BY occurred_at DESC, notification_id DESC
              LIMIT $${parameters.length}`,
            parameters,
        );
        const page = rows.rows.slice(0, limit);
        const counts = await this.pool.query<{
            total: string;
            unread: string;
        }>(
            `SELECT
                COUNT(*) FILTER (WHERE archived_at IS NULL)::text AS total,
                COUNT(*) FILTER (
                    WHERE archived_at IS NULL AND read_at IS NULL
                )::text AS unread
               FROM notification_intents
              WHERE recipient_did = $1`,
            [ownerDid],
        );
        return {
            items: page.map((row) => this.render(row, row.language ?? 'en')),
            total: Number(counts.rows[0]?.total ?? 0),
            unread: Number(counts.rows[0]?.unread ?? 0),
            ...(rows.rows.length > limit && page.length
                ? { nextCursor: page[page.length - 1]!.notification_id }
                : {}),
        };
    }

    async markRead(ownerDid: string, notificationId: string, read: boolean) {
        const result = await this.pool.query(
            `UPDATE notification_intents
                SET read_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
                    updated_at = NOW()
              WHERE recipient_did = $1 AND notification_id = $2
                AND archived_at IS NULL`,
            [ownerDid, notificationId, read],
        );
        return result.rowCount === 1;
    }

    async markAllRead(ownerDid: string): Promise<number> {
        const result = await this.pool.query(
            `UPDATE notification_intents
                SET read_at = NOW(), updated_at = NOW()
              WHERE recipient_did = $1 AND archived_at IS NULL
                AND read_at IS NULL`,
            [ownerDid],
        );
        return result.rowCount ?? 0;
    }

    async archive(ownerDid: string, notificationId: string) {
        const result = await this.pool.query(
            `UPDATE notification_intents
                SET archived_at = NOW(), updated_at = NOW()
              WHERE recipient_did = $1 AND notification_id = $2
                AND archived_at IS NULL`,
            [ownerDid, notificationId],
        );
        return result.rowCount === 1;
    }

    async getChannelState(ownerDid: string) {
        const [preferences, email, push] = await Promise.all([
            this.pool.query<{ notifications: unknown }>(
                `SELECT notifications
                   FROM account_preferences
                  WHERE did = $1`,
                [ownerDid],
            ),
            this.pool.query<{
                email_address: string;
                verified_at: Date | string | null;
                disabled_at: Date | string | null;
            }>(
                `SELECT email_address, verified_at, disabled_at
                   FROM notification_email_endpoints
                  WHERE owner_did = $1`,
                [ownerDid],
            ),
            this.pool.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count
                   FROM notification_push_subscriptions
                  WHERE owner_did = $1 AND revoked_at IS NULL`,
                [ownerDid],
            ),
        ]);
        const configured = this.parsePreferences(
            preferences.rows[0]?.notifications,
        );
        return {
            preferences: configured,
            email: email.rows[0]
                ? {
                      address: email.rows[0].email_address,
                      verified: Boolean(
                          email.rows[0].verified_at &&
                          !email.rows[0].disabled_at,
                      ),
                  }
                : null,
            push: {
                supported: Boolean(this.providers.push),
                publicKey: process.env['NOTIFICATION_VAPID_PUBLIC_KEY'] ?? null,
                activeSubscriptions: Number(push.rows[0]?.count ?? 0),
            },
        };
    }

    async requestEmailVerification(
        ownerDid: string,
        emailAddress: string,
        now = new Date(),
    ) {
        const email = emailAddress.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(email) || email.length > 320) {
            throw new Error('INVALID_NOTIFICATION_EMAIL');
        }
        if (!this.providers.email || !this.options.publicWebOrigin) {
            throw new Error('EMAIL_DELIVERY_UNAVAILABLE');
        }
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS);
        try {
            await this.pool.query(
                `INSERT INTO notification_email_endpoints (
                    endpoint_id, owner_did, email_address,
                    verification_token_hash, verification_expires_at,
                    verified_at, disabled_at, created_at, updated_at
                 ) VALUES (
                    gen_random_uuid(), $1, $2, $3, $4, NULL, NULL, $5, $5
                 )
                 ON CONFLICT (owner_did) DO UPDATE SET
                    email_address = EXCLUDED.email_address,
                    verification_token_hash =
                        EXCLUDED.verification_token_hash,
                    verification_expires_at =
                        EXCLUDED.verification_expires_at,
                    verified_at = NULL,
                    disabled_at = NULL,
                    updated_at = EXCLUDED.updated_at`,
                [ownerDid, email, tokenHash(token), expiresAt, now],
            );
        } catch (error) {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === '23505'
            ) {
                throw new Error('NOTIFICATION_EMAIL_ALREADY_REGISTERED');
            }
            throw error;
        }
        const result = await this.providers.email.send({
            to: email,
            subject: 'Confirm Patchwork notification email',
            text:
                'Confirm this address while signed in to Patchwork: ' +
                `${this.options.publicWebOrigin}/notifications?emailToken=${encodeURIComponent(token)}`,
            idempotencyKey: `email-verification:${ownerDid}:${tokenHash(token)}`,
        });
        if (!result.accepted) {
            throw new Error(
                result.errorCode ?? 'EMAIL_VERIFICATION_DELIVERY_FAILED',
            );
        }
        return { expiresAt: expiresAt.toISOString() };
    }

    async confirmEmail(ownerDid: string, token: string, now = new Date()) {
        const result = await this.pool.query(
            `UPDATE notification_email_endpoints
                SET verified_at = $3, verification_token_hash = NULL,
                    verification_expires_at = NULL, disabled_at = NULL,
                    updated_at = $3
              WHERE owner_did = $1
                AND verification_token_hash = $2
                AND verification_expires_at > $3`,
            [ownerDid, tokenHash(token), now],
        );
        return result.rowCount === 1;
    }

    async disableEmail(ownerDid: string) {
        const result = await this.pool.query(
            `UPDATE notification_email_endpoints
                SET disabled_at = NOW(), verification_token_hash = NULL,
                    verification_expires_at = NULL, updated_at = NOW()
              WHERE owner_did = $1 AND disabled_at IS NULL`,
            [ownerDid],
        );
        return result.rowCount === 1;
    }

    async registerPush(
        ownerDid: string,
        input: {
            endpoint: string;
            p256dh: string;
            auth: string;
            userAgent?: string;
        },
        now = new Date(),
    ) {
        if (!this.providers.push) throw new Error('PUSH_DELIVERY_UNAVAILABLE');
        if (
            !input.endpoint.startsWith('https://') ||
            input.endpoint.length > 2048 ||
            input.p256dh.length < 20 ||
            input.p256dh.length > 200 ||
            input.auth.length < 8 ||
            input.auth.length > 200
        ) {
            throw new Error('INVALID_PUSH_SUBSCRIPTION');
        }
        const preferences = await this.pool.query<{ notifications: unknown }>(
            'SELECT notifications FROM account_preferences WHERE did = $1',
            [ownerDid],
        );
        if (!this.parsePreferences(preferences.rows[0]?.notifications).push) {
            throw new Error('PUSH_OPT_IN_REQUIRED');
        }
        const userAgentHash = input.userAgent
            ? createHash('sha256').update(input.userAgent).digest('hex')
            : null;
        const result = await this.pool.query<{ subscription_id: string }>(
            `INSERT INTO notification_push_subscriptions (
                subscription_id, owner_did, endpoint, p256dh, auth_secret,
                user_agent_hash, created_at, updated_at, revoked_at,
                invalid_reason_code
             ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4, $5, $6, $6, NULL, NULL
             )
             ON CONFLICT (endpoint) DO UPDATE SET
                p256dh = EXCLUDED.p256dh,
                auth_secret = EXCLUDED.auth_secret,
                user_agent_hash = EXCLUDED.user_agent_hash,
                updated_at = EXCLUDED.updated_at,
                revoked_at = NULL,
                invalid_reason_code = NULL
             WHERE notification_push_subscriptions.owner_did =
                   EXCLUDED.owner_did
             RETURNING subscription_id`,
            [
                ownerDid,
                input.endpoint,
                input.p256dh,
                input.auth,
                userAgentHash,
                now,
            ],
        );
        if (!result.rows[0]) {
            throw new Error('PUSH_SUBSCRIPTION_OWNERSHIP_CONFLICT');
        }
        return { id: result.rows[0]!.subscription_id };
    }

    async revokePush(ownerDid: string, endpoint?: string) {
        const result = await this.pool.query(
            `UPDATE notification_push_subscriptions
                SET revoked_at = NOW(), invalid_reason_code = 'user-revoked',
                    updated_at = NOW()
              WHERE owner_did = $1 AND revoked_at IS NULL
                AND ($2::text IS NULL OR endpoint = $2)`,
            [ownerDid, endpoint ?? null],
        );
        return result.rowCount ?? 0;
    }

    async materializeChannels(batchSize = 100): Promise<number> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const intents = await client.query<{
                notification_id: string;
                recipient_did: string;
                notifications: unknown;
            }>(
                `SELECT n.notification_id, n.recipient_did, p.notifications
                   FROM notification_intents n
                   LEFT JOIN account_preferences p
                     ON p.did = n.recipient_did
                  WHERE n.channels_materialized_at IS NULL
                  ORDER BY n.created_at, n.notification_id
                  FOR UPDATE OF n SKIP LOCKED
                  LIMIT $1`,
                [batchSize],
            );
            for (const intent of intents.rows) {
                const preferences = this.parsePreferences(intent.notifications);
                if (preferences.email && this.providers.email) {
                    const targets = await client.query<{ endpoint_id: string }>(
                        `SELECT endpoint_id
                           FROM notification_email_endpoints
                          WHERE owner_did = $1 AND verified_at IS NOT NULL
                            AND disabled_at IS NULL`,
                        [intent.recipient_did],
                    );
                    for (const target of targets.rows) {
                        await this.insertDelivery(
                            client,
                            intent.notification_id,
                            'email',
                            target.endpoint_id,
                        );
                    }
                }
                if (preferences.push && this.providers.push) {
                    const targets = await client.query<{
                        subscription_id: string;
                    }>(
                        `SELECT subscription_id
                           FROM notification_push_subscriptions
                          WHERE owner_did = $1 AND revoked_at IS NULL`,
                        [intent.recipient_did],
                    );
                    for (const target of targets.rows) {
                        await this.insertDelivery(
                            client,
                            intent.notification_id,
                            'push',
                            target.subscription_id,
                        );
                    }
                }
                await client.query(
                    `UPDATE notification_intents
                        SET channels_materialized_at = NOW(), updated_at = NOW()
                      WHERE notification_id = $1`,
                    [intent.notification_id],
                );
            }
            await client.query('COMMIT');
            return intents.rowCount ?? 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async ingestModerationUrgentEvents(batchSize = 100): Promise<number> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const available = await client.query<{ table_name: string | null }>(
                `SELECT to_regclass('moderation_notification_events')::text
                        AS table_name`,
            );
            if (!available.rows[0]?.table_name) {
                await client.query('COMMIT');
                return 0;
            }
            const moderators = await client.query<{ did: string }>(
                `SELECT did FROM platform_roles
                  WHERE role IN ('moderator', 'admin')
                  ORDER BY did`,
            );
            if (moderators.rows.length === 0) {
                await client.query('COMMIT');
                return 0;
            }
            const events = await client.query<{
                event_id: string;
                deduplication_key: string;
                created_at: Date | string;
            }>(
                `SELECT event_id, deduplication_key, created_at
                   FROM moderation_notification_events
                  WHERE consumed_at IS NULL
                  ORDER BY created_at, event_id
                  FOR UPDATE SKIP LOCKED
                  LIMIT $1`,
                [batchSize],
            );
            for (const event of events.rows) {
                for (const moderator of moderators.rows) {
                    await client.query(
                        `SELECT patchwork_enqueue_notification(
                            $1, 'moderation_action',
                            'Urgent moderation review',
                            'A high-risk submission is waiting for moderator review.',
                            'urgent', '/moderation', '{}'::jsonb,
                            $2, $3
                         )`,
                        [
                            moderator.did,
                            `${event.deduplication_key}:${moderator.did}`,
                            event.created_at,
                        ],
                    );
                }
                await client.query(
                    `UPDATE moderation_notification_events
                        SET consumed_at = NOW()
                      WHERE event_id = $1`,
                    [event.event_id],
                );
            }
            await client.query('COMMIT');
            return events.rowCount ?? 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async runDeliverySweep(
        batchSize = 50,
    ): Promise<{ processed: number; delivered: number; failed: number }> {
        await this.ingestModerationUrgentEvents();
        await this.materializeChannels();
        const staleBefore = new Date(Date.now() - DELIVERY_LOCK_TIMEOUT_MS);
        await this.pool.query(
            `UPDATE notification_delivery_attempts
                SET status = 'retry', locked_at = NULL,
                    next_attempt_at = NOW(), updated_at = NOW(),
                    last_error_code = 'worker-lock-expired'
              WHERE status = 'processing' AND locked_at < $1`,
            [staleBefore],
        );
        const claimed = await this.pool.query<DeliveryRow>(
            `WITH candidates AS (
                SELECT delivery_id
                  FROM notification_delivery_attempts
                 WHERE status IN ('pending', 'retry')
                   AND next_attempt_at <= NOW()
                 ORDER BY next_attempt_at, created_at, delivery_id
                 FOR UPDATE SKIP LOCKED
                 LIMIT $1
             ),
             claimed AS (
                UPDATE notification_delivery_attempts d
                   SET status = 'processing', locked_at = NOW(),
                       attempt_count = attempt_count + 1,
                       updated_at = NOW()
                  FROM candidates c
                 WHERE d.delivery_id = c.delivery_id
                 RETURNING d.*
             )
             SELECT c.delivery_id, c.notification_id, c.channel, c.target_id,
                    c.provider_idempotency_key, c.attempt_count,
                    n.title, n.body, n.action_url, n.notification_type,
                    COALESCE(pref.language, 'en') AS language,
                    e.email_address, p.endpoint, p.p256dh,
                    p.auth_secret
               FROM claimed c
               JOIN notification_intents n
                 ON n.notification_id = c.notification_id
               LEFT JOIN account_preferences pref
                 ON pref.did = n.recipient_did
               LEFT JOIN notification_email_endpoints e
                 ON c.channel = 'email' AND e.endpoint_id = c.target_id
               LEFT JOIN notification_push_subscriptions p
                 ON c.channel = 'push' AND p.subscription_id = c.target_id`,
            [batchSize],
        );
        let delivered = 0;
        let failed = 0;
        for (const delivery of claimed.rows) {
            const result = await this.deliver(delivery);
            if (result.accepted) {
                delivered += 1;
                await this.pool.query(
                    `UPDATE notification_delivery_attempts
                        SET status = $2, provider_message_id = $3,
                            sent_at = NOW(),
                            delivered_at = CASE WHEN $2 = 'delivered'
                                THEN NOW() ELSE delivered_at END,
                            locked_at = NULL, last_error_code = NULL,
                            updated_at = NOW()
                      WHERE delivery_id = $1`,
                    [
                        delivery.delivery_id,
                        result.delivered ? 'delivered' : 'sent',
                        result.providerMessageId ?? null,
                    ],
                );
                continue;
            }
            failed += 1;
            if (result.invalidTarget) {
                await this.invalidateTarget(delivery, result.errorCode);
                await this.pool.query(
                    `UPDATE notification_delivery_attempts
                        SET status = 'skipped', locked_at = NULL,
                            last_error_code = $2, updated_at = NOW()
                      WHERE delivery_id = $1`,
                    [
                        delivery.delivery_id,
                        result.errorCode ?? 'invalid-target',
                    ],
                );
                continue;
            }
            const retry =
                result.retryable &&
                delivery.attempt_count < MAX_DELIVERY_ATTEMPTS;
            const delaySeconds = Math.min(
                3_600,
                30 * 2 ** Math.max(0, delivery.attempt_count - 1),
            );
            await this.pool.query(
                `UPDATE notification_delivery_attempts
                    SET status = $2, locked_at = NULL,
                        next_attempt_at = CASE WHEN $2 = 'retry'
                            THEN NOW() + ($3 * INTERVAL '1 second')
                            ELSE next_attempt_at END,
                        dead_lettered_at = CASE WHEN $2 = 'dead-letter'
                            THEN NOW() ELSE NULL END,
                        last_error_code = $4, updated_at = NOW()
                  WHERE delivery_id = $1`,
                [
                    delivery.delivery_id,
                    retry ? 'retry' : 'dead-letter',
                    delaySeconds,
                    result.errorCode ?? 'provider-rejected',
                ],
            );
        }
        return { processed: claimed.rows.length, delivered, failed };
    }

    async recordProviderFeedback(input: {
        channel: 'email' | 'push';
        providerMessageId: string;
        event: 'delivered' | 'bounced' | 'invalid';
    }) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const delivery = await client.query<{
                delivery_id: string;
                target_id: string;
            }>(
                `SELECT delivery_id, target_id
                   FROM notification_delivery_attempts
                  WHERE channel = $1 AND provider_message_id = $2
                  FOR UPDATE`,
                [input.channel, input.providerMessageId],
            );
            const row = delivery.rows[0];
            if (!row) {
                await client.query('ROLLBACK');
                return false;
            }
            if (input.event === 'delivered') {
                await client.query(
                    `UPDATE notification_delivery_attempts
                        SET status = 'delivered', delivered_at = NOW(),
                            updated_at = NOW()
                      WHERE delivery_id = $1`,
                    [row.delivery_id],
                );
            } else {
                if (input.channel === 'email') {
                    await client.query(
                        `UPDATE notification_email_endpoints
                            SET disabled_at = NOW(),
                                updated_at = NOW()
                          WHERE endpoint_id = $1`,
                        [row.target_id],
                    );
                } else {
                    await client.query(
                        `UPDATE notification_push_subscriptions
                            SET revoked_at = NOW(),
                                invalid_reason_code = $2,
                                updated_at = NOW()
                          WHERE subscription_id = $1`,
                        [row.target_id, input.event],
                    );
                }
                await client.query(
                    `UPDATE notification_delivery_attempts
                        SET status = 'skipped', last_error_code = $2,
                            updated_at = NOW()
                      WHERE delivery_id = $1`,
                    [row.delivery_id, `provider-${input.event}`],
                );
            }
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getOperatorMetrics() {
        const result = await this.pool.query<{
            pending: string;
            retrying: string;
            dead_letter: string;
            oldest_pending_seconds: string;
        }>(
            `SELECT
                COUNT(*) FILTER (
                    WHERE status = 'pending'
                )::text AS pending,
                COUNT(*) FILTER (
                    WHERE status = 'retry'
                )::text AS retrying,
                COUNT(*) FILTER (
                    WHERE status = 'dead-letter'
                )::text AS dead_letter,
                COALESCE(EXTRACT(EPOCH FROM (
                    NOW() - MIN(created_at) FILTER (
                        WHERE status IN ('pending', 'retry')
                    )
                )), 0)::text AS oldest_pending_seconds
               FROM notification_delivery_attempts`,
        );
        const row = result.rows[0]!;
        return {
            pending: Number(row.pending),
            retrying: Number(row.retrying),
            deadLetter: Number(row.dead_letter),
            oldestPendingSeconds: Number(row.oldest_pending_seconds),
        };
    }

    async runRetentionSweep(now = new Date()) {
        const result = await this.pool.query(
            `DELETE FROM notification_intents WHERE retention_until <= $1`,
            [now],
        );
        await this.pool.query(
            `DELETE FROM notification_email_endpoints
              WHERE verified_at IS NULL
                AND verification_expires_at <= $1`,
            [now],
        );
        return result.rowCount ?? 0;
    }

    private readonly render = (
        row: NotificationRow,
        locale = 'en',
    ): Notification => {
        const copy = localizedNotificationCopy(row.notification_type, locale, {
            title: row.title,
            body: row.body,
        });
        return {
            id: row.notification_id,
            type: row.notification_type,
            recipientDid: row.recipient_did,
            title: copy.title,
            body: copy.body,
            priority: row.priority,
            read: Boolean(row.read_at),
            archived: Boolean(row.archived_at),
            actionUrl: row.action_url,
            metadata: safeMetadata(row.metadata) ? row.metadata : {},
            templateVersion: row.template_version,
            deduplicationKey: row.deduplication_key,
            createdAt: iso(row.occurred_at),
            updatedAt: iso(row.updated_at),
        };
    };

    private parsePreferences(value: unknown): {
        inApp: boolean;
        email: boolean;
        push: boolean;
    } {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { inApp: true, email: false, push: false };
        }
        const record = value as Record<string, unknown>;
        return {
            inApp: record['inApp'] !== false,
            email: record['email'] === true,
            push: record['push'] === true,
        };
    }

    private async insertDelivery(
        client: PoolClient,
        notificationId: string,
        channel: 'email' | 'push',
        targetId: string,
    ) {
        await client.query(
            `INSERT INTO notification_delivery_attempts (
                delivery_id, notification_id, channel, target_id,
                provider_idempotency_key, status, attempt_count,
                next_attempt_at, created_at, updated_at
             ) VALUES (
                gen_random_uuid(), $1::uuid, $2::text, $3::uuid,
                $1::text || ':' || $2::text || ':' || $3::text,
                'pending', 0, NOW(), NOW(), NOW()
             )
             ON CONFLICT (notification_id, channel, target_id) DO NOTHING`,
            [notificationId, channel, targetId],
        );
    }

    private async deliver(
        delivery: DeliveryRow,
    ): Promise<DeliveryProviderResult> {
        const copy = localizedNotificationCopy(
            delivery.notification_type,
            delivery.language,
            { title: delivery.title, body: delivery.body },
        );
        if (delivery.channel === 'email') {
            if (!this.providers.email || !delivery.email_address) {
                return {
                    accepted: false,
                    invalidTarget: true,
                    errorCode: 'email-target-unavailable',
                };
            }
            return this.providers.email.send({
                to: delivery.email_address,
                subject: copy.title,
                text: `${copy.body}\n\n${this.options.publicWebOrigin ?? ''}${delivery.action_url}`,
                idempotencyKey: delivery.provider_idempotency_key,
            });
        }
        if (
            !this.providers.push ||
            !delivery.endpoint ||
            !delivery.p256dh ||
            !delivery.auth_secret
        ) {
            return {
                accepted: false,
                invalidTarget: true,
                errorCode: 'push-target-unavailable',
            };
        }
        return this.providers.push.send({
            endpoint: delivery.endpoint,
            p256dh: delivery.p256dh,
            auth: delivery.auth_secret,
            idempotencyKey: delivery.provider_idempotency_key,
            payload: JSON.stringify({
                title: copy.title,
                body: copy.body,
                actionUrl: delivery.action_url,
            }),
        });
    }

    private async invalidateTarget(delivery: DeliveryRow, errorCode?: string) {
        if (delivery.channel === 'email') {
            await this.pool.query(
                `UPDATE notification_email_endpoints
                    SET disabled_at = NOW(), updated_at = NOW()
                  WHERE endpoint_id = $1`,
                [delivery.target_id],
            );
            return;
        }
        await this.pool.query(
            `UPDATE notification_push_subscriptions
                SET revoked_at = NOW(), invalid_reason_code = $2,
                    updated_at = NOW()
              WHERE subscription_id = $1`,
            [delivery.target_id, errorCode ?? 'invalid-subscription'],
        );
    }
}
