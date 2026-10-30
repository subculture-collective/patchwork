import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuthorizationContext } from '../authorization-guard.js';
import type { DurableGroupService } from '../durable-group-service.js';
import { createGroupHandler } from './group-handler.js';

describe('group HTTP identity and idempotency boundary', () => {
    let origin: string;
    const actorDid = 'did:plc:group-session';
    const list = vi.fn();
    const create = vi.fn();
    const invite = vi.fn();
    const listLinkableRequests = vi.fn();
    const publicDetail = vi.fn();
    const listJoinRequests = vi.fn();
    const requestToJoin = vi.fn();
    const decideJoinRequest = vi.fn();
    const service = { list, create, invite, listLinkableRequests, publicDetail, listJoinRequests, requestToJoin, decideJoinRequest } as unknown as DurableGroupService;
    const executeIdempotent = vi.fn(async (_request, _actorDid, body, effect) =>
        effect(body as Record<string, unknown>, 'server-key'));
    const handler = createGroupHandler({
        service,
        authenticate: async () => ({
            sessionToken: 'opaque',
            session: { did: actorDid },
            principal: {
                did: actorDid,
                role: 'user',
                authorization: createAuthorizationContext(actorDid, 'user'),
            },
        }),
        executeIdempotent,
    });
    let server: ReturnType<typeof createServer>;

    beforeAll(async () => {
        server = createServer((request, response) => {
            if (!handler(request, response,
                new URL(request.url ?? '/', 'http://localhost'))) {
                response.writeHead(404).end();
            }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('server did not bind');
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => error ? reject(error) : resolve()));
    });

    it('derives list and mutation authority only from the session', async () => {
        list.mockResolvedValueOnce({ groups: [], invitations: [], outgoingInvitations: [] });
        expect((await fetch(`${origin}/groups?actorDid=did:plc:hostile`)).status).toBe(200);
        expect(list).toHaveBeenCalledWith(actorDid);

        const body = {
            name: 'Neighbors', description: '', purpose: 'Coordinate aid.',
            visibility: 'private', actorDid: 'did:plc:hostile',
        };
        create.mockResolvedValueOnce({ group: { id: 'group' } });
        const response = await fetch(`${origin}/groups`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(201);
        expect(create).toHaveBeenCalledWith(actorDid, body);
        expect(executeIdempotent).toHaveBeenCalledWith(
            expect.anything(), actorDid, body, expect.any(Function));
    });

    it('keeps invitations on the authenticated idempotent mutation path', async () => {
        const body = { groupId: '11111111-1111-4111-8111-111111111111',
            inviteeDid: 'did:plc:invitee', role: 'member' };
        invite.mockResolvedValueOnce({ invitation: { id: 'invite' } });
        const response = await fetch(`${origin}/groups/invitations`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(201);
        expect(invite).toHaveBeenCalledWith(actorDid, body);
    });

    it('lists linkable requests for the session actor without idempotency', async () => {
        listLinkableRequests.mockResolvedValueOnce({
            requests: [{ uri: 'at://did:plc:a/app.patchwork.aid.post/1', title: 'Groceries', status: 'open', role: 'requester' }],
        });
        const response = await fetch(`${origin}/groups/linkable-requests?actorDid=did:plc:forged`);
        expect(response.status).toBe(200);
        expect(listLinkableRequests).toHaveBeenCalledWith(actorDid);
        expect(list).not.toHaveBeenCalledWith('did:plc:forged');
        const body = (await response.json()) as { requests: unknown[] };
        expect(body.requests).toHaveLength(1);
    });
    it('keeps public details authenticated and join commands inside the idempotency boundary', async () => {
        const groupId = '11111111-1111-4111-8111-111111111111';
        publicDetail.mockResolvedValue({ group: { id: groupId, name: 'Pantry', memberCount: 1 } });
        const summary = await fetch(`${origin}/groups/details?groupId=${groupId}&actorDid=did:plc:spoof`);
        expect(summary.status).toBe(200);
        expect(summary.headers.get('cache-control')).toBe('no-store');
        expect(publicDetail).toHaveBeenCalledWith(actorDid, groupId);
        listJoinRequests.mockResolvedValue({ requests: [] });
        expect((await fetch(`${origin}/groups/join-requests`)).status).toBe(200);
        expect(listJoinRequests).toHaveBeenCalledWith(actorDid);
        const body = { groupId, introduction: 'I can help.' };
        requestToJoin.mockResolvedValue({ request: { id: 'request' } });
        const created = await fetch(`${origin}/groups/join-requests`, { method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': 'join-command' }, body: JSON.stringify(body) });
        expect(created.status).toBe(201);
        expect(requestToJoin).toHaveBeenCalledWith(actorDid, body);
        const decision = { groupId, requestId: groupId, action: 'approve' };
        decideJoinRequest.mockResolvedValue({ request: { status: 'approved' } });
        expect((await fetch(`${origin}/groups/join-decisions`, { method: 'POST',
            headers: { 'content-type': 'application/json' }, body: JSON.stringify(decision) })).status).toBe(200);
        expect(decideJoinRequest).toHaveBeenCalledWith(actorDid, decision);
    });

});
