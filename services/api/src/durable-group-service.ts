import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const createSchema = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000).default(''),
    purpose: z.string().trim().min(1).max(300),
    visibility: z.enum(['private', 'public']),
    linkedRequestUri: z.string().trim().min(1).max(2048).optional(),
}).strict();
const inviteSchema = z.object({
    groupId: z.string().uuid(),
    inviteeDid: z.string().trim().startsWith('did:').max(2048),
    role: z.enum(['moderator', 'member']).default('member'),
}).strict();
const invitationResponseSchema = z.object({
    token: z.string().min(32).max(256),
    action: z.enum(['accept', 'reject']),
}).strict();
const invitationRevokeSchema = z.object({
    groupId: z.string().uuid(),
    invitationId: z.string().uuid(),
}).strict();
const memberActionSchema = z.object({
    groupId: z.string().uuid(),
    memberDid: z.string().trim().startsWith('did:').max(2048),
}).strict();
const roleSchema = memberActionSchema.extend({
    role: z.enum(['moderator', 'member']),
}).strict();
const groupActionSchema = z.object({ groupId: z.string().uuid() }).strict();
const roomSchema = groupActionSchema.extend({
    name: z.string().trim().min(1).max(80),
    linkedRequestUri: z.string().trim().min(1).max(2048).optional(),
}).strict();
const roomActionSchema = groupActionSchema.extend({
    roomId: z.string().uuid(),
}).strict();

type GroupRole = 'owner' | 'moderator' | 'member';
interface GroupRow {
    group_id: string;
    owner_did: string;
    name: string;
    description: string;
    purpose: string;
    visibility: 'private' | 'public';
    status: 'active' | 'closed';
    version: number;
    created_at: Date | string;
    updated_at: Date | string;
    closed_at: Date | string | null;
}
interface MembershipRow {
    group_id: string;
    member_did: string;
    role: GroupRole;
    status: 'active' | 'left' | 'removed';
    joined_at: Date | string;
    updated_at: Date | string;
}
interface RoomRow {
    room_id: string;
    group_id: string;
    name: string;
    linked_request_uri: string | null;
    status: 'active' | 'closed';
    version: number;
    created_at: Date | string;
    updated_at: Date | string;
    closed_at: Date | string | null;
}
interface InvitationRow {
    invitation_id: string;
    group_id: string;
    invitee_did: string;
    invited_by_did: string;
    requested_role: 'moderator' | 'member';
    status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';
    expires_at: Date | string;
    created_at: Date | string;
    updated_at: Date | string;
}
interface InvitationGroupRow extends InvitationRow {
    owner_did: string;
    name: string;
    description: string;
    purpose: string;
    visibility: 'private' | 'public';
    group_status: 'active' | 'closed';
    version: number;
    group_created_at: Date | string;
    group_updated_at: Date | string;
    closed_at: Date | string | null;
}

const hash = (value: string): string =>
    createHash('sha256').update(value).digest('hex');
const plusDays = (date: Date, days: number): Date =>
    new Date(date.getTime() + days * 86_400_000);
const iso = (value: Date | string | null): string | null =>
    value === null ? null : new Date(value).toISOString();
const invalid = (code: string, message: string): never => {
    throw new PublicHttpError(400, code, message);
};

export class DurableGroupService {
    constructor(private readonly pool: Pool) {}

