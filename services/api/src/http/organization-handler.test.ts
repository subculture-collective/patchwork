import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OrganizationService } from '../organization-service.js';
import { createOrganizationHandler } from './organization-handler.js';

describe('organization HTTP boundary', () => {
    let origin: string;
    const listPublic = vi.fn();
    const getPublic = vi.fn();
    const create = vi.fn();
    const invite = vi.fn();
    const listResources = vi.fn();
    const service = {
        listPublic,
        getPublic,
        create,
        invite,
        listResources,
    } as unknown as OrganizationService;
    const authenticate = vi.fn(async () => ({
        sessionToken: 'opaque-session',
        session: {
            did: 'did:plc:session-owner',
            expiresAt: '2099-01-01T00:00:00.000Z',
        },
        principal: {
            did: 'did:plc:session-owner',
            role: 'user' as const,
            authorization: {
                actorDid: 'did:plc:session-owner',
                role: 'user' as const,
                capabilities: [],
            },
        },
    }));
    const handler = createOrganizationHandler({
        service,
        authenticate,
        executeIdempotent: async (_request, _actorDid, body, effect) =>
            effect(body as Record<string, unknown>, 'test-key'),
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
            throw new Error('test server did not bind');
        }
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
        );
    });

    it('keeps public organization discovery anonymous', async () => {
        listPublic.mockResolvedValueOnce({ organizations: [] });
        const response = await fetch(
            `${origin}/organizations?searchText=pantry`,
        );
        expect(response.status).toBe(200);
        expect(listPublic).toHaveBeenCalledWith('pantry');
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('derives organization ownership and invitation authority from the session', async () => {
        create.mockResolvedValueOnce({
            organization: {
                id: 'b7b8b206-c3c3-4ae7-8f29-6877b5a93531',
            },
        });
        const createBody = {
            name: 'Session-owned organization',
            description: '',
            ownerDid: 'did:plc:hostile-browser',
        };
        const created = await fetch(`${origin}/organizations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(createBody),
        });
        expect(created.status).toBe(201);
        expect(create).toHaveBeenCalledWith(
            'did:plc:session-owner',
            createBody,
        );

        invite.mockResolvedValueOnce({ invitation: { status: 'pending' } });
        const invitationBody = {
            organizationId: 'b7b8b206-c3c3-4ae7-8f29-6877b5a93531',
            inviteeDid: 'did:plc:invitee',
            role: 'steward',
            actorDid: 'did:plc:hostile-browser',
        };
        const invited = await fetch(`${origin}/organizations/invitations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(invitationBody),
        });
        expect(invited.status).toBe(200);
        expect(invite).toHaveBeenCalledWith(
            'did:plc:session-owner',
            invitationBody,
        );
    });

    it('lists assignable resources for the session actor only', async () => {
        listResources.mockResolvedValueOnce({
            resources: [
                {
                    uri: 'at://did:plc:member/app.patchwork.directory.resource/one',
                    name: 'Pilsen Community Pantry',
                    category: 'food-bank',
                    authorDid: 'did:plc:member',
                    stewardship: null,
                },
            ],
        });
        const organizationId = 'b7b8b206-c3c3-4ae7-8f29-6877b5a93531';
        const response = await fetch(
            `${origin}/organizations/resources?organizationId=${organizationId}&actorDid=did:plc:hostile-browser`,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(listResources).toHaveBeenCalledWith(
            'did:plc:session-owner',
            organizationId,
        );
        const body = (await response.json()) as { resources: unknown[] };
        expect(body.resources).toHaveLength(1);
    });
});
