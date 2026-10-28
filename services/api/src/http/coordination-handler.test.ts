import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuthorizationContext } from '../authorization-guard.js';
import type { CoordinationService } from '../coordination-service.js';
import { createCoordinationHandler } from './coordination-handler.js';

describe('coordination HTTP identity boundary', () => {
    let origin: string;
    const createOffer = vi.fn();
    const updatePickup = vi.fn();
    const listInbox = vi.fn();
    const service = {
        createOffer,
        updatePickup,
        listInbox,
    } as unknown as CoordinationService;
    const actorDid = 'did:plc:coordination-session';
    const handler = createCoordinationHandler({
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
        executeIdempotent: async (_request, _actorDid, body, effect) =>
            effect(body as Record<string, unknown>, 'key'),
    });
    let server: ReturnType<typeof createServer>;

    beforeAll(async () => {
        server = createServer((request, response) => {
            if (
                !handler(
                    request,
                    response,
                    new URL(request.url ?? '/', 'http://localhost'),
                )
            ) {
                response.writeHead(404).end();
            }
        });
        await new Promise<void>(resolve =>
            server.listen(0, '127.0.0.1', resolve),
        );
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('server did not bind');
        }
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
        );
    });

    it('derives pickup ownership from the authenticated session', async () => {
        const body = {requestUri:'at://did:plc:requester/app.patchwork.aid.post/pickup',action:'set-capacity',helperCapacity:2};
        updatePickup.mockResolvedValueOnce({pickup:body});
        const response = await fetch(`${origin}/coordination/pickups`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
        expect(response.status).toBe(200);
        expect(updatePickup).toHaveBeenCalledWith(actorDid,body);
        expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('derives offer and inbox ownership from the session', async () => {
        const body = {
            requestUri:
                'at://did:plc:requester/app.patchwork.aid.post/help',
            note: 'Available.',
            offererDid: 'did:plc:hostile-browser',
            requesterDid: 'did:plc:hostile-browser',
        };
        createOffer.mockResolvedValueOnce({ offer: { id: 'offer' } });
        const response = await fetch(`${origin}/coordination/offers`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        expect(response.status).toBe(201);
        expect(createOffer).toHaveBeenCalledWith(actorDid, body);

        listInbox.mockResolvedValueOnce({ items: [], unread: 0 });
        const inbox = await fetch(`${origin}/inbox?userDid=did:plc:hostile`);
        expect(inbox.status).toBe(200);
        expect(listInbox).toHaveBeenCalledWith(actorDid, false);
    });
});
