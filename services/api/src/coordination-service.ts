import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { capabilitySupportsAidCategory } from '@patchwork/shared';
import { PublicHttpError } from './http/error-response.js';

const requestUriSchema = z
    .string()
    .regex(/^at:\/\/did:[^/]+\/app\.patchwork\.aid\.post\/[^/]+$/);
const offerSchema = z
    .object({
        requestUri: requestUriSchema,
        note: z.string().trim().max(1000).nullable(),
    })
    .strict();
const offerDecisionSchema = z
    .object({
        offerId: z.string().uuid(),
        decision: z.enum(['accept', 'decline', 'cancel']),
    })
    .strict();
const connectionDecisionSchema = z
    .object({
        connectionId: z.string().uuid(),
        action: z.enum(['complete', 'cancel']),
    })
    .strict();
const feedbackSchema = z
    .object({
        connectionId: z.string().uuid(),
        outcome: z.enum([
            'successful',
            'partially-successful',
            'unsuccessful',
            'no-response',
            'cancelled',
        ]),
        rating: z.number().int().min(1).max(5),
        comment: z.string().trim().max(2000).nullable(),
        tags: z
            .array(
                z.enum([
                    'timely',
                    'respectful',
                    'clear-communication',
                    'needs-follow-up',
                    'safety-concern',
                    'other',
                ]),
            )
            .max(10),
    })
    .strict();
const matchingSchema = z
    .object({
        requestUri: requestUriSchema,
        requiredLanguages: z.array(z.string().trim().min(2).max(16)).max(10),
        accessibilityNeeds: z.array(z.string().trim().min(1).max(80)).max(10),
    })
    .strict();

const hash = (value: string): string =>
    createHash('sha256').update(value).digest('hex');
const iso = (value: Date | string | null): string | null =>
    value === null ? null : new Date(value).toISOString();
const plusDays = (now: Date, days: number): Date =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1_000);

export const localizedInboxCopy = (
    locale: string,
    title: string,
    summary: string,
): { title: string; summary: string } => {
    if (locale !== 'es') return { title, summary };
    const titles: Record<string, string> = {
        'New offer on your request': 'Nueva oferta para tu solicitud',
        'Offer closed': 'Oferta cerrada',
        'Offer accepted': 'Oferta aceptada',
        'Offer declined': 'Oferta rechazada',
        'Offer cancelled': 'Oferta cancelada',
        'Offer expired': 'Oferta vencida',
        'Connection completed': 'Conexión completada',
        'Connection cancelled': 'Conexión cancelada',
        'Connection expired': 'Conexión vencida',
        'Coordination reminder': 'Recordatorio de coordinación',
        'Coordination window expired': 'Ventana de coordinación vencida',
        'Coordination schedule updated': 'Agenda de coordinación actualizada',
    };
    const summaries: Record<string, string> = {
        'The requester closed this pickup.': 'La persona solicitante cerró esta recogida.',
        'A volunteer offered to help. Their identity stays private until you accept.':
            'Una persona voluntaria se ofreció a ayudar. Su identidad permanece privada hasta que aceptes.',
        'Another offer was accepted for this request.':
            'Se aceptó otra oferta para esta solicitud.',
        'The offer was accepted. Participant identities are now available in the connection.':
            'La oferta fue aceptada. Las identidades de las personas participantes ya están disponibles en la conexión.',
        'The offer was declined.': 'La oferta fue rechazada.',
        'The offer was cancelled.': 'La oferta fue cancelada.',
        'The handoff is complete. You can now record structured outcome feedback.':
            'La entrega está completada. Ahora puedes registrar comentarios estructurados sobre el resultado.',
        'The connection was cancelled.': 'La conexión fue cancelada.',
        'An offer expired without being accepted.':
            'Una oferta venció sin ser aceptada.',
        'A confirmed coordination window begins soon.':
            'Una ventana de coordinación confirmada comienza pronto.',
        'Open your connection to review the schedule status.':
            'Abre tu conexión para revisar el estado de la agenda.',
    };
    return {
        title: titles[title] ?? title,
        summary: summaries[summary] ?? summary,
    };
};

interface WorkflowRow {
    post_uri: string;
    requester_did: string;
    current_status: string;
    helper_capacity: number;
    pickup_configured: boolean;
}

interface OfferRow {
    offer_id: string;
    request_uri: string;
    requester_did: string;
    offerer_did: string;
    note: string | null;
    status: 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
    offered_at: Date | string;
    expires_at: Date | string;
    decided_at: Date | string | null;
    updated_at: Date | string;
}

interface ConnectionRow {
    connection_id: string;
    offer_id: string;
    request_uri: string;
    requester_did: string;
    helper_did: string;
    status: 'active' | 'completed' | 'cancelled' | 'expired';
    accepted_at: Date | string;
    completed_at: Date | string | null;
    updated_at: Date | string;
}

const invalid = (code: string, message: string): never => {
    throw new PublicHttpError(400, code, message);
};

export class CoordinationService {
    constructor(private readonly pool: Pool) {}

