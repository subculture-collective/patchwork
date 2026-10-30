import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DurableGroupService } from './durable-group-service.js';
import { DurableChatService } from './durable-chat-service.js';
import { PostgresIdempotencyExecutor } from './http/idempotency-store.js';
import { AccountPrivacyService } from './account-privacy-service.js';

const owner = 'did:plc:join-owner';
const applicant = 'did:plc:join-applicant';
const moderator = 'did:plc:join-moderator';
const member = 'did:plc:join-member';
const stranger = 'did:plc:join-stranger';
const intro = 'I can help with the weekend pantry.';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const groups = new DurableGroupService(pool);
const chat = new DurableChatService(pool);
const now = new Date();
const group = async (visibility = 'public') => {
    const result = await groups.create(owner, { name: 'Weekend pantry', purpose: 'Share food',
        description: 'Neighbors share surplus.', visibility }, now);
    return (result.group as { id: string }).id;
};
const join = async (groupId: string, did = applicant) => (await groups.requestToJoin(did,
    { groupId, introduction: intro }, now)).request as { id: string; conversationId: string };
const add = async (groupId: string, did: string, role = 'member') => {
    const result = await groups.invite(owner, { groupId, inviteeDid: did, role }, now);
    await groups.respondToInvitation(did, { token: (result.invitation as { token: string }).token, action: 'accept' }, now);
};
const decision = (groupId: string, requestId: string, action: 'approve'|'decline'|'withdraw', actor = owner) =>
    groups.decideJoinRequest(actor, { groupId, requestId, action }, now);
const send = (conversationId: string, actor = owner) => chat.send(actor,
    { conversationId, clientMessageId: randomUUID(), body: 'Welcome! Can you join on Saturday?' }, now);
const deny = { statusCode: 404, code: 'GROUP_NOT_FOUND' };

