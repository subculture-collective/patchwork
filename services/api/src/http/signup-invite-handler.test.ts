import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { SignupInviteService } from '../signup-invite-service.js';
import { createSignupInviteHandler } from './signup-invite-handler.js';

describe('signup invitation HTTP boundary', () => {
    let origin: string;
    let server: ReturnType<typeof createServer>;
    let role: 'user' | 'admin' = 'admin';
    const invitation = {
        inviteId: 'd15e9179-31f8-46f7-85ec-cfc74bde71c6',
        createdByDid: 'did:plc:admin',
        createdAt: '2026-09-03T12:00:00.000Z',
        expiresAt: '2026-09-04T12:00:00.000Z',
        revokedAt: null,
        successfulUseCount: 0,
        lastUsedAt: null,
        status: 'active' as const,
    };
    const create = vi.fn().mockResolvedValue({ token: 'a'.repeat(43), invitation });
    const list = vi.fn().mockResolvedValue([invitation]);
    const revoke = vi.fn().mockResolvedValue({ ...invitation, status: 'revoked' });

    beforeAll(async () => {
        const handler = createSignupInviteHandler({
            service: { create, list, revoke } as unknown as SignupInviteService,
            publicOrigin: 'https://patchwork.test',
            authenticate: async () => ({
                sessionToken: 'opaque',
                session: { did: 'did:plc:admin' },
                principal: {
                    did: 'did:plc:admin',
                    role,
                    authorization: {
                        actorDid: 'did:plc:admin',
                        role,
                        capabilities: role === 'admin' ? ['admin:system_config'] : [],
                    },
                },
            }),
        });
        server = createServer((request, response) => {
            if (!handler(request, response, new URL(request.url ?? '/', 'http://localhost'))) {
                response.writeHead(404).end();
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('no address');
        origin = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(error => error ? reject(error) : resolve()),
        );
    });

    it('creates a share URL while returning no raw PDS invite code', async () => {
        role = 'admin';
        const response = await fetch(`${origin}/admin/signup-invitations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ validForHours: 24 }),
        });
        expect(response.status).toBe(201);
        const body = await response.json() as Record<string, unknown>;
        expect(body.url).toBe(`https://patchwork.test/signup?invite=${'a'.repeat(43)}`);
        expect(JSON.stringify(body)).not.toContain('pdsInvite');
        expect(create).toHaveBeenCalledWith('did:plc:admin', { validForHours: 24 });
    });

    it('allows listing and revocation only for administrators', async () => {
        role = 'admin';
        expect((await fetch(`${origin}/admin/signup-invitations`)).status).toBe(200);
        const revoked = await fetch(`${origin}/admin/signup-invitations/revoke`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ inviteId: invitation.inviteId }),
        });
        expect(revoked.status).toBe(200);

        role = 'user';
        expect((await fetch(`${origin}/admin/signup-invitations`)).status).toBe(403);

    });

    it('rejects validity periods outside one hour through thirty days', async () => {
        role = 'admin';
        create.mockRejectedValueOnce(new ZodError([]));
        const response = await fetch(`${origin}/admin/signup-invitations`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ validForHours: 0 }),
        });
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'SIGNUP_INVITATION_COMMAND_INVALID' },
        });
    });
});
