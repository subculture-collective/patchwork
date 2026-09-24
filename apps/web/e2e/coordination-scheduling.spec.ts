import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const actor = 'did:plc:scheduling-browser-actor';
const peer = 'did:plc:scheduling-browser-peer';
const connectionId = '11111111-1111-4111-8111-111111111199';

test('accepted connection scheduling is responsive, keyboard operable, localized, and stale-safe', async ({ page, baseURL }) => {
    let windowState: Record<string, unknown> | undefined;
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([{ name: 'patchwork_csrf', value: 'scheduling-csrf', url: baseURL }]);
    await page.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace(/^\/api/, '');
        const fulfill = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path === '/auth/session') return fulfill({ session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' } });
        if (path === '/account/onboarding') return fulfill({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-08-05T00:00:00Z' });
        if (path === '/coordination/mine') return fulfill({ offers: [], connections: [{ id: 'other-connection', status: 'active', counterpartDid: 'did:plc:other' }, { id: connectionId, offerId: 'offer', requestUri: `at://${actor}/app.patchwork.aid.post/one`, status: 'active', requesterDid: actor, helperDid: peer, counterpartDid: peer, acceptedAt: '2026-08-05T00:00:00Z', completedAt: null, updatedAt: '2026-08-05T00:00:00Z' }] });
        if (path === '/coordination/windows' && request.method() === 'GET') return fulfill({ windows: windowState ? [windowState] : [] });
        if (path === '/coordination/windows' && request.method() === 'POST') {
            const body = request.postDataJSON() as Record<string, unknown>;
            expect(body.connectionId).toBe(connectionId);
            windowState = { id: 'window', connectionId, proposerDid: actor, recipientDid: peer, startAt: body.startAt, endAt: body.endAt, timezone: body.timezone, status: 'proposed', version: 1, proposalExpiresAt: '2026-08-07T00:00:00Z', reminderEligibleAt: '2026-08-06T14:00:00Z', reminderSentAt: null, createdAt: '2026-08-05T00:00:00Z', updatedAt: '2026-08-05T00:00:00Z' };
            return fulfill({ window: windowState }, 201);
        }
        return fulfill({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404);
    });

    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto(`/scheduling?connection=${connectionId}`);
    await expect(page.getByRole('combobox', { name: 'Connection', exact: true })).toHaveValue(connectionId);
    await expect(page.getByRole('heading', { name: 'Connection scheduling' })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel('Starts').fill('2026-08-06T10:00');
    await page.getByLabel('Ends').fill('2026-08-06T11:00');
    await page.getByRole('button', { name: 'Propose window' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Proposed', { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');

    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await expect(page.getByRole('heading', { name: 'Connection scheduling' })).toBeVisible();
    await page.evaluate(() => localStorage.setItem('patchwork-locale', 'es'));
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Programación de la conexión' })).toBeVisible();
});