    async updatePickup(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = z.discriminatedUnion('action', [
            z.object({action: z.literal('set-capacity'), requestUri: requestUriSchema, helperCapacity: z.number().int().min(1).max(20)}).strict(),
            z.object({action: z.literal('close'), requestUri: requestUriSchema}).strict(),
        ]).safeParse(input);
        if (!parsed.success) return invalid('INVALID_PICKUP', 'Choose a helper capacity between 1 and 20.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const workflow = await this.loadWorkflow(client, parsed.data.requestUri, true);
            if (workflow.requester_did !== actorDid) throw new PublicHttpError(403, 'PICKUP_FORBIDDEN', 'Only the requester may manage this pickup.');
            await this.assertSafety(client, workflow, actorDid, ['open', 'triaged', 'assigned', 'in_progress']);
            const counts = await client.query<{occupied: number; active: number}>(`SELECT count(*) FILTER (WHERE status IN ('active','completed'))::int AS occupied,
                count(*) FILTER (WHERE status='active')::int AS active FROM coordination_connections WHERE request_uri=$1`, [workflow.post_uri]);
            const {occupied, active} = counts.rows[0]!;
            if (parsed.data.action === 'set-capacity') {
                if (!workflow.pickup_configured && !['open','triaged'].includes(workflow.current_status))
                    throw new PublicHttpError(409, 'LEGACY_ARRANGEMENT_ACTIVE', 'Finish the existing single-helper arrangement before configuring a pickup.');
                if (parsed.data.helperCapacity < occupied) throw new PublicHttpError(409, 'CAPACITY_BELOW_COMMITMENTS', 'Capacity cannot be lower than committed places.');
                await client.query(`UPDATE request_workflows SET helper_capacity=$2, pickup_configured=TRUE, updated_at=$3 WHERE post_uri=$1`,
                    [workflow.post_uri, parsed.data.helperCapacity, now]);
            } else {
                if (!workflow.pickup_configured) throw new PublicHttpError(409, 'PICKUP_NOT_CONFIGURED', 'Configure this pickup first.');
                if (active > 0) throw new PublicHttpError(409, 'PICKUP_HAS_ACTIVE_HELPERS', 'Complete or cancel every active arrangement before closing the pickup.');
                await client.query(`UPDATE request_workflows SET current_status='resolved', updated_at=$2 WHERE post_uri=$1`, [workflow.post_uri, now]);
                await client.query(`INSERT INTO request_transition_events (command_id,post_uri,actor_did,from_status,to_status,reason,occurred_at,actor_role)
                    VALUES ($1,$2,$3,$4,'resolved','Requester closed pickup',$5,'requester')`, [randomUUID(),workflow.post_uri,actorDid,workflow.current_status,now]);
                const pending = await client.query<OfferRow>(`UPDATE coordination_offers SET status='cancelled',decided_at=$2,updated_at=$2
                    WHERE request_uri=$1 AND status='pending' RETURNING *`, [workflow.post_uri,now]);
                for (const offer of pending.rows) {
                    await this.recordEvent(client, {offerId:offer.offer_id,actorDid,action:'cancelled',previousStatus:'pending',nextStatus:'cancelled',summary:'Requester closed the pickup.',details:{requestUri:workflow.post_uri},now});
                    await this.addInboxItem(client, {recipientDid:offer.offerer_did,type:'offer',title:'Offer closed',summary:'The requester closed this pickup.',
                        actionUrl:'/inbox',sourceKey:`offer:${offer.offer_id}:cancelled`,metadata:{offerId:offer.offer_id},now});
                }
            }
            await client.query(`INSERT INTO operational_audit_events (command_id,actor_did,action,subject_uri,payload,occurred_at,retention_until)
                VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`, [randomUUID(),actorDid,`pickup:${parsed.data.action}`,workflow.post_uri,
                JSON.stringify({helperCapacity:parsed.data.action === 'set-capacity' ? parsed.data.helperCapacity : workflow.helper_capacity}),now,plusDays(now,365)]);
            await client.query('COMMIT');
            return {pickup: {requestUri:workflow.post_uri, helperCapacity:parsed.data.action === 'set-capacity' ? parsed.data.helperCapacity : workflow.helper_capacity,
                configured:true,status:parsed.data.action === 'close' ? 'resolved' : workflow.current_status,occupied,active}};
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async createOffer(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = offerSchema.safeParse(input);
        if (!parsed.success) {
            return invalid('INVALID_OFFER', 'The offer input is invalid.');
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const workflow = await this.loadWorkflow(
                client,
                parsed.data.requestUri,
                true,
            );
            if (workflow.requester_did === actorDid) {
                throw new PublicHttpError(
                    409,
                    'SELF_OFFER_FORBIDDEN',
                    'A requester cannot offer on their own request.',
                );
            }
            await this.assertSafety(client, workflow, actorDid, [
                'open',
                'triaged',
                ...(workflow.pickup_configured ? ['assigned', 'in_progress'] : []),
            ]);
            const eligible = await client.query(
                `SELECT 1
                 FROM indexer_volunteer_profile_projections
                 WHERE author_did_hash = $1
                   AND availability <> 'unavailable'`,
                [hash(actorDid)],
            );
            if (!eligible.rowCount) {
                throw new PublicHttpError(
                    403,
                    'ACTIVE_VOLUNTEER_PROFILE_REQUIRED',
                    'An active volunteer profile is required to offer help.',
                );
            }
            const offerId = randomUUID();
            const expiresAt = plusDays(now, 7);
            try {
                await client.query(
                    `INSERT INTO coordination_offers (
                        offer_id, request_uri, requester_did, offerer_did,
                        note, status, offered_at, expires_at, decided_at,
                        updated_at
                     ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7,
                               NULL, $6)`,
                    [
                        offerId,
                        workflow.post_uri,
                        workflow.requester_did,
                        actorDid,
                        parsed.data.note,
                        now,
                        expiresAt,
                    ],
                );
            } catch (error) {
                if (
                    typeof error === 'object' &&
                    error !== null &&
                    'code' in error &&
                    error.code === '23505'
                ) {
                    throw new PublicHttpError(
                        409,
                        'OFFER_ALREADY_OPEN',
                        'An open offer already exists for this request.',
                    );
                }
                throw error;
            }
            await this.recordEvent(client, {
                offerId,
                actorDid,
                action: 'offered',
                previousStatus: null,
                nextStatus: 'pending',
                summary: 'Help offered on a request.',
                details: { requestUri: workflow.post_uri },
                now,
            });
            await this.addInboxItem(client, {
                recipientDid: workflow.requester_did,
                type: 'offer',
                title: 'New offer on your request',
                summary:
                    'A volunteer offered to help. Their identity stays private until you accept.',
                actionUrl: `/inbox?${new URLSearchParams({ uri: workflow.post_uri }).toString()}`,
                sourceKey: `offer:${offerId}:created`,
                metadata: { offerId, requestUri: workflow.post_uri },
                now,
            });
            await client.query('COMMIT');
            return {
                offer: this.renderOffer(
                    {
                        offer_id: offerId,
                        request_uri: workflow.post_uri,
                        requester_did: workflow.requester_did,
                        offerer_did: actorDid,
                        note: parsed.data.note,
                        status: 'pending',
                        offered_at: now,
                        expires_at: expiresAt,
                        decided_at: null,
                        updated_at: now,
                    },
                    actorDid,
                ),
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async decideOffer(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = offerDecisionSchema.safeParse(input);
        if (!parsed.success) {
            return invalid(
                'INVALID_OFFER_DECISION',
                'The offer decision is invalid.',
            );
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const reference = await this.loadOffer(client, parsed.data.offerId);
            const workflow = await this.loadWorkflow(client, reference.request_uri, true);
            const offer = await this.loadOffer(client, parsed.data.offerId, true);

            if (offer.status === 'accepted' && parsed.data.decision === 'accept' && actorDid === offer.requester_did) {
                await this.assertSafety(client, workflow, offer.offerer_did, ['open', 'triaged', 'assigned', 'in_progress']);
                const existing = await client.query<ConnectionRow>('SELECT * FROM coordination_connections WHERE offer_id=$1', [offer.offer_id]);
                if (existing.rows[0]?.status === 'completed' || (existing.rows[0]?.status === 'active' && plusDays(new Date(existing.rows[0].accepted_at), 30) > now)) {
                    await client.query('COMMIT');
                    return { offer: this.renderOffer(offer, actorDid), connection: this.renderConnection(existing.rows[0], actorDid) };
                }
            }
            if (offer.status !== 'pending') {
                throw new PublicHttpError(
                    409,
                    'OFFER_NOT_PENDING',
                    'Only a pending offer can be changed.',
                );
            }
            if (new Date(offer.expires_at) <= now) {
                await this.expireOffer(client, offer, now);
                await client.query('COMMIT');
                throw new PublicHttpError(
                    409,
                    'OFFER_EXPIRED',
                    'The offer has expired.',
                );
            }
            await this.assertSafety(client, workflow, offer.offerer_did, [
                'open',
                'triaged',
                ...(workflow.pickup_configured ? ['assigned', 'in_progress'] : []),
            ]);
            if (
                parsed.data.decision === 'cancel' &&
                actorDid !== offer.offerer_did
            ) {
                throw new PublicHttpError(
                    403,
                    'OFFER_CANCEL_FORBIDDEN',
                    'Only the volunteer may cancel this offer.',
                );
            }
            if (
                parsed.data.decision !== 'cancel' &&
                actorDid !== offer.requester_did
            ) {
                throw new PublicHttpError(
                    403,
                    'OFFER_DECISION_FORBIDDEN',
                    'Only the requester may accept or decline this offer.',
                );
            }
            const nextStatus =
                parsed.data.decision === 'accept'
                    ? 'accepted'
                    : parsed.data.decision === 'decline'
                      ? 'declined'
                      : 'cancelled';
            await client.query(
                `UPDATE coordination_offers
                 SET status = $2, decided_at = $3, updated_at = $3
                 WHERE offer_id = $1`,
                [offer.offer_id, nextStatus, now],
            );
            let connection: ConnectionRow | null = null;
            if (nextStatus === 'accepted') {
                if (workflow.pickup_configured) {
                    const committed = await client.query<{occupied: number; duplicate: boolean}>(
                        `SELECT count(*)::int AS occupied, coalesce(bool_or(helper_did=$2),false) AS duplicate
                         FROM coordination_connections WHERE request_uri=$1 AND status IN ('active','completed')`,
                        [offer.request_uri, offer.offerer_did]);
                    if (committed.rows[0]!.duplicate) throw new PublicHttpError(409, 'HELPER_ALREADY_COMMITTED', 'This helper already has a place.');
                    if (committed.rows[0]!.occupied >= workflow.helper_capacity) throw new PublicHttpError(409, 'PICKUP_FULL', 'All helper places are committed. Pending offers are retained.');
                }
                const connectionId = randomUUID();
                await client.query(
                    `INSERT INTO coordination_connections (
                        connection_id, offer_id, request_uri, requester_did,
                        helper_did, status, accepted_at, completed_at,
                        updated_at
                     ) VALUES ($1, $2, $3, $4, $5, 'active', $6, NULL, $6)`,
                    [
                        connectionId,
                        offer.offer_id,
                        offer.request_uri,
                        offer.requester_did,
                        offer.offerer_did,
                        now,
                    ],
                );
                if (!workflow.pickup_configured) await client.query(
                    `UPDATE request_workflows
                     SET current_status = 'assigned',
                         assignment = $2::jsonb, updated_at = $3
                     WHERE post_uri = $1`,
                    [
                        offer.request_uri,
                        JSON.stringify({
                            offerId: offer.offer_id,
                            assigneeDid: offer.offerer_did,
                        }),
                        now,
                    ],
                );
                await client.query(
                    `INSERT INTO request_assignment_events (
                        command_id, post_uri, assigner_did, assignee_did,
                        assignment, occurred_at, event_type
                     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'assigned')`,
                    [
                        `coordination:${offer.offer_id}:accepted`,
                        offer.request_uri,
                        offer.requester_did,
                        offer.offerer_did,
                        JSON.stringify({ offerId: offer.offer_id }),
                        now,
                    ],
                );
                connection = {
                    connection_id: connectionId,
                    offer_id: offer.offer_id,
                    request_uri: offer.request_uri,
                    requester_did: offer.requester_did,
                    helper_did: offer.offerer_did,
                    status: 'active',
                    accepted_at: now,
                    completed_at: null,
                    updated_at: now,
                };
                if (workflow.pickup_configured) await client.query(
                    `UPDATE request_workflows SET current_status='assigned', updated_at=$2 WHERE post_uri=$1`, [offer.request_uri, now]);
                const superseded = await client.query<OfferRow>(
                    `UPDATE coordination_offers
                     SET status = 'cancelled', decided_at = $3,
                         updated_at = $3
                     WHERE request_uri = $1 AND offer_id <> $2
                       AND status = 'pending' AND $4::boolean = FALSE
                     RETURNING offer_id, request_uri, requester_did,
                        offerer_did, note, status, offered_at, expires_at,
                        decided_at, updated_at`,
                    [offer.request_uri, offer.offer_id, now, workflow.pickup_configured],
                );
                for (const other of superseded.rows) {
                    await this.recordEvent(client, {
                        offerId: other.offer_id,
                        actorDid: null,
                        action: 'cancelled',
                        previousStatus: 'pending',
                        nextStatus: 'cancelled',
                        summary:
                            'Offer closed because another offer was accepted.',
                        details: { requestUri: offer.request_uri },
                        now,
                    });
                    await this.addInboxItem(client, {
                        recipientDid: other.offerer_did,
                        type: 'offer',
                        title: 'Offer closed',
                        summary: 'Another offer was accepted for this request.',
                        actionUrl: `/inbox?${new URLSearchParams({ uri: offer.request_uri }).toString()}`,
                        sourceKey: `offer:${other.offer_id}:cancelled`,
                        metadata: { offerId: other.offer_id },
                        now,
                    });
                }
            }
            await this.recordEvent(client, {
                offerId: offer.offer_id,
                connectionId: connection?.connection_id,
                actorDid,
                action:
                    nextStatus === 'accepted'
                        ? 'accepted'
                        : nextStatus === 'declined'
                          ? 'declined'
                          : 'cancelled',
                previousStatus: 'pending',
                nextStatus,
                summary: `Offer ${nextStatus}.`,
                details: { requestUri: offer.request_uri },
                now,
            });
            await this.addInboxItem(client, {
                recipientDid:
                    actorDid === offer.requester_did
                        ? offer.offerer_did
                        : offer.requester_did,
                type: nextStatus === 'accepted' ? 'assignment' : 'offer',
                title: `Offer ${nextStatus}`,
                summary:
                    nextStatus === 'accepted'
                        ? 'The offer was accepted. Participant identities are now available in the connection.'
                        : `The offer was ${nextStatus}.`,
                actionUrl: connection ? `/inbox?connection=${encodeURIComponent(connection.connection_id)}`
                    : `/inbox?${new URLSearchParams({ uri: offer.request_uri }).toString()}`,
                sourceKey: `offer:${offer.offer_id}:${nextStatus}`,
                metadata: {
                    offerId: offer.offer_id,
                    ...(connection
                        ? { connectionId: connection.connection_id }
                        : {}),
                },
                now,
            });
            await client.query('COMMIT');
            return {
                offer: this.renderOffer(
                    {
                        ...offer,
                        status: nextStatus,
                        decided_at: now,
                        updated_at: now,
                    },
                    actorDid,
                ),
                connection: connection
                    ? this.renderConnection(connection, actorDid)
                    : null,
            };
        } catch (error) {
            if (
                error instanceof PublicHttpError &&
                error.code === 'OFFER_EXPIRED'
            ) {
                throw error;
            }
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async transitionConnection(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = connectionDecisionSchema.safeParse(input);
        if (!parsed.success) {
            return invalid(
                'INVALID_CONNECTION_DECISION',
                'The connection decision is invalid.',
            );
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const reference = await this.loadConnection(client, parsed.data.connectionId);
            const workflow = await this.loadWorkflow(client, reference.request_uri, true);
            const connection = await this.loadConnection(client, parsed.data.connectionId, true);
            if (
                actorDid !== connection.requester_did &&
                actorDid !== connection.helper_did
            ) {
                throw new PublicHttpError(
                    403,
                    'CONNECTION_FORBIDDEN',
                    'Only a connection participant may change it.',
                );
            }
            const desiredStatus = parsed.data.action === 'complete' ? 'completed' : 'cancelled';
            if (connection.status === desiredStatus) {
                await this.assertAccountsAndBlocks(client, connection.requester_did, connection.helper_did);
                await client.query('COMMIT');
                return { connection: this.renderConnection(connection, actorDid) };
            }
            if (connection.status !== 'active') {
                throw new PublicHttpError(
                    409,
                    'CONNECTION_NOT_ACTIVE',
                    'Only an active connection can be changed.',
                );
            }

            if (plusDays(new Date(connection.accepted_at), 30) <= now) throw new PublicHttpError(409, 'CONNECTION_EXPIRED', 'The connection has expired.');
            await this.assertSafety(client, workflow, connection.helper_did, [
                'assigned',
                'in_progress',
            ]);
            const nextStatus =
                parsed.data.action === 'complete' ? 'completed' : 'cancelled';
            await client.query(
                `UPDATE coordination_connections
                 SET status = $2,
                     completed_at = CASE
                         WHEN $2::text = 'completed'
                         THEN $3::timestamptz ELSE NULL
                     END,
                     updated_at = $3
                 WHERE connection_id = $1`,
                [connection.connection_id, nextStatus, now],
            );
            if (nextStatus === 'completed') {
                if (!workflow.pickup_configured) await client.query(
                    `UPDATE request_workflows
                     SET current_status = 'resolved',
                         handoff = $2::jsonb, updated_at = $3
                     WHERE post_uri = $1`,
                    [
                        connection.request_uri,
                        JSON.stringify({
                            connectionId: connection.connection_id,
                            completedBy: actorDid,
                        }),
                        now,
                    ],
                );
                await client.query(
                    `INSERT INTO request_handoff_events (
                        command_id, post_uri, completed_by, handoff, occurred_at
                     ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
                    [
                        `coordination:${connection.connection_id}:completed`,
                        connection.request_uri,
                        actorDid,
                        JSON.stringify({
                            connectionId: connection.connection_id,
                        }),
                        now,
                    ],
                );
            } else {
                await client.query(
                    `UPDATE request_workflows
                     SET current_status = 'open', assignment = NULL,
                         handoff = NULL, updated_at = $2
                     WHERE post_uri = $1
                       AND current_status IN ('assigned', 'in_progress')
                       AND (NOT pickup_configured OR NOT EXISTS (
                           SELECT 1 FROM coordination_connections c WHERE c.request_uri=request_workflows.post_uri
                             AND c.status IN ('active','completed')))`,
                    [connection.request_uri, now],
                );
            }
            await this.recordEvent(client, {
                offerId: connection.offer_id,
                connectionId: connection.connection_id,
                actorDid,
                action:
                    nextStatus === 'completed'
                        ? 'connection-completed'
                        : 'connection-cancelled',
                previousStatus: 'active',
                nextStatus,
                summary: `Connection ${nextStatus}.`,
                details: { requestUri: connection.request_uri },
                now,
            });
            for (const recipientDid of [
                connection.requester_did,
                connection.helper_did,
            ]) {
                await this.addInboxItem(client, {
                    recipientDid,
                    type: nextStatus === 'completed' ? 'outcome' : 'assignment',
                    title: `Connection ${nextStatus}`,
                    summary:
                        nextStatus === 'completed'
                            ? 'The handoff is complete. You can now record structured outcome feedback.'
                            : 'The connection was cancelled.',
                    actionUrl: `/inbox?connection=${encodeURIComponent(connection.connection_id)}`,
                    sourceKey: `connection:${connection.connection_id}:${nextStatus}`,
                    metadata: {
                        connectionId: connection.connection_id,
                        requestUri: connection.request_uri,
                    },
                    now,
                });
            }
            await client.query('COMMIT');
            return {
                connection: this.renderConnection(
                    {
                        ...connection,
                        status: nextStatus,
                        completed_at: nextStatus === 'completed' ? now : null,
                        updated_at: now,
                    },
                    actorDid,
                ),
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listMine(
        actorDid: string,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        await this.runExpirySweep(now);
        const offers = await this.pool.query<OfferRow>(
            `SELECT offer_id, request_uri, requester_did, offerer_did,
                    note, status, offered_at, expires_at, decided_at,
                    updated_at
             FROM coordination_offers
             WHERE requester_did = $1 OR offerer_did = $1
             ORDER BY updated_at DESC, offer_id`,
            [actorDid],
        );
        const connections = await this.pool.query<ConnectionRow>(
            `SELECT connection_id, offer_id, request_uri, requester_did,
                    helper_did, status, accepted_at, completed_at, updated_at
             FROM coordination_connections
             WHERE requester_did = $1 OR helper_did = $1
             ORDER BY updated_at DESC, connection_id`,
            [actorDid],
        );
        const pickups = await this.pool.query(`SELECT w.post_uri AS "requestUri", w.helper_capacity AS "helperCapacity",
            w.pickup_configured AS configured, w.current_status AS status,
            (SELECT count(*)::int FROM coordination_connections c WHERE c.request_uri=w.post_uri AND c.status IN ('active','completed')) AS occupied,
            (SELECT count(*)::int FROM coordination_connections c WHERE c.request_uri=w.post_uri AND c.status='active') AS active
            FROM request_workflows w WHERE w.requester_did=$1 ORDER BY w.created_at DESC LIMIT 100`, [actorDid]);
        return {
            pickups: pickups.rows,
            offers: offers.rows.map((row) => this.renderOffer(row, actorDid)),
            connections: connections.rows.map((row) =>
                this.renderConnection(row, actorDid),
            ),
        };
    }

    async listInbox(
        actorDid: string,
        unreadOnly = false,
    ): Promise<Record<string, unknown>> {
        await this.refreshInbox(actorDid);
        const result = await this.pool.query<{
            item_id: string;
            item_type: string;
            title: string;
            summary: string;
            action_url: string;
            metadata: Record<string, unknown>;
            occurred_at: Date | string;
            read_at: Date | string | null;
            language: string;
        }>(
            `SELECT item_id, item_type, title, summary, action_url,
                    metadata, occurred_at, read_at,
                    COALESCE((SELECT language FROM account_preferences
                              WHERE did = $1), 'en') AS language
             FROM activity_inbox_items
             WHERE recipient_did = $1
               AND retention_until > NOW()
               AND ($2::boolean = FALSE OR read_at IS NULL)
             ORDER BY occurred_at DESC, item_id
             LIMIT 100`,
            [actorDid, unreadOnly],
        );
        return {
            items: result.rows.map((row) => {
                const copy = localizedInboxCopy(
                    row.language ?? 'en',
                    row.title,
                    row.summary,
                );
                return {
                    id: row.item_id,
                    type: row.item_type,
                    title: copy.title,
                    summary: copy.summary,
                    actionUrl: row.action_url,
                    metadata: row.metadata,
                    occurredAt: iso(row.occurred_at),
                    readAt: iso(row.read_at),
                };
            }),
            unread: result.rows.filter((row) => row.read_at === null).length,
        };
    }

    async markInboxRead(
        actorDid: string,
        itemId: string,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        if (!z.string().uuid().safeParse(itemId).success) {
            return invalid('INVALID_INBOX_ITEM', 'The inbox item is invalid.');
        }
        const result = await this.pool.query(
            `UPDATE activity_inbox_items
             SET read_at = COALESCE(read_at, $3)
             WHERE item_id = $1 AND recipient_did = $2`,
            [itemId, actorDid, now],
        );
        if (!result.rowCount) {
            throw new PublicHttpError(
                404,
                'INBOX_ITEM_NOT_FOUND',
                'The inbox item was not found.',
            );
        }
        return { itemId, readAt: now.toISOString() };
    }

    async submitFeedback(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = feedbackSchema.safeParse(input);
        if (!parsed.success) {
            return invalid(
                'INVALID_OUTCOME_FEEDBACK',
                'The outcome feedback is invalid.',
            );
        }
        const feedbackId = randomUUID();
        const safetyEscalated = parsed.data.tags.includes('safety-concern');
        const client = await this.pool.connect();
        let connection: ConnectionRow;
        try {
            await client.query('BEGIN');
            connection = await this.loadConnection(
                client,
                parsed.data.connectionId,
                true,
            );
            if (
                actorDid !== connection.requester_did &&
                actorDid !== connection.helper_did
            ) {
                throw new PublicHttpError(
                    403,
                    'OUTCOME_FEEDBACK_FORBIDDEN',
                    'Only a connection participant may submit outcome feedback.',
                );
            }
            if (connection.status !== 'completed') {
                throw new PublicHttpError(
                    409,
                    'OUTCOME_FEEDBACK_NOT_AVAILABLE',
                    'Outcome feedback is available after a completed handoff.',
                );
            }
            await this.assertAccountsAndBlocks(
                client,
                connection.requester_did,
                connection.helper_did,
            );
            await client.query(
                `INSERT INTO coordination_outcome_feedback (
                    feedback_id, connection_id, request_uri, submitter_did,
                    outcome, rating, comment, tags, submitted_at,
                    retention_until
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
                [
                    feedbackId,
                    connection.connection_id,
                    connection.request_uri,
                    actorDid,
                    parsed.data.outcome,
                    parsed.data.rating,
                    parsed.data.comment,
                    JSON.stringify(parsed.data.tags),
                    now,
                    plusDays(now, 365),
                ],
            );
            if (safetyEscalated) {
                const subjectUri = `urn:patchwork:outcome-feedback:${feedbackId}`;
                const queueId = randomUUID();
                const reasonCodes = ['outcome-safety-concern'];
                await client.query(
                    `INSERT INTO moderation_queue_items (
                        subject_uri, queue_id, subject_type, reasons,
                        latest_reason, report_count, queue_status,
                        visibility, appeal_state, context, priority,
                        reason_codes, safe_preview, automated_decision,
                        record_origin, seed_version, created_at,
                        requested_at, updated_at, retention_until
                     ) VALUES (
                        $1, $2, 'other', $3::jsonb,
                        'Outcome feedback flagged for safety review', 1,
                        'queued', 'visible', 'none', $4::jsonb, 'high',
                        $3::jsonb, $5::jsonb, NULL,
                        'visitor-created', NULL, $6, $6, $6, NULL
                     )`,
                    [
                        subjectUri,
                        queueId,
                        JSON.stringify(reasonCodes),
                        JSON.stringify({
                            summary:
                                'A completed handoff was flagged for structured safety review.',
                            tags: ['outcome-feedback', 'safety-concern'],
                        }),
                        JSON.stringify({
                            source: 'outcome-feedback',
                            outcome: parsed.data.outcome,
                            rating: String(parsed.data.rating),
                            requestReference: hash(connection.request_uri),
                            connectionReference: connection.connection_id,
                        }),
                        now,
                    ],
                );
                await client.query(
                    `INSERT INTO moderation_notification_events (
                        subject_uri, priority, reason_codes,
                        deduplication_key, created_at, retention_until
                     ) VALUES ($1, 'high', $2::jsonb, $3, $4, $5)`,
                    [
                        subjectUri,
                        JSON.stringify(reasonCodes),
                        `outcome-safety:${feedbackId}`,
                        now,
                        plusDays(now, 30),
                    ],
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                error.code === '23505'
            ) {
                throw new PublicHttpError(
                    409,
                    'OUTCOME_FEEDBACK_ALREADY_SUBMITTED',
                    'Feedback was already submitted for this handoff.',
                );
            }
            throw error;
        } finally {
            client.release();
        }
        return {
            safetyEscalated,
            feedback: {
                id: feedbackId,
                connectionId: connection.connection_id,
                outcome: parsed.data.outcome,
                rating: parsed.data.rating,
                comment: parsed.data.comment,
                tags: parsed.data.tags,
                submittedAt: now.toISOString(),
            },
        };
    }

    async listFeedback(actorDid: string): Promise<Record<string, unknown>> {
        const result = await this.pool.query<{
            feedback_id: string;
            connection_id: string;
            outcome: string;
            rating: number;
            comment: string | null;
            tags: string[];
            submitted_at: Date | string;
        }>(
            `SELECT feedback_id, connection_id, outcome, rating,
                    comment, tags, submitted_at
             FROM coordination_outcome_feedback
             WHERE submitter_did = $1 AND retention_until > NOW()
             ORDER BY submitted_at DESC, feedback_id`,
            [actorDid],
        );
        return {
            feedback: result.rows.map((row) => ({
                id: row.feedback_id,
                connectionId: row.connection_id,
                outcome: row.outcome,
                rating: row.rating,
                comment: row.comment,
                tags: row.tags,
                submittedAt: iso(row.submitted_at),
            })),
        };
    }

    async matchRequest(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = matchingSchema.safeParse(input);
        if (!parsed.success) {
            return invalid(
                'INVALID_MATCH_REQUEST',
                'The matching request is invalid.',
            );
        }
        const workflow = await this.loadWorkflow(
            this.pool,
            parsed.data.requestUri,
        );
        if (workflow.requester_did !== actorDid) {
            throw new PublicHttpError(
                403,
                'MATCH_REQUEST_FORBIDDEN',
                'Only the requester may review match suggestions.',
            );
        }
        if (!['open', 'triaged'].includes(workflow.current_status)) {
            throw new PublicHttpError(
                409,
                'MATCH_REQUEST_CLOSED',
                'Matching is available only for an open request.',
            );
        }
        const request = await this.pool.query<{
            category: string;
            urgency: string;
            county_id: string | null;
            latitude: number;
            longitude: number;
        }>(
            `SELECT category, urgency, county_id, latitude, longitude
             FROM indexer_aid_post_projections
             WHERE uri = $1 AND status = 'open'`,
            [workflow.post_uri],
        );
        if (!request.rows[0]) {
            throw new PublicHttpError(
                409,
                'MATCH_REQUEST_NOT_DISCOVERABLE',
                'The public request is not currently discoverable.',
            );
        }
        const allProfiles = await this.pool.query<{
            did: string;
            matching_preferences: {
                preferredCategories?: string[];
                maxDistanceKm?: number;
            };
        }>(
            `SELECT did, matching_preferences
             FROM volunteer_private_profiles`,
        );
        const projections = await this.pool.query<{
            uri: string;
            author_did_hash: string;
            display_name: string;
            capabilities: string[];
            availability: string;
            skills: string[];
            languages: string[];
            latitude: number | null;
            longitude: number | null;
        }>(
            `SELECT uri, author_did_hash, display_name, capabilities,
                    availability, skills, languages, latitude, longitude
             FROM indexer_volunteer_profile_projections
             WHERE availability <> 'unavailable'`,
        );
        const profileByHash = new Map(
            allProfiles.rows.map((row) => [hash(row.did), row]),
        );
        const candidates: Array<{
            did: string;
            profileUri: string;
            categoryMatch: boolean;
            availability: string;
            distanceKm: number | null;
            languageMatch: boolean;
            accessibilityMatch: boolean;
            verified: boolean;
            score: number;
            explanations: string[];
        }> = [];
        for (const projection of projections.rows) {
            const privateProfile = profileByHash.get(
                projection.author_did_hash,
            );
            if (!privateProfile || privateProfile.did === actorDid) continue;
            try {
                await this.assertAccountsAndBlocks(
                    this.pool,
                    actorDid,
                    privateProfile.did,
                );
            } catch {
                continue;
            }
            const moderation = await this.pool.query(
                `SELECT 1 FROM moderation_queue_items
                 WHERE subject_uri = $1
                   AND (
                        visibility <> 'visible'
                        OR queue_status = 'queued'
                        OR appeal_state IN ('pending', 'under-review')
                   )`,
                [projection.uri],
            );
            if (moderation.rowCount) continue;
            const categoryMatch =
                projection.capabilities.some((capability) =>
                    capabilitySupportsAidCategory(
                        capability as Parameters<
                            typeof capabilitySupportsAidCategory
                        >[0],
                        request.rows[0].category as Parameters<
                            typeof capabilitySupportsAidCategory
                        >[1],
                    ),
                ) ||
                (
                    privateProfile.matching_preferences.preferredCategories ??
                    []
                ).includes(request.rows[0].category);
            if (!categoryMatch) continue;
            const requiredLanguages = parsed.data.requiredLanguages.map(
                (value) => value.toLowerCase(),
            );
            const languages = projection.languages.map((value) =>
                value.toLowerCase(),
            );
            const languageMatch =
                requiredLanguages.length === 0 ||
                requiredLanguages.every((value) => languages.includes(value));
            if (!languageMatch) continue;
            const skills = projection.skills.map((value) =>
                value.toLowerCase(),
            );
            const accessibilityMatch =
                parsed.data.accessibilityNeeds.length === 0 ||
                parsed.data.accessibilityNeeds.every((value) =>
                    skills.includes(value.toLowerCase()),
                );
            if (!accessibilityMatch) continue;
            const distanceKm =
                projection.latitude !== null && projection.longitude !== null
                    ? this.distanceKm(
                          request.rows[0].latitude,
                          request.rows[0].longitude,
                          projection.latitude,
                          projection.longitude,
                      )
                    : null;
            const maxDistance =
                privateProfile.matching_preferences.maxDistanceKm ?? 100;
            if (distanceKm !== null && distanceKm > maxDistance) continue;
            const verified = Boolean(
                (
                    await this.pool.query(
                        `SELECT 1 FROM verification_applications
                         WHERE subject_type = 'volunteer'
                           AND subject_ref = $1
                           AND status = 'approved' AND expires_at > $2`,
                        [privateProfile.did, now],
                    )
                ).rowCount,
            );
            const availabilityScore =
                projection.availability === 'immediate'
                    ? 1
                    : projection.availability === 'within-24h'
                      ? 0.75
                      : 0.5;
            const distanceScore =
                distanceKm === null ? 0.4 : Math.max(0, 1 - distanceKm / 100);
            const score =
                0.3 +
                availabilityScore * 0.25 +
                distanceScore * 0.2 +
                (languageMatch ? 0.1 : 0) +
                (accessibilityMatch ? 0.1 : 0) +
                (verified ? 0.05 : 0);
            candidates.push({
                did: privateProfile.did,
                profileUri: projection.uri,
                categoryMatch,
                availability: projection.availability,
                distanceKm,
                languageMatch,
                accessibilityMatch,
                verified,
                score: Number(score.toFixed(6)),
                explanations: [
                    `Supports ${request.rows[0].category}.`,
                    `Availability is ${projection.availability}.`,
                    distanceKm === null
                        ? 'Approximate distance is unavailable.'
                        : `Approximate distance is ${distanceKm.toFixed(1)} km${request.rows[0].county_id ? ' from the county area' : ''}.`,
                    requiredLanguages.length
                        ? `Matches requested languages: ${requiredLanguages.join(', ')}.`
                        : 'No language requirement was specified.',
                    parsed.data.accessibilityNeeds.length
                        ? `Matches accessibility needs: ${parsed.data.accessibilityNeeds.join(', ')}.`
                        : 'No accessibility requirement was specified.',
                    verified
                        ? 'Volunteer verification is active.'
                        : 'Volunteer verification is not active.',
                ],
            });
        }
        candidates.sort(
            (left, right) =>
                right.score - left.score || left.did.localeCompare(right.did),
        );
        const volunteerResults = candidates.slice(0, 20).map((candidate) => ({
            candidateRef: `volunteer-${hash(
                `${workflow.post_uri}:${candidate.did}`,
            ).slice(0, 20)}`,
            kind: 'volunteer' as const,
            label: 'Volunteer candidate',
            score: candidate.score,
            approximateDistanceKm: candidate.distanceKm,
            availability: candidate.availability,
            verification: candidate.verified ? 'active' : 'not-active',
            explanations: candidate.explanations,
            assignment: 'manual-only' as const,
        }));
        const resourceCategoryMap: Record<string, string[]> = {
            food: ['food-bank'],
            shelter: ['shelter'],
            medical: ['clinic'],
            transport: ['other'],
            childcare: ['other'],
            other: ['other', 'legal-aid', 'hotline'],
        };
        const resources = await this.pool.query<{
            uri: string;
            name: string;
            category: string;
            latitude: number | null;
            longitude: number | null;
        }>(
            `SELECT r.uri, r.name, r.category, r.latitude, r.longitude
             FROM indexer_directory_resource_projections r
             WHERE r.operational_status = 'open'
               AND r.category = ANY($1::text[])
               AND EXISTS (
                   SELECT 1
                   FROM organization_resource_stewardships s
                   JOIN verification_applications v
                     ON v.organization_id = s.organization_id
                   WHERE s.resource_uri = r.uri
                     AND s.status = 'active'
                     AND v.subject_type = 'resource'
                     AND v.subject_ref = r.uri
                     AND v.status = 'approved' AND v.expires_at > $2
               )
               AND NOT EXISTS (
                   SELECT 1 FROM moderation_queue_items q
                   WHERE q.subject_uri = r.uri
                     AND (
                        q.visibility <> 'visible'
                        OR q.queue_status = 'queued'
                        OR q.appeal_state IN ('pending', 'under-review')
                     )
               )`,
            [resourceCategoryMap[request.rows[0].category] ?? ['other'], now],
        );
        const resourceResults = resources.rows
            .map((resource) => {
                const distance =
                    resource.latitude !== null && resource.longitude !== null
                        ? this.distanceKm(
                              request.rows[0].latitude,
                              request.rows[0].longitude,
                              resource.latitude,
                              resource.longitude,
                          )
                        : null;
                return {
                    candidateRef: resource.uri,
                    kind: 'resource' as const,
                    label: resource.name,
                    score: Number(
                        (
                            0.8 +
                            (distance === null
                                ? 0
                                : Math.max(0, 1 - distance / 100) * 0.2)
                        ).toFixed(6),
                    ),
                    approximateDistanceKm: distance,
                    availability: 'open',
                    verification: 'active',
                    explanations: [
                        `Resource category matches ${request.rows[0].category}.`,
                        distance === null
                            ? 'Approximate distance is unavailable.'
                            : `Approximate distance is ${distance.toFixed(1)} km${request.rows[0].county_id ? ' from the county area' : ''}.`,
                        'Resource verification and stewardship are active.',
                    ],
                    assignment: 'manual-only' as const,
                };
            })
            .sort(
                (left, right) =>
                    right.score - left.score ||
                    left.candidateRef.localeCompare(right.candidateRef),
            );
        const rankedResults = [...volunteerResults, ...resourceResults]
            .sort(
                (left, right) =>
                    right.score - left.score ||
                    left.kind.localeCompare(right.kind) ||
                    left.candidateRef.localeCompare(right.candidateRef),
            )
            .slice(0, 20)
            .map((candidate, index) => ({
                ...candidate,
                label:
                    candidate.kind === 'volunteer'
                        ? `Volunteer candidate ${index + 1}`
                        : candidate.label,
                rank: index + 1,
            }));
        return {
            requestUri: workflow.post_uri,
            generatedAt: now.toISOString(),
            policy: {
                opaqueReputationScoreUsed: false,
                automaticAssignment: false,
                deterministicTieBreak: 'stable-candidate-identifier',
            },
            candidates: rankedResults,
        };
    }

    async runExpirySweep(now = new Date()): Promise<{
        offersExpired: number;
        connectionsExpired: number;
        inboxDeleted: number;
        feedbackDeleted: number;
    }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SELECT post_uri FROM request_workflows WHERE post_uri IN (
                SELECT request_uri FROM coordination_offers WHERE status='pending' AND expires_at <= $1
                UNION SELECT request_uri FROM coordination_connections WHERE status='active' AND accepted_at <= $1::timestamptz - INTERVAL '30 days'
            ) ORDER BY post_uri FOR UPDATE`, [now]);
            const expiredOffers = await client.query<OfferRow>(
                `SELECT offer_id, request_uri, requester_did, offerer_did,
                        note, status, offered_at, expires_at, decided_at,
                        updated_at
                 FROM coordination_offers
                 WHERE status = 'pending' AND expires_at <= $1
                 FOR UPDATE`,
                [now],
            );
            for (const offer of expiredOffers.rows) {
                await this.expireOffer(client, offer, now);
            }
            const expiredConnections = await client.query<ConnectionRow>(
                `UPDATE coordination_connections
                 SET status = 'expired', updated_at = $1
                 WHERE status = 'active'
                   AND accepted_at <= $1::timestamptz - INTERVAL '30 days'
                 RETURNING connection_id, offer_id, request_uri,
                    requester_did, helper_did, status, accepted_at,
                    completed_at, updated_at`,
                [now],
            );
            for (const connection of expiredConnections.rows) {
                await client.query(
                    `UPDATE request_workflows
                     SET current_status = 'open', assignment = NULL,
                         handoff = NULL, updated_at = $2
                     WHERE post_uri = $1
                       AND current_status IN ('assigned', 'in_progress')
                       AND (NOT pickup_configured OR NOT EXISTS (
                           SELECT 1 FROM coordination_connections c WHERE c.request_uri=request_workflows.post_uri
                             AND c.status IN ('active','completed')))`,
                    [connection.request_uri, now],
                );
                await this.recordEvent(client, {
                    offerId: connection.offer_id,
                    connectionId: connection.connection_id,
                    actorDid: null,
                    action: 'connection-expired',
                    previousStatus: 'active',
                    nextStatus: 'expired',
                    summary: 'Connection expired.',
                    details: { requestUri: connection.request_uri },
                    now,
                });
            }
            const inboxDeleted = await client.query(
                `DELETE FROM activity_inbox_items WHERE retention_until <= $1`,
                [now],
            );
            const feedbackDeleted = await client.query(
                `DELETE FROM coordination_outcome_feedback
                 WHERE retention_until <= $1`,
                [now],
            );
            await client.query('COMMIT');
            return {
                offersExpired: expiredOffers.rowCount ?? 0,
                connectionsExpired: expiredConnections.rowCount ?? 0,
                inboxDeleted: inboxDeleted.rowCount ?? 0,
                feedbackDeleted: feedbackDeleted.rowCount ?? 0,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    private async refreshInbox(actorDid: string): Promise<void> {
        await this.pool.query(
            `INSERT INTO activity_inbox_items (
                item_id, recipient_did, item_type, title, summary,
                action_url, source_key, metadata, occurred_at,
                retention_until
             )
             SELECT gen_random_uuid(), applicant_did, 'verification',
                    'Verification status updated',
                    'Your verification status is ' || status || '.',
                    '/verification',
                    'verification:' || application_id::text || ':' || status,
                    jsonb_build_object('applicationId', application_id),
                    updated_at, updated_at + INTERVAL '1 year'
             FROM verification_applications
             WHERE applicant_did = $1
             ON CONFLICT (recipient_did, source_key) DO NOTHING`,
            [actorDid],
        );
        await this.pool.query(
            `INSERT INTO activity_inbox_items (
                item_id, recipient_did, item_type, title, summary,
                action_url, source_key, metadata, occurred_at,
                retention_until
             )
             SELECT gen_random_uuid(), recipient_did, 'notification',
                    'Resource reconfirmation due',
                    'An organization resource needs reconfirmation.',
                    '/organizations',
                    'organization-notification:' || event_id::text,
                    jsonb_build_object(
                        'organizationId', organization_id,
                        'stewardshipId', stewardship_id
                    ),
                    created_at, created_at + INTERVAL '1 year'
             FROM organization_notification_events
             WHERE recipient_did = $1
             ON CONFLICT (recipient_did, source_key) DO NOTHING`,
            [actorDid],
        );
        await this.pool.query(
            `INSERT INTO activity_inbox_items (
                item_id, recipient_did, item_type, title, summary,
                action_url, source_key, metadata, occurred_at,
                retention_until
             )
             SELECT gen_random_uuid(), w.requester_did, 'moderation',
                    'Request moderation status changed',
                    'A moderation action affects one of your requests.',
                    '/inbox',
                    'moderation:' || q.subject_uri || ':' ||
                        q.visibility || ':' || q.appeal_state,
                    jsonb_build_object('requestUri', q.subject_uri),
                    q.updated_at, q.updated_at + INTERVAL '1 year'
             FROM moderation_queue_items q
             JOIN request_workflows w ON w.post_uri = q.subject_uri
             WHERE w.requester_did = $1
               AND (q.visibility <> 'visible' OR q.appeal_state <> 'none')
             ON CONFLICT (recipient_did, source_key) DO NOTHING`,
            [actorDid],
        );
    }

    private async assertSafety(
        client: Pick<Pool | PoolClient, 'query'>,
        workflow: WorkflowRow,
        helperDid: string,
        allowedStatuses: string[],
    ): Promise<void> {
        const demo = await client.query(`SELECT 1 FROM indexer_aid_post_projections WHERE uri = $1 AND record_origin = 'synthetic'
            UNION ALL SELECT 1 FROM indexer_volunteer_profile_projections WHERE author_did_hash = $2 AND record_origin = 'synthetic' LIMIT 1`, [workflow.post_uri, hash(helperDid)]);
        if (demo.rowCount) throw new PublicHttpError(409, 'DEMO_COORDINATION_FORBIDDEN', 'Example listings cannot be used for a real handoff.');
        if (!allowedStatuses.includes(workflow.current_status)) {
            throw new PublicHttpError(
                409,
                'REQUEST_NOT_AVAILABLE',
                'The request is not available for this transition.',
            );
        }
        await this.assertAccountsAndBlocks(
            client,
            workflow.requester_did,
            helperDid,
        );
        const moderation = await client.query(
            `SELECT 1
             FROM moderation_queue_items
             WHERE (
                    subject_uri = $1
                    OR subject_uri IN (
                        SELECT uri
                        FROM indexer_volunteer_profile_projections
                        WHERE author_did_hash = $2
                    )
                   )
               AND (
                    visibility <> 'visible'
                    OR queue_status = 'queued'
                    OR appeal_state IN ('pending', 'under-review')
               )`,
            [workflow.post_uri, hash(helperDid)],
        );
        if (moderation.rowCount) {
            throw new PublicHttpError(
                409,
                'COORDINATION_QUARANTINED',
                'The request or participant is not eligible for coordination.',
            );
        }
    }

    private async assertAccountsAndBlocks(
        client: Pick<Pool | PoolClient, 'query'>,
        firstDid: string,
        secondDid: string,
    ): Promise<void> {
        const deactivated = await client.query(
            `SELECT 1 FROM account_deactivations
             WHERE did_hash = ANY($1::text[])`,
            [[hash(firstDid), hash(secondDid)]],
        );
        if (deactivated.rowCount) {
            throw new PublicHttpError(
                409,
                'PARTICIPANT_DEACTIVATED',
                'A participant account is no longer active.',
            );
        }
        const blocked = await client.query(
            `SELECT 1 FROM user_blocks
             WHERE deleted_at IS NULL
               AND (
                    (blocker_did = $1 AND subject_did = $2)
                    OR
                    (blocker_did = $2 AND subject_did = $1)
               )`,
            [firstDid, secondDid],
        );
        if (blocked.rowCount) {
            throw new PublicHttpError(
                409,
                'PARTICIPANTS_BLOCKED',
                'The participants cannot coordinate.',
            );
        }
    }

    private async expireOffer(
        client: PoolClient,
        offer: OfferRow,
        now: Date,
    ): Promise<void> {
        await client.query(
            `UPDATE coordination_offers
             SET status = 'expired', decided_at = $2, updated_at = $2
             WHERE offer_id = $1 AND status = 'pending'`,
            [offer.offer_id, now],
        );
        await this.recordEvent(client, {
            offerId: offer.offer_id,
            actorDid: null,
            action: 'expired',
            previousStatus: 'pending',
            nextStatus: 'expired',
            summary: 'Offer expired.',
            details: { requestUri: offer.request_uri },
            now,
        });
        for (const recipientDid of [offer.requester_did, offer.offerer_did]) {
            await this.addInboxItem(client, {
                recipientDid,
                type: 'expiry',
                title: 'Offer expired',
                summary: 'An offer expired without being accepted.',
                actionUrl: `/inbox?${new URLSearchParams({ uri: offer.request_uri }).toString()}`,
                sourceKey: `offer:${offer.offer_id}:expired`,
                metadata: { offerId: offer.offer_id },
                now,
            });
        }
    }

    private async addInboxItem(
        client: Pick<Pool | PoolClient, 'query'>,
        item: {
            recipientDid: string;
            type:
                | 'request'
                | 'offer'
                | 'assignment'
                | 'verification'
                | 'moderation'
                | 'expiry'
                | 'notification'
                | 'outcome';
            title: string;
            summary: string;
            actionUrl: string;
            sourceKey: string;
            metadata: Record<string, unknown>;
            now: Date;
        },
    ): Promise<void> {
        await client.query(
            `INSERT INTO activity_inbox_items (
                item_id, recipient_did, item_type, title, summary,
                action_url, source_key, metadata, occurred_at,
                retention_until
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
             ON CONFLICT (recipient_did, source_key) DO NOTHING`,
            [
                randomUUID(),
                item.recipientDid,
                item.type,
                item.title,
                item.summary,
                item.actionUrl,
                item.sourceKey,
                JSON.stringify(item.metadata),
                item.now,
                plusDays(item.now, 365),
            ],
        );
    }

    private async recordEvent(
        client: Pick<Pool | PoolClient, 'query'>,
        event: {
            offerId: string;
            connectionId?: string;
            actorDid: string | null;
            action:
                | 'offered'
                | 'accepted'
                | 'declined'
                | 'expired'
                | 'cancelled'
                | 'connection-completed'
                | 'connection-cancelled'
                | 'connection-expired';
            previousStatus: string | null;
            nextStatus: string;
            summary: string;
            details: Record<string, unknown>;
            now: Date;
        },
    ): Promise<void> {
        await client.query(
            `INSERT INTO coordination_offer_events (
                offer_id, connection_id, actor_did, action,
                previous_status, next_status, public_summary,
                private_details, occurred_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
            [
                event.offerId,
                event.connectionId ?? null,
                event.actorDid,
                event.action,
                event.previousStatus,
                event.nextStatus,
                event.summary,
                JSON.stringify(event.details),
                event.now,
            ],
        );
    }

    private async loadWorkflow(
        client: Pick<Pool | PoolClient, 'query'>,
        requestUri: string,
        lock = false,
    ): Promise<WorkflowRow> {
        const result = await client.query<WorkflowRow>(
            `SELECT post_uri, requester_did, current_status, helper_capacity, pickup_configured
             FROM request_workflows
             WHERE post_uri = $1 ${lock ? 'FOR UPDATE' : ''}`,
            [requestUri],
        );
        if (!result.rows[0]) {
            throw new PublicHttpError(
                404,
                'REQUEST_NOT_FOUND',
                'The request was not found.',
            );
        }
        return result.rows[0];
    }

    private async loadOffer(
        client: Pick<Pool | PoolClient, 'query'>,
        offerId: string,
        lock = false,
    ): Promise<OfferRow> {
        const result = await client.query<OfferRow>(
            `SELECT offer_id, request_uri, requester_did, offerer_did,
                    note, status, offered_at, expires_at, decided_at,
                    updated_at
             FROM coordination_offers
             WHERE offer_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
            [offerId],
        );
        if (!result.rows[0]) {
            throw new PublicHttpError(
                404,
                'OFFER_NOT_FOUND',
                'The offer was not found.',
            );
        }
        return result.rows[0];
    }

    private async loadConnection(
        client: Pick<Pool | PoolClient, 'query'>,
        connectionId: string,
        lock = false,
    ): Promise<ConnectionRow> {
        const result = await client.query<ConnectionRow>(
            `SELECT connection_id, offer_id, request_uri, requester_did,
                    helper_did, status, accepted_at, completed_at, updated_at
             FROM coordination_connections
             WHERE connection_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
            [connectionId],
        );
        if (!result.rows[0]) {
            throw new PublicHttpError(
                404,
                'CONNECTION_NOT_FOUND',
                'The connection was not found.',
            );
        }
        return result.rows[0];
    }

    private renderOffer(row: OfferRow, actorDid: string) {
        const identityAuthorized = row.status === 'accepted';
        return {
            id: row.offer_id,
            requestUri: row.request_uri,
            direction: actorDid === row.requester_did ? 'received' : 'sent',
            note: row.note,
            status: row.status,
            offeredAt: iso(row.offered_at),
            expiresAt: iso(row.expires_at),
            decidedAt: iso(row.decided_at),
            ...(identityAuthorized
                ? {
                      requesterDid: row.requester_did,
                      helperDid: row.offerer_did,
                  }
                : {}),
        };
    }

    private renderConnection(row: ConnectionRow, actorDid: string) {
        return {
            id: row.connection_id,
            offerId: row.offer_id,
            requestUri: row.request_uri,
            status: row.status,
            requesterDid: row.requester_did,
            helperDid: row.helper_did,
            counterpartDid:
                actorDid === row.requester_did
                    ? row.helper_did
                    : row.requester_did,
            acceptedAt: iso(row.accepted_at),
            completedAt: iso(row.completed_at),
            updatedAt: iso(row.updated_at),
        };
    }

    private distanceKm(
        latitudeA: number,
        longitudeA: number,
        latitudeB: number,
        longitudeB: number,
    ): number {
        const radians = (value: number) => (value * Math.PI) / 180;
        const deltaLatitude = radians(latitudeB - latitudeA);
        const deltaLongitude = radians(longitudeB - longitudeA);
        const a =
            Math.sin(deltaLatitude / 2) ** 2 +
            Math.cos(radians(latitudeA)) *
                Math.cos(radians(latitudeB)) *
                Math.sin(deltaLongitude / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
