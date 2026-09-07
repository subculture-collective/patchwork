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

for (const failure of ['UNAVAILABLE', 'ACTIVE_VOLUNTEER_PROFILE_REQUIRED']) test(`a direct offer preserves its note and recovers from ${failure}`, async ({ page, baseURL }) => {
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
            return attempts === 1 ? respond({ error: { code: failure, message: 'Offer could not be created' } }, failure === 'UNAVAILABLE' ? 503 : 409)
                : respond({ offer: { id: 'offer-1', requestUri: uri, status: 'pending' } }, 201);
        }
        return respond({ error: { code: 'NOT_FOUND' } }, 404);
    });
    await page.goto(`/requests/view?uri=${encodeURIComponent(uri)}`);
    await page.getByRole('textbox', { name: 'How can you help?' }).fill('I can collect the order at 3 pm.');
    await page.getByRole('button', { name: 'Offer help', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Your offer was not confirmed');
    await expect(page.getByRole('textbox')).toHaveValue('I can collect the order at 3 pm.');
    if (failure === 'ACTIVE_VOLUNTEER_PROFILE_REQUIRED') await expect(page.getByRole('link', { name: 'Set up profile (opens a new tab)' })).toHaveAttribute('target', '_blank');
    await page.getByRole('button', { name: 'Offer help', exact: true }).click();
    await expect(page.getByText('Your offer was sent. You can follow its progress in My activity.')).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]?.key).toBeTruthy();
    if (failure === 'UNAVAILABLE') expect(commands[0]).toEqual(commands[1]);
    else expect(commands[0]?.key).not.toEqual(commands[1]?.key);
    expect(commands[0]?.body).toEqual({ requestUri: uri, note: 'I can collect the order at 3 pm.' });
});


test('saved requests survive delayed discovery, paginate, and recover independently of the feed', async ({ page }) => {
    let published = false;
    let unavailable = false;
    let requestsRead = 0;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path.endsWith('/auth/session')) return respond({ session: { did: 'did:plc:requester', expiresAt: '2099-01-01T00:00:00Z' } });
        if (path.endsWith('/account/onboarding')) return respond({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-09-05T12:00:00Z' });
        if (path.endsWith('/account/requests')) {
            requestsRead++;
            if (unavailable) return respond({ error: { code: 'UNAVAILABLE' } }, 503);
            const second = url.searchParams.get('page') === '2';
            return respond({ page: second ? 2 : 1, pageSize: 20, total: 21, hasNextPage: !second, requests: [{
                uri: second ? uri + '-older' : uri, title: second ? 'An older request' : 'Groceries this afternoon',
                status: 'open', sourceCid: 'cid-request', sourceWrittenAt: '2026-09-05T12:00:00Z', publication: published ? 'projected' : 'pending',
            }] });
        }
        if (path.endsWith('/coordination/mine')) return respond({ offers: [{ id: 'offer-one', requestUri: uri, direction: 'received', note: 'I can help tomorrow.', status: 'pending', offeredAt: '2026-09-05T12:00:00Z', expiresAt: '2099-01-01T00:00:00Z', decidedAt: null }], connections: [] });
        if (path.endsWith('/inbox')) return respond({ items: [], unread: 0 });
        if (path.endsWith('/outcomes/mine')) return respond({ feedback: [] });
        if (path.includes('/lifecycle')) return respond({ postUri: uri, currentStatus: 'open', validTransitions: [], timeline: [], publicSyncState: 'synced' });
        return respond({ error: { code: 'UNAVAILABLE' } }, 503);
    });
    await page.goto('/inbox');
    const mine = page.getByRole('region', { name: 'My requests', exact: true });
    await expect(mine.getByRole('heading', { name: 'Groceries this afternoon' })).toBeVisible();
    await expect(mine.getByText(/Waiting to appear/)).toBeVisible();
    await expect(mine.getByRole('link', { name: 'View request', exact: true })).toHaveCount(0);
    await expect(page.getByText('I can help tomorrow.')).toBeVisible();
    await expect(page.getByText(/Some activity could not be refreshed/)).toBeVisible();
    await expect(mine.getByRole('link', { name: 'Review offers' })).toHaveAttribute('href', `/inbox?uri=${encodeURIComponent(uri)}#request-offers`);
    await mine.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(mine.getByRole('heading', { name: 'An older request' })).toBeVisible();
    await mine.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(mine.getByRole('heading', { name: 'Groceries this afternoon' })).toBeVisible();
    unavailable = true;
    await mine.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(mine.getByRole('alert')).toHaveText('Your requests could not be refreshed. Try again.');
    await expect(mine.getByRole('heading', { name: 'Groceries this afternoon' })).toBeVisible();
    unavailable = false; published = true;
    await mine.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(mine.getByText('Public version is up to date.')).toBeVisible();
    await expect(mine.getByRole('link', { name: 'View request', exact: true })).toHaveAttribute('href', `/requests/view?uri=${encodeURIComponent(uri)}`);
    await expect(mine.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(requestsRead).toBeGreaterThanOrEqual(5);
});


