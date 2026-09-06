import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('production chat discloses its trust model and supports duplicate-safe retry, read, redaction, and reporting', async ({ page }) => {
    const actor = 'did:plc:chat-browser-actor';
    const peer = 'did:plc:chat-browser-peer';
    const connectionId = '51111111-1111-4111-8111-111111111111';
    const conversationId = '51111111-1111-4111-8111-111111111112';
    let conversationCreated = false;
    let sendAttempts = 0;
    const sentClientIds: string[] = [];
    let messages: Array<Record<string, unknown>> = [];
    const calls: string[] = [];

    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace(/^\/api/, '');
        calls.push(`${request.method()} ${path}`);
        const fulfill = (body: unknown, status = 200) => route.fulfill({
            status, contentType: 'application/json', body: JSON.stringify(body),
        });
        if (path === '/auth/session') return fulfill({ session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' } });
        if (path === '/account/onboarding') return fulfill({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-08-05T00:00:00Z' });
        if (path === '/account/preferences') return fulfill({ preferences: { privacy: 'private', notifications: { inApp: true, email: false, push: false }, visibility: 'authenticated', language: 'en', location: { sharing: 'hidden', noPermanentAddress: false } } });
        if (path === '/coordination/mine') return fulfill({ offers: [], connections: [{
            id: connectionId, offerId: 'offer', requestUri: `at://${actor}/app.patchwork.aid.post/chat-browser`,
            status: 'active', requesterDid: actor, helperDid: peer, counterpartDid: peer,
            acceptedAt: '2026-08-05T12:00:00Z', completedAt: null, updatedAt: '2026-08-05T12:00:00Z',
        }] });
        if (path === '/groups') return fulfill({ groups: [], invitations: [], outgoingInvitations: [] });
        if (path === '/chat/conversations' && request.method() === 'GET') return fulfill({ conversations: conversationCreated ? [{
            id: conversationId, kind: 'direct', connectionId, roomId: null, title: peer,
            counterpartDid: peer, status: 'active', version: 1, unreadCount: 0,
            lastSequence: messages.length || null, lastReadSequence: messages.length,
            lastMessageAt: messages.length ? '2026-08-05T12:01:00Z' : null,
            createdAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-05T12:01:00Z', closedAt: null,
        }] : [] });
        if (path === '/chat/conversations' && request.method() === 'POST') {
            conversationCreated = true;
            return fulfill({ conversation: { id: conversationId, kind: 'direct', connectionId,
                roomId: null, title: peer, counterpartDid: peer, status: 'active', version: 1,
                unreadCount: 0, lastSequence: null, lastReadSequence: 0, lastMessageAt: null,
                createdAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-05T12:00:00Z', closedAt: null }, created: true }, 201);
        }
        if (path === '/chat/messages' && request.method() === 'GET') return fulfill({ messages, nextCursor: null });
        if (path === '/chat/messages' && request.method() === 'POST') {
            const input = request.postDataJSON() as Record<string, string>;
            sentClientIds.push(input.clientMessageId);
            sendAttempts += 1;
            if (sendAttempts === 1) return fulfill({ error: { code: 'TEMPORARY', message: 'Try again.' } }, 503);
            const message = { id: '51111111-1111-4111-8111-111111111113', sequence: 1,
                conversationId, authorDid: actor, body: input.body, status: 'active',
                deliveryState: 'delivered', createdAt: '2026-08-05T12:01:00Z', redactedAt: null };
            messages = [message];
            return fulfill({ message, created: true }, 201);
        }
        if (path === '/chat/read') return fulfill({ conversationId, lastReadSequence: messages.length });
        if (path === '/chat/messages/redactions') {
            messages = [
                ...messages.map((message) => ({ ...message, body: null, status: 'redacted', redactedAt: '2026-08-05T12:02:00Z' })),
                { id: '51111111-1111-4111-8111-111111111114', sequence: 2,
                    conversationId, authorDid: peer, body: 'A reply that can be reported.', status: 'active',
                    deliveryState: 'read', createdAt: '2026-08-05T12:03:00Z', redactedAt: null },
            ];
            return fulfill({ message: messages[0] });
        }
        if (path === '/chat/reports') return fulfill({ report: { id: '1', status: 'pending' } }, 201);
        return fulfill({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    });

    await page.goto('/chat');
    await expect(page.getByText('Messages are server-readable and are not end-to-end encrypted.', { exact: false })).toBeVisible();
    await page.getByLabel('Authorized connection or room').selectOption(`direct:${connectionId}`);
    await page.getByRole('button', { name: 'Open conversation' }).click();
    await page.getByLabel('Message', { exact: true }).fill('Private browser message');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('alert')).toContainText('draft is preserved');
    await page.getByRole('button', { name: 'Retry message' }).click();
    await expect(page.getByText('Private browser message')).toBeVisible();
    expect(sentClientIds).toHaveLength(2);
    expect(sentClientIds[0]).toBe(sentClientIds[1]);
    await expect.poll(() => calls.includes('POST /chat/read')).toBe(true);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Redact' }).click();
    await expect(page.getByText('Message redacted', { exact: true })).toBeVisible();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Report' }).click();
    await expect(page.getByText('Message reported for review.', { exact: true })).toBeVisible();
    expect(calls).toContain('POST /chat/reports');
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
});

test('production chat preserves a draft while offline and localizes the trust disclosure', async ({ page, context }) => {
    const actor = 'did:plc:chat-browser-es';
    await page.addInitScript(() => localStorage.setItem('patchwork-locale', 'es'));
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
        const body = path === '/auth/session' ? { session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' } } :
            path === '/account/onboarding' ? { policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-08-05T00:00:00Z' } :
            path === '/account/preferences' ? { preferences: { privacy: 'private', notifications: { inApp: true, email: false, push: false }, visibility: 'authenticated', language: 'es', location: { sharing: 'hidden', noPermanentAddress: false } } } :
            path === '/chat/conversations' ? { conversations: [] } : path === '/coordination/mine' ? { offers: [], connections: [] } :
            path === '/groups' ? { groups: [], invitations: [], outgoingInvitations: [] } : { error: { code: 'NOT_FOUND', message: 'Not found.' } };
        await route.fulfill({ status: 'error' in body ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/chat');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByText('Los mensajes son legibles por el servidor', { exact: false })).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByText('No tienes conexión. Tu borrador permanece en este dispositivo; el envío se desactiva hasta que vuelva la conexión.', { exact: true })).toBeVisible();
    await context.setOffline(false);
});


test('connection and notification links select their own conversation instead of the first conversation', async ({ page }) => {
    const actor = 'did:plc:context-chat';
    const targetConnection = '71111111-1111-4111-8111-111111111111';
    const targetConversation = '71111111-1111-4111-8111-111111111112';
    let messageReads: string[] = [];
    const conversation = (id: string, connectionId: string) => ({ id, connectionId, kind: 'direct', roomId: null,
        title: id, status: 'active', version: 1, unreadCount: 0, lastSequence: null, lastReadSequence: 0,
        lastMessageAt: null, createdAt: '2026-09-05T12:00:00Z', updatedAt: '2026-09-05T12:00:00Z', closedAt: null });
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api/, '');
        const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path === '/auth/session') return respond({ session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' } });
        if (path === '/account/onboarding') return respond({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-09-05T12:00:00Z' });
        if (path === '/groups') return respond({ groups: [], invitations: [], outgoingInvitations: [] });
        if (path === '/coordination/mine') return respond({ offers: [], connections: [{ id: targetConnection, status: 'active', counterpartDid: 'did:plc:peer' }] });
        if (path === '/chat/conversations') return respond({ conversations: [conversation('other-conversation', 'other-connection'), conversation(targetConversation, targetConnection)] });
        if (path === '/chat/messages') { messageReads.push(url.searchParams.get('conversationId')!); return respond({ messages: [], nextCursor: null }); }
        return respond({ error: { code: 'NOT_FOUND' } }, 404);
    });
    for (const query of [`connection=${targetConnection}`, `conversation=${targetConversation}`]) {
        messageReads = [];
        await page.goto(`/chat?${query}`);
        await expect.poll(() => messageReads.length).toBeGreaterThan(0);
        expect(new Set(messageReads)).toEqual(new Set([targetConversation]));
    }
    messageReads = [];
    await page.goto('/chat?conversation=unavailable');
    await expect(page.getByRole('button', { name: /other-conversation/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
    expect(messageReads).toEqual([]);
});
