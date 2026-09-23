import { expect, test, type Page } from '@playwright/test';

/**
 * Opt-in visual baselines for the redesigned surfaces. Run with
 * PATCHWORK_VISUAL=1 (add --update-snapshots after an intended change).
 * Web fonts are blocked and data is mocked so screenshots are stable.
 */
test.skip(!process.env['PATCHWORK_VISUAL'], 'Set PATCHWORK_VISUAL=1 to run visual baselines.');

const requests = [
    ['Groceries and infant formula tonight', 'food', 'critical', 41.857, -87.657],
    ['Ride to a clinic appointment', 'transport', 'high', 41.846, -87.754],
    ['After-school childcare on Thursday', 'childcare', 'medium', 41.902, -87.721],
    ['Warm coats for three kids', 'other', 'low', 41.866, -88.107],
] as const;

const mockApi = async (page: Page) => {
    await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
    await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
        if (path === '/query/map' || path === '/query/feed') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    total: requests.length,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: requests.map(([title, category, urgency, latitude, longitude], index) => ({
                        uri: `at://did:plc:visual/app.patchwork.aid.post/${index}`,
                        authorDid: 'did:plc:visual',
                        title,
                        summary: 'Approximate demo request for visual baselines.',
                        category,
                        status: 'open',
                        urgency,
                        createdAt: '2026-09-22T12:00:00.000Z',
                        updatedAt: '2026-09-22T12:00:00.000Z',
                        approximateGeo: { latitude, longitude, precisionKm: 1 },
                        recordOrigin: 'synthetic',
                    })),
                }),
            });
        }
        if (path === '/query/directory') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ total: 0, page: 1, pageSize: 20, hasNextPage: false, results: [] }),
            });
        }
        return route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication required.' } }),
        });
    });
};

const area = 'tab=nearby&r=65000&lat=41.85&lng=-87.93&area=Cook+%26+DuPage';
const pages = [
    ['home', '/'],
    ['map', `/map?${area}`],
    ['requests', `/feed?${area}`],
    ['resources', `/resources?${area}`],
    ['login', '/login'],
    ['signup', '/signup'],
    ['posting-gate', '/posting'],
] as const;

for (const [width, label] of [[390, 'phone'], [1280, 'desktop']] as const) {
    for (const [name, path] of pages) {
        test(`${name} on ${label}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.clock.setFixedTime(new Date('2026-09-23T12:00:00.000Z'));
            await mockApi(page);
            await page.goto(path, { waitUntil: 'networkidle' });
            await expect(page).toHaveScreenshot(`${name}-${label}.png`, {
                fullPage: true,
                animations: 'disabled',
                // Leaflet tiles are unavailable in tests; mask the map canvas.
                mask: [page.locator('.leaflet-container')],
            });
        });
    }
}
