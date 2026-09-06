import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountPrivacyService } from '../account-privacy-service.js';
import { authenticateRequest } from './authenticated-request.js';
import { createAccountPrivacyHandler } from './account-privacy-handler.js';
import {
    idempotencyKeyFromRequest,
    withIdempotencyKey,
} from './idempotent-request.js';
import { PostgresIdempotencyExecutor } from './idempotency-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const viewerDid = 'did:plc:privacyviewer';
const otherDid = 'did:plc:privacyother';
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

const startServer = async (pool: Pool) => {
    const idempotency = new PostgresIdempotencyExecutor(pool);
    const handler = createAccountPrivacyHandler({
        service: new AccountPrivacyService(pool),
        authenticate: request =>
            authenticateRequest(request, {
                resolveSession: async token => {
                    if (token === 'privacy-session') return { did: viewerDid };
                    if (token === 'other-session') return { did: otherDid };
                    throw new Error('bad session');
                },
                resolveRole: async () => 'user',
            }),
        clearSessionCookies: response => {
            response.setHeader('set-cookie', [
                'patchwork_session=; Path=/; HttpOnly; Max-Age=0',
                'patchwork_csrf=; Path=/; Max-Age=0',
            ]);
        },
        executeIdempotent: (request, actorDid, body, effect) => {
            const key = idempotencyKeyFromRequest(request);
            const commandBody = withIdempotencyKey(body, key);
            const pathname = new URL(
                request.url ?? '/',
                'http://localhost',
            ).pathname;
            return idempotency.execute(
                {
                    actorDid,
                    method: request.method ?? 'POST',
                    pathname,
                    idempotencyKey: key,
                    body: commandBody,
                },
                () => effect(commandBody),
            );
        },
    });
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!handler(request, response, url)) response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    return { server, origin: `http://127.0.0.1:${address.port}` };
};

const stopServer = async (server: Server) => {
    server.close();
    await once(server, 'close');
};

