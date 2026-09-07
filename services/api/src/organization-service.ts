import { PublicResourceClaimService } from './public-resource-claim-service.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
    didSchema,
    organizationNonEndorsementLabel,
    organizationRoleRank,
    organizationRoleSchema,
    type OrganizationRole,
} from '@patchwork/shared';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const organizationIdSchema = z.string().uuid();
const resourceUriSchema = z
    .string()
    .regex(
        /^at:\/\/(did:[^/]+)\/app\.patchwork\.directory\.resource\/[^/]+$/,
    );
const createOrganizationSchema = z
    .object({
        name: z.string().trim().min(1).max(160),
        description: z.string().trim().max(2000),
    })
    .strict();
const invitationSchema = z
    .object({
        organizationId: organizationIdSchema,
        inviteeDid: didSchema,
        role: z.enum(['admin', 'steward', 'member']),
    })
    .strict();
const acceptInvitationSchema = z.object({ token: z.string().min(32).max(256) }).strict();
const roleUpdateSchema = z
    .object({
        organizationId: organizationIdSchema,
        memberDid: didSchema,
        role: z.enum(['admin', 'steward', 'member']),
    })
    .strict();
const memberRemoveSchema = z
    .object({
        organizationId: organizationIdSchema,
        memberDid: didSchema,
    })
    .strict();
const stewardshipSchema = z
    .object({
        organizationId: organizationIdSchema,
        resourceUri: resourceUriSchema,
        stewardDid: didSchema,
    })
    .strict();
const stewardshipReferenceSchema = z
    .object({
        organizationId: organizationIdSchema,
        stewardshipId: z.string().uuid(),
    })
    .strict();

const iso = (value: Date | string): string => new Date(value).toISOString();
const tokenHash = (token: string): string =>
    createHash('sha256').update(token).digest('hex');
const plusDays = (date: Date, days: number): Date =>
    new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const toSlug = (name: string): string =>
    name
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || 'organization';

interface OrganizationRow {
    organization_id: string;
    slug: string;
    name: string;
    description: string;
    origin: 'synthetic' | 'sourced-public' | 'visitor-created';
    source_url: string | null;
    source_retrieved_at: Date | string | null;
    source_last_verified_at: Date | string | null;
    non_endorsement_label: string;
    created_at: Date | string;
    updated_at: Date | string;
}

interface MembershipRow {
    organization_id: string;
    member_did: string;
    role: OrganizationRole;
    status: 'active' | 'removed';
    invited_by_did: string;
    joined_at: Date | string;
    updated_at: Date | string;
}

interface StewardshipRow {
    stewardship_id: string;
    organization_id: string;
    resource_uri: string;
    steward_did: string;
    status: 'active' | 'due' | 'expired' | 'revoked';
    last_reconfirmed_at: Date | string;
    reconfirm_due_at: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
}

const publicOrganization = (row: OrganizationRow) => ({
    id: row.organization_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    origin: row.origin,
    provenance:
        row.origin === 'sourced-public' &&
        row.source_url &&
        row.source_retrieved_at &&
        row.source_last_verified_at ?
            {
                sourceUrl: row.source_url,
                retrievedAt: iso(row.source_retrieved_at),
                lastVerifiedAt: iso(row.source_last_verified_at),
            }
        :   null,
    nonEndorsementLabel: row.non_endorsement_label,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
});

const membership = (row: MembershipRow) => ({
    organizationId: row.organization_id,
    memberDid: row.member_did,
    role: row.role,
    status: row.status,
    invitedByDid: row.invited_by_did,
    joinedAt: iso(row.joined_at),
    updatedAt: iso(row.updated_at),
});

