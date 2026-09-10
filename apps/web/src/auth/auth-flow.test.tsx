import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
// @vitest-environment jsdom

import {
    beginLogin,
    getCurrentSession,
    logoutSession,
    refreshSession,
    signup,
} from './auth-api.js';
import { AuthProvider, useAuth } from './AuthProvider.js';
import { AuthCallbackPage } from './AuthCallbackPage.js';
import { LoginPage } from './LoginPage.js';
import { SignupPage } from './SignupPage.js';
import {
    CURRENT_POLICY_VERSION,
    requiredPolicyDocuments,
} from '@patchwork/shared';

const originalFetch = globalThis.fetch;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;

const AuthProbe = () => {
    const auth = useAuth();
    return (
        <div>
            <span data-testid='status'>{auth.status}</span>
            <span data-testid='did'>{auth.session?.did ?? 'none'}</span>
            <button type='button' onClick={() => void auth.logout()}>
                Log out
            </button>
        </div>
    );
};

const setNativeInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
    )?.set;

    if (!setter) throw new Error('Expected native input value setter.');
    setter.call(input, value);
};

const createInputEvent = (type: 'input' | 'change') =>
    typeof InputEvent === 'function' ? new InputEvent(type, { bubbles: true }) : new Event(type, { bubbles: true });