    /**
     * Requests the actor may link to a group or room: ones they posted, or
     * ones where they hold an active connection. Mirrors assertRequestVisible
     * so the picker never offers a request that linking would reject.
     */
    async listLinkableRequests(actorDid: string): Promise<Record<string, unknown>> {
        const result = await this.pool.query<{
            uri: string; title: string | null; status: string; role: 'requester' | 'helper';
        }>(
            `SELECT w.post_uri AS uri, p.title, w.current_status AS status,
                    CASE WHEN w.requester_did = $1 THEN 'requester' ELSE 'helper' END AS role
             FROM request_workflows w
             LEFT JOIN indexer_aid_post_projections p ON p.uri = w.post_uri
             WHERE w.current_status <> 'archived'
               AND (w.requester_did = $1 OR EXISTS (
                    SELECT 1 FROM coordination_connections c
                    WHERE c.request_uri = w.post_uri AND c.status = 'active'
                      AND $1 IN (c.requester_did, c.helper_did)))
               AND NOT EXISTS (
                    SELECT 1 FROM user_blocks b
                    WHERE b.deleted_at IS NULL AND w.requester_did <> $1
                      AND ((b.blocker_did = w.requester_did AND b.subject_did = $1)
                        OR (b.blocker_did = $1 AND b.subject_did = w.requester_did)))
               AND NOT EXISTS (
                    SELECT 1 FROM moderation_queue_items q
                    WHERE q.subject_uri = w.post_uri
                      AND (q.visibility <> 'visible' OR q.queue_status = 'queued'
                        OR q.appeal_state IN ('pending', 'under-review')))
             ORDER BY w.updated_at DESC, w.post_uri
             LIMIT 100`,
            [actorDid]);
        return {
            requests: result.rows.map(row => ({
                uri: row.uri,
                title: row.title ?? null,
                status: row.status,
                role: row.role,
            })),
        };
    }

    async list(actorDid: string, now = new Date()): Promise<Record<string, unknown>> {
        await this.assertAccountActive(this.pool, actorDid);
        const groups = await this.pool.query<GroupRow & { actor_role: GroupRole }>(
            `SELECT g.*, m.role AS actor_role
             FROM groups g JOIN group_memberships m USING (group_id)
             WHERE m.member_did=$1 AND m.status='active'
             ORDER BY g.updated_at DESC, g.group_id`,
            [actorDid],
        );
        for (const group of groups.rows) {
            await this.assertGroupModeration(this.pool, group.group_id);
            await this.assertNotBlocked(this.pool, actorDid, group.owner_did);
            await this.assertLinkedRoomsVisible(this.pool, group.group_id, actorDid);
        }
        const ids = groups.rows.map((row) => row.group_id);
        const rooms = ids.length === 0 ? { rows: [] as RoomRow[] } :
            await this.pool.query<RoomRow>(
                `SELECT * FROM group_rooms WHERE group_id=ANY($1::uuid[])
                 ORDER BY group_id, created_at, room_id`, [ids]);
        const memberships = ids.length === 0 ? { rows: [] as MembershipRow[] } :
            await this.pool.query<MembershipRow>(
                `SELECT group_id,member_did,role,status,joined_at,updated_at
                 FROM group_memberships
                 WHERE group_id=ANY($1::uuid[]) AND status='active'
                 ORDER BY group_id,joined_at,member_did`, [ids]);
        const invitations = await this.pool.query<InvitationRow & { group_name: string }>(
            `SELECT i.invitation_id,i.group_id,i.invitee_did,i.invited_by_did,
                    i.requested_role,i.status,i.expires_at,i.created_at,i.updated_at,
                    g.name AS group_name
             FROM group_invitations i JOIN groups g USING (group_id)
             WHERE i.invitee_did=$1 AND i.status='pending' AND i.expires_at>$2
             ORDER BY i.created_at DESC`, [actorDid, now]);
        const manageableIds = groups.rows
            .filter((row) => row.actor_role === 'owner' || row.actor_role === 'moderator')
            .map((row) => row.group_id);
        const outgoingInvitations = manageableIds.length === 0 ? { rows: [] as InvitationRow[] } :
            await this.pool.query<InvitationRow>(
                `SELECT invitation_id,group_id,invitee_did,invited_by_did,
                        requested_role,status,expires_at,created_at,updated_at
                 FROM group_invitations
                 WHERE group_id=ANY($1::uuid[]) AND status='pending' AND expires_at>$2
                 ORDER BY created_at DESC`, [manageableIds, now]);
        return {
            groups: groups.rows.map((row) => ({
                ...this.renderGroup(row), actorRole: row.actor_role,
                rooms: rooms.rows.filter((room) => room.group_id === row.group_id).map(this.renderRoom),
                members: memberships.rows.filter((member) => member.group_id === row.group_id).map(this.renderMember),
            })),
            invitations: invitations.rows.map((row) => ({
                id: row.invitation_id, groupId: row.group_id,
                groupName: row.group_name, invitedByDid: row.invited_by_did,
                role: row.requested_role, expiresAt: iso(row.expires_at),
            })),
            outgoingInvitations: outgoingInvitations.rows.map((row) => ({
                id: row.invitation_id, groupId: row.group_id,
                inviteeDid: row.invitee_did, invitedByDid: row.invited_by_did,
                role: row.requested_role, expiresAt: iso(row.expires_at),
            })),
        };
    }

