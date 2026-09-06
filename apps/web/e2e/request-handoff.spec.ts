import { expect, test } from '@playwright/test';

const uri = 'at://did:plc:requester/app.patchwork.aid.post/handoff';

test('request context survives the sign-in link and anonymous visitors have no owner actions', async ({ page }) => {
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const body = path.endsWith('/query/aid-post') ? { total: 1, results: [{
            uri, cid: 'cid-request', authorDid: 'did:plc:requester', title: 'Groceries this afternoon',
            summary: 'Help collecting a grocery order.', category: 'food', status: 'open', urgency: 'medium',
            updatedAt: '2026-09-05T12:00:00Z', recordOrigin: 'visitor-created',
        }] } : path.endsWith('/auth/session') ? { session: null } : { error: { code: 'NOT_FOUND' } };
        await route.fulfill({ status: path.endsWith('/query/aid-post') || path.endsWith('/auth/session') ? 200 : 404,
            contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`/requests/view?uri=${encodeURIComponent(uri)}`);
    await expect(page.getByRole('heading', { name: 'Groceries this afternoon' })).toBeVisible();
    const href = await page.getByRole('link', { name: 'Sign in to offer help' }).getAttribute('href');
    const returnTo = new URL(href!, 'http://localhost').searchParams.get('returnTo')!;
    expect(new URL(returnTo, 'http://localhost').searchParams.get('uri')).toBe(uri);
    await expect(page.getByRole('button', { name: /^Resolve:/ })).toHaveCount(0);
});

test('an uncertain direct offer retains its note and reuses the operation key', async ({ page, baseURL }) => {
    let attempts = 0;
    const commands: { key: string | undefined; body: unknown }[] = [];
    await page.context().addCookies([{ name: 'patchwork_csrf', value: 'handoff-test', url: baseURL! }]);
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path.endsWith('/auth/session')) return respond({ session: { did: 'did:plc:helper', expiresAt: '2099-01-01T00:00:00Z' } });
        if (path.endsWith('/account/onboarding')) return respond({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-09-05T12:00:00Z' });
        if (path.endsWith('/query/aid-post')) return respond({ total: 1, results: [{
            uri, cid: 'cid-request', authorDid: 'did:plc:requester', title: 'Groceries this afternoon',
            summary: 'Help collecting a grocery order.', category: 'food', status: 'open', urgency: 'medium',
            updatedAt: '2026-09-05T12:00:00Z', recordOrigin: 'visitor-created',
        }] });
        if (path.endsWith('/coordination/offers')) {
            commands.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
            attempts += 1;
            return attempts === 1 ? respond({ error: { code: 'UNAVAILABLE', message: 'Uncertain response' } }, 503)
                : respond({ offer: { id: 'offer-1', requestUri: uri, status: 'pending' } }, 201);
        }
        return respond({ error: { code: 'NOT_FOUND' } }, 404);
    });
    await page.goto(`/requests/view?uri=${encodeURIComponent(uri)}`);
    await page.getByRole('textbox', { name: 'How can you help?' }).fill('I can collect the order at 3 pm.');
    await page.getByRole('button', { name: 'Offer help', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Your offer was not confirmed');
    await expect(page.getByRole('textbox')).toHaveValue('I can collect the order at 3 pm.');
    await page.getByRole('button', { name: 'Offer help', exact: true }).click();
    await expect(page.getByText('Your offer was sent. You can follow its progress in My activity.')).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]?.key).toBeTruthy();
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]?.body).toEqual({ requestUri: uri, note: 'I can collect the order at 3 pm.' });
});