describePostgres('authenticated account privacy HTTP boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeAll(async () => {
        for (const migration of [
            '0002_at_sessions.sql',
            '0003_core_operational_state.sql',
            '0004_lifecycle_timeline.sql',
            '0005_lifecycle_assignments.sql',
            '0006_assignment_responses.sql',
            '0007_lifecycle_handoffs.sql',
            '0008_platform_roles.sql',
            '0009_public_status_sync.sql',
            '0010_public_sync_state.sql',
            '0011_http_idempotency.sql',
            '0012_retention_enforcement.sql',
            '0013_account_deactivation.sql',
            '0014_account_onboarding.sql',
            '0015_volunteer_private_profiles.sql',
            '0016_organizations_and_stewardship.sql',
            '0017_verification_and_exact_public_addresses.sql',
            '0018_coordination_offers_inbox_outcomes.sql',
            '0020_durable_notification_outbox.sql',
        ]) {
            await pool.query(
                await readFile(
                    new URL(`../db/migrations/${migration}`, import.meta.url),
                    'utf8',
                ),
            );
        }
        await pool.query(
            await readFile(
                new URL('../../../indexer/src/migrations/0002_projection_store.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL(
                    '../../../indexer/src/migrations/0004_directory_projection_store.sql',
                    import.meta.url,
                ),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL(
                    '../../../indexer/src/migrations/0005_volunteer_profile_projection.sql',
                    import.meta.url,
                ),
                'utf8',
            ),
        );
        for (const migration of [
            '001_create_moderation_tables.sql',
            '002_durable_moderation.sql',
            '003_retention_enforcement.sql',
        ]) {
            await pool.query(
                await readFile(
                    new URL(
                        `../../../moderation-worker/src/migrations/${migration}`,
                        import.meta.url,
                    ),
                    'utf8',
                ),
            );
        }
        await pool.query(
            `TRUNCATE notification_delivery_attempts,
                      notification_push_subscriptions,
                      notification_email_endpoints,
                      notification_intents,
                      organization_notification_events,
                      coordination_outcome_feedback,
                      activity_inbox_items,
                      coordination_offer_events,
                      coordination_connections,
                      coordination_offers,
                      verification_audit_events,
                      exact_public_address_requests,
                      verification_appeals,
                      verification_decisions,
                      verification_evidence_metadata,
                      verification_applications,
                      private_attachments,
                      organization_audit_events,
                      organization_resource_stewardships,
                      organization_invitations,
                      organization_memberships, organizations,
                      patchwork_browser_sessions, at_oauth_sessions,
                      platform_roles, operational_audit_events, abuse_reports,
                      user_blocks, request_handoff_events,
                      request_assignment_events, request_transition_events,
                      request_workflows, http_idempotency_commands, aid_authoring_receipts,
                      account_preference_audit, account_preferences,
                      account_policy_consents, account_deactivations,
                      moderation_audit_records,
                      moderation_queue_items,
                      indexer_projection_events,
                      indexer_projection_tombstones,
                      indexer_aid_post_projections,
                      indexer_directory_resource_projections
                      , indexer_volunteer_profile_projections
                      , volunteer_private_profiles
                      RESTART IDENTITY CASCADE`,
        );
        await pool.query(
            `INSERT INTO at_oauth_sessions (
                did, handle, encrypted_payload, created_at, updated_at
             ) VALUES
                ($1, 'viewer.test', 'encrypted-secret-payload', NOW(), NOW()),
                ($2, 'other.test', 'other-secret-payload', NOW(), NOW())`,
            [viewerDid, otherDid],
        );
        await pool.query(
            `INSERT INTO patchwork_browser_sessions (
                session_id_hash, did, expires_at
             ) VALUES ('private-session-hash', $1, NOW() + INTERVAL '1 day')`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO request_workflows (
                post_uri, requester_did, current_status, create_command_id,
                created_at, updated_at
             ) VALUES
                ('at://did:plc:privacyviewer/app.patchwork.aid.post/one', $1,
                 'open', 'privacy-workflow', NOW(), NOW()),
                ('at://did:plc:privacyother/app.patchwork.aid.post/two', $2,
                 'open', 'other-workflow', NOW(), NOW())`,
            [viewerDid, otherDid],
        );
        await pool.query(
            `INSERT INTO indexer_aid_post_projections (
                uri, collection, author_did_hash, title, description,
                category, urgency, status, searchable_text, latitude,
                longitude, precision_km, record_created_at, record_updated_at,
                source_cursor, source_event_id
             ) VALUES
                ('at://did:plc:privacyviewer/app.patchwork.aid.post/one',
                 'app.patchwork.aid.post', $1, 'My aid post', 'Public body',
                 'food', 'low', 'open', 'my aid post public body', 0, 0, 5,
                 NOW(), NOW(), 1, 'privacy-event'),
                ('at://did:plc:privacyother/app.patchwork.aid.post/two',
                 'app.patchwork.aid.post', $2, 'Other aid post', 'Do not export',
                 'food', 'low', 'open', 'other aid post do not export', 0, 0, 5,
                 NOW(), NOW(), 2, 'other-event')`,
            [hash(viewerDid), hash(otherDid)],
        );
        await pool.query(
            `INSERT INTO indexer_directory_resource_projections (
                uri, collection, author_did_hash, name, service_area,
                category, verification_status, contact, searchable_text,
                latitude, longitude, precision_km, operational_status,
                record_created_at, record_updated_at, source_cursor,
                source_event_id
             ) VALUES
                ('at://did:plc:privacyviewer/app.patchwork.directory.resource/one',
                 'app.patchwork.directory.resource', $1, 'My pantry',
                 'Viewer district', 'food-bank', 'community-verified',
                 '{"url":"https://viewer.example"}', 'my pantry viewer district',
                 0, 0, 5, 'open', NOW(), NOW(), 3, 'privacy-directory-event'),
                ('at://did:plc:privacyother/app.patchwork.directory.resource/two',
                 'app.patchwork.directory.resource', $2, 'Other clinic',
                 'Other district', 'clinic', 'partner-verified',
                 '{"url":"https://other.example"}', 'other clinic other district',
                 0, 0, 5, 'open', NOW(), NOW(), 4, 'other-directory-event')`,
            [hash(viewerDid), hash(otherDid)],
        );
        await pool.query(
            `INSERT INTO user_blocks (
                command_id, blocker_did, subject_did, reason,
                retention_until, created_at
             ) VALUES
                ('viewer-owned-block', $1, $2, 'owned detail',
                 NOW() + INTERVAL '30 days', NOW()),
                ('viewer-subject-block', $2, $1, 'safety detail',
                 NOW() + INTERVAL '30 days', NOW())`,
            [viewerDid, otherDid],
        );
        await pool.query(
            `INSERT INTO abuse_reports (
                command_id, reporter_did, subject_uri, subject_did, reason,
                details, retention_until, created_at
             ) VALUES (
                'viewer-report', $1,
                'at://did:plc:privacyother/app.patchwork.aid.post/two', $2,
                'safety', 'private report detail',
                NOW() + INTERVAL '30 days', NOW()
             )`,
            [viewerDid, otherDid],
        );
        await pool.query(
            `INSERT INTO operational_audit_events (
                command_id, actor_did, action, subject_uri, payload,
                retention_until, occurred_at
             ) VALUES (
                'viewer-audit', $1, 'privacy-test',
                'at://did:plc:privacyviewer/app.patchwork.aid.post/one',
                '{"safe":true}', NOW() + INTERVAL '90 days', NOW()
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO account_policy_consents (
                did, policy_version, asserted_18_or_older,
                accepted_documents, accepted_at
             ) VALUES (
                $1, '2026-07-28', TRUE,
                '["terms-of-use","privacy-notice","community-guidelines",
                  "synthetic-data-disclosure","location-sharing-consent"]',
                NOW()
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO account_preferences (
                did, privacy, notifications, visibility, language, location,
                created_at, updated_at
             ) VALUES (
                $1, 'private',
                '{"inApp":true,"email":false,"push":false}',
                'hidden', 'es',
                '{"sharing":"hidden","noPermanentAddress":true}',
                NOW(), NOW()
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO indexer_volunteer_profile_projections (
                uri, collection, cid, author_did_hash, display_name, bio,
                capabilities, availability, contact_preference, skills,
                languages, service_area_label, no_permanent_address,
                latitude, longitude, precision_km, searchable_text,
                record_created_at, record_updated_at, source_cursor,
                source_event_id
             ) VALUES (
                'at://did:plc:privacyviewer/app.patchwork.volunteer.profile/main',
                'app.patchwork.volunteer.profile', 'volunteer-cid', $1,
                'Viewer Volunteer', 'Public bio', '["food-delivery"]',
                'within-24h', 'chat-only', '["meal delivery"]', '["en"]',
                'Viewer district', TRUE, 0, 0, 5,
                'viewer volunteer public bio', NOW(), NOW(), 5,
                'privacy-volunteer-event'
             )`,
            [hash(viewerDid)],
        );
        await pool.query(
            `INSERT INTO volunteer_private_profiles (
                did, contact_email, contact_phone, availability_windows,
                matching_preferences, created_at, updated_at
             ) VALUES (
                $1, 'viewer@example.test', NULL, '["weekday_evenings"]',
                '{"preferredCategories":["food"],
                  "preferredUrgencies":["medium"],
                  "maxDistanceKm":10,"acceptsLateNight":false}',
                NOW(), NOW()
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO organizations (
                organization_id, slug, name, description, origin,
                source_url, source_retrieved_at,
                source_last_verified_at, non_endorsement_label,
                created_by_did, created_at, updated_at
             ) VALUES (
                '11111111-1111-4111-8111-111111111111',
                'privacy-cooperative', 'Privacy Cooperative',
                'Shared organization for privacy tests.',
                'visitor-created', NULL, NULL, NULL,
                'Listed for public information. Patchwork does not endorse or guarantee this organization.',
                $1, NOW(), NOW()
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO organization_memberships (
                organization_id, member_did, role, status,
                invited_by_did, joined_at, updated_at
             ) VALUES
                ('11111111-1111-4111-8111-111111111111', $1,
                 'owner', 'active', $1, NOW(), NOW()),
                ('11111111-1111-4111-8111-111111111111', $2,
                 'admin', 'active', $1, NOW(), NOW())`,
            [viewerDid, otherDid],
        );
        await pool.query(
            `INSERT INTO organization_invitations (
                invitation_id, organization_id, invitee_did, role,
                token_hash, status, invited_by_did, expires_at,
                created_at, accepted_at
             ) VALUES (
                '22222222-2222-4222-8222-222222222222',
                '11111111-1111-4111-8111-111111111111', $1, 'member',
                $3, 'accepted', $2, NOW() + INTERVAL '7 days',
                NOW(), NOW()
             )`,
            [viewerDid, otherDid, 'a'.repeat(64)],
        );
        await pool.query(
            `INSERT INTO organization_resource_stewardships (
                stewardship_id, organization_id, resource_uri,
                steward_did, status, last_reconfirmed_at,
                reconfirm_due_at, created_at, updated_at
             ) VALUES (
                '33333333-3333-4333-8333-333333333333',
                '11111111-1111-4111-8111-111111111111',
                'at://did:plc:privacyviewer/app.patchwork.directory.resource/one',
                $1, 'due', NOW() - INTERVAL '90 days',
                NOW(), NOW() - INTERVAL '90 days', NOW()
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO organization_notification_events (
                event_id, organization_id, recipient_did, event_type,
                stewardship_id, deduplication_key, payload,
                created_at, consumed_at
             ) VALUES (
                '44444444-4444-4444-8444-444444444444',
                '11111111-1111-4111-8111-111111111111', $1,
                'resource-reconfirmation-due',
                '33333333-3333-4333-8333-333333333333',
                'privacy-reconfirmation-event',
                '{"stewardshipId":"33333333-3333-4333-8333-333333333333"}',
                NOW(), NULL
             )`,
            [viewerDid],
        );
        await pool.query(
            `INSERT INTO private_attachments (
                attachment_id, owner_did, purpose, filename, object_key,
                declared_mime, detected_mime, byte_size, status,
                upload_expires_at, retention_expires_at,
                created_at, updated_at
             ) VALUES (
                '55555555-5555-4555-8555-555555555555',
                'did:plc:privacyviewer',
                'verification-evidence',
                'private-viewer-evidence.pdf',
                'verification/private-viewer-evidence.pdf',
                'application/pdf', 'application/pdf', 2048, 'clean',
                NOW(), NOW() + INTERVAL '1 year', NOW(), NOW()
             );
             INSERT INTO verification_applications (
                application_id, applicant_did, subject_type,
                organization_id, subject_ref, status, submitted_at,
                decided_at, expires_at, revoked_at, updated_at
             ) VALUES (
                '66666666-6666-4666-8666-666666666666',
                'did:plc:privacyviewer',
                'organization',
                '11111111-1111-4111-8111-111111111111',
                '11111111-1111-4111-8111-111111111111',
                'denied', NOW(), NOW(), NULL, NULL, NOW()
             );
             INSERT INTO verification_evidence_metadata (
                evidence_id, application_id, evidence_kind, label,
                issuer, issued_at, attachment_id, private_notes, created_at
             ) VALUES (
                '77777777-7777-4777-8777-777777777777',
                '66666666-6666-4666-8666-666666666666',
                'organization-registration', 'Registration record',
                'State registry', CURRENT_DATE,
                '55555555-5555-4555-8555-555555555555',
                'Private applicant note', NOW()
             );
             INSERT INTO verification_appeals (
                appeal_id, application_id, applicant_did, reason,
                status, submitted_at
             ) VALUES (
                '88888888-8888-4888-8888-888888888888',
                '66666666-6666-4666-8666-666666666666',
                'did:plc:privacyviewer',
                'Please review the updated registration.', 'pending', NOW()
             );
             INSERT INTO exact_public_address_requests (
                request_id, organization_id, resource_uri, applicant_did,
                street_address, latitude, longitude, confidential_facility,
                status, requested_at, updated_at
             ) VALUES (
                '99999999-9999-4999-8999-999999999999',
                '11111111-1111-4111-8111-111111111111',
                'at://did:plc:privacyviewer/app.patchwork.directory.resource/one',
                'did:plc:privacyviewer',
                '123 Private Review Street', 41.88, -87.63,
                FALSE, 'pending', NOW(), NOW()
             );
             INSERT INTO verification_audit_events (
                actor_did, action, subject_type, subject_id,
                public_summary, private_details, occurred_at
             ) VALUES (
                'did:plc:privacyviewer',
                'verification-appeal-submitted', 'application',
                '66666666-6666-4666-8666-666666666666',
                'Verification appeal submitted.',
                '{"privateApplicantContext":"must be redacted"}', NOW()
             )`,
        );
        await pool.query(
            `INSERT INTO notification_email_endpoints (
                endpoint_id, owner_did, email_address,
                verification_token_hash, verification_expires_at,
                verified_at, disabled_at, created_at, updated_at
             ) VALUES (
                'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1,
                'notify-viewer@example.test', $2,
                NOW() + INTERVAL '30 minutes', NOW(), NULL, NOW(), NOW()
             )`,
            [viewerDid, 'c'.repeat(64)],
        );
        await pool.query(
            `
             INSERT INTO notification_push_subscriptions (
                subscription_id, owner_did, endpoint, p256dh, auth_secret,
                user_agent_hash, created_at, updated_at
             ) VALUES (
                'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', $1,
                'https://push.example.test/private-subscription',
                'private-p256dh-material', 'private-auth-material',
                $2, NOW(), NOW()
             )`,
            [viewerDid, 'd'.repeat(64)],
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('exports only session-derived subject data without credential material', async () => {
        await pool.query(`INSERT INTO aid_authoring_receipts (post_uri, owner_did, title, source_cid, public_status)
            VALUES ($1, $2, 'My pending request', 'pending-cid', 'open'), ($3, $4, 'Other pending request', 'other-cid', 'open')`,
            [`at://${viewerDid}/app.patchwork.aid.post/pending`, viewerDid, `at://${otherDid}/app.patchwork.aid.post/pending`, otherDid]);
        const running = await startServer(pool);
        const response = await fetch(`${running.origin}/account/export`, {
            headers: { cookie: 'patchwork_session=privacy-session' },
        });
        const body = await response.json();
        await stopServer(running.server);

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(response.headers.get('content-disposition')).toBe(
            'attachment; filename="patchwork-account-export.json"',
        );
        expect(body).toMatchObject({
            formatVersion: '1.0',
            subject: { did: viewerDid, handle: 'viewer.test' },
            data: {
                authoringReceipts: [expect.objectContaining({ title: 'My pending request', sourceCid: 'pending-cid' })],
                publicAidPosts: [
                    expect.objectContaining({ title: 'My aid post' }),
                ],
                publicDirectoryResources: [
                    expect.objectContaining({ name: 'My pantry' }),
                ],
                workflows: [
                    expect.objectContaining({ currentStatus: 'open' }),
                ],
                policyConsents: [
                    expect.objectContaining({
                        policyVersion: '2026-07-28',
                        asserted18OrOlder: true,
                    }),
                ],
                preferences: expect.objectContaining({
                    privacy: 'private',
                    visibility: 'hidden',
                    language: 'es',
                }),
                publicVolunteerProfiles: [
                    expect.objectContaining({
                        displayName: 'Viewer Volunteer',
                    }),
                ],
                privateVolunteerProfile: expect.objectContaining({
                    contactEmail: 'viewer@example.test',
                }),
                organizations: {
                    memberships: [
                        expect.objectContaining({
                            name: 'Privacy Cooperative',
                            role: 'owner',
                        }),
                    ],
                    invitations: [
                        expect.objectContaining({
                            role: 'member',
                            status: 'accepted',
                        }),
                    ],
                    stewardships: [
                        expect.objectContaining({
                            status: 'due',
                        }),
                    ],
                },
                verification: {
                    applications: [
                        expect.objectContaining({
                            subjectType: 'organization',
                            status: 'denied',
                        }),
                    ],
                    evidence: [
                        expect.objectContaining({
                            label: 'Registration record',
                            privateNotes: 'Private applicant note',
                        }),
                    ],
                    appeals: [
                        expect.objectContaining({ status: 'pending' }),
                    ],
                    exactAddressRequests: [
                        expect.objectContaining({
                            streetAddress: '123 Private Review Street',
                            status: 'pending',
                        }),
                    ],
                },
                attachments: [
                    expect.objectContaining({
                        purpose: 'verification-evidence',
                        status: 'clean',
                    }),
                ],
                notifications: {
                    items: expect.arrayContaining([
                        expect.objectContaining({
                            type: 'verification_submitted',
                        }),
                        expect.objectContaining({
                            type: 'appeal_submitted',
                        }),
                    ]),
                    email: expect.objectContaining({
                        address: 'notify-viewer@example.test',
                    }),
                    pushSubscriptions: [
                        expect.objectContaining({
                            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                        }),
                    ],
                },
            },
            exclusions: expect.arrayContaining([
                expect.objectContaining({ category: 'at-repository' }),
                expect.objectContaining({ category: 'moderation-casework' }),
            ]),
        });
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('encrypted-secret-payload');
        expect(serialized).not.toContain('private-session-hash');
        expect(serialized).not.toContain(
            'verification/private-viewer-evidence.pdf',
        );
        expect(serialized).not.toContain(
            'https://push.example.test/private-subscription',
        );
        expect(serialized).not.toContain('private-p256dh-material');
        expect(serialized).not.toContain('private-auth-material');
        expect(serialized).not.toContain('c'.repeat(64));
        expect(serialized).not.toContain('d'.repeat(64));
        expect(serialized).not.toContain('Other aid post');
        expect(serialized).not.toContain('Other clinic');
        expect(serialized).not.toContain(otherDid);
    });

    it('rejects export without an authenticated browser session', async () => {
        const running = await startServer(pool);
        const response = await fetch(`${running.origin}/account/export`);
        await stopServer(running.server);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'AUTHENTICATION_REQUIRED' },
        });
    });

    it('deactivates only the authenticated subject and reports retained exceptions', async () => {
        expect((await pool.query('SELECT COUNT(*) FROM aid_authoring_receipts WHERE owner_did=$1', [viewerDid])).rows[0].count).toBe('1');
        const running = await startServer(pool);
        const response = await fetch(`${running.origin}/account/deactivate`, {
            method: 'POST',
            headers: {
                cookie: 'patchwork_session=privacy-session',
                'content-type': 'application/json',
                'idempotency-key': 'privacy-deactivate-1',
            },
            body: JSON.stringify({ did: otherDid }),
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toContain(
            'patchwork_session=; Path=/; HttpOnly; Max-Age=0',
        );
        expect(body).toMatchObject({
            status: 'deactivated',
            removed: {
                publicAidPosts: 1,
                publicDirectoryResources: 1,
                workflows: 1,
                publicVolunteerProfiles: 1,
                privateVolunteerProfile: 1,
                organizationMemberships: 1,
                organizationInvitations: 1,
                organizationNotifications: 1,
                organizations: 0,
                verificationApplications: 1,
                exactAddressRequests: 1,
                privateAttachments: 1,
                notificationIntents: expect.any(Number),
                notificationEmailEndpoints: 1,
                notificationPushSubscriptions: 1,
                policyConsents: 1,
                preferences: 1,
            },
            revoked: {
                browserSessions: 1,
                oauthSessions: 1,
                organizationStewardships: 1,
            },
            retained: expect.objectContaining({
                deactivationReceipt: 1,
                safetyBlocks: 1,
                safetyReports: 1,
                operationalAudit: 1,
                transferredOrganizations: 1,
            }),
        });
        expect(JSON.stringify(body)).not.toContain(viewerDid);
        expect(JSON.stringify(body)).not.toContain(otherDid);

        expect((await pool.query('SELECT COUNT(*) FROM aid_authoring_receipts WHERE owner_did=$1', [viewerDid])).rows[0].count).toBe('0');
        expect((await pool.query('SELECT COUNT(*) FROM aid_authoring_receipts WHERE owner_did=$1', [otherDid])).rows[0].count).toBe('1');

        const reused = await fetch(`${running.origin}/account/deactivate`, {
            method: 'POST',
            headers: {
                cookie: 'patchwork_session=privacy-session',
                'content-type': 'application/json',
                'idempotency-key': 'privacy-deactivate-1',
            },
            body: JSON.stringify({ changed: true }),
        });
        expect(reused.status).toBe(409);
        await expect(reused.json()).resolves.toMatchObject({
            error: { code: 'IDEMPOTENCY_KEY_REUSED' },
        });

        const retained = await pool.query<{
            reason: string | null;
            details: string | null;
            actor_did: string;
        }>(
            `SELECT b.reason, r.details, a.actor_did
             FROM user_blocks b, abuse_reports r, operational_audit_events a
             WHERE b.subject_did = $1
               AND r.command_id = 'viewer-report'
               AND a.command_id = 'viewer-audit'`,
            [viewerDid],
        );
        expect(retained.rows[0]).toMatchObject({
            reason: null,
            details: null,
            actor_did: `deactivated:${hash(viewerDid)}`,
        });
        const verificationRetained = await pool.query<{
            actor_did: string | null;
            private_details: Record<string, unknown>;
        }>(
            `SELECT actor_did, private_details
             FROM verification_audit_events
             WHERE subject_id =
                   '66666666-6666-4666-8666-666666666666'`,
        );
        expect(verificationRetained.rows).toEqual([
            {
                actor_did: null,
                private_details: { redactedForDeactivation: true },
            },
        ]);

        const viewerExport = (await fetch(`${running.origin}/account/export`, {
            headers: { cookie: 'patchwork_session=privacy-session' },
        }).then(result => result.json())) as {
            data: {
                publicAidPosts: unknown[];
                publicDirectoryResources: unknown[];
                workflows: unknown[];
                publicVolunteerProfiles: unknown[];
                privateVolunteerProfile: unknown;
            };
        };
        expect(viewerExport.data.publicAidPosts).toEqual([]);
        expect(viewerExport.data.publicDirectoryResources).toEqual([]);
        expect(viewerExport.data.workflows).toEqual([]);
        expect(viewerExport.data.publicVolunteerProfiles).toEqual([]);
        expect(viewerExport.data.privateVolunteerProfile).toBeNull();

        const transferredOwner = await pool.query<{
            member_did: string;
            created_by_did: string;
        }>(
            `SELECT m.member_did, o.created_by_did
             FROM organizations o
             JOIN organization_memberships m USING (organization_id)
             WHERE o.organization_id =
                   '11111111-1111-4111-8111-111111111111'
               AND m.role = 'owner' AND m.status = 'active'`,
        );
        expect(transferredOwner.rows).toEqual([
            { member_did: otherDid, created_by_did: otherDid },
        ]);

        const otherExport = (await fetch(`${running.origin}/account/export`, {
            headers: { cookie: 'patchwork_session=other-session' },
        }).then(result => result.json())) as {
            data: {
                publicAidPosts: unknown[];
                publicDirectoryResources: unknown[];
                workflows: unknown[];
            };
        };
        expect(otherExport.data.publicAidPosts).toHaveLength(1);
        expect(otherExport.data.publicDirectoryResources).toHaveLength(1);
        expect(otherExport.data.workflows).toHaveLength(1);
        await stopServer(running.server);
    });
});
