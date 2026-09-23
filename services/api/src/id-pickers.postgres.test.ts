import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DurableGroupService } from './durable-group-service.js';
import { OrganizationService } from './organization-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const ownerDid = 'did:plc:picker-owner';
const stewardDid = 'did:plc:picker-steward';
const memberDid = 'did:plc:picker-member';
const outsiderDid = 'did:plc:picker-outsider';
const helperDid = 'did:plc:picker-helper';
const now = new Date('2026-09-01T12:00:00.000Z');
const didHash = (did: string) => createHash('sha256').update(did).digest('hex');

describePostgres('ID picker list endpoints (PostgreSQL)', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    const insertResource = async (authorDid: string, slug: string, name: string) => {
        const uri = `at://${authorDid}/app.patchwork.directory.resource/${slug}`;
        await pool.query(
            `INSERT INTO indexer_directory_resource_projections (
                 uri, collection, cid, revision, author_did_hash, name,
                 service_area, category, verification_status, contact,
                 searchable_text, operational_status, record_created_at,
                 record_updated_at, source_cursor, source_event_id
             ) VALUES ($1, 'app.patchwork.directory.resource', 'bafy', '1', $2,
                 $3, 'Test area', 'food-bank', 'unverified',
                 '{"url":"https://example.invalid"}', $3, 'open', $4, $4,
                 1, $5)`,
            [uri, didHash(authorDid), name, now, `test:${slug}`],
        );
        return uri;
    };

    const insertRequest = async (
        requesterDid: string,
        slug: string,
        title: string,
        status = 'open',
    ) => {
        const uri = `at://${requesterDid}/app.patchwork.aid.post/${slug}`;
        await pool.query(
            `INSERT INTO request_workflows (post_uri, requester_did, current_status,
                 create_command_id, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $5)`,
            [uri, requesterDid, status, `cmd-${slug}`, now],
        );
        await pool.query(
            `INSERT INTO indexer_aid_post_projections (
                 uri, collection, cid, revision, author_did_hash, title,
                 description, category, urgency, status, searchable_text,
                 latitude, longitude, precision_km,
                 record_created_at, record_updated_at, source_cursor,
                 source_event_id
             ) VALUES ($1, 'app.patchwork.aid.post', 'bafy', '1', $2, $3,
                 'Test request', 'food', 'medium', 'open', $3,
                 41.85, -87.65, 1, $4, $4, 1, $5)`,
            [uri, didHash(requesterDid), title, now, `test:${slug}`],
        );
        return uri;
    };

    const connect = async (requestUri: string, requesterDid: string, helper: string) => {
        const offerId = randomUUID();
        await pool.query(
            `INSERT INTO coordination_offers (offer_id, request_uri, requester_did,
                 offerer_did, status, offered_at, expires_at, decided_at, updated_at)
             VALUES ($1, $2, $3, $4, 'accepted', $5, $5, $5, $5)`,
            [offerId, requestUri, requesterDid, helper, now],
        );
        await pool.query(
            `INSERT INTO coordination_connections (connection_id, offer_id,
                 request_uri, requester_did, helper_did, status, accepted_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
            [randomUUID(), offerId, requestUri, requesterDid, helper, now],
        );
    };

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE organization_notification_events, organization_audit_events,
                      organization_resource_stewardships, organization_invitations,
                      organization_memberships, organizations,
                      coordination_connections, coordination_offers,
                      request_workflows, user_blocks, moderation_queue_items,
                      indexer_directory_resource_projections,
                      indexer_aid_post_projections
             RESTART IDENTITY CASCADE`,
        );
    });

    afterAll(async () => pool.end());

    it('lists only member-authored resources, with stewardship, to stewards and above', async () => {
        const service = new OrganizationService(pool);
        const created = (await service.create(
            ownerDid,
            { name: 'Picker Mutual Aid', description: '' },
            now,
        )) as { organization: { id: string } };
        const organizationId = created.organization.id;
        for (const [did, role] of [[stewardDid, 'steward'], [memberDid, 'member']] as const) {
            const { token } = (await service.invite(
                ownerDid,
                { organizationId, inviteeDid: did, role },
                now,
            )) as { token: string };
            await service.acceptInvitation(did, { token }, now);
        }
        const pantry = await insertResource(stewardDid, 'pantry', 'Zeta Pantry');
        await insertResource(memberDid, 'clinic', 'Alpha Clinic');
        await insertResource(outsiderDid, 'elsewhere', 'Outsider Shelter');
        await service.assignStewardship(
            ownerDid,
            { organizationId, resourceUri: pantry, stewardDid },
            now,
        );

        const listed = (await service.listResources(stewardDid, organizationId)) as {
            resources: { uri: string; name: string; authorDid: string; stewardship: unknown }[];
        };
        expect(listed.resources.map(resource => resource.name)).toEqual([
            'Alpha Clinic',
            'Zeta Pantry',
        ]);
        expect(listed.resources[1]).toMatchObject({
            uri: pantry,
            authorDid: stewardDid,
            stewardship: { stewardDid, status: 'active' },
        });
        expect(listed.resources[0]?.stewardship).toBeNull();

        await expect(service.listResources(memberDid, organizationId)).rejects.toMatchObject({
            statusCode: 403,
        });
        await expect(service.listResources(outsiderDid, organizationId)).rejects.toMatchObject({
            statusCode: 403,
        });
    });

    it('lists own and actively connected requests, hiding archived, blocked and moderated ones', async () => {
        const mine = await insertRequest(ownerDid, 'mine', 'My groceries');
        await insertRequest(ownerDid, 'archived', 'Old request', 'archived');
        const moderated = await insertRequest(ownerDid, 'moderated', 'Hidden request');
        await pool.query(
            `INSERT INTO moderation_queue_items (subject_uri, queue_id, subject_type,
                 latest_reason, visibility)
             VALUES ($1, 'q1', 'aid-post', 'spam', 'delisted')`,
            [moderated],
        );
        const helping = await insertRequest(helperDid, 'helping', 'Ride to clinic');
        await connect(helping, helperDid, ownerDid);
        await insertRequest(outsiderDid, 'unrelated', 'Not mine');
        const blocked = await insertRequest(memberDid, 'blocked', 'Blocked requester');
        await connect(blocked, memberDid, ownerDid);
        await pool.query(
            `INSERT INTO user_blocks (command_id, blocker_did, subject_did, created_at)
             VALUES ('block-1', $1, $2, $3)`,
            [memberDid, ownerDid, now],
        );

        const service = new DurableGroupService(pool);
        const listed = (await service.listLinkableRequests(ownerDid)) as {
            requests: { uri: string; title: string | null; role: string }[];
        };
        expect(listed.requests.map(request => request.uri).sort()).toEqual(
            [helping, mine].sort(),
        );
        expect(listed.requests.find(request => request.uri === mine)).toMatchObject({
            title: 'My groceries',
            role: 'requester',
        });
        expect(listed.requests.find(request => request.uri === helping)).toMatchObject({
            title: 'Ride to clinic',
            role: 'helper',
        });
    });
});