describe('AT authentication flow', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    it('begins OAuth with a safe intended destination and no browser token', async () => {
        document.cookie = 'patchwork_csrf=csrf-proof; Path=/';
        const fetchMock = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ) =>
            new Response(
                JSON.stringify({
                    authorizationUrl: 'https://pds.example/oauth/authorize?request=opaque',
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;
        const result = await beginLogin('alice.example.com', '/posting?from=feed');

        expect(result).toEqual({
            authorizationUrl: 'https://pds.example/oauth/authorize?request=opaque',
        });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/oauth/login',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
                redirect: 'error',
                headers: expect.objectContaining({
                    'x-csrf-token': 'csrf-proof',
                }),
                body: JSON.stringify({
                    handle: 'alice.example.com',
                    returnTo: '/posting?from=feed',
                }),
            }),
        );
        expect(JSON.stringify(result)).not.toMatch(/access|refresh|token/i);
    });

    it('removes sensitive parameters from the intended destination', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    authorizationUrl: 'https://pds.example/oauth/authorize',
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        await beginLogin(
            'alice.example.com',
            '/posting?filter=food&access_token=secret&state=secret#refresh_token=secret',
        );

        const request = (
            fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
        )[0]?.[1];
        if (!request) throw new Error('Expected login request.');
        expect(JSON.parse(String(request.body))).toEqual({
            handle: 'alice.example.com',
            returnTo: '/posting?filter=food',
        });
    });

    it('restores only the cookie-backed public session summary', async () => {
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    session: {
                        did: 'did:plc:alice',
                        handle: 'alice.example.com',
                        expiresAt: '2026-07-12T12:00:00.000Z',
                        role: 'administrator',
                        canManageSignupInvitations: true,
                    },
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const session = await getCurrentSession();

        expect(session).toEqual({
            did: 'did:plc:alice',
            handle: 'alice.example.com',
            expiresAt: '2026-07-12T12:00:00.000Z',
            role: 'administrator',
            canManageSignupInvitations: true,
        });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/session',
            expect.objectContaining({ method: 'GET', credentials: 'include' }),
        );
        expect(JSON.stringify(session)).not.toMatch(/access|refresh|token/i);
    });

    it('refreshes the cookie-backed session with CSRF protection', async () => {
        document.cookie = 'patchwork_csrf=csrf-proof; Path=/';
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    session: {
                        did: 'did:plc:alice',
                        expiresAt: '2026-07-12T12:00:00.000Z',
                    },
                    refreshed: true,
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const session = await refreshSession();

        expect(session.did).toBe('did:plc:alice');
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/refresh',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
                headers: expect.objectContaining({
                    'x-csrf-token': 'csrf-proof',
                }),
            }),
        );
    });

    it('logs out through the cookie and CSRF boundary', async () => {
        document.cookie = 'patchwork_csrf=logout-proof; Path=/';
        const fetchMock = vi.fn(async () =>
            new Response(JSON.stringify({ deleted: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        await logoutSession();

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/session',
            expect.objectContaining({
                method: 'DELETE',
                credentials: 'include',
                headers: expect.objectContaining({
                    'x-csrf-token': 'logout-proof',
                }),
            }),
        );
    });

    it('preserves a recoverable PDS-unavailable error code', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    error: {
                        code: 'PDS_UNAVAILABLE',
                        message: 'The AT Protocol server is temporarily unavailable.',
                        retryable: true,
                    },
                }),
                {
                    status: 503,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        ) as typeof fetch;

        await expect(beginLogin('alice.example.com', '/posting')).rejects.toEqual(
            expect.objectContaining({
                code: 'PDS_UNAVAILABLE',
                retryable: true,
            }),
        );
    });

    it('renders a keyboard-operable and screen-reader-labelled login form', () => {
        const html = renderToStaticMarkup(
            <AuthProvider initialStatus='anonymous'>
                <LoginPage />
            </AuthProvider>,
        );

        expect(html).toContain('<main');
        expect(html).toContain('aria-labelledby="login-heading"');
        expect(html).toContain('for="at-handle"');
        expect(html).toContain('id="at-handle"');
        expect(html).toContain('type="submit"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('Continue with Bluesky');
        expect(html).toContain('Bluesky or AT Protocol handle');
    });

    it('renders a labelled signup form without exposing secrets', () => {
        window.history.replaceState({}, '', '/signup?returnTo=/feed?state=secret&token=secret');
        const html = renderToStaticMarkup(
            <AuthProvider initialStatus='anonymous'>
                <SignupPage />
            </AuthProvider>,
        );

        expect(html).toContain('for="handle-label"');
        expect(html).toContain('id="handle-label"');
        expect(html).toContain('.subcult.tv');
        expect(html).toContain('for="email"');
        expect(html).toContain('for="password"');
        expect(html).toContain('for="password-confirm"');
        expect(html).toContain('for="invite-code"');
        expect(html).toContain('for="terms-accepted"');
        expect(html).not.toContain('supersecret');
        expect(html).not.toContain('invite-123');
        expect(html).not.toContain('fake-jwt');
        expect(html).not.toContain('fake-access');
        expect(html).not.toContain('fake-refresh');
    });

    it('signs up with CSRF and strips fake JWT fields from the result', async () => {
        document.cookie = 'patchwork_csrf=signup-proof; Path=/';
        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    did: 'did:plc:alice',
                    handle: 'alice.subcult.tv',
                    accessJwt: 'fake-access',
                    refreshJwt: 'fake-refresh',
                    jwt: 'fake-jwt',
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const result = await signup({
            handle: 'alice.subcult.tv',
            email: 'alice@example.com',
            password: 'supersecret',
            inviteCode: 'invite-123',
            policyVersion: CURRENT_POLICY_VERSION,
            asserted18OrOlder: true,
            acceptedDocuments: [...requiredPolicyDocuments],
        });

        expect(result).toEqual({ did: 'did:plc:alice', handle: 'alice.subcult.tv' });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/auth/signup',
            expect.objectContaining({
                method: 'POST',
                credentials: 'include',
                redirect: 'error',
                headers: expect.objectContaining({
                    'x-csrf-token': 'signup-proof',
                }),
                body: JSON.stringify({
                    handle: 'alice.subcult.tv',
                    email: 'alice@example.com',
                    password: 'supersecret',
                    inviteCode: 'invite-123',
                    policyVersion: CURRENT_POLICY_VERSION,
                    asserted18OrOlder: true,
                    acceptedDocuments: [...requiredPolicyDocuments],
                }),
            }),
        );
        expect(JSON.stringify(result)).not.toMatch(/accessJwt|refreshJwt|jwt|token|supersecret|invite-123/i);
    });

    it('submits a shared invitation token without a raw PDS invite code', async () => {
        const fetchMock = vi.fn(async (
            _input: RequestInfo | URL,
            _init?: RequestInit,
        ) =>
            new Response(
                JSON.stringify({ did: 'did:plc:alice', handle: 'alice.subcult.tv' }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            ),
        );
        globalThis.fetch = fetchMock as typeof fetch;

        await signup({
            handle: 'alice.subcult.tv',
            email: 'alice@example.com',
            password: 'supersecret',
            inviteToken: 'a'.repeat(43),
            policyVersion: CURRENT_POLICY_VERSION,
            asserted18OrOlder: true,
            acceptedDocuments: [...requiredPolicyDocuments],
        });

        const request = fetchMock.mock.calls[0]![1] as RequestInit;
        expect(request.body).toBe(JSON.stringify({
            handle: 'alice.subcult.tv',
            email: 'alice@example.com',
            password: 'supersecret',
            inviteToken: 'a'.repeat(43),
            policyVersion: CURRENT_POLICY_VERSION,
            asserted18OrOlder: true,
            acceptedDocuments: [...requiredPolicyDocuments],
        }));
        expect(String(request.body)).not.toContain('inviteCode');
    });

    it('recognizes an invite URL, removes its bearer token from the address bar, and hides the code field', async () => {
        const token = 'b'.repeat(43);
        window.history.replaceState({}, '', `/signup?invite=${token}&returnTo=%2Fmap`);
        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <AuthProvider initialStatus='anonymous'>
                    <SignupPage />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(container.textContent).toContain('Your invitation is ready');
        expect(container.querySelector('#invite-code')).toBeNull();
        expect(window.location.search).toBe('?returnTo=%2Fmap');
        expect(container.innerHTML).not.toContain(token);
        await act(async () => root.unmount());
        window.history.replaceState({}, '', '/');
    });

    it('does not submit mismatched passwords', async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as typeof fetch;
        const navigate = vi.fn();

        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <AuthProvider initialStatus='anonymous' navigate={navigate}>
                    <SignupPage />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        await act(async () => {
            const handle = container.querySelector('#handle-label') as HTMLInputElement;
            setNativeInputValue(handle, 'alice');
            handle.dispatchEvent(createInputEvent('input'));
            handle.dispatchEvent(createInputEvent('change'));

            const email = container.querySelector('#email') as HTMLInputElement;
            setNativeInputValue(email, 'alice@example.com');
            email.dispatchEvent(createInputEvent('input'));
            email.dispatchEvent(createInputEvent('change'));

            const password = container.querySelector('#password') as HTMLInputElement;
            setNativeInputValue(password, 'password1');
            password.dispatchEvent(createInputEvent('input'));
            password.dispatchEvent(createInputEvent('change'));

            const passwordConfirm = container.querySelector('#password-confirm') as HTMLInputElement;
            setNativeInputValue(passwordConfirm, 'password2');
            passwordConfirm.dispatchEvent(createInputEvent('input'));
            passwordConfirm.dispatchEvent(createInputEvent('change'));

            const inviteCode = container.querySelector('#invite-code') as HTMLInputElement;
            setNativeInputValue(inviteCode, 'invite');
            inviteCode.dispatchEvent(createInputEvent('input'));
            inviteCode.dispatchEvent(createInputEvent('change'));

            const termsAccepted = container.querySelector('#terms-accepted') as HTMLInputElement;
            termsAccepted.click();
            (
                container.querySelector(
                    '#eligibility-accepted',
                ) as HTMLInputElement
            ).click();
        });

        await act(async () => {
            (container.querySelector('form') as HTMLFormElement | null)?.requestSubmit();
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Passwords do not match');
        await act(async () => root.unmount());
    });

    it('shows a recovery state when signup succeeds but OAuth begin fails', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ did: 'did:plc:alice', handle: 'alice.subcult.tv' }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        error: {
                            code: 'RATE_LIMITED',
                            message: 'Temporarily rate limited.',
                        },
                    }),
                    { status: 429, headers: { 'content-type': 'application/json' } },
                ),
            );
        globalThis.fetch = fetchMock as typeof fetch;

        const container = document.createElement('div');
        const root = createRoot(container);
        const navigate = vi.fn();

        await act(async () => {
            root.render(
                <AuthProvider initialStatus='anonymous' navigate={navigate}>
                    <SignupPage />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        await act(async () => {
            const setValue = (selector: string, value: string) => {
                const input = container.querySelector(selector) as HTMLInputElement;
                setNativeInputValue(input, value);
                input.dispatchEvent(createInputEvent('input'));
                input.dispatchEvent(createInputEvent('change'));
            };

            setValue('#handle-label', 'alice');
            setValue('#email', 'alice@example.com');
            setValue('#password', 'password1');
            setValue('#password-confirm', 'password1');
            setValue('#invite-code', 'invite-123');
            (container.querySelector('#terms-accepted') as HTMLInputElement).click();
            (
                container.querySelector(
                    '#eligibility-accepted',
                ) as HTMLInputElement
            ).click();
        });

        await act(async () => {
            (container.querySelector('form') as HTMLFormElement | null)?.requestSubmit();
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(navigate).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Account created for alice.subcult.tv.');
        expect(container.textContent).toContain('the login page');
        expect(container.textContent).not.toContain('invite-123');
        await act(async () => root.unmount());
    });

    it('submits signup and starts OAuth with sanitized returnTo', async () => {
        window.history.replaceState({}, '', '/signup?returnTo=/posting?state=secret&code=secret');
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        did: 'did:plc:alice',
                        handle: 'alice.subcult.tv',
                        accessJwt: 'fake-access',
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        authorizationUrl: 'https://pds.example/oauth/authorize?request=opaque',
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            );
        globalThis.fetch = fetchMock as typeof fetch;

        const container = document.createElement('div');
        const root = createRoot(container);
        const navigate = vi.fn(() => {
            root.unmount();
        });

        await act(async () => {
            root.render(
                <AuthProvider initialStatus='anonymous' navigate={navigate}>
                    <SignupPage />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        await act(async () => {
            const setValue = (selector: string, value: string) => {
                const input = container.querySelector(selector) as HTMLInputElement;
                setNativeInputValue(input, value);
                input.dispatchEvent(createInputEvent('input'));
                input.dispatchEvent(createInputEvent('change'));
            };

            setValue('#handle-label', 'alice');
            setValue('#email', 'alice@example.com');
            setValue('#password', 'password1');
            setValue('#password-confirm', 'password1');
            setValue('#invite-code', 'invite-123');

            const termsAccepted = container.querySelector('#terms-accepted') as HTMLInputElement;
            termsAccepted.click();
            (
                container.querySelector(
                    '#eligibility-accepted',
                ) as HTMLInputElement
            ).click();
        });

        await act(async () => {
            (container.querySelector('form') as HTMLFormElement | null)?.requestSubmit();
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            '/api/auth/signup',
            expect.objectContaining({
                body: JSON.stringify({
                    handle: 'alice.subcult.tv',
                    email: 'alice@example.com',
                    password: 'password1',
                    inviteCode: 'invite-123',
                    policyVersion: CURRENT_POLICY_VERSION,
                    asserted18OrOlder: true,
                    acceptedDocuments: [...requiredPolicyDocuments],
                }),
            }),
        );
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            '/api/oauth/login',
            expect.objectContaining({
                body: JSON.stringify({
                    handle: 'alice.subcult.tv',
                    returnTo: '/posting',
                }),
            }),
        );
        expect(container.innerHTML).not.toContain('password1');
        expect(container.innerHTML).not.toContain('invite-123');
        expect(container.innerHTML).not.toContain('fake-access');
        await act(async () => root.unmount());
    });

    it('renders stale-callback recovery without reflecting OAuth parameters', () => {
        window.history.replaceState(
            {},
            '',
            '/auth/callback?error=OAUTH_STATE_INVALID&state=sensitive-state&code=sensitive-code',
        );
        const html = renderToStaticMarkup(
            <AuthProvider initialStatus='anonymous'>
                <AuthCallbackPage />
            </AuthProvider>,
        );

        expect(html).toContain('role="alert"');
        expect(html).toContain('This login callback is stale or invalid.');
        expect(html).toContain('Start a new login');
        expect(html).not.toContain('sensitive-state');
        expect(html).not.toContain('sensitive-code');

        window.history.replaceState({}, '', '/auth/callback?error=access_denied');
        const denied = renderToStaticMarkup(
            <AuthProvider initialStatus='anonymous'>
                <AuthCallbackPage />
            </AuthProvider>,
        );
        expect(denied).toContain('Authorization was denied');

        window.history.replaceState({}, '', '/auth/callback?error=PDS_UNAVAILABLE');
        const unavailable = renderToStaticMarkup(
            <AuthProvider initialStatus='anonymous'>
                <AuthCallbackPage />
            </AuthProvider>,
        );
        expect(unavailable).toContain('temporarily unavailable');
    });

    it('verifies the callback cookie before navigating to the sanitized destination', async () => {
        window.history.replaceState(
            {},
            '',
            '/auth/callback?returnTo=%2Fmap%3Fr%3D3000%26code%3Dsecret',
        );
        globalThis.fetch = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    session: {
                        did: 'did:plc:alice',
                        expiresAt: '2099-07-12T12:00:00.000Z',
                    },
                }),
                {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        ) as typeof fetch;
        const navigate = vi.fn();
        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <AuthProvider>
                    <AuthCallbackPage navigate={navigate} />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/auth/session',
            expect.objectContaining({ credentials: 'include' }),
        );
        expect(navigate).toHaveBeenCalledWith('/map?r=3000');
        expect(window.location.search).toBe('');
        await act(async () => root.unmount());
    });

    it('offers a new login when the callback has no verified session cookie', async () => {
        window.history.replaceState(
            {},
            '',
            '/auth/callback?returnTo=%2Fmap&code=sensitive-code',
        );
        globalThis.fetch = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    error: {
                        code: 'AUTHENTICATION_REQUIRED',
                        message: 'Authentication required.',
                    },
                }),
                {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        ) as typeof fetch;
        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <AuthProvider>
                    <AuthCallbackPage />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(container.textContent).toContain(
            'Patchwork could not find a verified session.',
        );
        expect(container.innerHTML).toContain(
            'href="/login?returnTo=%2Fmap"',
        );
        expect(container.innerHTML).not.toContain('sensitive-code');
        expect(window.location.search).toBe('');
        await act(async () => root.unmount());
    });

    it('links from login to signup with a sanitized returnTo', () => {
        window.history.replaceState({}, '', '/login?returnTo=/feed?state=secret&token=secret');
        const html = renderToStaticMarkup(
            <AuthProvider initialStatus='anonymous'>
                <LoginPage />
            </AuthProvider>,
        );

        expect(html).toContain('href="/signup?returnTo=%2Ffeed"');
        expect(html).toContain('Create an account on Subcult’s PDS');
        expect(html).toContain(
            'Get your own portable AT Protocol handle, hosted on our community PDS.',
        );
        expect(html).not.toContain('secret');
        expect(html).not.toContain('token');
    });

    it('restores and clears the real provider session through public actions', async () => {
        document.cookie = 'patchwork_csrf=provider-proof; Path=/';
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        session: {
                            did: 'did:plc:alice',
                            expiresAt: '2099-07-12T12:00:00.000Z',
                        },
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ deleted: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            );
        globalThis.fetch = fetchMock as typeof fetch;
        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <AuthProvider>
                    <AuthProbe />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(container.textContent).toContain('authenticated');
        expect(container.textContent).toContain('did:plc:alice');

        await act(async () => {
            container.querySelector('button')?.click();
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        expect(container.textContent).toContain('anonymous');
        expect(container.textContent).toContain('none');
        expect(fetchMock).toHaveBeenCalledTimes(2);

        await act(async () => root.unmount());
    });

    it('announces an expired restored session with a sign-in recovery', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    error: {
                        code: 'SESSION_EXPIRED',
                        message: 'The Patchwork browser session is expired.',
                    },
                }),
                {
                    status: 401,
                    headers: { 'content-type': 'application/json' },
                },
            ),
        ) as typeof fetch;
        const container = document.createElement('div');
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <AuthProvider>
                    <LoginPage />
                </AuthProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 0));
        });

        expect(container.querySelector('[role="alert"]')?.textContent).toContain(
            'Your session expired. Sign in again to continue.',
        );
        await act(async () => root.unmount());
    });
});