test('a resource deep link loads outside the current result page and retries without requiring map coordinates', async ({ page }) => {
    const resourceUri = 'at://did:plc:regional/app.patchwork.directory.resource/help';
    let fail = true;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path.endsWith('/auth/session')) return respond({ session: null });
        if (path.endsWith('/query/directory-resource')) return fail ? respond({ error: { code: 'UNAVAILABLE' } }, 503) : respond({ total: 1, results: [{
            uri: resourceUri, name: 'Regional support line', category: 'hotline', serviceArea: 'Illinois',
            contact: { phone: '+1-555-0100' }, openHours: 'Every day', eligibilityNotes: 'Call for information.',
            operationalStatus: 'open', verificationStatus: 'community-verified', recordOrigin: 'sourced-public',
        }] });
        if (path.endsWith('/query/directory')) return respond({ total: 0, page: 1, pageSize: 20, hasNextPage: false, results: [] });
        return respond({ error: { code: 'NOT_FOUND' } }, 404);
    });
    await page.goto(`/resources?resource=${encodeURIComponent(resourceUri)}`);
    const detail = page.getByRole('region', { name: 'Resource detail', exact: true });
    await expect(detail.getByRole('alert')).toContainText('This resource could not be loaded');
    fail = false;
    await detail.getByRole('button', { name: 'Retry' }).click();
    await expect(detail.getByText('Regional support line', { exact: true })).toBeVisible();
    await expect(detail.getByRole('link', { name: /Call/ })).toHaveAttribute('href', 'tel:+15550100');
    await expect(detail.getByRole('link', { name: 'Directions', exact: true })).toHaveCount(0);
    await expect(detail.getByRole('link', { name: 'Ask the community for help' })).toHaveAttribute('href', /resource=at%3A/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


for (const allowed of [true, false]) test(`posting requires a ZIP without requesting device location when permission is ${allowed ? 'allowed' : 'denied'}`, async ({ page }) => {
    await page.addInitScript(granted => {
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
            getCurrentPosition: (success: (value: unknown) => void, failure: () => void) => granted
                ? success({ coords: { latitude: 41.88123456, longitude: -87.63123456 } }) : failure(),
        } });
    }, allowed);
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/at/aid-posts')) {
            submitted = route.request().postDataJSON();
            return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) });
        }
        const body = path.endsWith('/auth/session') ? { session: { did: 'did:plc:location-author', expiresAt: '2099-01-01T00:00:00Z' } }
            : path.endsWith('/account/onboarding') ? { policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-09-05T12:00:00Z' }
            : { error: { code: 'NOT_FOUND' } };
        await route.fulfill({ status: 'error' in body ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('/posting');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('A ride to the pantry');
    await page.getByRole('textbox', { name: 'Description', exact: true }).fill('I need a ride to pick up groceries tomorrow.');
    const publish = page.getByRole('button', { name: 'Publish request', exact: true });
    await page.getByRole('textbox', { name: 'ZIP code where help is needed', exact: true }).fill('60625');
    await expect(publish).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/posting');
    expect(new URL(page.url()).searchParams.has('lat')).toBe(false);
    const saved = await page.evaluate(() => sessionStorage.getItem('patchwork:posting-text:v1'));
    expect(saved).toContain('A ride to the pantry');
    expect(saved).not.toMatch(/latitude|longitude|precision|center|41\.88|87\.63/);
    await publish.click();
    await expect.poll(() => submitted).toBeTruthy();
    expect(submitted?.location).toEqual({ countryCode: 'US', postalCode: '60625' });
});


for (const operation of ['accept', 'complete'] as const) test(`${operation} retries keep the same operation key after an uncertain response`, async ({ page, baseURL }) => {
    const commands: Array<{ key?: string; body: unknown }> = [];
    let confirmed = false;
    const connectionId = '81111111-1111-4111-8111-111111111111';
    await page.context().addCookies([{ name: 'patchwork_csrf', value: 'handoff-retry', url: baseURL! }]);
    const offer = () => ({ id: 'offer-retry', requestUri: uri, direction: 'received', note: 'I can help.', status: confirmed ? 'accepted' : 'pending', offeredAt: '2026-09-05T12:00:00Z', expiresAt: '2099-01-01T00:00:00Z' });
    const connection = () => ({ id: connectionId, offerId: 'offer-retry', requestUri: uri, status: confirmed ? 'completed' : 'active', requesterDid: 'did:plc:requester', helperDid: 'did:plc:helper', counterpartDid: 'did:plc:helper', acceptedAt: '2026-09-05T12:00:00Z' });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const respond = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path.endsWith('/auth/session')) return respond({ session: { did: 'did:plc:requester', expiresAt: '2099-01-01T00:00:00Z' } });
        if (path.endsWith('/account/onboarding')) return respond({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: '2026-09-05T12:00:00Z' });
        if (path.endsWith('/coordination/mine')) return respond({ offers: operation === 'accept' ? [offer()] : [], connections: operation === 'complete' ? [connection()] : [] });
        if (path.endsWith('/inbox')) return respond({ items: [], unread: 0 });
        if (path.endsWith('/outcomes/mine')) return respond({ feedback: [] });
        if (path.endsWith('/query/feed')) return respond({ results: [], total: 0, page: 1, pageSize: 20, hasNextPage: false });
        if (path.endsWith('/account/requests')) return respond({ requests: [], total: 0, page: 1, pageSize: 20, hasNextPage: false });
        if (path.endsWith(operation === 'accept' ? '/coordination/offer-decisions' : '/coordination/connections')) {
            commands.push({ key: route.request().headers()['idempotency-key'], body: route.request().postDataJSON() });
            if (commands.length === 1) return respond({ error: { code: 'UNAVAILABLE' } }, 503);
            confirmed = true;
            return respond(operation === 'accept' ? { offer: offer(), connection: null } : { connection: connection() });
        }
        return respond({ error: { code: 'NOT_FOUND' } }, 404);
    });
    await page.goto('/inbox');
    const button = page.getByRole('button', { name: operation === 'accept' ? 'Accept' : 'Complete handoff', exact: true });
    await button.click();
    await expect(page.getByRole('alert')).toContainText('Error');
    await button.click();
    await expect(button).toHaveCount(0);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.key).toBeTruthy();
    expect(commands[0]).toEqual(commands[1]);
});
