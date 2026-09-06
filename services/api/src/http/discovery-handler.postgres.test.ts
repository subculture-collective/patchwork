import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordNsid } from '@patchwork/shared';
import { AtClientError } from '@patchwork/at-client';
import { PostgresProjectionQueryService } from '../query-service.js';
import { authenticateRequest } from './authenticated-request.js';
import { createDiscoveryHandler } from './discovery-handler.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const viewerDid = 'did:plc:discovery-viewer';
const blockedDid = 'did:plc:discovery-blocked';
const visibleDid = 'did:plc:discovery-visible';
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');

const startServer = async (pool: Pool) => {
    const handler = createDiscoveryHandler({
        service: new PostgresProjectionQueryService(pool),
        authenticateOptional: request =>
            request.headers.cookie ?
                authenticateRequest(request, {
                    resolveSession: async token => {
                        if (token !== 'viewer-session') {
                            throw new AtClientError(
                                'SESSION_EXPIRED',
                                'The Patchwork browser session is missing or expired.',
                            );
                        }
                        return { did: viewerDid };
                    },
                    resolveRole: async () => 'user',
                })
            :   Promise.resolve(undefined),
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

describePostgres('session-aware durable discovery HTTP boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeAll(async () => {
        await pool.query(
            `TRUNCATE user_blocks, indexer_projection_events,
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
             ) VALUES (TRUE, 2, $1)
             ON CONFLICT (singleton) DO UPDATE SET
                latest_cursor = EXCLUDED.latest_cursor,
                heartbeat_at = EXCLUDED.heartbeat_at`,
            [now],
        );
        await pool.query(
            `INSERT INTO indexer_aid_post_projections (
                uri, collection, cid, author_did_hash, title, description,
                category, urgency, status, searchable_text, latitude,
                longitude, precision_km, record_created_at, record_updated_at,
                source_cursor, source_event_id
             ) VALUES
                ($1, $3, 'cid-blocked', $4, 'Blocked author', 'Hidden for viewer',
                 'food', 'medium', 'open', 'blocked author hidden for viewer',
                 41.88, -87.63, 3, $6, $6, 1, 'blocked-event'),
                ($2, $3, 'cid-visible', $5, 'Visible author', 'Visible for viewer',
                 'food', 'medium', 'open', 'visible author visible for viewer',
                 41.88, -87.63, 3, $6, $6, 2, 'visible-event')`,
            [
                `at://${blockedDid}/${recordNsid.aidPost}/blocked`,
                `at://${visibleDid}/${recordNsid.aidPost}/visible`,
                recordNsid.aidPost,
                hash(blockedDid),
                hash(visibleDid),
                now,
            ],
        );
        await pool.query(
            `INSERT INTO user_blocks (
                command_id, blocker_did, subject_did, retention_until, created_at
             ) VALUES ('discovery-block', $1, $2,
                       NOW() + INTERVAL '1 year', NOW())`,
            [viewerDid, blockedDid],
        );
        await pool.query(
            `INSERT INTO indexer_directory_resource_projections (
                uri, collection, cid, author_did_hash, name, service_area,
                category, verification_status, contact, searchable_text,
                latitude, longitude, precision_km, open_hours,
                eligibility_notes, operational_status, record_created_at,
                record_updated_at, source_cursor, source_event_id
             ) VALUES (
                $1, $2, 'cid-directory', $3, 'Community Pantry',
                'Near North Side', 'food-bank', 'community-verified',
                '{"url":"https://pantry.example"}',
                'community pantry near north side food bank',
                41.88, -87.63, 2, 'Mon-Fri 09:00-17:00',
                'Open to local residents', 'open', $4, $4, 3,
                'directory-event'
             )`,
            [
                `at://did:plc:directory/${recordNsid.directoryResource}/pantry`,
                recordNsid.directoryResource,
                hash('did:plc:directory'),
                now,
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
                ($1, $3, 'cid-volunteer-blocked', 'rev-volunteer-blocked', $4,
                 'Blocked Volunteer', 'Private to the viewer block boundary',
                 '["food-delivery"]', 'within-24h', 'chat-only',
                 '["meal delivery"]', '["en"]', 'North side', FALSE,
                 41.91, -87.68, 2, 'blocked volunteer meal delivery',
                 $6, $6, 4, 'volunteer-blocked-event', $6),
                ($2, $3, 'cid-volunteer-visible', 'rev-volunteer-visible', $5,
                 'Visible Volunteer', 'Public volunteer profile',
                 '["translation"]', 'scheduled', 'chat-only',
                 '["interpretation"]', '["en","es"]', 'West side', TRUE,
                 41.88, -87.72, 3, 'visible volunteer interpretation',
                 $6, $6, 5, 'volunteer-visible-event', $6)`,
            [
                `at://${blockedDid}/${recordNsid.volunteerProfile}/blocked`,
                `at://${visibleDid}/${recordNsid.volunteerProfile}/visible`,
                recordNsid.volunteerProfile,
                hash(blockedDid),
                hash(visibleDid),
                now,
            ],
        );
    });

    afterAll(async () => pool.end());

    it('keeps anonymous discovery public but filters active blocks for the authenticated viewer', async () => {
        const running = await startServer(pool);
        const query = 'latitude=41.88&longitude=-87.63&radiusKm=10';
        const anonymous = await fetch(`${running.origin}/query/feed?${query}`);
        const authenticated = await fetch(
            `${running.origin}/query/feed?${query}&viewerDid=${encodeURIComponent(visibleDid)}`,
            { headers: { cookie: 'patchwork_session=viewer-session' } },
        );
        await stopServer(running.server);

        expect(anonymous.status).toBe(200);
        expect((await anonymous.json()) as { total: number }).toMatchObject({
            total: 2,
        });
        expect(authenticated.status).toBe(200);
        const body = (await authenticated.json()) as {
            total: number;
            results: Array<{ authorDid: string }>;
        };
        expect(body.total).toBe(1);
        expect(body.results).toEqual([
            expect.objectContaining({ authorDid: visibleDid }),
        ]);
        expect(JSON.stringify(body)).not.toContain(blockedDid);
    });

    it('supports a cleared map area with fine public cells and still validates partial coordinates', async () => {
        const running = await startServer(pool);
        try {
            const response = await fetch(`${running.origin}/query/map`);
            expect(response.status).toBe(200);
            const body = await response.json() as { total: number; aggregates: { locatedRequestCount: number; cells: Array<{ latitude: number; longitude: number; count: number; radiusKm: number }> } };
            expect(body.total).toBe(2);
            expect(body.aggregates.locatedRequestCount).toBe(2);
            expect(body.aggregates.cells).toHaveLength(1);
            expect(body.aggregates.cells[0]).toMatchObject({ count: 2, radiusKm: 4 });
            expect(body.aggregates.cells[0]?.latitude).toBeCloseTo(41.885);
            expect(body.aggregates.cells[0]?.longitude).toBeCloseTo(-87.625);
            const directory = await fetch(`${running.origin}/query/directory`);
            expect(directory.status).toBe(200);
            expect(await directory.json()).toMatchObject({ total: 1 });
            const partial = await fetch(`${running.origin}/query/map?latitude=41.88`);
            expect(partial.status).toBe(400);
        } finally { await stopServer(running.server); }
    });

    it('rejects an expired supplied session instead of falling back to anonymous discovery', async () => {
        const running = await startServer(pool);
        const response = await fetch(
            `${running.origin}/query/feed?latitude=41.88&longitude=-87.63&radiusKm=10`,
            { headers: { cookie: 'patchwork_session=expired-session' } },
        );
        await stopServer(running.server);

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'SESSION_EXPIRED' },
        });
    });

    it('serves public volunteer profiles and applies bilateral blocks from the authenticated session only', async () => {
        const running = await startServer(pool);
        const anonymous = await fetch(
            `${running.origin}/query/volunteers?page=1&pageSize=20`,
        );
        const authenticated = await fetch(
            `${running.origin}/query/volunteers?page=1&pageSize=20&viewerDid=${encodeURIComponent(visibleDid)}`,
            { headers: { cookie: 'patchwork_session=viewer-session' } },
        );
        await stopServer(running.server);

        expect(anonymous.status).toBe(200);
        const anonymousBody = (await anonymous.json()) as {
            total: number;
            results: Array<Record<string, unknown>>;
        };
        expect(anonymousBody.total).toBe(2);
        expect(JSON.stringify(anonymousBody)).not.toContain('contactEmail');
        expect(JSON.stringify(anonymousBody)).not.toContain(
            'matchingPreferences',
        );

        expect(authenticated.status).toBe(200);
        const authenticatedBody = (await authenticated.json()) as {
            total: number;
            results: Array<{ authorDid: string }>;
        };
        expect(authenticatedBody).toEqual(
            expect.objectContaining({
                total: 1,
                results: [
                    expect.objectContaining({ authorDid: visibleDid }),
                ],
            }),
        );
        expect(JSON.stringify(authenticatedBody)).not.toContain(blockedDid);
    });

    it('serves durable directory resources through the public discovery boundary', async () => {
        const running = await startServer(pool);
        const response = await fetch(
            `${running.origin}/query/directory?latitude=41.88&longitude=-87.63&radiusKm=10&category=food-bank`,
        );
        await stopServer(running.server);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            total: 1,
            results: [
                {
                    name: 'Community Pantry',
                    category: 'food-bank',
                    status: 'community-verified',
                    contact: { url: 'https://pantry.example' },
                    operationalStatus: 'open',
                },
            ],
        });
    });
});