describe('public group applications and private chat PostgreSQL boundary', () => {
    beforeEach(async () => { await pool.query(`TRUNCATE http_idempotency_commands,groups,user_blocks,account_deactivations,
        moderation_queue_items,notification_intents,activity_inbox_items,request_workflows CASCADE`); });
    afterAll(async () => pool.end());

    it('exposes only public summary fields and makes private and absent groups indistinguishable', async () => {
        const id = await group();
        expect(await groups.publicDetail(applicant, id)).toEqual({ group: { id,
            name: 'Weekend pantry', purpose: 'Share food', description: 'Neighbors share surplus.', memberCount: 1 } });
        for (const hidden of [await group('private'), randomUUID()]) {
            await expect(groups.publicDetail(applicant, hidden)).rejects.toMatchObject(deny);
            await expect(join(hidden)).rejects.toMatchObject(deny);
        }
        expect((await pool.query('SELECT * FROM group_join_requests')).rows).toEqual([]);
    });

    it('rejects empty, oversized, control-character and spoofed introductions', async () => {
        const id = await group();
        for (const introduction of ['', ' ', 'a'.repeat(1001), 'hi\nthere', 'hi\u0000', 'hi\u007f'])
            await expect(groups.requestToJoin(applicant, { groupId: id, introduction }, now))
                .rejects.toMatchObject({ code: 'INVALID_GROUP_JOIN' });
        await expect(groups.requestToJoin(applicant, { groupId: id, introduction: intro, requesterDid: owner }, now))
            .rejects.toMatchObject({ code: 'INVALID_GROUP_JOIN' });
    });

    it('serializes duplicate requests and database uniqueness enforces one pending application', async () => {
        const id = await group();
        const results = await Promise.allSettled([join(id), join(id)]);
        expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
        expect((results.find(row => row.status === 'rejected') as PromiseRejectedResult).reason)
            .toMatchObject({ code: 'GROUP_JOIN_PENDING' });
        expect((await pool.query('SELECT * FROM group_join_requests')).rowCount).toBe(1);
        await expect(pool.query(`INSERT INTO group_join_requests (request_id,group_id,requester_did,
            introduction,status,expires_at,retention_until,created_at,updated_at)
            SELECT gen_random_uuid(),group_id,requester_did,introduction,status,expires_at,
                retention_until,created_at,updated_at FROM group_join_requests LIMIT 1`))
            .rejects.toMatchObject({ code:'23505' });
    });

    it('replays the same idempotent join command across executor restarts without another request or notification', async () => {
        const id = await group();
        const command = { actorDid: applicant, method: 'POST', pathname: '/groups/join-requests',
            idempotencyKey: 'join-once', body: { groupId: id, introduction: intro } };
        const effect = async () => ({ statusCode: 201, body: await groups.requestToJoin(applicant,command.body,now) });
        const [first,replay] = await Promise.all([new PostgresIdempotencyExecutor(pool).execute(command,effect),
            new PostgresIdempotencyExecutor(pool).execute(command,effect)]);
        expect(replay).toEqual(first);
        expect((await pool.query('SELECT 1 FROM group_join_requests')).rowCount).toBe(1);
        expect((await pool.query("SELECT 1 FROM notification_intents WHERE notification_type='group_join_requested'")).rowCount).toBe(1);
    });

    it('reuses bounded chat and membership paths, hides ordinary members and other applicants', async () => {
        const id = await group();
        await add(id, member); await add(id, moderator, 'moderator');
        const request = await join(id);
        const another = await join(id, stranger);
        await send(request.conversationId, moderator);
        expect((await chat.listMessages(applicant, { conversationId: request.conversationId })).messages)
            .toMatchObject([{ body: 'Welcome! Can you join on Saturday?' }]);
        for (const did of [member, stranger]) {
            await expect(chat.listMessages(did, { conversationId: request.conversationId })).rejects.toMatchObject(deny);
            await expect(send(request.conversationId, did)).rejects.toMatchObject(deny);
        }
        expect(await groups.listJoinRequests(member, now)).toEqual({ requests: [] });
        expect((await groups.listJoinRequests(applicant, now)).requests).toHaveLength(1);
        await decision(id, request.id, 'approve', moderator);
        expect((await pool.query(`SELECT role FROM group_memberships WHERE group_id=$1 AND member_did=$2`, [id, applicant])).rows)
            .toEqual([{ role: 'member' }]);
        await expect(send(request.conversationId, applicant)).rejects.toMatchObject({ code: 'CHAT_CONVERSATION_CLOSED' });
        await expect(chat.listMessages(applicant, { conversationId: another.conversationId })).rejects.toMatchObject(deny);
        expect((await chat.listConversations(applicant)).conversations).toEqual([]);
        expect((await groups.listJoinRequests(applicant, now)).requests).toMatchObject([{ status: 'approved', conversationId: null }]);
        const intents = (await pool.query(`SELECT title,body,metadata FROM notification_intents WHERE notification_type LIKE 'group_join_%'`)).rows;
        expect(intents.length).toBeGreaterThan(0);
        expect(JSON.stringify(intents)).not.toContain(intro);
    });

    it('concurrent moderators produce one final decision and at most one membership', async () => {
        const id = await group(); await add(id, moderator, 'moderator');
        const request = await join(id);
        const results = await Promise.allSettled([decision(id, request.id, 'approve'), decision(id, request.id, 'decline', moderator)]);
        expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
        expect((results.find(row => row.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'GROUP_JOIN_CLOSED' });
        const status = (await pool.query('SELECT status FROM group_join_requests WHERE request_id=$1', [request.id])).rows[0].status;
        expect(['approved', 'declined']).toContain(status);
        expect((await pool.query('SELECT 1 FROM group_memberships WHERE group_id=$1 AND member_did=$2', [id, applicant])).rowCount)
            .toBe(status === 'approved' ? 1 : 0);
    });

    it('serializes a moderator reply against approval and prevents subsequent writes', async () => {
        const id = await group(); const request = await join(id);
        const results = await Promise.allSettled([decision(id,request.id,'approve'),send(request.conversationId)]);
        expect(results[0].status).toBe('fulfilled');
        if (results[1].status === 'rejected') expect(results[1].reason).toMatchObject({ code:'CHAT_CONVERSATION_CLOSED' });
        expect((await pool.query('SELECT 1 FROM chat_messages WHERE conversation_id=$1',[request.conversationId])).rowCount)
            .toBe(results[1].status === 'fulfilled' ? 1 : 0);
        await expect(send(request.conversationId)).rejects.toMatchObject({ code:'CHAT_CONVERSATION_CLOSED' });
    });

    it('rechecks blocks in either direction for summaries, reads, replies and decisions', async () => {
        const id = await group(); const request = await join(id);
        for (const [one,two] of [[owner,applicant],[applicant,owner]]) {
            await pool.query(`INSERT INTO user_blocks(command_id,blocker_did,subject_did,created_at) VALUES ($1 || $2,$1,$2,$3)`, [one,two,now]);
            await expect(groups.publicDetail(applicant,id)).rejects.toMatchObject(deny);
            await expect(join(id)).rejects.toMatchObject(deny);
            await expect(join(id,stranger)).resolves.toBeDefined();
            await expect(send(request.conversationId)).rejects.toMatchObject(deny);
            await expect(chat.listMessages(applicant,{ conversationId: request.conversationId })).rejects.toMatchObject(deny);
            for (const action of ['approve','decline'] as const) await expect(decision(id,request.id,action)).rejects.toMatchObject(deny);
            expect(await groups.listJoinRequests(owner,now)).toMatchObject({ requests: expect.not.arrayContaining([expect.objectContaining({ id: request.id })]) });
            await pool.query('DELETE FROM user_blocks');
            await pool.query(`DELETE FROM group_join_requests WHERE requester_did=$1`, [stranger]);
        }
    });

    it('rechecks account deactivation and moderation holds and current moderator roles', async () => {
        const id = await group(); await add(id,moderator,'moderator'); const request = await join(id);
        await groups.changeRole(owner,{ groupId:id, memberDid:moderator,role:'member' },now);
        await expect(send(request.conversationId,moderator)).rejects.toMatchObject(deny);
        await expect(decision(id,request.id,'approve',moderator)).rejects.toMatchObject(deny);
        for (const subject of [applicant,owner,`patchwork:group:${id}`]) {
            await pool.query(`INSERT INTO moderation_queue_items(subject_uri,queue_id,subject_type,latest_reason,updated_at)
                VALUES ($1,$1,'other','join-test',$2)`,[subject,now]);
            await expect(join(id)).rejects.toMatchObject(deny);
            await expect(send(request.conversationId)).rejects.toMatchObject({
                code:subject===owner?'CHAT_PARTICIPANT_MODERATED':'GROUP_NOT_FOUND' });
            for (const action of ['approve','decline'] as const)
                await expect(decision(id,request.id,action)).rejects.toMatchObject(deny);
            await pool.query('DELETE FROM moderation_queue_items');
        }
        await pool.query(`INSERT INTO account_deactivations(did_hash,command_id,result,requested_at,retention_until)
            VALUES ($1,'join-disabled','{}',$2,'infinity')`,[createHash('sha256').update(applicant).digest('hex'),now]);
        await expect(send(request.conversationId)).rejects.toMatchObject(deny);
        await expect(decision(id,request.id,'approve')).rejects.toMatchObject(deny);
    });

    it('withdrawal, expiry and group closure close the thread; retention deletes it and its messages', async () => {
        const id = await group(); const request = await join(id);
        await send(request.conversationId);
        await decision(id,request.id,'withdraw',applicant);
        await expect(send(request.conversationId)).rejects.toMatchObject({ code:'CHAT_CONVERSATION_CLOSED' });
        const next = await join(id);
        await pool.query(`UPDATE group_join_requests SET expires_at=$2 WHERE request_id=$1`,[next.id,new Date(now.getTime()-1000)]);
        await expect(send(next.conversationId)).rejects.toMatchObject({ code:'CHAT_CONVERSATION_CLOSED' });
        await expect(decision(id,next.id,'approve')).rejects.toMatchObject({ code:'GROUP_JOIN_CLOSED' });
        await groups.runSweep(now);
        expect((await pool.query('SELECT status FROM group_join_requests WHERE request_id=$1',[next.id])).rows[0].status).toBe('expired');
        const last = await join(id);
        await groups.close(owner,{ groupId:id },now);
        expect((await pool.query('SELECT status FROM chat_conversations WHERE join_request_id=$1',[last.id])).rows[0].status).toBe('closed');
        await groups.runSweep(new Date(now.getTime()+91*86400000));
        expect((await pool.query('SELECT 1 FROM group_join_requests')).rowCount).toBe(0);
        expect((await pool.query(`SELECT 1 FROM chat_conversations WHERE kind='join-request'`)).rowCount).toBe(0);
        expect((await pool.query('SELECT 1 FROM chat_messages')).rowCount).toBe(0);
    });

    it('exports only own applications and deactivation removes introductions and audit identity', async () => {
        const id = await group(); const request = await join(id); await join(id,stranger);
        await send(request.conversationId,applicant);
        const privacy = new AccountPrivacyService(pool);
        const exported = await privacy.exportFor(applicant);
        expect(exported).toMatchObject({ data: { groups: { joinRequests: [{ id:request.id,introduction:intro }] } } });
        await privacy.deactivate(applicant,'join-deactivate',now);
        expect((await pool.query('SELECT introduction,status FROM group_join_requests WHERE request_id=$1',[request.id])).rows)
            .toEqual([{ introduction:null,status:'withdrawn' }]);
        expect((await pool.query('SELECT 1 FROM group_audit_events WHERE actor_did=$1 OR subject_did=$1',[applicant])).rowCount).toBe(0);
        expect((await pool.query('SELECT 1 FROM chat_messages WHERE author_did=$1 OR body IS NOT NULL',[applicant])).rowCount).toBe(0);
    });
});
