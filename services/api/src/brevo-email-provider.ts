import { createHash } from 'node:crypto';
import type { DeliveryProviderResult, EmailProvider } from './durable-notification-service.js';

export class BrevoEmailProvider implements EmailProvider {
    // Brevo retains batch idempotency keys for 30 minutes. Keep a safety margin.
    readonly retryWindowMs = 29 * 60_000;

    constructor(
        private readonly apiKey: string,
        private readonly fromAddress: string,
        private readonly replyTo: string = fromAddress,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    async send(input: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<DeliveryProviderResult> {
        try {
            const response = await this.fetchImpl('https://api.brevo.com/v3/smtp/email', {
                method: 'POST', redirect: 'error',
                headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({
                    sender: { name: 'Patchwork', email: this.fromAddress },
                    replyTo: { email: this.replyTo },
                    subject: input.subject, textContent: input.text,
                    messageVersions: [{ to: [{ email: input.to }] }],
                    headers: { idempotencyKey: brevoIdempotencyKey(input.idempotencyKey) },
                    tags: ['patchwork'],
                }),
                signal: AbortSignal.timeout(10_000),
            });
            const raw = await response.text();
            if (Buffer.byteLength(raw) > 65_536) {
                return { accepted: false, retryable: true, errorCode: 'brevo-invalid-response' };
            }
            let payload: Record<string, unknown> | null = null;
            try {
                const parsed: unknown = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>;
            } catch { /* Interpret status below without exposing provider content. */ }
            const id = payload?.['messageId'] ?? (Array.isArray(payload?.['messageIds']) ? payload['messageIds'][0] : undefined);
            if (response.status === 201 && typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\r\n]/u.test(id)) {
                return { accepted: true, providerMessageId: id.replace(/^<|>$/g, '') };
            }
            if (response.status === 201) {
                return { accepted: false, retryable: true, errorCode: 'brevo-invalid-response' };
            }
            if (payload?.['code'] === 'duplicate_parameter') {
                return { accepted: false, retryable: false, errorCode: 'brevo-acceptance-unconfirmed' };
            }
            // Configuration/authentication errors must not disable a valid recipient.
            return {
                accepted: false,
                retryable: response.status === 408 || response.status === 429 || response.status >= 500,
                errorCode: `brevo-http-${response.status}`,
            };
        } catch {
            return { accepted: false, retryable: true, errorCode: 'brevo-network' };
        }
    }
}

export function brevoIdempotencyKey(value: string): string {
    const hash = createHash('sha256').update('patchwork-email/' + value).digest();
    hash[6] = (hash[6]! & 0x0f) | 0x40;
    hash[8] = (hash[8]! & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString('hex');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
