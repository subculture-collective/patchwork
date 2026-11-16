import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultAccountPreferences } from '@patchwork/shared';
import { AccountOnboardingService } from './account-onboarding-service.js';
import { DurableNotificationService } from './durable-notification-service.js';
import { createAccountOnboardingHandler } from './http/account-onboarding-handler.js';
import { createNotificationHandler } from './http/notification-handler.js';
import { authenticateRequest } from './http/authenticated-request.js';
import { idempotencyKeyFromRequest, withIdempotencyKey } from './http/idempotent-request.js';
import { PostgresIdempotencyExecutor } from './http/idempotency-store.js';

const did = 'did:example:mobile-language-fixture';
const fixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(
    new URL(`../../../packages/mobile-contracts/fixtures/${name}.json`, import.meta.url), 'utf8')) as T;

describe('native language preference and delivery HTTP contracts', () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const preferences = new AccountOnboardingService(pool);
    const executor = new PostgresIdempotencyExecutor(pool);
    const emails: { subject: string; text: string }[] = [];
    const pushes: { payload: string }[] = [];
    const notifications = new DurableNotificationService(pool, {
        email: { send: async input => { emails.push(input); return { accepted: true }; } },
        push: { send: async input => { pushes.push(input); return { accepted: true }; } },
    }, { publicWebOrigin: 'https://patchwork.example' });
    const authenticate = (request: Parameters<typeof authenticateRequest>[0]) => authenticateRequest(request, {
        resolveSession: async token => {
            if (token !== 'synthetic-native-session') throw new Error('invalid fixture credential');
            return { did };
        },
        resolveRole: async () => 'user',
    });
    const accountHandler = createAccountOnboardingHandler({ service: preferences, authenticate,
        executeIdempotent: (request, actorDid, body, effect) => {
            const key = idempotencyKeyFromRequest(request);
            const command = withIdempotencyKey(body, key);
            return executor.execute({ actorDid, method: request.method!,
                pathname: new URL(request.url!, 'http://localhost').pathname,
                idempotencyKey: key, body: command }, () => effect(command, key));
        },
    });
    const notificationHandler = createNotificationHandler({ service: notifications, authenticate });
    let server: Server;
    let origin: string;
    const request = (path: string, method = 'GET', body?: unknown) => fetch(`${origin}${path}`, {
        method, headers: { authorization: 'Bearer synthetic-native-session',
            'content-type': 'application/json', 'idempotency-key': randomUUID(),
            // Device region and transport language must not override the stored interface language.
            'accept-language': 'fr-CA' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    beforeAll(async () => {
        await pool.query('DELETE FROM account_preferences WHERE did=$1', [did]);
        server = createServer((request, response) => {
            const url = new URL(request.url!, 'http://localhost');
            if (!accountHandler(request, response, url) && !notificationHandler(request, response, url)) response.writeHead(404).end();
        });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
        origin = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        for (const table of ['notification_intents', 'notification_email_endpoints', 'notification_push_subscriptions']) {
            await pool.query(`DELETE FROM ${table} WHERE ${table === 'notification_intents' ? 'recipient_did' : 'owner_did'}=$1`, [did]);
        }
        await pool.query('DELETE FROM account_preferences WHERE did=$1', [did]);
        await pool.query('DELETE FROM account_preference_audit WHERE did=$1', [did]);
        await pool.query('DELETE FROM http_idempotency_commands WHERE actor_did=$1', [did]);
        await pool.end();
    });
    it('reads/updates supported languages and rejects unsupported language without losing the preference', async () => {
        expect(await (await request('/account/preferences')).json()).toEqual(fixture('account-preferences-en'));
        const response = await request('/account/preferences', 'PUT', fixture('account-preferences-es'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual(fixture('account-preferences-es'));
        const invalid = fixture<{ preferences: unknown; expectedErrorCode: string }>('account-preferences-unsupported');
        const rejected = await request('/account/preferences', 'PUT', { preferences: invalid.preferences });
        expect(rejected.status).toBe(400);
        expect(await rejected.json()).toMatchObject({ error: { code: invalid.expectedErrorCode } });
        expect(await (await request('/account/preferences')).json()).toEqual(fixture('account-preferences-es'));
        expect((await new AccountOnboardingService(pool).preferencesFor(did)).language).toBe('es');
    });
    it('refetches existing notification copy after language change and localizes pending external delivery at send time', async () => {
        await preferences.updatePreferences(did, { ...defaultAccountPreferences, language: 'en', notifications: { inApp: true, email: true, push: true } });
        await notifications.requestEmailVerification(did, 'member@patchwork.example');
        const link = emails[0]!.text.match(/https:\/\/\S+/u)![0];
        await notifications.confirmEmail(did, new URL(link).searchParams.get('emailToken')!);
        emails.length = 0;
        await notifications.registerPush(did, { endpoint: 'https://push.example.test/mobile-language', p256dh: 'fixture-public-key-material', auth: 'fixture-auth-key' });
        await pool.query(`SELECT patchwork_enqueue_notification($1, 'offer_received', 'New offer',
            'Someone offered to help with your request.', 'normal', '/inbox', '{}'::jsonb, $2, NOW())`, [did, randomUUID()]);
        const english = await (await request('/notifications')).json() as { items: { id: string; title: string }[] };
        expect(english.items[0]?.title).toBe('New offer');
        await preferences.updatePreferences(did, { ...defaultAccountPreferences, language: 'es', notifications: { inApp: true, email: true, push: true } });
        const spanish = await (await request('/notifications')).json() as { items: { id: string; title: string }[] };
        expect(spanish.items[0]).toMatchObject({ id: english.items[0]!.id, title: 'Nueva oferta' });
        expect(await notifications.runDeliverySweep()).toMatchObject({ delivered: 2 });
        expect(emails[0]?.subject).toBe('Nueva oferta');
        expect(JSON.parse(pushes[0]!.payload)).toEqual({ title: 'Nueva oferta', body: 'Alguien se ofreció a ayudar con tu solicitud.', actionUrl: '/inbox' });
    });
});
