import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });

const uri = 'at://did:plc:map-link/app.patchwork.aid.post/outside-page';
const request = { uri, authorDid: 'did:plc:map-link', title: 'Request outside this page', summary: 'A public request.', category: 'food', status: 'open', urgency: 'high', approximateGeo: { latitude: 41.88, longitude: -87.63, precisionKm: 2 }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', recordOrigin: 'visitor-created' };
const pageResult = (results: unknown[]) => ({ results, total: results.length, page: 1, pageSize: 20, hasNextPage: false });

test('map deep links load outside the result page and restore selection through reload and Back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/query/aid-post')) {
            expect(url.searchParams.get('uri')).toBe(uri);
            expect(url.searchParams.get('dataset')).toBe('all');
            return route.fulfill({ json: pageResult([request]) });
        }
        if (url.pathname.endsWith('/query/map') || url.pathname.endsWith('/query/directory')) return route.fulfill({ json: pageResult([]) });
        return route.fulfill({ status: 401, json: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' } } });
    });
    await page.goto(`/nearby?view=map&lat=41.88&lng=-87.63&r=20000&uri=${encodeURIComponent(uri)}`);
    const detail = page.getByRole('region', { name: 'Details for Request outside this page' });
    await expect(detail).toBeVisible();
    await page.reload();
    await expect(detail).toBeVisible();
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    await expect(detail).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('uri')).toBe(false);
    await page.goBack();
    await expect(detail).toBeVisible();
});

test('integrated discovery removes the examples switch and normalizes legacy dataset links', async ({ page }) => {
    const datasets: string[] = [];
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (/\/query\/(feed|map)$/.test(url.pathname)) datasets.push(url.searchParams.get('dataset') ?? 'missing');
        if (url.pathname.includes('/query/')) return route.fulfill({ json: pageResult([]) });
        return route.fulfill({ status: 401, json: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' } } });
    });
    await page.goto('/nearby?view=list&dataset=demo&lat=41.88&lng=-87.63&r=20000');
    await expect.poll(() => datasets.includes('all')).toBe(true);
    await expect(page.getByRole('button', { name: 'Explore examples', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Community', exact: true })).toHaveCount(0);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Nearby view' })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('dataset')).toBe(false);
    expect(datasets.every(dataset => dataset === 'all')).toBe(true);
});
