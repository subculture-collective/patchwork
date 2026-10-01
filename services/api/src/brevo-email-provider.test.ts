import { describe, expect, it, vi } from 'vitest';
import { BrevoEmailProvider, brevoIdempotencyKey } from './brevo-email-provider.js';

const message = { to: 'guest@example.test', subject: 'Update', text: 'Hello', idempotencyKey: 'delivery-123' };

describe('BrevoEmailProvider', () => {
    it('uses Brevo authentication, batch idempotency and native payload', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageIds: ['<123@relay.test>'] }), { status: 201 }));
        const provider = new BrevoEmailProvider('synthetic-key', 'patchwork@subcult.tv', 'info@subcult.tv', fetcher);
        expect(await provider.send(message)).toEqual({ accepted: true, providerMessageId: '123@relay.test' });
        const [url, options] = fetcher.mock.calls[0]!;
        expect(url).toBe('https://api.brevo.com/v3/smtp/email');
        expect(options.headers['api-key']).toBe('synthetic-key');
        expect(options.headers.authorization).toBeUndefined();
        expect(options.redirect).toBe('error');
        expect(JSON.parse(options.body)).toMatchObject({
            sender: { name: 'Patchwork', email: 'patchwork@subcult.tv' },
            replyTo: { email: 'info@subcult.tv' },
            messageVersions: [{ to: [{ email: message.to }] }],
            textContent: message.text, headers: { idempotencyKey: brevoIdempotencyKey(message.idempotencyKey) },
        });
        expect(provider.retryWindowMs).toBeLessThan(30 * 60_000);
    });

    it('uses stable UUIDs for the same delivery and distinct UUIDs for different deliveries', () => {
        const key = brevoIdempotencyKey('delivery-one');
        expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
        expect(brevoIdempotencyKey('delivery-one')).toBe(key);
        expect(brevoIdempotencyKey('delivery-two')).not.toBe(key);
    });

    it('holds duplicate-key acceptance uncertainty instead of assigning a made-up provider ID', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('{"code":"duplicate_parameter"}', { status: 400 }));
        expect(await new BrevoEmailProvider('synthetic', 'patchwork@subcult.tv', undefined, fetcher).send(message))
            .toEqual({ accepted: false, retryable: false, errorCode: 'brevo-acceptance-unconfirmed' });
    });

    it('retries ambiguous successful responses within the durable retry window', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
        expect(await new BrevoEmailProvider('synthetic', 'patchwork@subcult.tv', undefined, fetcher).send(message))
            .toEqual({ accepted: false, retryable: true, errorCode: 'brevo-invalid-response' });
    });

    it.each([400, 401, 403, 404])('does not invalidate recipients for provider status %s', async status => {
        const fetcher = vi.fn().mockResolvedValue(new Response('{"message":"private details"}', { status }));
        const result = await new BrevoEmailProvider('synthetic', 'patchwork@subcult.tv', undefined, fetcher).send(message);
        expect(result).toEqual({ accepted: false, retryable: false, errorCode: `brevo-http-${status}` });
    });

    it('retries throttling without exposing the provider body', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('{"message":"secret"}', { status: 429 }));
        expect(await new BrevoEmailProvider('synthetic', 'patchwork@subcult.tv', undefined, fetcher).send(message))
            .toEqual({ accepted: false, retryable: true, errorCode: 'brevo-http-429' });
    });
});