const stewardship = (row: StewardshipRow) => ({
    id: row.stewardship_id,
    organizationId: row.organization_id,
    resourceUri: row.resource_uri,
    stewardDid: row.steward_did,
    status: row.status,
    lastReconfirmedAt: iso(row.last_reconfirmed_at),
    reconfirmDueAt: iso(row.reconfirm_due_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
});

const invalid = (code: string, message: string): never => {
    throw new PublicHttpError(400, code, message);
};
const parseOrganizationId = (value: string): string => {
    const parsed = organizationIdSchema.safeParse(value);
    return parsed.success ?
            parsed.data
        :   invalid(
                'INVALID_ORGANIZATION_ID',
                'The organization identifier is invalid.',
            );
};

export class OrganizationService {
    listResourceClaims(actorDid: string) { return new PublicResourceClaimService(this.pool).list(actorDid); }
    submitResourceClaim(actorDid: string, input: unknown) { return new PublicResourceClaimService(this.pool).submit(actorDid,input); }
    decideResourceClaim(actorDid: string, input: unknown) { return new PublicResourceClaimService(this.pool).decide(actorDid,input); }
    editPublicResource(actorDid: string, input: unknown) { return new PublicResourceClaimService(this.pool).edit(actorDid,input); }

    constructor(private readonly pool: Pool) {}

    async listPublic(searchText?: string): Promise<Record<string, unknown>> {
        const search = searchText?.trim().toLowerCase();
        if (search && search.length > 120) {
            invalid('INVALID_ORGANIZATION_QUERY', 'The organization query is invalid.');
        }
        const result = await this.pool.query<OrganizationRow>(
            `SELECT organization_id, slug, name, description, origin,
                    source_url, source_retrieved_at,
                    source_last_verified_at, non_endorsement_label,
                    created_at, updated_at
             FROM organizations
             WHERE ($1::text IS NULL OR
                    lower(name || ' ' || description) LIKE '%' || $1 || '%')
             ORDER BY name, organization_id`,
            [search || null],
        );
        return { organizations: result.rows.map(publicOrganization) };
    }

    async getPublic(idOrSlug: string): Promise<Record<string, unknown>> {
        const value = idOrSlug.trim();
        const result = await this.pool.query<OrganizationRow>(
            `SELECT organization_id, slug, name, description, origin,
                    source_url, source_retrieved_at,
                    source_last_verified_at, non_endorsement_label,
                    created_at, updated_at
             FROM organizations
             WHERE organization_id::text = $1 OR slug = $1`,
            [value],
        );
        const row = result.rows[0];
        if (!row) {
            throw new PublicHttpError(
                404,
                'ORGANIZATION_NOT_FOUND',
                'The organization was not found.',
            );
        }
        const resources = await this.pool.query<StewardshipRow>(
            `SELECT stewardship_id, organization_id, resource_uri,
                    steward_did, status, last_reconfirmed_at,
                    reconfirm_due_at, created_at, updated_at
             FROM organization_resource_stewardships
             WHERE organization_id = $1 AND status = 'active'
             ORDER BY resource_uri`,
            [row.organization_id],
        );
        return {
            organization: publicOrganization(row),
            resources: resources.rows.map(item => ({
                id: item.stewardship_id,
                resourceUri: item.resource_uri,
                lastReconfirmedAt: iso(item.last_reconfirmed_at),
                reconfirmDueAt: iso(item.reconfirm_due_at),
            })),
        };
    }

    async listMine(actorDid: string): Promise<Record<string, unknown>> {
        const result = await this.pool.query<
            OrganizationRow & MembershipRow
        >(
            `SELECT o.organization_id, o.slug, o.name, o.description,
                    o.origin, o.source_url, o.source_retrieved_at,
                    o.source_last_verified_at, o.non_endorsement_label,
                    o.created_at, o.updated_at, m.member_did, m.role,
                    m.status, m.invited_by_did, m.joined_at,
                    m.updated_at AS membership_updated_at
             FROM organization_memberships m
             JOIN organizations o USING (organization_id)
             WHERE m.member_did = $1 AND m.status = 'active'
             ORDER BY o.name, o.organization_id`,
            [actorDid],
        );
        return {
            organizations: result.rows.map(row => ({
                ...publicOrganization(row),
                membership: {
                    organizationId: row.organization_id,
                    memberDid: row.member_did,
                    role: row.role,
                    status: row.status,
                    invitedByDid: row.invited_by_did,
                    joinedAt: iso(row.joined_at),
                    updatedAt: iso(
                        (row as unknown as { membership_updated_at: Date | string })
                            .membership_updated_at,
                    ),
                },
            })),
        };
    }

    async create(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = createOrganizationSchema.safeParse(input);
        if (!parsed.success) {
            return invalid(
                'INVALID_ORGANIZATION',
                'The organization name or description is invalid.',
            );
        }
        const id = randomUUID();
        const baseSlug = toSlug(parsed.data.name);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const collision = await client.query(
                `SELECT 1 FROM organizations WHERE slug = $1`,
                [baseSlug],
            );
            const slug =
                collision.rowCount ?
                    `${baseSlug.slice(0, 70)}-${id.slice(0, 8)}`
                :   baseSlug;
            await client.query(
                `INSERT INTO organizations (
                    organization_id, slug, name, description, origin,
                    source_url, source_retrieved_at,
                    source_last_verified_at, non_endorsement_label,
                    created_by_did, created_at, updated_at
                 ) VALUES ($1, $2, $3, $4, 'visitor-created',
                           NULL, NULL, NULL, $5, $6, $7, $7)`,
                [
                    id,
                    slug,
                    parsed.data.name,
                    parsed.data.description,
                    organizationNonEndorsementLabel,
                    actorDid,
                    now,
                ],
            );
            await client.query(
                `INSERT INTO organization_memberships (
                    organization_id, member_did, role, status,
                    invited_by_did, joined_at, updated_at
                 ) VALUES ($1, $2, 'owner', 'active', $2, $3, $3)`,
                [id, actorDid, now],
            );
            await this.audit(
                client,
                id,
                actorDid,
                'organization-created',
                id,
                { origin: 'visitor-created' },
                now,
            );
            await client.query('COMMIT');
            return this.getPublic(id);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async invite(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = invitationSchema.safeParse(input);
        if (!parsed.success) {
            return invalid('INVALID_INVITATION', 'The organization invitation is invalid.');
        }
        await this.requireRole(parsed.data.organizationId, actorDid, 'admin');
        const existing = await this.pool.query(
            `SELECT 1 FROM organization_memberships
             WHERE organization_id = $1 AND member_did = $2
               AND status = 'active'`,
            [parsed.data.organizationId, parsed.data.inviteeDid],
        );
        if (existing.rowCount) {
            throw new PublicHttpError(
                409,
                'ORGANIZATION_MEMBER_EXISTS',
                'That account is already an active member.',
            );
        }
        const token = randomBytes(32).toString('base64url');
        const invitationId = randomUUID();
        const expiresAt = plusDays(now, 7);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE organization_invitations
                 SET status = 'revoked'
                 WHERE organization_id = $1 AND invitee_did = $2
                   AND status = 'pending'`,
                [parsed.data.organizationId, parsed.data.inviteeDid],
            );
            await client.query(
                `INSERT INTO organization_invitations (
                    invitation_id, organization_id, invitee_did, role,
                    token_hash, status, invited_by_did, expires_at,
                    created_at, accepted_at
                 ) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, NULL)`,
                [
                    invitationId,
                    parsed.data.organizationId,
                    parsed.data.inviteeDid,
                    parsed.data.role,
                    tokenHash(token),
                    actorDid,
                    expiresAt,
                    now,
                ],
            );
            await this.audit(
                client,
                parsed.data.organizationId,
                actorDid,
                'member-invited',
                parsed.data.inviteeDid,
                { role: parsed.data.role, invitationId },
                now,
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        return {
            invitation: {
                id: invitationId,
                organizationId: parsed.data.organizationId,
                inviteeDid: parsed.data.inviteeDid,
                role: parsed.data.role,
                status: 'pending',
                invitedByDid: actorDid,
                expiresAt: expiresAt.toISOString(),
                createdAt: now.toISOString(),
                acceptedAt: null,
            },
            token,
        };
    }

    async listInvitations(actorDid: string): Promise<Record<string, unknown>> {
        await this.expireInvitations();
        const result = await this.pool.query<{
            invitation_id: string;
            organization_id: string;
            invitee_did: string;
            role: 'admin' | 'steward' | 'member';
            status: 'pending' | 'accepted' | 'revoked' | 'expired';
            invited_by_did: string;
            expires_at: Date | string;
            created_at: Date | string;
            accepted_at: Date | string | null;
            organization_name: string;
        }>(
            `SELECT i.invitation_id, i.organization_id, i.invitee_did,
                    i.role, i.status, i.invited_by_did, i.expires_at,
                    i.created_at, i.accepted_at, o.name AS organization_name
             FROM organization_invitations i
             JOIN organizations o USING (organization_id)
             WHERE i.invitee_did = $1 AND i.status = 'pending'
             ORDER BY i.created_at, i.invitation_id`,
            [actorDid],
        );
        return {
            invitations: result.rows.map(row => ({
                id: row.invitation_id,
                organizationId: row.organization_id,
                organizationName: row.organization_name,
                inviteeDid: row.invitee_did,
                role: row.role,
                status: row.status,
                invitedByDid: row.invited_by_did,
                expiresAt: iso(row.expires_at),
                createdAt: iso(row.created_at),
                acceptedAt:
                    row.accepted_at ? iso(row.accepted_at) : null,
            })),
        };
    }

    async acceptInvitation(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = acceptInvitationSchema.safeParse(input);
        if (!parsed.success) {
            return invalid('INVALID_INVITATION_TOKEN', 'The invitation token is invalid.');
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query<{
                invitation_id: string;
                organization_id: string;
                invitee_did: string;
                role: OrganizationRole;
                status: string;
                expires_at: Date | string;
                invited_by_did: string;
            }>(
                `SELECT invitation_id, organization_id, invitee_did, role,
                        status, expires_at, invited_by_did
                 FROM organization_invitations
                 WHERE token_hash = $1
                 FOR UPDATE`,
                [tokenHash(parsed.data.token)],
            );
            const invitation = result.rows[0];
            if (
                !invitation ||
                invitation.status !== 'pending' ||
                invitation.invitee_did !== actorDid
            ) {
                throw new PublicHttpError(
                    403,
                    'INVITATION_NOT_ACCEPTABLE',
                    'This invitation cannot be accepted by the current account.',
                );
            }
            if (new Date(invitation.expires_at).getTime() <= now.getTime()) {
                await client.query(
                    `UPDATE organization_invitations
                     SET status = 'expired' WHERE invitation_id = $1`,
                    [invitation.invitation_id],
                );
                await client.query('COMMIT');
                throw new PublicHttpError(
                    410,
                    'INVITATION_EXPIRED',
                    'This organization invitation has expired.',
                );
            }
            await client.query(
                `INSERT INTO organization_memberships (
                    organization_id, member_did, role, status,
                    invited_by_did, joined_at, updated_at
                 ) VALUES ($1, $2, $3, 'active', $4, $5, $5)
                 ON CONFLICT (organization_id, member_did) DO UPDATE SET
                    role = EXCLUDED.role, status = 'active',
                    invited_by_did = EXCLUDED.invited_by_did,
                    joined_at = EXCLUDED.joined_at,
                    updated_at = EXCLUDED.updated_at`,
                [
                    invitation.organization_id,
                    actorDid,
                    invitation.role,
                    invitation.invited_by_did,
                    now,
                ],
            );
            await client.query(
                `UPDATE organization_invitations
                 SET status = 'accepted', accepted_at = $2
                 WHERE invitation_id = $1`,
                [invitation.invitation_id, now],
            );
            await this.audit(
                client,
                invitation.organization_id,
                actorDid,
                'invitation-accepted',
                actorDid,
                { invitationId: invitation.invitation_id },
                now,
            );
            await client.query('COMMIT');
            return {
                organizationId: invitation.organization_id,
                membership: {
                    organizationId: invitation.organization_id,
                    memberDid: actorDid,
                    role: invitation.role,
                    status: 'active',
                    invitedByDid: invitation.invited_by_did,
                    joinedAt: now.toISOString(),
                    updatedAt: now.toISOString(),
                },
            };
        } catch (error) {
            // A committed expiry must not be rolled back.
            if (
                !(
                    error instanceof PublicHttpError &&
                    error.code === 'INVITATION_EXPIRED'
                )
            ) {
                await client.query('ROLLBACK');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async listMembers(
        actorDid: string,
        organizationId: string,
    ): Promise<Record<string, unknown>> {
        const id = parseOrganizationId(organizationId);
        await this.requireRole(id, actorDid, 'member');
        const result = await this.pool.query<MembershipRow>(
            `SELECT organization_id, member_did, role, status,
                    invited_by_did, joined_at, updated_at
             FROM organization_memberships
             WHERE organization_id = $1 AND status = 'active'
             ORDER BY
                CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
                          WHEN 'steward' THEN 2 ELSE 3 END,
                member_did`,
            [id],
        );
        return { members: result.rows.map(membership) };
    }

    async updateRole(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = roleUpdateSchema.safeParse(input);
        if (!parsed.success) {
            return invalid('INVALID_MEMBER_ROLE', 'The member role is invalid.');
        }
        const actor = await this.requireRole(
            parsed.data.organizationId,
            actorDid,
            'admin',
        );
        const target = await this.requireActiveMember(
            parsed.data.organizationId,
            parsed.data.memberDid,
        );
        if (target.role === 'owner') {
            throw new PublicHttpError(
                409,
                'OWNER_ROLE_IMMUTABLE',
                'The organization owner role cannot be changed.',
            );
        }
        if (
            actor.role !== 'owner' &&
            (organizationRoleRank[target.role] >=
                organizationRoleRank[actor.role] ||
                organizationRoleRank[parsed.data.role] >=
                    organizationRoleRank[actor.role])
        ) {
            throw new PublicHttpError(
                403,
                'ORGANIZATION_ROLE_FORBIDDEN',
                'The current organization role cannot make that change.',
            );
        }
        await this.pool.query(
            `UPDATE organization_memberships
             SET role = $3, updated_at = $4
             WHERE organization_id = $1 AND member_did = $2
               AND status = 'active'`,
            [
                parsed.data.organizationId,
                parsed.data.memberDid,
                parsed.data.role,
                now,
            ],
        );
        await this.audit(
            this.pool,
            parsed.data.organizationId,
            actorDid,
            'member-role-updated',
            parsed.data.memberDid,
            { previousRole: target.role, nextRole: parsed.data.role },
            now,
        );
        return {
            membership: {
                ...membership(target),
                role: parsed.data.role,
                updatedAt: now.toISOString(),
            },
        };
    }

    async removeMember(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = memberRemoveSchema.safeParse(input);
        if (!parsed.success) {
            return invalid('INVALID_MEMBER', 'The member reference is invalid.');
        }
        const actor = await this.requireRole(
            parsed.data.organizationId,
            actorDid,
            'admin',
        );
        const target = await this.requireActiveMember(
            parsed.data.organizationId,
            parsed.data.memberDid,
        );
        if (
            target.role === 'owner' ||
            (actor.role !== 'owner' &&
                organizationRoleRank[target.role] >=
                    organizationRoleRank[actor.role])
        ) {
            throw new PublicHttpError(
                403,
                'ORGANIZATION_MEMBER_REMOVE_FORBIDDEN',
                'The current organization role cannot remove that member.',
            );
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE organization_memberships
                 SET status = 'removed', updated_at = $3
                 WHERE organization_id = $1 AND member_did = $2`,
                [parsed.data.organizationId, parsed.data.memberDid, now],
            );
            await client.query(
                `UPDATE organization_resource_stewardships
                 SET status = 'revoked', updated_at = $3
                 WHERE organization_id = $1 AND steward_did = $2
                   AND status <> 'revoked'`,
                [parsed.data.organizationId, parsed.data.memberDid, now],
            );
            await this.audit(
                client,
                parsed.data.organizationId,
                actorDid,
                'member-removed',
                parsed.data.memberDid,
                {},
                now,
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        return { removed: parsed.data.memberDid };
    }

    async assignStewardship(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = stewardshipSchema.safeParse(input);
        if (!parsed.success) {
            return invalid('INVALID_STEWARDSHIP', 'The resource stewardship is invalid.');
        }
        await this.requireRole(parsed.data.organizationId, actorDid, 'admin');
        const stewardMember = await this.requireActiveMember(
            parsed.data.organizationId,
            parsed.data.stewardDid,
        );
        if (
            !['owner', 'admin', 'steward'].includes(stewardMember.role)
        ) {
            throw new PublicHttpError(
                403,
                'STEWARD_CAPABILITY_REQUIRED',
                'The assigned account must have a steward role.',
            );
        }
        const resourceOwnerDid =
            resourceUriSchema.parse(parsed.data.resourceUri).match(
                /^at:\/\/(did:[^/]+)\//,
            )?.[1];
        if (!resourceOwnerDid) {
            return invalid('INVALID_STEWARDSHIP', 'The resource URI is invalid.');
        }
        await this.requireActiveMember(
            parsed.data.organizationId,
            resourceOwnerDid,
        );
        const id = randomUUID();
        const dueAt = plusDays(now, 90);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query<StewardshipRow>(
                `INSERT INTO organization_resource_stewardships (
                    stewardship_id, organization_id, resource_uri,
                    steward_did, status, last_reconfirmed_at,
                    reconfirm_due_at, created_at, updated_at
                 ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $5, $5)
                 ON CONFLICT (organization_id, resource_uri) DO UPDATE SET
                    steward_did = EXCLUDED.steward_did,
                    status = 'active',
                    last_reconfirmed_at = EXCLUDED.last_reconfirmed_at,
                    reconfirm_due_at = EXCLUDED.reconfirm_due_at,
                    updated_at = EXCLUDED.updated_at
                 RETURNING stewardship_id, organization_id, resource_uri,
                    steward_did, status, last_reconfirmed_at,
                    reconfirm_due_at, created_at, updated_at`,
                [
                    id,
                    parsed.data.organizationId,
                    parsed.data.resourceUri,
                    parsed.data.stewardDid,
                    now,
                    dueAt,
                ],
            );
            await this.audit(
                client,
                parsed.data.organizationId,
                actorDid,
                'resource-stewardship-assigned',
                parsed.data.resourceUri,
                { stewardDid: parsed.data.stewardDid },
                now,
            );
            await client.query('COMMIT');
            return { stewardship: stewardship(result.rows[0]!) };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async listStewardships(
        actorDid: string,
        organizationId: string,
    ): Promise<Record<string, unknown>> {
        const id = parseOrganizationId(organizationId);
        await this.requireRole(id, actorDid, 'member');
        const result = await this.pool.query<StewardshipRow>(
            `SELECT stewardship_id, organization_id, resource_uri,
                    steward_did, status, last_reconfirmed_at,
                    reconfirm_due_at, created_at, updated_at
             FROM organization_resource_stewardships
             WHERE organization_id = $1
             ORDER BY resource_uri`,
            [id],
        );
        return { stewardships: result.rows.map(stewardship) };
    }

    async reconfirmStewardship(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const parsed = stewardshipReferenceSchema.safeParse(input);
        if (!parsed.success) {
            return invalid(
                'INVALID_STEWARDSHIP_REFERENCE',
                'The resource stewardship reference is invalid.',
            );
        }
        const actor = await this.requireRole(
            parsed.data.organizationId,
            actorDid,
            'steward',
        );
        const current = await this.pool.query<StewardshipRow>(
            `SELECT stewardship_id, organization_id, resource_uri,
                    steward_did, status, last_reconfirmed_at,
                    reconfirm_due_at, created_at, updated_at
             FROM organization_resource_stewardships
             WHERE organization_id = $1 AND stewardship_id = $2`,
            [parsed.data.organizationId, parsed.data.stewardshipId],
        );
        const row = current.rows[0];
        if (!row || row.status === 'revoked') {
            throw new PublicHttpError(
                404,
                'STEWARDSHIP_NOT_FOUND',
                'The resource stewardship was not found.',
            );
        }
        if (
            actor.role === 'steward' &&
            row.steward_did !== actorDid
        ) {
            throw new PublicHttpError(
                403,
                'STEWARDSHIP_RECONFIRM_FORBIDDEN',
                'Only the assigned steward or an organization administrator may reconfirm this resource.',
            );
        }
        const dueAt = plusDays(now, 90);
        const result = await this.pool.query<StewardshipRow>(
            `UPDATE organization_resource_stewardships
             SET status = 'active', last_reconfirmed_at = $3,
                 reconfirm_due_at = $4, updated_at = $3
             WHERE organization_id = $1 AND stewardship_id = $2
             RETURNING stewardship_id, organization_id, resource_uri,
                steward_did, status, last_reconfirmed_at,
                reconfirm_due_at, created_at, updated_at`,
            [
                parsed.data.organizationId,
                parsed.data.stewardshipId,
                now,
                dueAt,
            ],
        );
        await this.audit(
            this.pool,
            parsed.data.organizationId,
            actorDid,
            'resource-reconfirmed',
            row.resource_uri,
            { stewardshipId: row.stewardship_id },
            now,
        );
        return { stewardship: stewardship(result.rows[0]!) };
    }

    async runReconfirmationSweep(
        now = new Date(),
    ): Promise<{ due: number; expired: number; events: number }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const due = await client.query<StewardshipRow>(
                `UPDATE organization_resource_stewardships
                 SET status = 'due', updated_at = $1
                 WHERE status = 'active' AND reconfirm_due_at <= $1
                 RETURNING stewardship_id, organization_id, resource_uri,
                    steward_did, status, last_reconfirmed_at,
                    reconfirm_due_at, created_at, updated_at`,
                [now],
            );
            let events = 0;
            for (const row of due.rows) {
                const inserted = await client.query(
                    `INSERT INTO organization_notification_events (
                        event_id, organization_id, recipient_did,
                        event_type, stewardship_id, deduplication_key,
                        payload, created_at, consumed_at
                     ) VALUES ($1, $2, $3, 'resource-reconfirmation-due',
                               $4, $5, $6::jsonb, $7, NULL)
                     ON CONFLICT (deduplication_key) DO NOTHING`,
                    [
                        randomUUID(),
                        row.organization_id,
                        row.steward_did,
                        row.stewardship_id,
                        `resource-reconfirmation-due:${row.stewardship_id}:${iso(row.reconfirm_due_at)}`,
                        JSON.stringify({
                            organizationId: row.organization_id,
                            stewardshipId: row.stewardship_id,
                            resourceUri: row.resource_uri,
                            dueAt: iso(row.reconfirm_due_at),
                        }),
                        now,
                    ],
                );
                events += inserted.rowCount ?? 0;
            }
            const expired = await client.query(
                `UPDATE organization_resource_stewardships
                 SET status = 'expired', updated_at = $1
                 WHERE status = 'due'
                   AND reconfirm_due_at <=
                       $1::timestamptz - INTERVAL '30 days'`,
                [now],
            );
            await client.query('COMMIT');
            return {
                due: due.rowCount ?? 0,
                expired: expired.rowCount ?? 0,
                events,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getAudit(
        actorDid: string,
        organizationId: string,
    ): Promise<Record<string, unknown>> {
        const id = parseOrganizationId(organizationId);
        await this.requireRole(id, actorDid, 'admin');
        const result = await this.pool.query<{
            audit_id: string;
            actor_did: string | null;
            action: string;
            subject: string;
            details: Record<string, unknown>;
            occurred_at: Date | string;
        }>(
            `SELECT audit_id, actor_did, action, subject, details, occurred_at
             FROM organization_audit_events
             WHERE organization_id = $1
             ORDER BY occurred_at, audit_id`,
            [id],
        );
        return {
            events: result.rows.map(row => ({
                id: row.audit_id,
                actorDid: row.actor_did,
                action: row.action,
                subject: row.subject,
                details: row.details,
                occurredAt: iso(row.occurred_at),
            })),
        };
    }

    private async expireInvitations(now = new Date()): Promise<void> {
        await this.pool.query(
            `UPDATE organization_invitations
             SET status = 'expired'
             WHERE status = 'pending' AND expires_at <= $1`,
            [now],
        );
    }

    private async requireRole(
        organizationId: string,
        actorDid: string,
        minimum: OrganizationRole,
    ): Promise<MembershipRow> {
        const actor = await this.requireActiveMember(
            organizationId,
            actorDid,
        );
        if (
            organizationRoleRank[actor.role] <
            organizationRoleRank[minimum]
        ) {
            throw new PublicHttpError(
                403,
                'ORGANIZATION_CAPABILITY_REQUIRED',
                `The ${minimum} organization capability is required.`,
            );
        }
        return actor;
    }

    private async requireActiveMember(
        organizationId: string,
        memberDid: string,
    ): Promise<MembershipRow> {
        parseOrganizationId(organizationId);
        const result = await this.pool.query<MembershipRow>(
            `SELECT organization_id, member_did, role, status,
                    invited_by_did, joined_at, updated_at
             FROM organization_memberships
             WHERE organization_id = $1 AND member_did = $2
               AND status = 'active'`,
            [organizationId, memberDid],
        );
        const row = result.rows[0];
        if (!row || !organizationRoleSchema.safeParse(row.role).success) {
            throw new PublicHttpError(
                403,
                'ORGANIZATION_MEMBERSHIP_REQUIRED',
                'An active organization membership is required.',
            );
        }
        return row;
    }

    private async audit(
        client: Pick<Pool | PoolClient, 'query'>,
        organizationId: string,
        actorDid: string | null,
        action: string,
        subject: string,
        details: Record<string, unknown>,
        occurredAt: Date,
    ): Promise<void> {
        await client.query(
            `INSERT INTO organization_audit_events (
                organization_id, actor_did, action, subject,
                details, occurred_at
             ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
            [
                organizationId,
                actorDid,
                action,
                subject,
                JSON.stringify(details),
                occurredAt,
            ],
        );
    }
}
