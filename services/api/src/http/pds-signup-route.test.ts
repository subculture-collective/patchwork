import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicHttpError } from './error-response.js';
import {
    CURRENT_POLICY_VERSION,
    requiredPolicyDocuments,
} from '@patchwork/shared';

const createAccount = vi.fn();

vi.mock('../auth/pds-signup-service.js', () => ({
    createPdsSignupService: () => ({ createAccount }),
}));

describe('POST /auth/signup', () => {
    let server: Server;
    let origin: string;

    beforeAll(async () => {
        process.env.NODE_ENV = 'test';
        process.env.ATPROTO_SERVICE_DID = 'did:example:patchwork-test';
        process.env.API_DATA_SOURCE = 'fixture';
        process.env.API_PUBLIC_ORIGIN = 'https://patchwork.test';
        process.env.ATPROTO_ACCOUNT_PDS_URL = 'https://pds.subcult.tv';
        const { createApiServer } = await import('../index.js');
        server = createApiServer();
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') {
            throw new Error('API test server did not bind a TCP address.');
        }
        origin = `http://127.0.0.1:${address.port}`;
    }, 15_000);

    beforeEach(() => {
        createAccount.mockReset();
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) =>
            server.close(error => (error ? reject(error) : resolve())),
        );
    });

    it('creates an account and returns only did and handle', async () => {
        createAccount.mockResolvedValueOnce({
            did: 'did:plc:newdid',
            handle: 'alice.subcult.tv',
        });

        const response = await fetch(`${origin}/auth/signup`, {
            method: 'POST',
            headers: {
                origin: 'https://patchwork.test',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                handle: 'alice.subcult.tv',
                email: 'alice@example.com',
                password: 'password123',
                inviteCode: 'invite-1',
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            }),
        });

        expect(response.status).toBe(201);
        await expect(response.json()).resolves.toEqual({
            did: 'did:plc:newdid',
            handle: 'alice.subcult.tv',
        });
        expect(createAccount).toHaveBeenCalledWith({
            handle: 'alice.subcult.tv',
            email: 'alice@example.com',
            password: 'password123',
            inviteCode: 'invite-1',
        });
    });

    it('rejects a wrong Origin before contacting the PDS', async () => {
        const response = await fetch(`${origin}/auth/signup`, {
            method: 'POST',
            headers: {
                origin: 'https://evil.test',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                handle: 'alice.subcult.tv',
                email: 'alice@example.com',
                password: 'password123',
                inviteCode: 'invite-1',
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            }),
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'CSRF_ORIGIN_INVALID' },
        });
        expect(createAccount).not.toHaveBeenCalled();
    });

    it('rejects malformed payloads', async () => {
        createAccount.mockRejectedValueOnce(
            new PublicHttpError(400, 'INVALID_SIGNUP_INPUT', 'The signup input is invalid.'),
        );
        const response = await fetch(`${origin}/auth/signup`, {
            method: 'POST',
            headers: {
                origin: 'https://patchwork.test',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                handle: 'alice.subcult.tv',
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'INVALID_SIGNUP_INPUT' },
        });
        expect(createAccount).not.toHaveBeenCalled();
    });

    it.each([
        { did: 'did:plc:forged' },
        { role: 'admin' },
        { verification: 'approved' },
        { accountOrigin: 'synthetic' },
    ])('rejects browser-controlled identity or privilege fields', async field => {
        const response = await fetch(`${origin}/auth/signup`, {
            method: 'POST',
            headers: {
                origin: 'https://patchwork.test',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                handle: 'alice.subcult.tv',
                email: 'alice@example.com',
                password: 'password123',
                inviteCode: 'invite-1',
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
                ...field,
            }),
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'INVALID_SIGNUP_INPUT' },
        });
        expect(createAccount).not.toHaveBeenCalled();
    });

    it('rejects an existing browser session without CSRF proof', async () => {
        const response = await fetch(`${origin}/auth/signup`, {
            method: 'POST',
            headers: {
                origin: 'https://patchwork.test',
                cookie: 'patchwork_session=session',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                handle: 'alice.subcult.tv',
                email: 'alice@example.com',
                password: 'password123',
                inviteCode: 'invite-1',
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            }),
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'CSRF_TOKEN_INVALID' },
        });
    });

    it('maps upstream PDS errors without leaking JWTs', async () => {
        createAccount.mockRejectedValueOnce(
            new PublicHttpError(400, 'INVALID_INVITE_CODE', 'The invite code is invalid.'),
        );

        const response = await fetch(`${origin}/auth/signup`, {
            method: 'POST',
            headers: {
                origin: 'https://patchwork.test',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                handle: 'alice.subcult.tv',
                email: 'alice@example.com',
                password: 'password123',
                inviteCode: 'invite-1',
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            }),
        });

        expect(response.status).toBe(400);
        const text = await response.text();
        expect(text).not.toContain('secret');
    });
});
