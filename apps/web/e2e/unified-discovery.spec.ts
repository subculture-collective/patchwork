import { test, expect } from '@playwright/test';
const uri = 'at://did:plc:neighbor/app.patchwork.aid.post/groceries';
const record = {
    uri,
    authorDid: 'did:plc:neighbor',
    title: 'Groceries for a neighbor',
    summary: 'Help picking up a pantry parcel.',
    category: 'food',
    status: 'open',
    urgency: 'high',
    approximateGeo: { latitude: 41.88, longitude: -87.63, precisionKm: 3 },
    createdAt: '2026-09-06T12:00:00Z',
    updatedAt: '2026-09-06T13:00:00Z',
    recordOrigin: 'visitor-created',
};
const cells = Array.from({ length: 80 }, (_, i) => ({
    latitude: 41.88,
    longitude: -88 + i * 0.015,
    count: 3,
    radiusKm: 5,
}));
test.beforeEach(async ({ page }) => {
    page.on('pageerror', (error) => {
        throw error;
    });
    await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/query/aid-post'))
            return route.fulfill({
                json: {
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [record],
                },
            });
        if (path.endsWith('/query/map'))
            return route.fulfill({
                json: {
                    total: 240,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [record],
                    aggregates: {
                        requestCount: 240,
                        locatedRequestCount: 240,
                        truncated: false,
                        cells,
                    },
                },
            });
        if (path.endsWith('/query/directory'))
            return route.fulfill({
                json: {
                    total: 0,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [],
                },
            });
        return route.fulfill({
            status: 401,
            json: {
                error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' },
            },
        });
    });
});
test('available browser location persists across legacy list and map navigation', async ({
    page,
    context,
}) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 41.882, longitude: -87.631 });
    await page.goto('/feed');
    await expect
        .poll(() => new URL(page.url()).searchParams.get('lat'))
        .toBe('41.88');
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(
        page.getByText('Groceries for a neighbor', { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('navigation', { name: 'Nearby view' }),
    ).toHaveCount(0);
    await page
        .getByText('Location and filters', { exact: false })
        .first()
        .click();
    await expect(
        page.getByText(
            /Finding your location timed out|Location permission was denied|Your device could not provide/,
        ),
    ).toHaveCount(0);
    await page
        .getByRole('navigation', { name: 'Primary flows' })
        .getByRole('link', { name: 'Resources', exact: true })
        .click();
    await page
        .getByRole('navigation', { name: 'Primary flows' })
        .getByRole('link', { name: 'Nearby', exact: true })
        .click();
    await expect
        .poll(() => new URL(page.url()).searchParams.get('lat'))
        .toBe('41.88');
    await expect(page.locator('.leaflet-container')).toBeVisible();
});
test('clearing the area retains the same map and loads all-area results', async ({
    page,
}) => {
    const requests: URL[] = [];
    const directoryRequests: URL[] = [];
    page.on('request', (req) => {
        const url = new URL(req.url());
        if (url.pathname.endsWith('/query/map')) requests.push(url);
        if (url.pathname.endsWith('/query/directory')) directoryRequests.push(url);
    });
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=20000');
    const map = page.locator('.leaflet-container');
    await expect(map).toBeVisible();
    await map.evaluate((el) => el.setAttribute('data-continuity', 'original'));
    await page
        .getByRole('button', { name: 'Clear area filter', exact: true })
        .click();
    await expect(map).toHaveAttribute('data-continuity', 'original');
    await expect
        .poll(() => requests.at(-1)?.searchParams.has('latitude'))
        .toBe(false);
    await expect.poll(() => directoryRequests.at(-1)?.searchParams.has('latitude')).toBe(false);
    await expect(
        page.getByText(/Allow location access to load nearby results/),
    ).toHaveCount(0);
    await expect(
        page.getByText('Groceries for a neighbor', { exact: true }),
    ).toBeVisible();
});
test('clusters split with one click, dim the others, and merge when zooming out', async ({
    page,
}) => {
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=50000');
    const clusters = page.locator('path.mh-map-cluster');
    await expect(clusters.first()).toBeVisible();
    const before = await clusters.count();
    await page.getByRole('button', { name: /^Zoom into/ }).first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => clusters.count()).toBeGreaterThan(before);
    await expect(
        page.locator('path.mh-map-cluster.is-dimmed').first(),
    ).toBeAttached();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect.poll(() => clusters.count()).toBeLessThanOrEqual(before);
});
test('filters collapse, use compact buttons and two columns on wider screens', async ({
    page,
}) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=20000');
    const filters = page.locator('.mh-filter-disclosure');
    await expect(filters).not.toHaveAttribute('open', '');
    await filters.locator('summary').click();
    await expect(filters).toHaveAttribute('open', '');
    expect(
        await filters
            .locator('.mh-filter-grid')
            .evaluate(
                (el) =>
                    getComputedStyle(el).gridTemplateColumns.split(' ').length,
            ),
    ).toBe(2);
    const height = await filters
        .getByRole('button', { name: 'Food', exact: true })
        .evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThanOrEqual(36);
});
test('request details provide context, area, dates and an actionable next step', async ({
    page,
}) => {
    await page.goto('/requests/view?uri=' + encodeURIComponent(uri));
    for (const name of [
        'What is needed',
        'Approximate area',
        'Request updates',
        'How to help',
    ])
        await expect(
            page.getByRole('region', { name, exact: true }),
        ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'View area on map' }),
    ).toHaveAttribute('href', /lat=41.88/);
    await expect(
        page.getByRole('link', { name: 'Find nearby resources' }),
    ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'Sign in to offer help', exact: true }),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Copy request link' }),
    ).toBeVisible();
});

