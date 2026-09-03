import { describe, expect, it, vi } from 'vitest';
import { PublicHttpError } from '../http/error-response.js';
import { createPdsSignupService } from './pds-signup-service.js';

const baseInput = {
    handle: 'alice.subcult.tv',
    email: 'alice@example.com',
    password: 'correct horse battery staple',
    inviteCode: 'invite-123',
};

describe('createPdsSignupService', () => {
    it('creates one-use invite codes through PDS admin authentication', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ code: 'pds-code' }),
        });
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            adminPassword: 'admin-secret',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createInviteCode()).resolves.toBe('pds-code');
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://pds.subcult.tv/xrpc/com.atproto.server.createInviteCode',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ useCount: 1 }),
                headers: expect.objectContaining({
                    authorization: `Basic ${Buffer.from('admin:admin-secret').toString('base64')}`,
                }),
            }),
        );
    });

    it('fails closed when PDS invite issuance is not configured', async () => {
        const fetchImpl = vi.fn();
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createInviteCode()).rejects.toMatchObject({
            code: 'PDS_INVITE_ISSUANCE_UNAVAILABLE',
            statusCode: 503,
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('forwards credentials to the configured PDS and returns only did and handle', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                did: 'did:plc:abc123',
                handle: 'alice.subcult.tv',
                accessJwt: 'secret',
                refreshJwt: 'secret',
            }),
        });
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
            timeoutMs: 50,
        });

        await expect(service.createAccount(baseInput)).resolves.toEqual({
            did: 'did:plc:abc123',
            handle: 'alice.subcult.tv',
        });
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://pds.subcult.tv/xrpc/com.atproto.server.createAccount',
            expect.objectContaining({
                method: 'POST',
                redirect: 'error',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(baseInput),
            }),
        );
    });

    it.each([
        'abuse.subcult.tv',
        'admin.subcult.tv',
        'api.subcult.tv',
        'auth.subcult.tv',
        'contact.subcult.tv',
        'edda.subcult.tv',
        'git.subcult.tv',
        'grafana.subcult.tv',
        'help.subcult.tv',
        'legal.subcult.tv',
        'login.subcult.tv',
        'mail.subcult.tv',
        'oauth.subcult.tv',
        'patchwork.subcult.tv',
        'pds.subcult.tv',
        'privacy.subcult.tv',
        'security.subcult.tv',
        'service.subcult.tv',
        'signup.subcult.tv',
        'staging.subcult.tv',
        'status.subcult.tv',
        'support.subcult.tv',
        'terms.subcult.tv',
        'www.subcult.tv',
    ])(
        'rejects reserved handle %s',
        async handle => {
            const service = createPdsSignupService({ pdsUrl: 'https://pds.subcult.tv' });
            await expect(
                service.createAccount({ ...baseInput, handle } as unknown as typeof baseInput),
            ).rejects.toEqual(
                expect.objectContaining({
                    code: 'RESERVED_HANDLE',
                }),
            );
        },
    );

    it.each(['Alice.subcult.tv', 'ab.subcult.tv', 'toolonglabeltoolonglabel.subcult.tv', 'bad.handle'])(
        'rejects malformed handle %s',
        async handle => {
            const service = createPdsSignupService({ pdsUrl: 'https://pds.subcult.tv' });
            await expect(service.createAccount({ ...baseInput, handle } as unknown as typeof baseInput)).rejects.toBeInstanceOf(PublicHttpError);
        },
    );

    it.each([
        ['handle', { handle: '' }],
        ['email', { email: 'not-an-email' }],
        ['password', { password: '' }],
        ['inviteCode', { inviteCode: '' }],
    ])('rejects invalid %s input with a stable public error', async (_field, patch) => {
        const service = createPdsSignupService({ pdsUrl: 'https://pds.subcult.tv' });
        await expect(service.createAccount({ ...baseInput, ...patch } as unknown as typeof baseInput)).rejects.toMatchObject({
            code: 'INVALID_SIGNUP_INPUT',
            statusCode: 400,
        });
    });

    it.each([
        ['handle', { handle: undefined }],
        ['email', { email: undefined }],
        ['password', { password: undefined }],
        ['inviteCode', { inviteCode: undefined }],
    ])('rejects missing %s input with a stable public error', async (_field, patch) => {
        const service = createPdsSignupService({ pdsUrl: 'https://pds.subcult.tv' });
        await expect(service.createAccount({ ...baseInput, ...patch } as unknown as typeof baseInput)).rejects.toMatchObject({
            code: 'INVALID_SIGNUP_INPUT',
            statusCode: 400,
        });
    });

    it('maps duplicate handles, invalid passwords, and invite codes to stable public errors', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: false,
            status: 400,
            json: vi.fn().mockResolvedValue({ error: 'HandleNotAvailable' }),
        });
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'HANDLE_ALREADY_EXISTS',
            statusCode: 400,
        });

        fetchImpl.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: vi.fn().mockResolvedValue({ error: 'InvalidPassword' }),
        });
        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'INVALID_PASSWORD',
            statusCode: 400,
        });

        fetchImpl.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: vi.fn().mockResolvedValue({ error: 'InvalidInviteCode' }),
        });
        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'INVALID_INVITE_CODE',
            statusCode: 400,
        });
    });

    it('rejects a mismatched upstream handle', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                did: 'did:plc:abc123',
                handle: 'someone-else.subcult.tv',
            }),
        });
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'PDS_SIGNUP_FAILED',
            statusCode: 400,
        });
    });

    it('rejects malformed upstream identity and browser-controlled fields', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({
                did: 'not-a-did',
                handle: 'alice.subcult.tv',
            }),
        });
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'PDS_SIGNUP_FAILED',
        });
        await expect(
            service.createAccount({
                ...baseInput,
                did: 'did:plc:forged',
                role: 'admin',
                verified: true,
                accountOrigin: 'synthetic',
            } as unknown as typeof baseInput),
        ).rejects.toMatchObject({ code: 'INVALID_SIGNUP_INPUT' });
    });

    it('maps an upstream HTTP rate limit without reflecting its body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: false,
            status: 429,
            json: vi.fn().mockResolvedValue({
                error: 'UnexpectedProviderMessage',
                message: 'private upstream details',
            }),
        });
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'PDS_RATE_LIMITED',
            statusCode: 503,
            message: 'The account service is busy.',
        });
    });

    it('maps a timeout to a public unavailable error', async () => {
        const fetchImpl = vi.fn().mockRejectedValue(
            Object.assign(new Error('Aborted'), { name: 'AbortError' }),
        );
        const service = createPdsSignupService({
            pdsUrl: 'https://pds.subcult.tv',
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        await expect(service.createAccount(baseInput)).rejects.toMatchObject({
            code: 'PDS_UNAVAILABLE',
            statusCode: 503,
        });
    });
});
