import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicHttpError } from './error-response.js';
import {
    createIdentityHandler,
    normalizeIdentifier,
    type IdentityResolverFn,
} from './identity-handler.js';

const principal = {
    sessionToken: 'opaque-session',
    session: { did: 'did:plc:session-owner', expiresAt: '2099-01-01T00:00:00.000Z' },
    principal: {
        did: 'did:plc:session-owner',
        role: 'user' as const,
        authorization: {
            actorDid: 'did:plc:session-owner',
            role: 'user' as const,
            capabilities: [],
        },
    },
};

const servers: ReturnType<typeof createServer>[] = [];

const start = async (options: {
    resolve?: IdentityResolverFn;
    lookupHandles?: (dids: readonly string[]) => Promise<Record<string, string>>;
    authenticate?: () => Promise<typeof principal>;
}) => {
    const handler = createIdentityHandler({
        ...(options.resolve ? { resolve: options.resolve } : {}),
        ...(options.lookupHandles ? { lookupHandles: options.lookupHandles } : {}),
        authenticate: options.authenticate ?? (async () => principal),
    });
    const server = createServer((request, response) => {
        if (!handler(request, response, new URL(request.url ?? '/', 'http://localhost'))) {
            response.writeHead(404).end();
        }
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${address.port}`;
};

afterEach(async () => {
    await Promise.all(
        servers.splice(0).map(
            server => new Promise<void>(resolve => server.close(() => resolve())),
        ),
    );
});

describe('identity resolution boundary', () => {
    it('normalises handles and accepts only plc and web DIDs', () => {
        expect(normalizeIdentifier(' @Alice.Bsky.Social ')).toBe('alice.bsky.social');
        expect(normalizeIdentifier('did:plc:abc123')).toBe('did:plc:abc123');
        expect(normalizeIdentifier('did:key:abc')).toBeUndefined();
        expect(normalizeIdentifier('not a handle')).toBeUndefined();
        expect(normalizeIdentifier('localhost')).toBeUndefined();
    });

    it('resolves a handle for a signed-in user without caching', async () => {
        const resolve = vi.fn<IdentityResolverFn>(async () => ({
            did: 'did:plc:alice',
            handle: 'alice.bsky.social',
        }));
        const origin = await start({ resolve });
        const response = await fetch(`${origin}/identity/resolve?q=%40alice.bsky.social`);
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            identity: { did: 'did:plc:alice', handle: 'alice.bsky.social' },
        });
        expect(resolve.mock.calls[0]?.[0]).toBe('alice.bsky.social');
    });

    it('rejects malformed identifiers before resolving', async () => {
        const resolve = vi.fn<IdentityResolverFn>();
        const origin = await start({ resolve });
        const response = await fetch(`${origin}/identity/resolve?q=nope`);
        expect(response.status).toBe(400);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('reports unknown accounts as not found', async () => {
        const origin = await start({
            resolve: async () => {
                throw new Error('handle does not resolve');
            },
        });
        const response = await fetch(`${origin}/identity/resolve?q=missing.example.com`);
        expect(response.status).toBe(404);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe('IDENTITY_NOT_FOUND');
    });

    it('requires a session', async () => {
        const origin = await start({
            resolve: vi.fn<IdentityResolverFn>(),
            authenticate: async () => {
                throw new PublicHttpError(401, 'AUTHENTICATION_REQUIRED', 'Sign in.');
            },
        });
        const response = await fetch(`${origin}/identity/resolve?q=alice.bsky.social`);
        expect(response.status).toBe(401);
    });

    it('returns 503 when no resolver is configured', async () => {
        const origin = await start({});
        const response = await fetch(`${origin}/identity/resolve?q=alice.bsky.social`);
        expect(response.status).toBe(503);
    });

    it('returns handles for a DID batch and validates the batch', async () => {
        const lookupHandles = vi.fn(async () => ({ 'did:plc:a': 'alice.example' }));
        const origin = await start({ lookupHandles });
        const ok = await fetch(`${origin}/identity/handles?dids=did:plc:a,did:plc:b`);
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ handles: { 'did:plc:a': 'alice.example' } });
        expect(lookupHandles).toHaveBeenCalledWith(['did:plc:a', 'did:plc:b']);

        const tooMany = Array.from({ length: 51 }, (_, index) => `did:plc:x${index}`).join(',');
        expect((await fetch(`${origin}/identity/handles?dids=${tooMany}`)).status).toBe(400);
        expect((await fetch(`${origin}/identity/handles?dids=did:key:nope`)).status).toBe(400);
        expect((await fetch(`${origin}/identity/handles`)).status).toBe(400);
    });

    it('returns 503 for handle batches without a resolver', async () => {
        const origin = await start({});
        expect((await fetch(`${origin}/identity/handles?dids=did:plc:a`)).status).toBe(503);
    });
});