for (const code of [1, 2, 3])
    test(`location failure ${code} falls back and an explicit retry recovers`, async ({
        page,
    }) => {
        await page.addInitScript((code) => {
            let calls = 0;
            Object.defineProperty(navigator, 'geolocation', {
                value: {
                    getCurrentPosition: (
                        success: PositionCallback,
                        failure: PositionErrorCallback,
                    ) => {
                        calls++;
                        if (calls === 1)
                            failure({
                                code,
                                message: 'Unavailable',
                                PERMISSION_DENIED: 1,
                                POSITION_UNAVAILABLE: 2,
                                TIMEOUT: 3,
                            });
                        else
                            success({
                                coords: {
                                    latitude: 42.04,
                                    longitude: -87.69,
                                    accuracy: 100,
                                    altitude: null,
                                    altitudeAccuracy: null,
                                    heading: null,
                                    speed: null,
                                },
                                timestamp: Date.now(),
                            } as GeolocationPosition);
                    },
                },
            });
        }, code);
        await page.goto('/nearby');
        await expect
            .poll(() => new URL(page.url()).searchParams.get('area'))
            .toBe('Chicagoland');
        await expect(page.locator('.leaflet-container')).toBeVisible();
        await page.locator('.mh-filter-disclosure summary').click();
        await page
            .getByRole('button', { name: 'Update location', exact: true })
            .click();
        await expect
            .poll(() => new URL(page.url()).searchParams.get('lat'))
            .toBe('42.04');
        await expect(
            page.getByText(
                /Finding your location timed out|Location permission was denied|Your device could not provide/,
            ),
        ).toHaveCount(0);
        await page
            .getByRole('button', { name: 'Clear area filter', exact: true })
            .click();
        await expect
            .poll(() => new URL(page.url()).searchParams.has('lat'))
            .toBe(false);
        await expect(page.locator('.leaflet-container')).toBeVisible();
    });

test('shared-location requests open a chooser instead of endless zoom', async ({ page }) => {
    await page.route('**/api/query/map?**', route => route.fulfill({ json: {
        total: 8, page: 1, pageSize: 20, hasNextPage: false,
        results: Array.from({ length: 8 }, (_, i) => ({ ...record, uri: uri + i, title: `Shared area request ${i + 1}` })),
    } }));
    await page.goto('/nearby?tab=nearby&lat=41.88&lng=-87.63&r=20000');
    await page.getByRole('button', { name: 'Show 8 requests in this area', exact: true }).click();
    const chooser = page.getByRole('region', { name: 'These requests share an approximate area. Choose one to see details.' });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('button', { name: 'Shared area request 8', exact: true })).toBeVisible();
    await chooser.getByRole('button', { name: 'Shared area request 8', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Details for Shared area request 8' })).toBeVisible();
});

test('nearby resources searches the request area on arrival', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', req => { if (req.url().includes('/query/directory?')) requested.push(req.url()); });
    await page.goto('/requests/view?uri=' + encodeURIComponent(uri));
    await page.getByRole('link', { name: 'Find nearby resources', exact: true }).click();
    await expect.poll(() => requested.some(url => {
        const params = new URL(url).searchParams;
        return params.get('latitude') === '41.880000' && params.get('longitude') === '-87.630000' && params.get('radiusKm') === '20';
    })).toBe(true);
    await expect(page.getByText('Closest to the selected area first. Distances are approximate.', { exact: true })).toBeVisible();
});
