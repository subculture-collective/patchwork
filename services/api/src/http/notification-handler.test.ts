import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuthorizationContext } from '../authorization-guard.js';
import type { DurableNotificationService } from '../durable-notification-service.js';
import { createNotificationHandler } from './notification-handler.js';

describe('durable notification HTTP boundary', () => {
    const actorDid = 'did:plc:notification-owner';
    const list = vi.fn();
    const markRead = vi.fn();
    const markAllRead = vi.fn();
    const archive = vi.fn();
    const getChannelState = vi.fn();
    const requestEmailVerification = vi.fn();
    const confirmEmail = vi.fn();
    const disableEmail = vi.fn();
    const registerPush = vi.fn();
    const revokePush = vi.fn();
    const recordProviderFeedback = vi.fn();
    const service = {
        list,
        markRead,
        markAllRead,
        archive,
        getChannelState,
        requestEmailVerification,
        confirmEmail,
        disableEmail,
        registerPush,
        revokePush,
        recordProviderFeedback,
    } as unknown as DurableNotificationService;
    let origin: string;
    let server: ReturnType<typeof createServer>;

    beforeAll(async () => {
        const handler = createNotificationHandler({
            service,
            providerFeedbackToken: 'provider-feedback-secret',
            emailProviderKind: 'brevo',
            authenticate: async () => ({
                sessionToken: 'opaque',
                session: { did: actorDid },
                principal: {
                    did: actorDid,
                    role: 'user',
                    authorization: createAuthorizationContext(
                        actorDid,
                        'user',
                    ),
                },
            }),
        });
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

    it('derives list and mutation ownership from the authenticated session', async () => {
        list.mockResolvedValueOnce({
            items: [],
            total: 0,
            unread: 0,
        });
        const listed = await fetch(
            `${origin}/notifications?recipientDid=did:plc:hostile&filter=unread`,
        );
        expect(listed.status).toBe(200);
        expect(listed.headers.get('cache-control')).toBe('no-store');
        expect(list).toHaveBeenCalledWith(actorDid, {
            filter: 'unread',
            type: undefined,
            cursor: undefined,
            limit: undefined,
        });

        markRead.mockResolvedValueOnce(true);
        const updated = await fetch(`${origin}/notifications/read`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                recipientDid: 'did:plc:hostile',
                notificationId:
                    '11111111-1111-4111-8111-111111111111',
                read: true,
            }),
        });
        expect(updated.status).toBe(200);
        expect(markRead).toHaveBeenCalledWith(
            actorDid,
            '11111111-1111-4111-8111-111111111111',
            true,
        );
    });

    it('requires explicit push opt-in in the service and ignores body identity', async () => {
        registerPush.mockResolvedValueOnce({
            id: '22222222-2222-4222-8222-222222222222',
        });
        const response = await fetch(`${origin}/notifications/push`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'user-agent': 'test-browser',
            },
            body: JSON.stringify({
                ownerDid: 'did:plc:hostile',
                endpoint: 'https://push.example.test/subscription',
                keys: {
                    p256dh: 'p256dh-public-key-material',
                    auth: 'auth-secret-material',
                },
            }),
        });
        expect(response.status).toBe(201);
        expect(registerPush).toHaveBeenCalledWith(actorDid, {
            endpoint: 'https://push.example.test/subscription',
            p256dh: 'p256dh-public-key-material',
            auth: 'auth-secret-material',
            userAgent: 'test-browser',
        });
    });

    it('normalizes native Brevo feedback without trusting its recipient', async () => {
        recordProviderFeedback.mockResolvedValueOnce(true);
        const response = await fetch(`${origin}/internal/notifications/provider-feedback`, {
            method: 'POST',
            headers: { authorization: 'Bearer provider-feedback-secret', 'content-type': 'application/json' },
            body: JSON.stringify({ event: 'hard_bounce', 'message-id': '<brevo-one>', email: 'untrusted@example.test' }),
        });
        expect(response.status).toBe(202);
        expect(recordProviderFeedback).toHaveBeenLastCalledWith({ channel: 'email', providerMessageId: 'brevo-one', event: 'bounced' });
        recordProviderFeedback.mockClear();
    });

    it('acknowledges other project events without storing them or requesting retry', async () => {
        for (const tags of [{ tags: ['subcult-os'] }, { tag: '["hasanara-operational"]' }]) {
            const response = await fetch(`${origin}/internal/notifications/provider-feedback`, {
                method: 'POST',
                headers: { authorization: 'Bearer provider-feedback-secret', 'content-type': 'application/json' },
                body: JSON.stringify({ event: 'delivered', 'message-id': '<other@brevo.test>', ...tags }),
            });
            expect(response.status).toBe(202);
            expect(recordProviderFeedback).not.toHaveBeenCalled();
        }
    });

    it('requests provider retry for early receipts and unavailable storage', async () => {
        for (const result of ['unknown', 'unavailable']) {
            if (result === 'unknown') recordProviderFeedback.mockResolvedValueOnce(false);
            else recordProviderFeedback.mockRejectedValueOnce(new Error('private storage detail'));
            const response = await fetch(`${origin}/internal/notifications/provider-feedback`, {
                method: 'POST',
                headers: { authorization: 'Bearer provider-feedback-secret', 'content-type': 'application/json' },
                body: JSON.stringify({ event: 'delivered', 'message-id': '<early@brevo.test>' }),
            });
            expect(response.status).toBe(429);
            expect(await response.text()).not.toContain('private storage detail');
        }
        recordProviderFeedback.mockClear();
    });

    it('keeps provider feedback on a dedicated constant-time bearer boundary', async () => {
        const denied = await fetch(
            `${origin}/internal/notifications/provider-feedback`,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    channel: 'email',
                    providerMessageId: 'provider-one',
                    event: 'bounced',
                }),
            },
        );
        expect(denied.status).toBe(401);
        expect(recordProviderFeedback).not.toHaveBeenCalled();

        recordProviderFeedback.mockResolvedValueOnce(true);
        const accepted = await fetch(
            `${origin}/internal/notifications/provider-feedback`,
            {
                method: 'POST',
                headers: {
                    authorization: 'Bearer provider-feedback-secret',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    channel: 'email',
                    providerMessageId: 'provider-one',
                    event: 'bounced',
                }),
            },
        );
        expect(accepted.status).toBe(202);
        expect(recordProviderFeedback).toHaveBeenCalledWith({
            channel: 'email',
            providerMessageId: 'provider-one',
            event: 'bounced',
        });
    });
});
