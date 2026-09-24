import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ExactLocationSignalService } from './exact-location-signal-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const requesterDid = 'did:plc:location-requester';
const helperDid = 'did:plc:location-helper';
const outsiderDid = 'did:plc:location-outsider';
const requestUri = `at://${requesterDid}/app.patchwork.aid.post/location-request`;
const connectionId = '81111111-1111-4111-8111-111111111111';
const offerId = '82111111-1111-4111-8111-111111111111';
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

describe('ephemeral exact-location signaling boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE coordination_outcome_feedback,
                      activity_inbox_items,
                      coordination_offer_events,
                      coordination_connections,
                      coordination_offers,
                      request_handoff_events,
                      request_assignment_events,
                      request_transition_events,
                      request_workflows,
                      user_blocks,
                      account_deactivations,
                      moderation_audit_records,
                      moderation_queue_items
             RESTART IDENTITY CASCADE`,
        );
        await pool.query(
            `INSERT INTO request_workflows (
                post_uri, requester_did, current_status,
                create_command_id, created_at, updated_at
             ) VALUES (
                $1, $2, 'assigned', 'location-request', $3, $3
             )`,
            [requestUri, requesterDid, new Date('2026-07-28T12:00:00.000Z')],
        );
        await pool.query(
            `INSERT INTO coordination_offers (
                offer_id, request_uri, requester_did, offerer_did,
                note, status, offered_at, expires_at, decided_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, NULL, 'accepted', $5,
                $5::timestamptz + INTERVAL '7 days', $5, $5
             )`,
            [
                offerId,
                requestUri,
                requesterDid,
                helperDid,
                new Date('2026-07-28T12:00:00.000Z'),
            ],
        );
        await pool.query(
            `INSERT INTO coordination_connections (
                connection_id, offer_id, request_uri, requester_did,
                helper_did, status, accepted_at, completed_at, updated_at
             ) VALUES (
                $1, $2, $3, $4, $5, 'active', $6, NULL, $6
             )`,
            [
                connectionId,
                offerId,
                requestUri,
                requesterDid,
                helperDid,
                new Date('2026-07-28T12:00:00.000Z'),
            ],
        );
    });

    afterAll(async () => pool.end());

    it('requires two fresh participant consents and relays only coordinate-free single-use signaling', async () => {
        const service = new ExactLocationSignalService(pool);
        const first = await service.consent(
            requesterDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:01:00.000Z'),
        );
        expect(first).toMatchObject({
            consent: { actorConsented: true, peerConsented: false },
            session: null,
        });
        await expect(
            service.consent(outsiderDid, {
                connectionId,
                consent: true,
            }),
        ).rejects.toMatchObject({
            statusCode: 403,
            code: 'LOCATION_CONNECTION_FORBIDDEN',
        });

        const second = await service.consent(
            helperDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:01:30.000Z'),
        );
        const session = (
            second as {
                session: {
                    id: string;
                    participantProof: string;
                    expectedPeerProof: string;
                };
            }
        ).session;
        expect(session.participantProof).toHaveLength(43);
        expect(session.expectedPeerProof).toHaveLength(43);
        expect(JSON.stringify(second)).not.toMatch(
            /latitude|longitude|coordinate/i,
        );

        const requesterState = await service.state(
            requesterDid,
            connectionId,
            0,
            new Date('2026-07-28T12:01:31.000Z'),
        );
        expect(requesterState).toMatchObject({
            session: {
                id: session.id,
                role: 'offerer',
                singleUse: true,
                status: 'pending',
            },
        });
        await expect(
            service.signal(
                requesterDid,
                {
                    connectionId,
                    sessionId: session.id,
                    kind: 'description',
                    payload: { type: 'offer', sdp: 'v=0\\r\\n' },
                },
                new Date('2026-07-28T12:01:32.000Z'),
            ),
        ).resolves.toMatchObject({ accepted: true, status: 'pending' });
        const helperState = await service.state(
            helperDid,
            connectionId,
            0,
            new Date('2026-07-28T12:01:33.000Z'),
        );
        expect(helperState).toMatchObject({
            session: {
                signals: [
                    {
                        kind: 'description',
                        payload: { type: 'offer', sdp: 'v=0\\r\\n' },
                    },
                ],
            },
        });
        await expect(
            service.signal(
                helperDid,
                {
                    connectionId,
                    sessionId: session.id,
                    kind: 'description',
                    payload: { type: 'answer', sdp: 'v=0\\r\\n' },
                },
                new Date('2026-07-28T12:01:34.000Z'),
            ),
        ).resolves.toMatchObject({ accepted: true, status: 'active' });
        await expect(
            service.signal(
                helperDid,
                {
                    connectionId,
                    sessionId: session.id,
                    kind: 'description',
                    payload: { type: 'answer', sdp: 'v=0\\r\\n' },
                },
                new Date('2026-07-28T12:01:35.000Z'),
            ),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'LOCATION_SESSION_ALREADY_USED',
        });
        await expect(
            service.signal(
                requesterDid,
                {
                    connectionId,
                    sessionId: session.id,
                    kind: 'candidate',
                    payload: {
                        candidate: 'candidate',
                        sdpMid: null,
                        sdpMLineIndex: null,
                        usernameFragment: null,
                        latitude: 41.88,
                    },
                },
                new Date('2026-07-28T12:01:36.000Z'),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: 'INVALID_LOCATION_SIGNAL',
        });

        const restarted = new ExactLocationSignalService(pool);
        await expect(
            restarted.state(requesterDid, connectionId),
        ).resolves.toMatchObject({
            session: null,
        });
        const durableLocationSchema = await pool.query(
            `SELECT table_name, column_name
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND (
                    table_name ~* '(exact_?location|location_?signal)'
                    OR column_name ~* '(exact_?location|location_?session|exact_?(latitude|longitude))'
               )`,
        );
        expect(durableLocationSchema.rows).toEqual([]);
    });

    it('fails closed on maintenance, blocks, inactive connections, revocation, and expiry', async () => {
        const maintenance = new ExactLocationSignalService(pool, () => true);
        await expect(
            maintenance.consent(requesterDid, {
                connectionId,
                consent: true,
            }),
        ).rejects.toMatchObject({
            statusCode: 503,
            code: 'LOCATION_EXCHANGE_DISABLED',
        });

        const service = new ExactLocationSignalService(pool);
        await service.consent(
            requesterDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:01:00.000Z'),
        );
        const active = await service.consent(
            helperDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:01:10.000Z'),
        );
        const sessionId = (active as { session: { id: string } }).session.id;
        await pool.query(
            `INSERT INTO user_blocks (
                command_id, blocker_did, subject_did, reason,
                retention_until, created_at
             ) VALUES (
                'location-block', $1, $2, NULL,
                NOW() + INTERVAL '1 day', NOW()
             )`,
            [requesterDid, helperDid],
        );
        await expect(
            service.signal(requesterDid, {
                connectionId,
                sessionId,
                kind: 'end-of-candidates',
                payload: {},
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'LOCATION_AUTHORIZATION_LOST',
        });
        await pool.query(`DELETE FROM user_blocks`);

        await service.consent(
            requesterDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:02:00.000Z'),
        );
        await service.consent(
            helperDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:02:05.000Z'),
        );
        await expect(
            service.revoke(requesterDid, { connectionId }),
        ).resolves.toMatchObject({
            status: 'revoked',
        });

        const expiryService = new ExactLocationSignalService(pool);
        await expiryService.consent(
            requesterDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:03:00.000Z'),
        );
        await expiryService.consent(
            helperDid,
            { connectionId, consent: true },
            new Date('2026-07-28T12:03:05.000Z'),
        );
        expect(
            expiryService.sweep(new Date('2026-07-28T12:09:00.000Z')),
        ).toMatchObject({
            expiredSessions: 1,
        });
        await expect(
            expiryService.state(
                requesterDid,
                connectionId,
                0,
                new Date('2026-07-28T12:09:01.000Z'),
            ),
        ).resolves.toMatchObject({
            session: {
                status: 'expired',
                participantProof: null,
                expectedPeerProof: null,
                signals: [],
            },
        });

        await pool.query(
            `UPDATE coordination_connections
             SET status = 'cancelled' WHERE connection_id = $1`,
            [connectionId],
        );
        await expect(
            expiryService.state(requesterDid, connectionId),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'LOCATION_CONNECTION_NOT_ACTIVE',
        });

        await pool.query(
            `INSERT INTO account_deactivations (
                did_hash, command_id, result, requested_at, retention_until
             ) VALUES (
                $1, 'location-deactivation', '{}', NOW(),
                NOW() + INTERVAL '1 day'
             ) ON CONFLICT DO NOTHING`,
            [hash(helperDid)],
        );
        await pool.query(
            `UPDATE coordination_connections
             SET status = 'active' WHERE connection_id = $1`,
            [connectionId],
        );
        await expect(
            new ExactLocationSignalService(pool).consent(requesterDid, {
                connectionId,
                consent: true,
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'LOCATION_AUTHORIZATION_LOST',
        });
    });
});
