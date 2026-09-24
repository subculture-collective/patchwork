import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountPrivacyService } from './account-privacy-service.js';
import { DurableGroupService } from './durable-group-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const owner = 'did:plc:group-owner';
const member = 'did:plc:group-member';
const third = 'did:plc:group-third';
const outsider = 'did:plc:group-outsider';
const requestUri = `at://${owner}/app.patchwork.aid.post/group-request`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('DurableGroupService PostgreSQL boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const baseline = new Date('2026-08-05T12:00:00.000Z');

    beforeEach(async () => {
        await pool.query(`TRUNCATE notification_delivery_attempts,
            notification_intents,group_audit_events,group_invitations,
            group_rooms,group_memberships,groups,activity_inbox_items,
            coordination_connections,coordination_offers,user_blocks,
            account_deactivations,moderation_queue_items,request_workflows
            RESTART IDENTITY CASCADE`);
    });

    afterAll(async () => pool.end());

    it('persists invitation, membership, roles, transfer, rooms, closure, export, and privacy-safe intent across service restarts', async () => {
        const service = new DurableGroupService(pool);
        const created = await service.create(owner, {
            name: 'Neighborhood deliveries',
            description: 'Coordinate weekly deliveries.',
            purpose: 'Match available neighbors with delivery work.',
            visibility: 'private',
        }, baseline);
        const group = created.group as { id: string };
        const invite = await service.invite(owner, {
            groupId: group.id,
            inviteeDid: member,
            role: 'member',
        }, baseline) as { invitation: { token: string; id: string } };

        const restarted = new DurableGroupService(pool);
        await expect(restarted.respondToInvitation(member, {
            token: invite.invitation.token,
            action: 'accept',
        }, new Date('2026-08-05T13:00:00Z'))).resolves.toMatchObject({
            invitation: { id: invite.invitation.id, status: 'accepted' },
        });
        await expect(restarted.respondToInvitation(member, {
            token: invite.invitation.token,
            action: 'accept',
        })).rejects.toMatchObject({ code: 'GROUP_INVITATION_NOT_FOUND' });

        await restarted.changeRole(owner, {
            groupId: group.id, memberDid: member, role: 'moderator',
        }, new Date('2026-08-05T14:00:00Z'));
        await restarted.createRoom(member, {
            groupId: group.id, name: 'Dispatch',
        }, new Date('2026-08-05T15:00:00Z'));
        await restarted.transferOwnership(owner, {
            groupId: group.id, memberDid: member,
        }, new Date('2026-08-05T16:00:00Z'));

        const listed = await restarted.list(member) as { groups: Array<{
            id: string; actorRole: string; rooms: unknown[]; members: unknown[];
        }> };
        expect(listed.groups[0]).toMatchObject({
            id: group.id, actorRole: 'owner',
        });
        expect(listed.groups[0]?.rooms).toHaveLength(2);
        expect(listed.groups[0]?.members).toHaveLength(2);
        await expect(new AccountPrivacyService(pool).exportFor(member))
            .resolves.toMatchObject({ data: { groups: {
                memberships: [expect.objectContaining({ groupId: group.id, role: 'owner' })],
                invitations: [expect.objectContaining({ status: 'accepted' })],
            } } });

        const stored = JSON.stringify((await pool.query(
            `SELECT title,body,action_url,metadata FROM notification_intents ORDER BY created_at`,
        )).rows);
        expect(stored).not.toContain(invite.invitation.token);
        expect(stored).not.toMatch(/token|latitude|longitude|streetAddress|message/i);

        await restarted.close(member, { groupId: group.id }, new Date('2026-08-05T17:00:00Z'));
        await expect(restarted.createRoom(member, { groupId: group.id, name: 'Late' }))
            .rejects.toMatchObject({ code: 'GROUP_CLOSED' });
    });

    it('fails closed for cross-group, block, deactivation, stale token, and request-linked authorization probes', async () => {
        await pool.query(
            `INSERT INTO request_workflows (post_uri,requester_did,current_status,
                create_command_id,created_at,updated_at)
             VALUES ($1,$2,'assigned','group-request',$3,$3)`,
            [requestUri, owner, baseline]);
        const offerId = '31111111-1111-4111-8111-111111111111';
        const connectionId = '31111111-1111-4111-8111-111111111112';
        await pool.query(
            `INSERT INTO coordination_offers (offer_id,request_uri,requester_did,
                offerer_did,status,offered_at,expires_at,updated_at)
             VALUES ($1,$2,$3,$4,'accepted',$5,$6,$5)`,
            [offerId, requestUri, owner, member, baseline, new Date('2026-08-12T12:00:00Z')]);
        await pool.query(
            `INSERT INTO coordination_connections (connection_id,offer_id,request_uri,
                requester_did,helper_did,status,accepted_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,'active',$6,$6)`,
            [connectionId, offerId, requestUri, owner, member, baseline]);
        const service = new DurableGroupService(pool);
        const created = await service.create(owner, {
            name: 'Request room', description: '', purpose: 'Coordinate one request.',
            visibility: 'private', linkedRequestUri: requestUri,
        }, baseline);
        const groupId = (created.group as { id: string }).id;

        await expect(service.invite(owner, {
            groupId, inviteeDid: outsider, role: 'member',
        }, baseline)).rejects.toMatchObject({ code: 'REQUEST_NOT_VISIBLE' });
        await expect(service.removeMember(outsider, {
            groupId, memberDid: owner,
        })).rejects.toMatchObject({ code: 'GROUP_NOT_FOUND' });

        const invitation = await service.invite(owner, {
            groupId, inviteeDid: member, role: 'member',
        }, baseline) as { invitation: { token: string } };
        await pool.query(
            `INSERT INTO user_blocks (command_id,blocker_did,subject_did,created_at)
             VALUES ('group-block',$1,$2,$3)`, [member, owner, baseline]);
        await expect(service.respondToInvitation(member, {
            token: invitation.invitation.token, action: 'accept',
        }, baseline)).rejects.toMatchObject({ code: 'GROUP_PARTICIPANTS_BLOCKED' });
        await pool.query(`DELETE FROM user_blocks`);
        await pool.query(
            `INSERT INTO account_deactivations (did_hash,command_id,result,
                requested_at,retention_until) VALUES ($1,'group-deactivated','{}',$2,'infinity')`,
            [hash(member), baseline]);
        await expect(service.respondToInvitation(member, {
            token: invitation.invitation.token, action: 'accept',
        }, baseline)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });

        await expect(service.runSweep(new Date('2026-08-13T12:00:00Z')))
            .resolves.toEqual({ expiredInvitations: 1 });
        await expect(service.list(outsider)).resolves.toMatchObject({ groups: [] });
    });

    it('transfers owned groups on deactivation and immediately removes the former owner', async () => {
        const service = new DurableGroupService(pool);
        const created = await service.create(owner, {
            name: 'Continuity group', description: '', purpose: 'Keep coordination available.',
            visibility: 'private',
        }, baseline);
        const groupId = (created.group as { id: string }).id;
        const invitation = await service.invite(owner, {
            groupId, inviteeDid: third, role: 'member',
        }, baseline) as { invitation: { token: string } };
        await service.respondToInvitation(third, {
            token: invitation.invitation.token, action: 'accept',
        }, baseline);
        await new AccountPrivacyService(pool).deactivate(owner,
            'group-owner-deactivation', new Date('2026-08-06T12:00:00Z'));
        await expect(service.list(owner)).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
        await expect(service.list(third)).resolves.toMatchObject({
            groups: [expect.objectContaining({ id: groupId, ownerDid: third, actorRole: 'owner' })],
        });
    });
});
