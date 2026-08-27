import { describe, expect, it, vi } from 'vitest';
import type { OAuthAdapter } from '@patchwork/at-client';
import {
    AtAuthService,
    oauthCallbackLandingPath,
    serializeSessionCookie,
} from './at-auth-service.js';
import type {
    BrowserSession,
    BrowserSessionRepository,
} from './session-repository.js';

const oauthAdapter = (): OAuthAdapter => ({
    authorize: vi.fn(async handle =>
        new URL(`https://pds.example/authorize?login_hint=${handle}`),
    ),
    callback: vi.fn(async () => ({
        state: '/feed',
        session: {
            did: 'did:plc:alice',
            fetch: vi.fn(),
        },
    })),
    restore: vi.fn(async did => ({ did, fetch: vi.fn() })),
    revoke: vi.fn(async () => undefined),
});

const browserSessions = (): BrowserSessionRepository => {
    const sessions = new Map<string, BrowserSession>();
    let currentHandle: string | undefined;
    return {
        create: vi.fn(async (did, expiresAt) => {
            sessions.set('browser-token', {
                did,
                ...(currentHandle ? { handle: currentHandle } : {}),
                expiresAt,
                authenticatedAt: new Date(),
            });
            return 'browser-token';
        }),
        get: vi.fn(async token => sessions.get(token)),
        touch: vi.fn(async () => undefined),
        revoke: vi.fn(async token => {
            sessions.delete(token);
        }),
        setHandle: vi.fn(async (_did, handle) => {
            currentHandle = handle;
        }),
    };
};

describe('AtAuthService', () => {
    it('routes completed OAuth through a sanitized session-verification landing page', () => {
        expect(oauthCallbackLandingPath('/map?r=3000')).toBe(
            '/auth/callback?returnTo=%2Fmap%3Fr%3D3000',
        );
        expect(
            oauthCallbackLandingPath(
                '/map?code=secret&state=secret&r=3000',
            ),
        ).toBe('/auth/callback?returnTo=%2Fmap%3Fr%3D3000');
        expect(oauthCallbackLandingPath('https://hostile.example')).toBe(
            '/auth/callback?returnTo=%2F',
        );
    });

    it('starts OAuth without receiving a password', async () => {
        const oauth = oauthAdapter();
        const service = new AtAuthService(oauth, browserSessions());

        await expect(service.beginLogin('alice.example')).resolves.toEqual({
            authorizationUrl:
                'https://pds.example/authorize?login_hint=alice.example',
        });
        expect(oauth.authorize).toHaveBeenCalledWith(
            'alice.example',
            expect.any(String),
        );
    });

    it('completes OAuth and creates an opaque browser session', async () => {
        const sessions = browserSessions();
        const service = new AtAuthService(oauthAdapter(), sessions);

        await expect(
            service.completeLogin(new URLSearchParams('code=abc&state=state-1')),
        ).resolves.toMatchObject({
            did: 'did:plc:alice',
            returnTo: '/feed',
            sessionToken: 'browser-token',
        });
        expect(sessions.create).toHaveBeenCalledWith(
            'did:plc:alice',
            expect.any(Date),
        );
    });

    it('round-trips the handle and safe return path through OAuth app state', async () => {
        const oauth = oauthAdapter();
        const sessions = browserSessions();
        const service = new AtAuthService(oauth, sessions);
        await service.beginLogin(
            'alice.example',
            '/feed?filter=food&access_token=secret&state=secret#token=secret',
        );
        const encodedState = vi.mocked(oauth.authorize).mock.calls[0]?.[1];
        vi.mocked(oauth.callback).mockResolvedValueOnce({
            state: encodedState ?? null,
            session: { did: 'did:plc:alice', fetch: vi.fn() },
        });

        await expect(
            service.completeLogin(new URLSearchParams('code=abc')),
        ).resolves.toMatchObject({ returnTo: '/feed?filter=food' });
        expect(sessions.setHandle).toHaveBeenCalledWith(
            'did:plc:alice',
            'alice.example',
        );
        await expect(service.current('browser-token')).resolves.toMatchObject({
            did: 'did:plc:alice',
            handle: 'alice.example',
        });
    });

    it('returns a safe stable error when OAuth callback state is rejected', async () => {
        const oauth = oauthAdapter();
        vi.mocked(oauth.callback).mockRejectedValueOnce(
            Object.assign(new Error('state mismatch'), { status: 400 }),
        );
        const service = new AtAuthService(oauth, browserSessions());

        await expect(
            service.completeLogin(new URLSearchParams('code=abc&state=bad')),
        ).rejects.toMatchObject({
            code: 'OAUTH_STATE_INVALID',
            message: 'The OAuth callback state is stale or invalid.',
        });
    });

    it('restores the SDK session when refreshing a browser session', async () => {
        const oauth = oauthAdapter();
        const sessions = browserSessions();
        await sessions.create(
            'did:plc:alice',
            new Date(Date.now() + 60_000),
        );
        const service = new AtAuthService(oauth, sessions);

        await expect(service.refresh('browser-token')).resolves.toMatchObject({
            did: 'did:plc:alice',
            expiresAt: expect.any(String),
        });
        expect(oauth.restore).toHaveBeenCalledWith('did:plc:alice');
        expect(sessions.touch).toHaveBeenCalledWith('browser-token');
    });

    it('rejects missing or expired browser sessions', async () => {
        const service = new AtAuthService(oauthAdapter(), browserSessions());

        await expect(service.current('missing')).rejects.toMatchObject({
            code: 'SESSION_EXPIRED',
        });
    });

    it('revokes both OAuth and browser sessions during logout', async () => {
        const oauth = oauthAdapter();
        const sessions = browserSessions();
        await sessions.create(
            'did:plc:alice',
            new Date(Date.now() + 60_000),
        );
        const service = new AtAuthService(oauth, sessions);

        await service.logout('browser-token');

        expect(oauth.revoke).toHaveBeenCalledWith('did:plc:alice');
        expect(sessions.revoke).toHaveBeenCalledWith('browser-token');
    });
});

describe('serializeSessionCookie', () => {
    it('creates an HttpOnly same-site secure cookie', () => {
        expect(serializeSessionCookie('opaque', true)).toBe(
            'patchwork_session=opaque; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure',
        );
    });

    it('clears the cookie without exposing OAuth tokens', () => {
        expect(serializeSessionCookie('', false, 0)).toBe(
            'patchwork_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
        );
    });
});
