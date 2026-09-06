import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordNsid } from '@patchwork/shared';
import { PostgresProjectionQueryService } from './query-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres('PostgresProjectionQueryService', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    it('looks up a resource directly without search filters or coordinates and applies current address approval', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const uri = `at://did:plc:pantry/${recordNsid.directoryResource}/a`;
        const current = await service.queryResource(new URLSearchParams({ uri, searchText: 'unrelated', page: '999' }));
        expect(current).toMatchObject({ statusCode: 200, body: { total: 1, results: [expect.objectContaining({ uri,
            exactPublicAddress: expect.objectContaining({ streetAddress: '100 Public Way, Chicago, IL' }),
        })] } });
        const nonSpatial = await service.queryResource(new URLSearchParams({ uri: `at://did:plc:legal/${recordNsid.directoryResource}/b` }));
        expect(nonSpatial).toMatchObject({ statusCode: 200, body: { total: 1, results: [expect.objectContaining({ name: 'Regional Legal Line', contact: { phone: '+1-555-0100' } })] } });
        await pool.query("UPDATE exact_public_address_requests SET approval_expires_at = NOW() - INTERVAL '1 day'");
        expect(JSON.stringify((await service.queryResource(new URLSearchParams({ uri }))).body)).not.toContain('100 Public Way');
        expect((await service.queryResource(new URLSearchParams({ uri: uri + '-missing' }))).statusCode).toBe(404);
        expect((await service.queryResource(new URLSearchParams({ uri: 'invalid' }))).statusCode).toBe(400);
    });

    it('returns public request details without private lifecycle state and respects blocks', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const uri = `at://did:plc:alice/${recordNsid.aidPost}/a`;
        const result = await service.queryAidPost(new URLSearchParams({ uri }));
        expect(result.statusCode).toBe(200);
        expect(result.body).toMatchObject({ total: 1, results: [{ uri, title: 'Food support' }] });
        expect(JSON.stringify(result.body)).not.toMatch(/validTransitions|assignment|handoff|timeline/);
        const missing = await service.queryAidPost(new URLSearchParams({ uri: `${uri}-missing` }));
        expect(missing.statusCode).toBe(404);
        const invalid = await service.queryAidPost(new URLSearchParams({ uri: 'not-a-request' }));
        expect(invalid.statusCode).toBe(400);
        await pool.query(`INSERT INTO user_blocks (command_id, blocker_did, subject_did, created_at)
            VALUES ('detail-block', 'did:plc:viewer', 'did:plc:alice', NOW())`);
        expect((await service.queryAidPost(new URLSearchParams({ uri }), 'did:plc:viewer')).statusCode).toBe(404);
    });

    beforeAll(async () => {
        const schema = await pool.query<{
            aid_table: string | null;
            directory_table: string | null;
            volunteer_table: string | null;
        }>(
            `SELECT
                to_regclass('indexer_aid_post_projections')::TEXT AS aid_table,
                to_regclass('indexer_directory_resource_projections')::TEXT
                    AS directory_table,
                to_regclass('indexer_volunteer_profile_projections')::TEXT
                    AS volunteer_table`,
        );
        if (
            !schema.rows[0]?.aid_table ||
            !schema.rows[0]?.directory_table ||
            !schema.rows[0]?.volunteer_table
        ) {
            throw new Error('Indexer projection migrations are required.');
        }
    });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE verification_audit_events,
                      exact_public_address_requests,
                      verification_appeals,
                      verification_decisions,
                      verification_evidence_metadata,
                      verification_applications,
                      private_attachments,
                      organization_notification_events,
                      organization_audit_events,
                      organization_resource_stewardships,
                      organization_invitations,
                      organization_memberships,
                      organizations,
                      indexer_projection_events,
                      indexer_projection_tombstones,
                      indexer_aid_post_projections,
                      indexer_directory_resource_projections,
                      indexer_volunteer_profile_projections,
                      indexer_dead_letters
             RESTART IDENTITY CASCADE`,
        );
        const now = new Date();
        await pool.query(
            `INSERT INTO indexer_projection_state (
                singleton, latest_cursor, heartbeat_at
             ) VALUES (TRUE, 102, $1)
             ON CONFLICT (singleton) DO UPDATE SET
                latest_cursor = EXCLUDED.latest_cursor,
                heartbeat_at = EXCLUDED.heartbeat_at`,
            [now],
        );
        await pool.query(
            `INSERT INTO indexer_aid_post_projections (
                uri, collection, cid, revision, author_did_hash, title,
                description, category, urgency, status, searchable_text,
                latitude, longitude, precision_km, record_created_at,
                record_updated_at, source_cursor, source_event_id, projected_at
             ) VALUES
                ($1, $2, 'cid-a', 'rev-a', $3, 'Food support', 'Groceries needed',
                 'food', 'high', 'open', 'food support groceries needed',
                 41.88, -87.63, 3, $4, $4, 100, 'event-a', $4),
                ($5, $2, 'cid-b', 'rev-b', $6, 'Clinic ride', 'Ride needed',
                 'medical', 'critical', 'open', 'clinic ride needed',
                 41.89, -87.64, 3, $4, $4, 101, 'event-b', $4),
                ($7, $2, 'cid-c', 'rev-c', $8, 'Old food request', 'Already closed',
                 'food', 'low', 'closed', 'old food request already closed',
                 41.87, -87.62, 3, $4, $4, 102, 'event-c', $4)`,
            [
                `at://did:plc:alice/${recordNsid.aidPost}/a`,
                recordNsid.aidPost,
                'a'.repeat(64),
                now,
                `at://did:plc:bob/${recordNsid.aidPost}/b`,
                'b'.repeat(64),
                `at://did:plc:carol/${recordNsid.aidPost}/c`,
                'c'.repeat(64),
            ],
        );
        await pool.query(
            `INSERT INTO indexer_directory_resource_projections (
                uri, collection, cid, revision, author_did_hash, name,
                service_area, category, verification_status, contact,
                searchable_text, latitude, longitude, precision_km,
                open_hours, eligibility_notes, operational_status,
                record_created_at, record_updated_at, source_cursor,
                source_event_id, projected_at
             ) VALUES
                ($1, $2, 'directory-cid-a', 'directory-rev-a', $3,
                 'Northside Community Pantry', 'Near North Side', 'food-bank',
                 'community-verified', '{"url":"https://pantry.example"}',
                 'northside community pantry near north side food bank',
                 41.90, -87.64, 2, 'Mon-Fri 09:00-17:00',
                 'Open to local residents', 'open', $4, $4, 200,
                 'directory-event-a', $4),
                ($5, $2, 'directory-cid-b', 'directory-rev-b', $6,
                 'Regional Legal Line', 'Illinois', 'legal-aid',
                 'partner-verified', '{"phone":"+1-555-0100"}',
                 'regional legal line illinois legal aid',
                 NULL, NULL, NULL, 'Daily 08:00-20:00',
                 'Call for intake', 'limited', $4, $4, 201,
                 'directory-event-b', $4)`,
            [
                `at://did:plc:pantry/${recordNsid.directoryResource}/a`,
                recordNsid.directoryResource,
                'd'.repeat(64),
                now,
                `at://did:plc:legal/${recordNsid.directoryResource}/b`,
                'e'.repeat(64),
            ],
        );
        await pool.query(
            `INSERT INTO indexer_volunteer_profile_projections (
                uri, collection, cid, revision, author_did_hash,
                display_name, bio, capabilities, availability,
                contact_preference, skills, languages, service_area_label,
                no_permanent_address, latitude, longitude, precision_km,
                searchable_text, record_created_at, record_updated_at,
                source_cursor, source_event_id, projected_at
             ) VALUES
                ($1, $2, 'volunteer-cid-a', 'volunteer-rev-a', $3,
                 'Alex Rivera', 'Neighborhood delivery volunteer',
                 '["food-delivery","translation"]', 'within-24h',
                 'chat-only', '["meal delivery"]', '["en","es"]',
                 'Near North Side', TRUE, 41.9, -87.64, 2,
                 'alex rivera neighborhood delivery volunteer food delivery',
                 $4, $4, 300, 'volunteer-event-a', $4)`,
            [
                `at://did:plc:alex/${recordNsid.volunteerProfile}/main`,
                recordNsid.volunteerProfile,
                'f'.repeat(64),
                now,
            ],
        );
        await pool.query(
            `INSERT INTO organizations (
                organization_id, slug, name, description, origin,
                source_url, source_retrieved_at,
                source_last_verified_at, non_endorsement_label,
                created_by_did, created_at, updated_at
             ) VALUES (
                '11111111-1111-4111-8111-111111111111',
                'directory-owner', 'Directory Owner', '',
                'visitor-created', NULL, NULL, NULL,
                'No endorsement.', 'did:plc:directory', $1, $1
             )`,
            [now],
        );
        await pool.query(
            `INSERT INTO verification_applications (
                application_id, applicant_did, subject_type,
                organization_id, subject_ref, status, submitted_at,
                decided_at, expires_at, revoked_at, updated_at
             ) VALUES
                ('22222222-2222-4222-8222-222222222222',
                 'did:plc:directory', 'organization',
                 '11111111-1111-4111-8111-111111111111',
                 '11111111-1111-4111-8111-111111111111',
                 'approved', $1, $1,
                 $1::timestamptz + INTERVAL '1 year', NULL, $1),
                ('33333333-3333-4333-8333-333333333333',
                 'did:plc:directory', 'resource',
                 '11111111-1111-4111-8111-111111111111', $2,
                 'approved', $1, $1,
                 $1::timestamptz + INTERVAL '1 year', NULL, $1)`,
            [
                now,
                `at://did:plc:pantry/${recordNsid.directoryResource}/a`,
            ],
        );
        await pool.query(
            `INSERT INTO organization_memberships (
                organization_id, member_did, role, status,
                invited_by_did, joined_at, updated_at
             ) VALUES (
                '11111111-1111-4111-8111-111111111111',
                'did:plc:directory', 'owner', 'active',
                'did:plc:directory', $1, $1
             )`,
            [now],
        );
        await pool.query(
            `INSERT INTO organization_resource_stewardships (
                stewardship_id, organization_id, resource_uri,
                steward_did, status, last_reconfirmed_at,
                reconfirm_due_at, created_at, updated_at
             ) VALUES (
                '55555555-5555-4555-8555-555555555555',
                '11111111-1111-4111-8111-111111111111', $2,
                'did:plc:directory', 'active', $1,
                $1::timestamptz + INTERVAL '90 days', $1, $1
             )`,
            [
                now,
                `at://did:plc:pantry/${recordNsid.directoryResource}/a`,
            ],
        );
        await pool.query(
            `INSERT INTO exact_public_address_requests (
                request_id, organization_id, resource_uri, applicant_did,
                street_address, latitude, longitude,
                confidential_facility, status, requested_at, decided_at,
                decided_by_did, decision_reason, approval_expires_at,
                updated_at
             ) VALUES (
                '44444444-4444-4444-8444-444444444444',
                '11111111-1111-4111-8111-111111111111', $1,
                'did:plc:directory', '100 Public Way, Chicago, IL',
                41.881, -87.631, FALSE, 'approved', $2, $2,
                'did:plc:moderator', 'Verified public facility.',
                $2::timestamptz + INTERVAL '1 year', $2
             )`,
            [
                `at://did:plc:pantry/${recordNsid.directoryResource}/a`,
                now,
            ],
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('filters and paginates exclusively over durable projections with freshness metadata', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const first = await service.queryMap(
            new URLSearchParams({
                latitude: '41.88',
                longitude: '-87.63',
                radiusKm: '25',
                status: 'open',
                page: '1',
                pageSize: '1',
            }),
        );
        const second = await service.queryMap(
            new URLSearchParams({
                latitude: '41.88',
                longitude: '-87.63',
                radiusKm: '25',
                status: 'open',
                page: '2',
                pageSize: '1',
            }),
        );
        const repeatedFirst = await service.queryMap(
            new URLSearchParams({
                latitude: '41.88',
                longitude: '-87.63',
                radiusKm: '25',
                status: 'open',
                page: '1',
                pageSize: '1',
            }),
        );

        expect(first.statusCode).toBe(200);
        expect(first.body).toMatchObject({
            total: 2,
            page: 1,
            pageSize: 1,
            hasNextPage: true,
            projectionFreshness: {
                latestCursor: 102,
                lagSeconds: expect.any(Number),
            },
        });
        expect(second.body).toMatchObject({
            total: 2,
            page: 2,
            pageSize: 1,
            hasNextPage: false,
        });
        const firstUri = (first.body as { results: Array<{ uri: string }> }).results[0]?.uri;
        const secondUri = (second.body as { results: Array<{ uri: string }> }).results[0]?.uri;
        expect(firstUri).toBeTruthy();
        expect(secondUri).toBeTruthy();
        expect(firstUri).not.toBe(secondUri);
        expect(
            (repeatedFirst.body as { results: Array<{ uri: string }> }).results[0]
                ?.uri,
        ).toBe(firstUri);
    });

    it('enforces category, urgency, status, geography, search, and freshness filters', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const result = await service.queryFeed(
            new URLSearchParams({
                latitude: '41.88',
                longitude: '-87.63',
                radiusKm: '5',
                category: 'food',
                urgency: 'high',
                status: 'open',
                searchText: 'groceries',
                freshnessHours: '1',
            }),
        );

        expect(result.body).toMatchObject({
            total: 1,
            results: [
                {
                    uri: `at://did:plc:alice/${recordNsid.aidPost}/a`,
                    cid: 'cid-a',
                    category: 'food',
                    urgency: 'high',
                    status: 'open',
                },
            ],
        });
    });

    it('queries durable directory projections with filters, geography, and freshness', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const nearby = await service.queryDirectory(
            new URLSearchParams({
                latitude: '41.90',
                longitude: '-87.64',
                radiusKm: '5',
                category: 'food-bank',
                status: 'community-verified',
                operationalStatus: 'open',
                searchText: 'pantry',
                freshnessHours: '1',
                page: '1',
                pageSize: '10',
            }),
        );

        expect(nearby.statusCode).toBe(200);
        expect(nearby.body).toMatchObject({
            total: 1,
            page: 1,
            pageSize: 10,
            hasNextPage: false,
            results: [
                {
                    uri: `at://did:plc:pantry/${recordNsid.directoryResource}/a`,
                    name: 'Northside Community Pantry',
                    category: 'food-bank',
                    status: 'community-verified',
                    operationalStatus: 'open',
                    contact: { url: 'https://pantry.example' },
                    approximateGeo: {
                        latitude: 41.9,
                        longitude: -87.64,
                        precisionKm: 2,
                    },
                },
            ],
            projectionFreshness: {
                latestCursor: 102,
                lagSeconds: expect.any(Number),
            },
        });

        const all = await service.queryDirectory(
            new URLSearchParams({ page: '1', pageSize: '10' }),
        );
        expect(all.body).toMatchObject({ total: 2 });
        expect(
            (all.body as { results: unknown[] }).results,
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: 'Northside Community Pantry',
                    approximateGeo: {
                        latitude: 41.9,
                        longitude: -87.64,
                        precisionKm: 2,
                    },
                }),
                expect.objectContaining({
                    name: 'Regional Legal Line',
                }),
            ]),
        );
        expect(
            (
                all.body as {
                    results: Array<{
                        name: string;
                        approximateGeo?: unknown;
                    }>;
                }
            ).results.find(row => row.name === 'Regional Legal Line')
                ?.approximateGeo,
        ).toBeUndefined();
    });

    it('queries only public volunteer projection fields with deterministic filters', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const result = await service.queryVolunteers(
            new URLSearchParams({
                capability: 'translation',
                language: 'es',
                availability: 'within-24h',
                searchText: 'delivery',
            }),
        );

        expect(result).toMatchObject({
            statusCode: 200,
            body: {
                total: 1,
                results: [
                    {
                        authorDid: 'did:plc:alex',
                        displayName: 'Alex Rivera',
                        capabilities: ['food-delivery', 'translation'],
                        languages: ['en', 'es'],
                        serviceArea: {
                            areaLabel: 'Near North Side',
                            noPermanentAddress: true,
                            approximateGeo: { precisionKm: 2 },
                        },
                    },
                ],
            },
        });
        expect(JSON.stringify(result.body)).not.toContain('contactEmail');
        expect(JSON.stringify(result.body)).not.toContain(
            'matchingPreferences',
        );
    });

    it('projects an exact public address only while all three approval gates remain active', async () => {
        const service = new PostgresProjectionQueryService(pool);
        const active = await service.queryDirectory(
            new URLSearchParams({ searchText: 'pantry' }),
        );
        expect(active).toMatchObject({
            statusCode: 200,
            body: {
                results: [
                    expect.objectContaining({
                        exactPublicAddress: expect.objectContaining({
                            kind: 'exact-public-resource',
                            streetAddress: '100 Public Way, Chicago, IL',
                            latitude: 41.881,
                            longitude: -87.631,
                        }),
                    }),
                ],
            },
        });

        await pool.query(
            `UPDATE verification_applications
             SET status = 'revoked'
             WHERE subject_type = 'organization'`,
        );
        const revoked = await service.queryDirectory(
            new URLSearchParams({ searchText: 'pantry' }),
        );
        expect(JSON.stringify(revoked.body)).not.toContain(
            'exactPublicAddress',
        );
        expect(JSON.stringify(revoked.body)).not.toContain(
            '100 Public Way',
        );
    });
});
