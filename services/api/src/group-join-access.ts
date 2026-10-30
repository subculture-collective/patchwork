import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PublicHttpError } from './http/error-response.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;
export const joinUnavailable = (): never => {
    throw new PublicHttpError(404, 'GROUP_NOT_FOUND', 'The group was not found.');
};

/** Shared by public details, join commands and every application-chat operation. */
export const authorizePublicGroup = async (client: Queryable, groupId: string,
    actorDid: string, applicantDid = actorDid) => {
    const result = await client.query<{
        group_id: string; name: string; purpose: string; description: string; owner_did: string;
    }>(`SELECT group_id,name,purpose,description,owner_did FROM groups
        WHERE group_id=$1 AND visibility='public' AND status='active'`, [groupId]);
    const group = result.rows[0];
    if (!group) return joinUnavailable();
    const moderators = await client.query<{ member_did: string }>(
        `SELECT member_did FROM group_memberships WHERE group_id=$1
         AND status='active' AND role IN ('owner','moderator') ORDER BY member_did`, [groupId]);
    const participants = [...new Set([applicantDid, group.owner_did,
        ...moderators.rows.map(row => row.member_did)])];
    if (!participants.includes(actorDid)) return joinUnavailable();
    for (const did of participants) {
        const disabled = await client.query(`SELECT 1 FROM account_deactivations WHERE did_hash=$1`,
            [createHash('sha256').update(did).digest('hex')]);
        if (disabled.rowCount) return joinUnavailable();
    }
    const unavailable = await client.query(`SELECT 1 FROM moderation_queue_items
        WHERE subject_uri=ANY($1::text[]) AND (visibility<>'visible' OR queue_status='queued'
            OR appeal_state IN ('pending','under-review'))`,
        [[...participants, `patchwork:group:${groupId}`]]);
    if (unavailable.rowCount) return joinUnavailable();
    const blocked = await client.query(`SELECT 1 FROM user_blocks WHERE deleted_at IS NULL
        AND blocker_did=ANY($1::text[]) AND subject_did=ANY($1::text[])`, [participants]);
    if (blocked.rowCount) return joinUnavailable();
    return { group, participants, moderators: moderators.rows.map(row => row.member_did) };
};

/** Invitation acceptance and join approval share the membership path. Never demote an active member. */
export const activateGroupMembership = async (client: PoolClient, groupId: string,
    did: string, role: 'member' | 'moderator', now: Date): Promise<void> => {
    await client.query(`INSERT INTO group_memberships (group_id,member_did,role,status,
        joined_at,updated_at,retention_until) VALUES ($1,$2,$3,'active',$4,$4,$5)
        ON CONFLICT (group_id,member_did) DO UPDATE SET role=EXCLUDED.role,status='active',
            joined_at=EXCLUDED.joined_at,updated_at=EXCLUDED.updated_at,
            retention_until=EXCLUDED.retention_until WHERE group_memberships.status<>'active'`,
        [groupId, did, role, now, new Date(now.getTime() + 365 * 86_400_000)]);
};
