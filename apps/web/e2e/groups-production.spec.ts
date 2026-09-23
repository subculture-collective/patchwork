import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('authenticated group owner creates a durable group, room, and privacy-safe invitation UI', async ({ page }) => {
    const actor = 'did:plc:groups-browser-owner';
    const groupId = '41111111-1111-4111-8111-111111111111';
    const roomId = '41111111-1111-4111-8111-111111111112';
    const token = 'single-use-invitation-token-with-sufficient-length';
    let groups: Array<Record<string, unknown>> = [];
    let outgoingInvitations: Array<Record<string, unknown>> = [];
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
        const fulfill = (body: unknown, status = 200) => route.fulfill({
            status, contentType: 'application/json', body: JSON.stringify(body),
        });
        if (path === '/auth/session') return fulfill({ session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' } });
        if (path === '/account/onboarding') return fulfill({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-08-05T00:00:00Z' });
        if (path === '/account/preferences') return fulfill({ preferences: { privacy: 'private', notifications: { inApp: true, email: false, push: false }, visibility: 'authenticated', language: 'en', location: { sharing: 'hidden', noPermanentAddress: false } } });
        if (path === '/groups' && route.request().method() === 'GET')
            return fulfill({ groups, invitations: [], outgoingInvitations });
        if (path === '/groups' && route.request().method() === 'POST') {
            const input = route.request().postDataJSON() as Record<string, unknown>;
            const group = {
                id: groupId, ownerDid: actor, name: input.name, description: input.description,
                purpose: input.purpose, visibility: input.visibility, status: 'active', version: 1,
                actorRole: 'owner', createdAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-05T12:00:00Z', closedAt: null,
                rooms: [{ id: roomId, groupId, name: 'General', linkedRequestUri: null, status: 'active', version: 1, createdAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-05T12:00:00Z', closedAt: null }],
                members: [{ did: actor, role: 'owner', status: 'active', joinedAt: '2026-08-05T12:00:00Z', updatedAt: '2026-08-05T12:00:00Z' }],
            };
            groups = [group];
            return fulfill({ group }, 201);
        }
        if (path === '/identity/resolve') return fulfill({ identity: { did: 'did:plc:groups-browser-member', handle: 'member.example' } });
        if (path === '/groups/linkable-requests') return fulfill({ requests: [] });
        if (path === '/groups/invitations') {
            const input = route.request().postDataJSON() as Record<string, string>;
            const invitation = { id: '41111111-1111-4111-8111-111111111113', groupId, inviteeDid: input.inviteeDid, role: input.role, token, expiresAt: '2026-08-12T12:00:00Z' };
            outgoingInvitations = [invitation];
            return fulfill({ invitation }, 201);
        }
        if (path === '/groups/rooms') {
            const input = route.request().postDataJSON() as Record<string, string>;
            const room = { id: '41111111-1111-4111-8111-111111111114', groupId, name: input.name, linkedRequestUri: null, status: 'active', version: 1, createdAt: '2026-08-05T13:00:00Z', updatedAt: '2026-08-05T13:00:00Z', closedAt: null };
            const group = groups[0] as Record<string, unknown>;
            group.rooms = [...(group.rooms as unknown[]), room];
            return fulfill({ room }, 201);
        }
        return fulfill({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    });

    await page.setViewportSize({ width: 320, height: 800 });
    await page.addInitScript(() => { document.documentElement.style.fontSize = '200%'; });
    await page.goto('/groups');
    await page.getByLabel('Group name').fill('Neighborhood deliveries');
    await page.getByLabel('Description').fill('Coordinate weekly deliveries.');
    await page.getByLabel('Purpose').fill('Match available neighbors with delivery work.');
    await page.getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Neighborhood deliveries' })).toBeVisible();

    await page.getByLabel('Person to invite').fill('member.example');
    await expect(page.getByText('Found @member.example.')).toBeVisible();
    await page.getByRole('button', { name: 'Create secure invitation' }).click();
    await expect(page.getByText(token)).toBeVisible();
    expect(page.url()).not.toContain(token);

    await page.getByLabel('Room name').fill('Dispatch');
    await page.getByRole('button', { name: 'Add room' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Dispatch' })).toBeVisible({ timeout: 15_000 });
    const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(size.width).toBeLessThanOrEqual(size.viewport);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
});
