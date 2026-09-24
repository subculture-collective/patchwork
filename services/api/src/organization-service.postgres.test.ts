import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PublicHttpError } from './http/error-response.js';
import { OrganizationService } from './organization-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const ownerDid = 'did:plc:organization-owner';
const stewardDid = 'did:plc:organization-steward';
const memberDid = 'did:plc:organization-member';

describe('OrganizationService PostgreSQL boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE organization_notification_events,
                      organization_audit_events,
                      organization_resource_stewardships,
                      organization_invitations,
                      organization_memberships,
                      organizations
             RESTART IDENTITY CASCADE`,
        );
    });

    afterAll(async () => pool.end());

    it('persists real-DID ownership, invitations, roles, stewardship, and reconfirmation across service restart', async () => {
        const createdAt = new Date('2026-01-01T12:00:00.000Z');
        const service = new OrganizationService(pool);
        const created = await service.create(
            ownerDid,
            {
                name: 'Northside Mutual Aid',
                description: 'Local resource coordination.',
            },
            createdAt,
        );
        const organization = (
            created as {
                organization: {
                    id: string;
                    origin: string;
                    provenance: unknown;
                    nonEndorsementLabel: string;
                };
            }
        ).organization;
        expect(organization.id).not.toMatch(/^did:/);
        expect(organization).toMatchObject({
            origin: 'visitor-created',
            provenance: null,
        });
        expect(organization.nonEndorsementLabel).toContain(
            'does not endorse',
        );

        const invitation = await service.invite(
            ownerDid,
            {
                organizationId: organization.id,
                inviteeDid: stewardDid,
                role: 'steward',
            },
            createdAt,
        );
        const token = (invitation as { token: string }).token;
        expect(token).toHaveLength(43);
        const persistedInvitation = await pool.query<{
            token_hash: string;
        }>(
            `SELECT token_hash FROM organization_invitations
             WHERE organization_id = $1`,
            [organization.id],
        );
        expect(persistedInvitation.rows[0]?.token_hash).toHaveLength(64);
        expect(persistedInvitation.rows[0]?.token_hash).not.toBe(token);

        await expect(
            service.acceptInvitation(memberDid, { token }, createdAt),
        ).rejects.toMatchObject({
            statusCode: 403,
            code: 'INVITATION_NOT_ACCEPTABLE',
        });
        await service.acceptInvitation(stewardDid, { token }, createdAt);

        const resourceUri =
            `at://${stewardDid}/app.patchwork.directory.resource/pantry`;
        const assigned = await service.assignStewardship(
            ownerDid,
            {
                organizationId: organization.id,
                resourceUri,
                stewardDid,
            },
            createdAt,
        );
        const assignedStewardship = (
            assigned as {
                stewardship: { id: string; reconfirmDueAt: string };
            }
        ).stewardship;
        expect(assignedStewardship.reconfirmDueAt).toBe(
            '2026-04-01T12:00:00.000Z',
        );

        const afterRestart = new OrganizationService(pool);
        await expect(afterRestart.listMine(stewardDid)).resolves.toMatchObject({
            organizations: [
                {
                    id: organization.id,
                    membership: { memberDid: stewardDid, role: 'steward' },
                },
            ],
        });
        const sweep = await afterRestart.runReconfirmationSweep(
            new Date('2026-04-02T12:00:00.000Z'),
        );
        expect(sweep).toEqual({ due: 1, expired: 0, events: 1 });
        expect(
            await afterRestart.runReconfirmationSweep(
                new Date('2026-04-02T13:00:00.000Z'),
            ),
        ).toEqual({ due: 0, expired: 0, events: 0 });
        const event = await pool.query<{
            recipient_did: string;
            payload: Record<string, unknown>;
        }>(
            `SELECT recipient_did, payload
             FROM organization_notification_events`,
        );
        expect(event.rows).toEqual([
            expect.objectContaining({
                recipient_did: stewardDid,
                payload: expect.objectContaining({ resourceUri }),
            }),
        ]);
        expect(JSON.stringify(event.rows)).not.toMatch(
            /latitude|longitude|contactEmail|contactPhone/,
        );

        await expect(
            afterRestart.reconfirmStewardship(
                stewardDid,
                {
                    organizationId: organization.id,
                    stewardshipId: assignedStewardship.id,
                },
                new Date('2026-04-02T14:00:00.000Z'),
            ),
        ).resolves.toMatchObject({
            stewardship: {
                status: 'active',
                reconfirmDueAt: '2026-07-01T14:00:00.000Z',
            },
        });
        await expect(
            afterRestart.getPublic(organization.id),
        ).resolves.toMatchObject({
            organization: {
                id: organization.id,
                origin: 'visitor-created',
            },
            resources: [
                expect.objectContaining({
                    resourceUri,
                    lastReconfirmedAt: '2026-04-02T14:00:00.000Z',
                }),
            ],
        });
    });

    it('rejects forged origin fields and enforces owner/admin/steward capabilities', async () => {
        const service = new OrganizationService(pool);
        await expect(
            service.create(ownerDid, {
                name: 'Forged source',
                description: '',
                origin: 'sourced-public',
                sourceUrl: 'https://example.test',
            }),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: 'INVALID_ORGANIZATION',
        });

        const created = await service.create(ownerDid, {
            name: 'Capability Test',
            description: '',
        });
        const organizationId = (
            created as { organization: { id: string } }
        ).organization.id;
        const memberInvitation = await service.invite(ownerDid, {
            organizationId,
            inviteeDid: memberDid,
            role: 'member',
        });
        await service.acceptInvitation(memberDid, {
            token: (memberInvitation as { token: string }).token,
        });

        await expect(
            service.invite(memberDid, {
                organizationId,
                inviteeDid: stewardDid,
                role: 'steward',
            }),
        ).rejects.toBeInstanceOf(PublicHttpError);
        await expect(
            service.assignStewardship(memberDid, {
                organizationId,
                resourceUri:
                    `at://${memberDid}/app.patchwork.directory.resource/one`,
                stewardDid: memberDid,
            }),
        ).rejects.toMatchObject({
            statusCode: 403,
            code: 'ORGANIZATION_CAPABILITY_REQUIRED',
        });
        await expect(
            service.updateRole(memberDid, {
                organizationId,
                memberDid,
                role: 'admin',
            }),
        ).rejects.toMatchObject({ statusCode: 403 });

        await service.updateRole(ownerDid, {
            organizationId,
            memberDid,
            role: 'steward',
        });
        await expect(
            service.removeMember(memberDid, {
                organizationId,
                memberDid: ownerDid,
            }),
        ).rejects.toMatchObject({ statusCode: 403 });

        const publicResult = await service.getPublic(organizationId);
        expect(JSON.stringify(publicResult)).not.toContain('members');
        expect(JSON.stringify(publicResult)).not.toContain(memberDid);
        const audit = await service.getAudit(ownerDid, organizationId);
        expect(audit).toMatchObject({
            events: expect.arrayContaining([
                expect.objectContaining({
                    action: 'member-role-updated',
                    actorDid: ownerDid,
                }),
            ]),
        });
    });
});
