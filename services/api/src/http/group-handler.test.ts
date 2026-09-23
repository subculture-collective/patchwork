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
    const service = { list, create, invite, listLinkableRequests } as unknown as DurableGroupService;
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
});