    async runSweep(now = new Date()): Promise<{ expiredInvitations: number }> {
        const result = await this.pool.query(
            `UPDATE group_invitations
             SET status='expired',updated_at=$1
             WHERE status='pending' AND expires_at<=$1`, [now]);
        return { expiredInvitations: result.rowCount ?? 0 };
    }

    async create(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = createSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP', 'The group details are invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.assertAccountActive(client, actorDid);
            if (parsed.data.linkedRequestUri)
                await this.assertRequestVisible(client, parsed.data.linkedRequestUri, actorDid);
            const groupId = randomUUID();
            const roomId = randomUUID();
            const retention = plusDays(now, 365);
            const result = await client.query<GroupRow>(
                `INSERT INTO groups (group_id,owner_did,name,description,purpose,
                    visibility,status,retention_until,created_at,updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$8) RETURNING *`,
                [groupId, actorDid, parsed.data.name, parsed.data.description,
                 parsed.data.purpose, parsed.data.visibility, retention, now]);
            await client.query(
                `INSERT INTO group_memberships (group_id,member_did,role,status,
                    joined_at,updated_at,retention_until)
                 VALUES ($1,$2,'owner','active',$3,$3,$4)`,
                [groupId, actorDid, now, retention]);
            await client.query(
                `INSERT INTO group_rooms (room_id,group_id,name,linked_request_uri,
                    status,retention_until,created_at,updated_at)
                 VALUES ($1,$2,'General',$3,'active',$4,$5,$5)`,
                [roomId, groupId, parsed.data.linkedRequestUri ?? null, retention, now]);
            await this.audit(client, groupId, actorDid, null, roomId, 'created', now);
            await client.query('COMMIT');
            return { group: { ...this.renderGroup(result.rows[0]!), actorRole: 'owner', rooms: [{
                id: roomId, groupId, name: 'General', linkedRequestUri: parsed.data.linkedRequestUri ?? null,
                status: 'active', version: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), closedAt: null,
            }] } };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }

    async invite(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = inviteSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_INVITATION', 'The invitation is invalid.');
        if (parsed.data.inviteeDid === actorDid)
            invalid('INVALID_GROUP_INVITATION', 'You cannot invite yourself.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group, membership } = await this.authorize(client, parsed.data.groupId, actorDid, 'moderate');
            await this.assertAccountActive(client, parsed.data.inviteeDid);
            await this.assertNotBlocked(client, actorDid, parsed.data.inviteeDid);
            await this.assertLinkedRoomsVisible(client, group.group_id, parsed.data.inviteeDid);
            const active = await client.query(
                `SELECT 1 FROM group_memberships WHERE group_id=$1 AND member_did=$2 AND status='active'`,
                [group.group_id, parsed.data.inviteeDid]);
            if (active.rowCount) invalid('ALREADY_GROUP_MEMBER', 'That account is already a member.');
            const pending = await client.query(
                `SELECT 1 FROM group_invitations
                 WHERE group_id=$1 AND invitee_did=$2 AND status='pending' FOR UPDATE`,
                [group.group_id, parsed.data.inviteeDid]);
            if (pending.rowCount)
                throw new PublicHttpError(409, 'GROUP_INVITATION_PENDING', 'An invitation is already pending.');
            if (membership.role === 'moderator' && parsed.data.role === 'moderator')
                throw new PublicHttpError(403, 'GROUP_ROLE_FORBIDDEN', 'Only the owner can invite another moderator.');
            const token = randomBytes(32).toString('base64url');
            const invitationId = randomUUID();
            const expiresAt = plusDays(now, 7);
            await client.query(
                `INSERT INTO group_invitations (invitation_id,group_id,invitee_did,
                    invited_by_did,token_hash,requested_role,status,expires_at,
                    retention_until,created_at,updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$9)`,
                [invitationId, group.group_id, parsed.data.inviteeDid, actorDid,
                 hash(token), parsed.data.role, expiresAt, plusDays(now, 90), now]);
            await this.audit(client, group.group_id, actorDid, parsed.data.inviteeDid,
                null, 'invited', now);
            await this.notify(client, group, parsed.data.inviteeDid, 'group_invited',
                `group:${invitationId}:invited`, now);
            await client.query('COMMIT');
            return { invitation: { id: invitationId, groupId: group.group_id,
                inviteeDid: parsed.data.inviteeDid, role: parsed.data.role,
                token, expiresAt: expiresAt.toISOString() } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async respondToInvitation(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = invitationResponseSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_INVITATION', 'The invitation is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.assertAccountActive(client, actorDid);
            const result = await client.query<InvitationGroupRow>(
                `SELECT i.*,g.owner_did,g.name,g.description,g.purpose,g.visibility,
                        g.status AS group_status,g.version,g.created_at AS group_created_at,
                        g.updated_at AS group_updated_at,g.closed_at
                 FROM group_invitations i JOIN groups g USING (group_id)
                 WHERE i.token_hash=$1 FOR UPDATE OF i,g`, [hash(parsed.data.token)]);
            const row = result.rows[0];
            if (!row || row.invitee_did !== actorDid || row.status !== 'pending')
                throw new PublicHttpError(404, 'GROUP_INVITATION_NOT_FOUND', 'The invitation is unavailable.');
            if (new Date(row.expires_at) <= now) {
                await client.query(`UPDATE group_invitations SET status='expired',updated_at=$2 WHERE invitation_id=$1`, [row.invitation_id, now]);
                throw new PublicHttpError(409, 'GROUP_INVITATION_EXPIRED', 'The invitation has expired.');
            }
            if (row.group_status !== 'active')
                throw new PublicHttpError(409, 'GROUP_CLOSED', 'The group is closed.');
            await this.assertNotBlocked(client, actorDid, row.owner_did);
            await this.assertLinkedRoomsVisible(client, row.group_id, actorDid);
            const status = parsed.data.action === 'accept' ? 'accepted' : 'rejected';
            await client.query(
                `UPDATE group_invitations SET status=$2,consumed_at=$3,updated_at=$3
                 WHERE invitation_id=$1`, [row.invitation_id, status, now]);
            if (parsed.data.action === 'accept') {
                await client.query(
                    `INSERT INTO group_memberships (group_id,member_did,role,status,
                        joined_at,updated_at,retention_until)
                     VALUES ($1,$2,$3,'active',$4,$4,$5)
                     ON CONFLICT (group_id,member_did) DO UPDATE SET role=EXCLUDED.role,
                        status='active',joined_at=EXCLUDED.joined_at,
                        updated_at=EXCLUDED.updated_at,retention_until=EXCLUDED.retention_until`,
                    [row.group_id, actorDid, row.requested_role, now, plusDays(now, 365)]);
            }
            await this.audit(client, row.group_id, actorDid, actorDid, null,
                parsed.data.action === 'accept' ? 'invitation-accepted' : 'invitation-rejected', now);
            const group: GroupRow = { group_id: row.group_id, owner_did: row.owner_did,
                name: row.name, description: row.description, purpose: row.purpose,
                visibility: row.visibility, status: row.group_status, version: row.version,
                created_at: row.group_created_at, updated_at: row.group_updated_at,
                closed_at: row.closed_at };
            if (parsed.data.action === 'accept')
                await this.notify(client, group, row.invited_by_did, 'group_joined',
                    `group:${row.invitation_id}:accepted`, now);
            await client.query('COMMIT');
            return { invitation: { id: row.invitation_id, status },
                group: parsed.data.action === 'accept' ? this.renderGroup(group) : undefined };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async revokeInvitation(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = invitationRevokeSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_INVITATION', 'The invitation is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.authorize(client, parsed.data.groupId, actorDid, 'moderate');
            const result = await client.query<InvitationRow>(
                `UPDATE group_invitations SET status='revoked',consumed_at=$3,updated_at=$3
                 WHERE invitation_id=$1 AND group_id=$2 AND status='pending' RETURNING *`,
                [parsed.data.invitationId, parsed.data.groupId, now]);
            if (!result.rows[0]) throw new PublicHttpError(404, 'GROUP_INVITATION_NOT_FOUND', 'The invitation is unavailable.');
            await this.audit(client, parsed.data.groupId, actorDid, result.rows[0].invitee_did,
                null, 'invitation-revoked', now);
            await client.query('COMMIT');
            return { invitation: { id: parsed.data.invitationId, status: 'revoked' } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async removeMember(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = memberActionSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_MEMBER', 'The member action is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group, membership } = await this.authorize(client, parsed.data.groupId, actorDid, 'moderate');
            const target = await this.activeMembership(client, group.group_id, parsed.data.memberDid, true);
            if (target.role === 'owner' || (membership.role === 'moderator' && target.role !== 'member'))
                throw new PublicHttpError(403, 'GROUP_ROLE_FORBIDDEN', 'You cannot remove that member.');
            await client.query(`UPDATE group_memberships SET status='removed',updated_at=$3 WHERE group_id=$1 AND member_did=$2`,
                [group.group_id, parsed.data.memberDid, now]);
            await this.audit(client, group.group_id, actorDid, parsed.data.memberDid, null, 'member-removed', now);
            await this.notify(client, group, parsed.data.memberDid, 'group_removed',
                `group:${group.group_id}:removed:${parsed.data.memberDid}:${group.version}`, now);
            await client.query('COMMIT');
            return { member: { did: parsed.data.memberDid, status: 'removed' } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async changeRole(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = roleSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_ROLE', 'The role change is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group } = await this.authorize(client, parsed.data.groupId, actorDid, 'own');
            const target = await this.activeMembership(client, group.group_id, parsed.data.memberDid, true);
            if (target.role === 'owner') invalid('INVALID_GROUP_ROLE', 'Transfer ownership instead.');
            await client.query(`UPDATE group_memberships SET role=$3,updated_at=$4 WHERE group_id=$1 AND member_did=$2`,
                [group.group_id, parsed.data.memberDid, parsed.data.role, now]);
            await this.audit(client, group.group_id, actorDid, parsed.data.memberDid, null, 'role-changed', now);
            await this.notify(client, group, parsed.data.memberDid, 'group_role_changed',
                `group:${group.group_id}:role:${parsed.data.memberDid}:${now.toISOString()}`, now);
            await client.query('COMMIT');
            return { member: { did: parsed.data.memberDid, role: parsed.data.role, status: 'active' } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async leave(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = groupActionSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP', 'The group action is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group, membership } = await this.authorize(client, parsed.data.groupId, actorDid, 'member');
            if (membership.role === 'owner')
                throw new PublicHttpError(409, 'OWNERSHIP_TRANSFER_REQUIRED', 'Transfer ownership before leaving.');
            await client.query(`UPDATE group_memberships SET status='left',updated_at=$3 WHERE group_id=$1 AND member_did=$2`,
                [group.group_id, actorDid, now]);
            await this.audit(client, group.group_id, actorDid, actorDid, null, 'member-left', now);
            await client.query('COMMIT');
            return { member: { did: actorDid, status: 'left' } };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async transferOwnership(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = memberActionSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_OWNERSHIP_TRANSFER', 'The ownership transfer is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group } = await this.authorize(client, parsed.data.groupId, actorDid, 'own');
            await this.activeMembership(client, group.group_id, parsed.data.memberDid, true);
            await client.query(`UPDATE group_memberships SET role='moderator',updated_at=$3 WHERE group_id=$1 AND member_did=$2`,
                [group.group_id, actorDid, now]);
            await client.query(`UPDATE group_memberships SET role='owner',updated_at=$3 WHERE group_id=$1 AND member_did=$2`,
                [group.group_id, parsed.data.memberDid, now]);
            await client.query(`UPDATE groups SET owner_did=$2,version=version+1,updated_at=$3 WHERE group_id=$1`,
                [group.group_id, parsed.data.memberDid, now]);
            await this.audit(client, group.group_id, actorDid, parsed.data.memberDid, null, 'ownership-transferred', now);
            await client.query('COMMIT');
            return { groupId: group.group_id, ownerDid: parsed.data.memberDid };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async close(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = groupActionSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP', 'The group action is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group } = await this.authorize(client, parsed.data.groupId, actorDid, 'own');
            const members = await client.query<MembershipRow>(`SELECT * FROM group_memberships WHERE group_id=$1 AND status='active' FOR UPDATE`, [group.group_id]);
            await client.query(`UPDATE groups SET status='closed',version=version+1,closed_at=$2,updated_at=$2 WHERE group_id=$1`, [group.group_id, now]);
            await client.query(`UPDATE group_rooms SET status='closed',version=version+1,closed_at=$2,updated_at=$2 WHERE group_id=$1 AND status='active'`, [group.group_id, now]);
            await client.query(`UPDATE group_invitations SET status='revoked',consumed_at=$2,updated_at=$2 WHERE group_id=$1 AND status='pending'`, [group.group_id, now]);
            await this.audit(client, group.group_id, actorDid, null, null, 'group-closed', now);
            for (const member of members.rows) if (member.member_did !== actorDid)
                await this.notify(client, group, member.member_did, 'group_closed',
                    `group:${group.group_id}:closed:${member.member_did}`, now);
            await client.query('COMMIT');
            return { groupId: group.group_id, status: 'closed' };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async createRoom(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = roomSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_ROOM', 'The room details are invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group } = await this.authorize(client, parsed.data.groupId, actorDid, 'moderate');
            if (parsed.data.linkedRequestUri) {
                const members = await client.query<MembershipRow>(`SELECT * FROM group_memberships WHERE group_id=$1 AND status='active'`, [group.group_id]);
                for (const member of members.rows)
                    await this.assertRequestVisible(client, parsed.data.linkedRequestUri, member.member_did);
            }
            const result = await client.query<RoomRow>(
                `INSERT INTO group_rooms (room_id,group_id,name,linked_request_uri,status,
                    retention_until,created_at,updated_at)
                 VALUES ($1,$2,$3,$4,'active',$5,$6,$6) RETURNING *`,
                [randomUUID(), group.group_id, parsed.data.name,
                 parsed.data.linkedRequestUri ?? null, plusDays(now, 365), now]);
            await this.audit(client, group.group_id, actorDid, null, result.rows[0]!.room_id, 'room-created', now);
            await client.query('COMMIT');
            return { room: this.renderRoom(result.rows[0]!) };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async closeRoom(actorDid: string, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
        const parsed = roomActionSchema.safeParse(input);
        if (!parsed.success) throw new PublicHttpError(400, 'INVALID_GROUP_ROOM', 'The room action is invalid.');
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const { group } = await this.authorize(client, parsed.data.groupId, actorDid, 'moderate');
            const result = await client.query<RoomRow>(
                `UPDATE group_rooms SET status='closed',version=version+1,closed_at=$3,updated_at=$3
                 WHERE room_id=$1 AND group_id=$2 AND status='active' RETURNING *`,
                [parsed.data.roomId, group.group_id, now]);
            if (!result.rows[0]) throw new PublicHttpError(404, 'GROUP_ROOM_NOT_FOUND', 'The room was not found.');
            await this.audit(client, group.group_id, actorDid, null, parsed.data.roomId, 'room-closed', now);
            await client.query('COMMIT');
            return { room: this.renderRoom(result.rows[0]) };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    private async authorize(client: PoolClient, groupId: string, actorDid: string,
        capability: 'member' | 'moderate' | 'own'): Promise<{ group: GroupRow; membership: MembershipRow }> {
        await this.assertAccountActive(client, actorDid);
        const result = await client.query<GroupRow & MembershipRow>(
            `SELECT g.*,m.member_did,m.role,m.status AS membership_status,
                    m.joined_at,m.updated_at AS membership_updated_at
             FROM groups g JOIN group_memberships m USING (group_id)
             WHERE g.group_id=$1 AND m.member_did=$2 FOR UPDATE OF g,m`, [groupId, actorDid]);
        const row = result.rows[0] as (GroupRow & MembershipRow & {
            membership_status: MembershipRow['status']; membership_updated_at: Date | string;
        }) | undefined;
        if (!row || row.membership_status !== 'active')
            throw new PublicHttpError(404, 'GROUP_NOT_FOUND', 'The group was not found.');
        if (row.status !== 'active') throw new PublicHttpError(409, 'GROUP_CLOSED', 'The group is closed.');
        if (capability === 'own' && row.role !== 'owner')
            throw new PublicHttpError(403, 'GROUP_OWNER_REQUIRED', 'Only the group owner may do that.');
        if (capability === 'moderate' && !['owner', 'moderator'].includes(row.role))
            throw new PublicHttpError(403, 'GROUP_MODERATOR_REQUIRED', 'A group moderator role is required.');
        await this.assertGroupModeration(client, groupId);
        await this.assertNotBlocked(client, actorDid, row.owner_did);
        return { group: row, membership: { group_id: row.group_id, member_did: row.member_did,
            role: row.role, status: row.membership_status, joined_at: row.joined_at,
            updated_at: row.membership_updated_at } };
    }

    private async activeMembership(client: PoolClient, groupId: string, did: string, hide: boolean): Promise<MembershipRow> {
        const result = await client.query<MembershipRow>(
            `SELECT group_id,member_did,role,status,joined_at,updated_at FROM group_memberships
             WHERE group_id=$1 AND member_did=$2 AND status='active' FOR UPDATE`, [groupId, did]);
        if (!result.rows[0]) throw new PublicHttpError(hide ? 404 : 409,
            hide ? 'GROUP_MEMBER_NOT_FOUND' : 'GROUP_MEMBERSHIP_REQUIRED',
            hide ? 'The member was not found.' : 'Active membership is required.');
        return result.rows[0];
    }

    private async assertAccountActive(client: Pick<Pool | PoolClient, 'query'>, did: string): Promise<void> {
        const deactivated = await client.query(`SELECT 1 FROM account_deactivations WHERE did_hash=$1`, [hash(did)]);
        if (deactivated.rowCount) throw new PublicHttpError(409, 'ACCOUNT_DEACTIVATED', 'The account is not active.');
        const moderated = await client.query(
            `SELECT 1 FROM moderation_queue_items WHERE subject_uri=$1
             AND (visibility<>'visible' OR queue_status='queued' OR appeal_state IN ('pending','under-review'))`, [did]);
        if (moderated.rowCount) throw new PublicHttpError(409, 'ACCOUNT_MODERATED', 'The account is not eligible for groups.');
    }

    private async assertGroupModeration(client: Pick<Pool | PoolClient, 'query'>, groupId: string): Promise<void> {
        const moderated = await client.query(
            `SELECT 1 FROM moderation_queue_items WHERE subject_uri=$1
             AND (visibility<>'visible' OR queue_status='queued' OR appeal_state IN ('pending','under-review'))`,
            [`patchwork:group:${groupId}`]);
        if (moderated.rowCount) throw new PublicHttpError(409, 'GROUP_MODERATED', 'The group is unavailable.');
    }

    private async assertNotBlocked(client: Pick<Pool | PoolClient, 'query'>, one: string, two: string): Promise<void> {
        if (one === two) return;
        const blocked = await client.query(
            `SELECT 1 FROM user_blocks WHERE deleted_at IS NULL
             AND ((blocker_did=$1 AND subject_did=$2) OR (blocker_did=$2 AND subject_did=$1))`, [one, two]);
        if (blocked.rowCount) throw new PublicHttpError(409, 'GROUP_PARTICIPANTS_BLOCKED', 'The accounts cannot share a group.');
    }

    private async assertLinkedRoomsVisible(client: Pick<Pool | PoolClient, 'query'>, groupId: string, did: string): Promise<void> {
        const rooms = await client.query<{ linked_request_uri: string }>(
            `SELECT linked_request_uri FROM group_rooms
             WHERE group_id=$1 AND status='active' AND linked_request_uri IS NOT NULL`, [groupId]);
        for (const room of rooms.rows) await this.assertRequestVisible(client, room.linked_request_uri, did);
    }

    private async assertRequestVisible(client: Pick<Pool | PoolClient, 'query'>, requestUri: string, did: string): Promise<void> {
        const result = await client.query<{ requester_did: string }>(
            `SELECT requester_did FROM request_workflows WHERE post_uri=$1`, [requestUri]);
        const request = result.rows[0];
        if (!request) throw new PublicHttpError(404, 'REQUEST_NOT_VISIBLE', 'The linked request is unavailable.');
        const collaborator = request.requester_did === did || (await client.query(
            `SELECT 1 FROM coordination_connections
             WHERE request_uri=$1 AND status='active' AND $2 IN (requester_did,helper_did)`,
            [requestUri, did])).rowCount;
        if (!collaborator) throw new PublicHttpError(404, 'REQUEST_NOT_VISIBLE', 'The linked request is unavailable.');
        await this.assertNotBlocked(client, request.requester_did, did);
        const moderated = await client.query(
            `SELECT 1 FROM moderation_queue_items WHERE subject_uri=$1
             AND (visibility<>'visible' OR queue_status='queued' OR appeal_state IN ('pending','under-review'))`, [requestUri]);
        if (moderated.rowCount) throw new PublicHttpError(404, 'REQUEST_NOT_VISIBLE', 'The linked request is unavailable.');
    }

    private async audit(client: PoolClient, groupId: string, actorDid: string | null,
        subjectDid: string | null, roomId: string | null, action: string, now: Date): Promise<void> {
        await client.query(
            `INSERT INTO group_audit_events (group_id,actor_did,subject_did,room_id,
                action,occurred_at,retention_until) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [groupId, actorDid, subjectDid, roomId, action, now, plusDays(now, 365)]);
    }

    private async notify(client: PoolClient, group: GroupRow, recipientDid: string,
        kind: string, key: string, now: Date): Promise<void> {
        const title = kind === 'group_invited' ? 'Group invitation' :
            kind === 'group_joined' ? 'A member joined your group' :
            kind === 'group_removed' ? 'Group membership ended' :
            kind === 'group_role_changed' ? 'Group role updated' : 'Group closed';
        const body = kind === 'group_invited' ? 'You have a new group invitation.' :
            kind === 'group_joined' ? 'Open the group to review its members.' :
            kind === 'group_removed' ? 'You no longer have access to this group.' :
            kind === 'group_role_changed' ? 'Open the group to review your current role.' :
            'A group you belonged to has closed.';
        const metadata = JSON.stringify({ groupId: group.group_id, status: group.status });
        await client.query(
            `INSERT INTO activity_inbox_items (item_id,recipient_did,item_type,title,
                summary,action_url,source_key,metadata,occurred_at,retention_until)
             VALUES ($1,$2,'group',$3,$4,'/groups',$5,$6::jsonb,$7,$8)
             ON CONFLICT (recipient_did,source_key) DO NOTHING`,
            [randomUUID(), recipientDid, title, body, key, metadata, now, plusDays(now, 365)]);
        await client.query(`SELECT patchwork_enqueue_notification($1,$2,$3,$4,'normal','/groups',$5::jsonb,$6,$7)`,
            [recipientDid, kind, title, body, metadata, key, now]);
    }

    private renderGroup(row: GroupRow): Record<string, unknown> {
        return { id: row.group_id, ownerDid: row.owner_did, name: row.name,
            description: row.description, purpose: row.purpose, visibility: row.visibility,
            status: row.status, version: row.version, createdAt: iso(row.created_at),
            updatedAt: iso(row.updated_at), closedAt: iso(row.closed_at) };
    }
    private renderRoom = (row: RoomRow): Record<string, unknown> => ({
        id: row.room_id, groupId: row.group_id, name: row.name,
        linkedRequestUri: row.linked_request_uri, status: row.status,
        version: row.version, createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at), closedAt: iso(row.closed_at),
    });
    private renderMember = (row: MembershipRow): Record<string, unknown> => ({
        did: row.member_did, role: row.role, status: row.status,
        joinedAt: iso(row.joined_at), updatedAt: iso(row.updated_at),
    });
}
