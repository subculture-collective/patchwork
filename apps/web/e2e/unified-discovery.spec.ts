import { lookupPostalArea } from '@patchwork/at-lexicons';
import { test, expect } from '@playwright/test';
const uri = 'at://did:plc:neighbor/app.patchwork.aid.post/groceries';
const record = {
    postalCode: '60602',
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
const cells = ['60602','60625','60654','60605'].map(postalCode => ({ postalCode, latitude: lookupPostalArea(postalCode)!.latitude, longitude: lookupPostalArea(postalCode)!.longitude, count: 60, radiusKm: 1 }));
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
    await page.getByText('Filters', { exact: false }).first().click();
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
test('county boundaries split into ZIPs with one keyboard action and regroup when zooming out', async ({
    page,
}) => {
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=50000');
    await page.getByRole('button', { name: 'Explore Cook County, IL: 240 requests', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('path[aria-label^="Show ZIP"]')).toHaveCount(4);
    await expect(page.locator('path.mh-map-cluster')).toHaveCount(0);
    await expect(page.locator('.mh-postal-count')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Explore Cook County, IL: 240 requests', exact: true })).toHaveAttribute('aria-pressed','true');
    const emptyCounty = page
        .locator('path[aria-label$="0 requests"][aria-hidden="false"]')
        .first();
    await emptyCounty.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('path[aria-pressed="true"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Explore Cook County, IL: 240 requests', exact: true })).toBeAttached();
});
test('ZIP request panel returns to the previous browsing area', async ({
    page,
}) => {
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=50000');
    await page.getByRole('button', { name: 'Explore Cook County, IL: 240 requests', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Show ZIP 60602: 60 requests', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(
        page.getByRole('article', {
            name: 'Requests in ZIP 60602',
            exact: true,
        }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Back to ZIP areas', exact: true }).click();
    await expect(page.locator('.mh-map-detail-sheet')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('zip')).toBeNull();
    expect(new URL(page.url()).searchParams.get('lat')).toBe('41.88');
    expect(new URL(page.url()).searchParams.get('r')).toBe('50000');
    await expect(page.getByRole('button', { name: 'ZIP areas', exact: true })).toHaveAttribute('aria-current', 'step');
});
test('filters expose their state and remain usable by keyboard and touch', async ({
    page,
}) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=20000');
    const filters = page.locator('.mh-filter-disclosure');
    await expect(filters).not.toHaveAttribute('open', '');
    await filters.locator('summary').focus();
    await page.keyboard.press('Enter');
    const food = filters
.getByRole('button', { name: 'Food', exact: true });
    await food.click();
    await expect(food).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(page.url()).searchParams.get('cat')).toBe('food');
    expect(
        await food.evaluate(el => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    await food.click();
    await expect(food).toHaveAttribute('aria-pressed', 'false');
});
test('request details provide context, area, dates and an actionable next step', async ({
    page,
}) => {
    await page.goto('/requests/view?uri=' + encodeURIComponent(uri));
    for (const name of [
        'What is needed',
        'ZIP area',
        'Request updates',
        'How to help',
    ])
        await expect(
            page.getByRole('region', { name, exact: true }),
        ).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'View area on map' }),
    ).toHaveAttribute('href', /zip=60602/);
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
            .toBe('United States');
        await expect(page.locator('.leaflet-container')).toBeVisible();
        await page.locator('.mh-filter-disclosure summary').click();
        await page
            .getByRole('button', { name: 'Use my location', exact: true })
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

test('requests in one ZIP stay together at street zoom and are selectable from the list', async ({
    page,
}) => {
    await page.route('**/api/query/map?**', route => route.fulfill({ json: {
        total: 8, page: 1, pageSize: 20, hasNextPage: false,
        results: Array.from({ length: 8 }, (_, i) => ({ ...record, uri: uri + i, title: `Shared ZIP request ${i + 1}` })),
        aggregates: { requestCount: 8, locatedRequestCount: 8, truncated: false, cells: [{ ...cells[0], count: 8 }] },
    } }));
    await page.goto('/nearby?zip=60602');
    const polygon=page.getByRole('button',{ name: 'Show ZIP 60602: 8 requests', exact:true });
    await expect(polygon).toBeAttached();
    for(let i=0;i<5;i++) await page.getByRole('button',{name:'Zoom in',exact:true}).click();
    await expect(page.locator('path[aria-label^="Show ZIP"]')).toHaveCount(1);
    await expect(page.locator('path.mh-map-marker')).toHaveCount(0);
    await expect(
        page.getByRole('article', {
            name: 'Requests in ZIP 60602',
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole('article', { name: 'Requests in ZIP 60602', exact: true })
        .getByRole('button', { name: /Shared ZIP request 8/ })
        .click();
    await expect(page.getByRole('region',{name:'Details for Shared ZIP request 8'})).toBeVisible();
});

test('nearby resources searches the request area on arrival', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', req => { if (req.url().includes('/query/directory?')) requested.push(req.url()); });
    await page.goto('/requests/view?uri=' + encodeURIComponent(uri));
    await page.getByRole('link', { name: 'Find nearby resources', exact: true }).click();
    await expect.poll(() => requested.some(url => {
        const params = new URL(url).searchParams;
        return params.get('latitude') === lookupPostalArea('60602')!.latitude.toFixed(6) && params.get('longitude') === lookupPostalArea('60602')!.longitude.toFixed(6) && params.get('radiusKm') === '20';
    })).toBe(true);
    await expect(page.getByText('Closest to the selected area first. Distances are approximate.', { exact: true })).toBeVisible();
});

test('mobile ZIP search keeps one results list and preserves the map on return', async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/nearby?lat=41.88&lng=-87.63&r=20000');
    const map = page.locator('.leaflet-container');
    await expect(map).toBeVisible();
    await map.evaluate(el => el.setAttribute('data-continuity', 'same-map'));
    await page.getByLabel('ZIP code', { exact: true }).fill('60602');
    await page.getByRole('button', { name: 'Find area', exact: true }).click();
    const results = page.getByRole('article', {
        name: 'Requests in ZIP 60602',
        exact: true,
    });
    await expect(results).toBeVisible();
    await expect(page.locator('.mh-map-detail-sheet')).toHaveCount(0);
    await expect(map).not.toBeVisible();
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(map).toBeVisible();
    await expect(map).toHaveAttribute('data-continuity', 'same-map');
    await expect(
        page.getByRole('button', { name: 'Show ZIP 60602: 60 requests', exact: true }),
    ).toBeVisible();
    const search = page.getByRole('textbox', { name: 'Search', exact: true });
    await search.pressSequentially('pantry parcel');
    await expect(search).toHaveValue('pantry parcel');
    expect(new URL(page.url()).searchParams.get('q')).toBe('pantry parcel');
});

test('resource categories query the whole directory and restore through Back', async ({
    page,
}) => {
    const queries: URL[] = [];
    await page.route('**/api/query/directory?**', route => {
        const url = new URL(route.request().url());
        queries.push(url);
        return route.fulfill({
            json: {
                total: 0,
                page: 1,
                pageSize: 20,
                hasNextPage: false,
                results: [],
            },
        });
    });
    await page.goto('/resources?lat=41.88&lng=-87.63&r=20000');
    const legal = page.getByLabel('Resource type', { exact: true });
    await legal.selectOption('legal-aid');
    await expect(legal).toHaveValue('legal-aid');
    await expect
        .poll(() => queries.at(-1)?.searchParams.get('category'))
        .toBe('legal-aid');
    expect(new URL(page.url()).searchParams.get('resourceType')).toBe(
        'legal-aid',
    );
    await expect(
        page.getByRole('button', { name: 'Resolved', exact: true }),
    ).toHaveCount(0);
    await legal.selectOption('');
    await expect
        .poll(() => queries.at(-1)?.searchParams.has('category'))
        .toBe(false);
    await page.goBack();
    await expect(legal).toHaveValue('legal-aid');
    await expect
        .poll(() => queries.at(-1)?.searchParams.get('category'))
        .toBe('legal-aid');
});


test('resource filters survive directory-to-Nearby navigation, reload and reset', async ({ page }) => {
    const queries: URL[] = [];
    await page.route('**/api/query/directory?**', route => {
        queries.push(new URL(route.request().url()));
        return route.fulfill({ json: { total: 0, page: 1, pageSize: 20, hasNextPage: false, results: [] } });
    });
    await page.goto('/resources?zip=60187');
    await page.getByLabel('What do you need?', { exact: true }).selectOption('youth');
    await page.getByLabel('Service, organization, or keyword', { exact: true }).fill('nutrition');
    await expect.poll(() => queries.at(-1)?.searchParams.get('service')).toBe('youth');
    await expect.poll(() => queries.at(-1)?.searchParams.get('searchText')).toBe('nutrition');
    expect(new URL(page.url()).searchParams.get('zip')).toBe('60187');
    await page.getByLabel('Program or benefit', { exact: true }).selectOption('wic');
    await page.getByLabel('Resource type', { exact: true }).selectOption('clinic');
    await page.getByLabel('Search distance', { exact: true }).selectOption('5000');
    await page.getByRole('navigation', { name: 'Primary flows' }).getByRole('link', { name: 'Nearby', exact: true }).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get('pageSize')).toBe('100');
    expect(Object.fromEntries(queries.at(-1)!.searchParams)).toMatchObject({service:'youth',program:'wic',category:'clinic',radiusKm:'5',searchText:'nutrition'});
    await page.reload();
    await expect(page.getByLabel('What do you need?', { exact: true })).toHaveValue('youth');
    await expect(page.getByLabel('Program or benefit', { exact: true })).toHaveValue('wic');
    await expect(page.getByLabel('Search distance', { exact: true })).toHaveValue('5000');
    await page.locator('.mh-resource-filter-disclosure summary').click();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).first().click();
    await expect.poll(() => queries.at(-1)?.searchParams.has('service')).toBe(false);
    expect(queries.at(-1)?.searchParams.has('program')).toBe(false);
    expect(queries.at(-1)?.searchParams.has('category')).toBe(false);
    expect(queries.at(-1)?.searchParams.get('radiusKm')).toBe('20');
    expect(new URL(page.url()).searchParams.get('zip')).toBe('60187');
});


test('resource searches keep the mobile map and a separate resource list through ZIP changes', async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    const queries: URL[]=[];
    await page.route('**/api/query/map?**', route => route.fulfill({json:{total:0,page:1,pageSize:20,hasNextPage:false,results:[]}}));
    await page.route('**/api/query/directory?**', route => {
        queries.push(new URL(route.request().url()));
        return route.fulfill({json:{total:0,page:1,pageSize:100,hasNextPage:false,results:[]}});
    });
    await page.goto('/nearby?nearby=resources&zip=60608&r=5000');
    await expect(page.getByRole('button',{name:'Public resources',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('button',{name:'Map',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.mh-resource-filter-disclosure')).not.toHaveAttribute('open','');
    await page.getByRole('textbox',{name:'ZIP code',exact:true}).fill('80219');
    await page.getByRole('button',{name:'Find area',exact:true}).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get('radiusKm')).toBe('5');
    expect(new URL(page.url()).searchParams.get('zip')).toBe('80219');
    await expect(page.getByRole('button',{name:'Map',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Resources (0)',exact:true}).click();
    await expect(page.getByText('No resources match these filters in this area. Try a wider distance or fewer filters.')).toBeVisible();
    await page.getByRole('button',{name:'Search farther away',exact:true}).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get('radiusKm')).toBe('10');
    await page.getByRole('button',{name:'Community requests',exact:true}).click();
    await expect(page.getByRole('button',{name:'Requests (0)',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByRole('heading',{name:'Requests in ZIP 80219',exact:true})).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('button',{name:'Public resources',exact:true})).toHaveAttribute('aria-pressed','true');
});
