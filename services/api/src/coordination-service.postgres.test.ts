import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountPrivacyService } from './account-privacy-service.js';
import { CoordinationService } from './coordination-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const requesterDid = 'did:plc:coordination-requester';
const helperDid = 'did:plc:coordination-helper';
const requestUri =
    `at://${requesterDid}/app.patchwork.aid.post/groceries`;
const secondRequestUri =
    `at://${requesterDid}/app.patchwork.aid.post/transport`;
const profileUri =
    `at://${helperDid}/app.patchwork.volunteer.profile/main`;
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

describePostgres('CoordinationService PostgreSQL boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    it('rejects real offers involving an example request or volunteer before creating notifications', async () => {
        const service = new CoordinationService(pool);
        await pool.query("UPDATE indexer_aid_post_projections SET record_origin = 'synthetic', seed_version = 'candidate-test-v1' WHERE uri = $1", [requestUri]);
        await expect(service.createOffer(helperDid, { requestUri, note: 'I can help.' })).rejects.toMatchObject({ code: 'DEMO_COORDINATION_FORBIDDEN' });
        await pool.query("UPDATE indexer_aid_post_projections SET record_origin = 'visitor-created', seed_version = NULL WHERE uri = $1", [requestUri]);
        await pool.query("UPDATE indexer_volunteer_profile_projections SET record_origin = 'synthetic', seed_version = 'candidate-test-v1' WHERE uri = $1", [profileUri]);
        await expect(service.createOffer(helperDid, { requestUri, note: 'I can help.' })).rejects.toMatchObject({ code: 'DEMO_COORDINATION_FORBIDDEN' });
        expect(Number((await pool.query('SELECT count(*) AS count FROM coordination_offers')).rows[0].count)).toBe(0);
        expect(Number((await pool.query('SELECT count(*) AS count FROM activity_inbox_items')).rows[0].count)).toBe(0);
    });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE moderation_notification_events,
                      coordination_outcome_feedback,
                      activity_inbox_items,
                      coordination_offer_events,
                      coordination_connections,
                      coordination_offers,
                      verification_audit_events,
                      verification_appeals,
                      verification_decisions,
                      verification_evidence_metadata,
                      verification_applications,
                      organization_notification_events,
                      organization_audit_events,
                      organization_resource_stewardships,
                      organization_invitations,
                      organization_memberships,
                      organizations,
                      volunteer_private_profiles,
                      indexer_volunteer_profile_projections,
                      indexer_aid_post_projections,
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
        const now = new Date('2026-01-01T12:00:00.000Z');
        await pool.query(
            `INSERT INTO request_workflows (
                post_uri, requester_did, current_status,
                create_command_id, created_at, updated_at
             ) VALUES
                ($1, $3, 'open', 'coordination-request-one', $4, $4),
                ($2, $3, 'open', 'coordination-request-two', $4, $4)`,
            [requestUri, secondRequestUri, requesterDid, now],
        );
        await pool.query(
            `INSERT INTO indexer_aid_post_projections (
                uri, collection, cid, revision, author_did_hash,
                title, description, category, urgency, status,
                searchable_text, latitude, longitude, precision_km,
                record_created_at, record_updated_at, source_cursor,
                source_event_id, projected_at
             ) VALUES
                ($1, 'app.patchwork.aid.post', 'request-cid-1', 'rev-1',
                 $3, 'Groceries needed', 'Weekly groceries', 'food',
                 'high', 'open', 'groceries needed weekly', 41.9, -87.65,
                 2, $4, $4, 1, 'coordination-request-event-1', $4),
                ($2, 'app.patchwork.aid.post', 'request-cid-2', 'rev-2',
                 $3, 'Accessible ride', 'Ride to an appointment',
                 'transport', 'medium', 'open', 'accessible ride', 41.9,
                 -87.65, 2, $4, $4, 2,
                 'coordination-request-event-2', $4)`,
            [requestUri, secondRequestUri, hash(requesterDid), now],
        );
        await pool.query(
            `INSERT INTO indexer_volunteer_profile_projections (
                uri, collection, cid, revision, author_did_hash,
                display_name, bio, capabilities, availability,
                contact_preference, skills, languages, service_area_label,
                no_permanent_address, latitude, longitude, precision_km,
                searchable_text, record_created_at, record_updated_at,
                source_cursor, source_event_id, projected_at
             ) VALUES (
                $1, 'app.patchwork.volunteer.profile', 'helper-cid',
                'helper-rev', $2, 'Private Helper Name', NULL,
                '["food-delivery","transport"]', 'within-24h', 'chat-only',
                '["wheelchair-accessible"]', '["en","es"]', 'North side',
                FALSE, 41.91, -87.66, 2, 'private helper name food transport',
                $3, $3, 3, 'coordination-helper-event', $3
             )`,
            [profileUri, hash(helperDid), now],
        );
        await pool.query(
            `INSERT INTO volunteer_private_profiles (
                did, contact_email, contact_phone, availability_windows,
                matching_preferences, created_at, updated_at
             ) VALUES (
                $1, NULL, NULL, '["weekdays"]',
                '{"preferredCategories":["food","transport"],
                  "preferredUrgencies":["medium","high"],
                  "maxDistanceKm":25,"acceptsLateNight":false}',
                $2, $2
             )`,
            [helperDid, now],
        );
        await pool.query(
            `INSERT INTO verification_applications (
                application_id, applicant_did, subject_type,
                organization_id, subject_ref, status, submitted_at,
                decided_at, expires_at, revoked_at, updated_at
             ) VALUES (
                '11111111-1111-4111-8111-111111111111', $1,
                'volunteer', NULL, $1, 'approved', $2, $2,
                $2::timestamptz + INTERVAL '1 year', NULL, $2
             )`,
            [helperDid, now],
        );
    });

    afterAll(async () => pool.end());

    it('keeps identities private until acceptance and persists offer, connection, handoff, inbox, and outcome state', async () => {
        const offeredAt = new Date('2026-01-02T12:00:00.000Z');
        const service = new CoordinationService(pool);
        const created = await service.createOffer(
            helperDid,
            { requestUri, note: 'I can deliver on Thursday.' },
            offeredAt,
        );
        const offerId = (created as { offer: { id: string } }).offer.id;
        expect(JSON.stringify(created)).not.toContain(helperDid);

        const restarted = new CoordinationService(pool);
        const requesterPending = await restarted.listMine(
            requesterDid,
            offeredAt,
        );
        expect(requesterPending).toMatchObject({
            offers: [
                expect.objectContaining({
                    id: offerId,
                    direction: 'received',
                    status: 'pending',
                }),
            ],
        });
        expect(JSON.stringify(requesterPending)).not.toContain(helperDid);

        const accepted = await restarted.decideOffer(
            requesterDid,
            { offerId, decision: 'accept' },
            new Date('2026-01-03T12:00:00.000Z'),
        );
        expect(accepted).toMatchObject({
            offer: {
                status: 'accepted',
                requesterDid,
                helperDid,
            },
            connection: {
                status: 'active',
                counterpartDid: helperDid,
            },
        });
        const connectionId = (
            accepted as { connection: { id: string } }
        ).connection.id;

        await restarted.transitionConnection(
            helperDid,
            { connectionId, action: 'complete' },
            new Date('2026-01-04T12:00:00.000Z'),
        );
        await expect(
            restarted.submitFeedback(
                requesterDid,
                {
                    connectionId,
                    outcome: 'successful',
                    rating: 5,
                    comment: 'Groceries arrived safely.',
                    tags: ['timely', 'respectful'],
                },
                new Date('2026-01-05T12:00:00.000Z'),
            ),
        ).resolves.toMatchObject({
            feedback: { outcome: 'successful', rating: 5 },
        });
        await expect(
            restarted.submitFeedback(requesterDid, {
                connectionId,
                outcome: 'successful',
                rating: 5,
                comment: null,
                tags: [],
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'OUTCOME_FEEDBACK_ALREADY_SUBMITTED',
        });

        const workflow = await pool.query<{
            current_status: string;
            assignment: { offerId: string };
            handoff: { connectionId: string };
        }>(
            `SELECT current_status, assignment, handoff
             FROM request_workflows WHERE post_uri = $1`,
            [requestUri],
        );
        expect(workflow.rows[0]).toMatchObject({
            current_status: 'resolved',
            assignment: { offerId },
            handoff: { connectionId },
        });
        const inbox = await restarted.listInbox(requesterDid);
        expect(inbox).toMatchObject({
            items: expect.arrayContaining([
                expect.objectContaining({ type: 'offer' }),
                expect.objectContaining({ type: 'outcome' }),
            ]),
        });
        expect(JSON.stringify(inbox)).not.toContain('message_received');
        expect(JSON.stringify(inbox)).not.toContain('conversation');
        await expect(restarted.listInbox(helperDid)).resolves.toMatchObject({
            items: expect.arrayContaining([
                expect.objectContaining({ type: 'verification' }),
            ]),
        });

        const privacy = new AccountPrivacyService(pool);
        await expect(privacy.exportFor(requesterDid)).resolves.toMatchObject({
            data: {
                coordination: {
                    offers: [
                        expect.objectContaining({
                            id: offerId,
                            status: 'accepted',
                            helperDid,
                        }),
                    ],
                    connections: [
                        expect.objectContaining({
                            id: connectionId,
                            status: 'completed',
                        }),
                    ],
                    feedback: [
                        expect.objectContaining({
                            connectionId,
                            outcome: 'successful',
                        }),
                    ],
                },
            },
        });
        await expect(
            privacy.deactivate(
                helperDid,
                'coordination-helper-deactivation',
                new Date('2026-01-06T12:00:00.000Z'),
            ),
        ).resolves.toMatchObject({
            status: 'deactivated',
            removed: {
                coordinationOffers: 1,
                publicVolunteerProfiles: 1,
                privateVolunteerProfile: 1,
            },
        });
        const remaining = await pool.query(
            `SELECT 1 FROM coordination_connections
             WHERE helper_did = $1`,
            [helperDid],
        );
        expect(remaining.rowCount).toBe(0);
    });

    it('atomically escalates safety-concern outcomes without copying private comments or identity', async () => {
        const service = new CoordinationService(pool);
        const created = await service.createOffer(
            helperDid,
            { requestUri, note: null },
            new Date('2026-02-01T12:00:00.000Z'),
        );
        const offerId = (created as { offer: { id: string } }).offer.id;
        const accepted = await service.decideOffer(
            requesterDid,
            { offerId, decision: 'accept' },
            new Date('2026-02-02T12:00:00.000Z'),
        );
        const connectionId = (
            accepted as { connection: { id: string } }
        ).connection.id;
        await service.transitionConnection(
            requesterDid,
            { connectionId, action: 'complete' },
            new Date('2026-02-03T12:00:00.000Z'),
        );

        const privateComment = 'Private safety narrative for the feedback owner.';
        await expect(
            service.submitFeedback(
                helperDid,
                {
                    connectionId,
                    outcome: 'unsuccessful',
                    rating: 1,
                    comment: privateComment,
                    tags: ['safety-concern'],
                },
                new Date('2026-02-04T12:00:00.000Z'),
            ),
        ).resolves.toMatchObject({
            safetyEscalated: true,
            feedback: {
                connectionId,
                tags: ['safety-concern'],
            },
        });

        const queue = await pool.query<{
            subject_uri: string;
            subject_type: string;
            priority: string;
            reason_codes: string[];
            safe_preview: Record<string, string>;
            context: Record<string, unknown>;
        }>(
            `SELECT subject_uri, subject_type, priority, reason_codes,
                    safe_preview, context
             FROM moderation_queue_items
             WHERE latest_reason = 'Outcome feedback flagged for safety review'`,
        );
        expect(queue.rows).toHaveLength(1);
        expect(queue.rows[0]).toMatchObject({
            subject_type: 'other',
            priority: 'high',
            reason_codes: ['outcome-safety-concern'],
            safe_preview: {
                source: 'outcome-feedback',
                outcome: 'unsuccessful',
                rating: '1',
                requestReference: hash(requestUri),
                connectionReference: connectionId,
            },
        });
        const queueJson = JSON.stringify(queue.rows[0]);
        expect(queueJson).not.toContain(privateComment);
        expect(queueJson).not.toContain(requesterDid);
        expect(queueJson).not.toContain(helperDid);

        const notifications = await pool.query<{
            priority: string;
            reason_codes: string[];
        }>(
            `SELECT priority, reason_codes
             FROM moderation_notification_events
             WHERE subject_uri = $1`,
            [queue.rows[0]!.subject_uri],
        );
        expect(notifications.rows).toEqual([
            {
                priority: 'high',
                reason_codes: ['outcome-safety-concern'],
            },
        ]);

        await expect(
            service.submitFeedback(helperDid, {
                connectionId,
                outcome: 'unsuccessful',
                rating: 1,
                comment: null,
                tags: ['safety-concern'],
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'OUTCOME_FEEDBACK_ALREADY_SUBMITTED',
        });
        await expect(
            pool.query(`SELECT COUNT(*)::int AS count FROM moderation_queue_items`),
        ).resolves.toMatchObject({ rows: [{ count: 1 }] });
        await expect(
            pool.query(
                `SELECT COUNT(*)::int AS count FROM moderation_notification_events`,
            ),
        ).resolves.toMatchObject({ rows: [{ count: 1 }] });
    });

    it('rechecks block and request state, expires offers, and returns deterministic explainable matches without reputation', async () => {
        const service = new CoordinationService(pool);
        const first = await service.matchRequest(
            requesterDid,
            {
                requestUri,
                requiredLanguages: ['en'],
                accessibilityNeeds: ['wheelchair-accessible'],
            },
            new Date('2026-01-02T12:00:00.000Z'),
        );
        const second = await service.matchRequest(
            requesterDid,
            {
                requestUri,
                requiredLanguages: ['en'],
                accessibilityNeeds: ['wheelchair-accessible'],
            },
            new Date('2026-01-02T12:00:00.000Z'),
        );
        expect(first).toMatchObject({
            policy: {
                opaqueReputationScoreUsed: false,
                automaticAssignment: false,
            },
            candidates: [
                expect.objectContaining({
                    kind: 'volunteer',
                    verification: 'active',
                    assignment: 'manual-only',
                    explanations: expect.arrayContaining([
                        'Matches requested languages: en.',
                    ]),
                }),
            ],
        });
        expect(
            (first as { candidates: Array<{ candidateRef: string }> })
                .candidates[0]?.candidateRef,
        ).toBe(
            (second as { candidates: Array<{ candidateRef: string }> })
                .candidates[0]?.candidateRef,
        );
        expect(JSON.stringify(first)).not.toContain(helperDid);
        expect(
            (first as { candidates: Array<Record<string, unknown>> })
                .candidates[0],
        ).not.toHaveProperty('reputationScore');

        const offer = await service.createOffer(
            helperDid,
            { requestUri: secondRequestUri, note: null },
            new Date('2026-01-02T12:00:00.000Z'),
        );
        const offerId = (offer as { offer: { id: string } }).offer.id;
        await pool.query(
            `INSERT INTO user_blocks (
                command_id, blocker_did, subject_did, reason,
                retention_until, created_at
             ) VALUES (
                'coordination-block', $1, $2, NULL,
                NOW() + INTERVAL '30 days', NOW()
             )`,
            [requesterDid, helperDid],
        );
        await expect(
            service.decideOffer(
                requesterDid,
                {
                    offerId,
                    decision: 'accept',
                },
                new Date('2026-01-03T12:00:00.000Z'),
            ),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'PARTICIPANTS_BLOCKED',
        });
        await pool.query(`DELETE FROM user_blocks`);
        const expiry = await service.runExpirySweep(
            new Date('2026-01-10T12:00:00.000Z'),
        );
        expect(expiry.offersExpired).toBe(1);
        await expect(service.listMine(helperDid)).resolves.toMatchObject({
            offers: [expect.objectContaining({ status: 'expired' })],
        });
    });
});
