import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const resourceUri = 'at://did:plc:public-resource/app.patchwork.directory.resource/clinic';
const resource = { uri: resourceUri, authorDid: 'did:plc:public-resource', name: 'Neighborhood WIC clinic', category: 'clinic', serviceArea: 'Chicago, IL 60608', status: 'unverified', operationalStatus: 'unknown', recordOrigin: 'sourced-public', approximateGeo: {latitude: 41.85, longitude: -87.67, precisionKm: 1}, distanceKm: 1.2, contact: {url: 'https://example.org/wic', phone: '312-555-0100'}, openHours: 'Tuesday by appointment', eligibilityNotes: 'WIC eligibility applies. Call before visiting.', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', exactPublicAddress: {streetAddress: '100 Public Street, Chicago IL 60608', latitude: 41.85, longitude: -87.67, kind: 'sourced-public-resource', sourceExpiresAt: '2099-01-01T00:00:00Z', sourceUrl: 'https://example.org/wic'}};
const envelope = (results = [resource], total = results.length, page = 1, hasNextPage = false) => ({results, total, page, pageSize: 100, hasNextPage});
const point = {latitude: 41.85, longitude: -87.67, count: 1, resourceUri, members: [{uri: resourceUri, name: resource.name}], west: -87.67, east: -87.67, south: 41.85, north: 41.85};
test.beforeEach(async ({page}) => {
    page.on('pageerror', error => { throw error; });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/query/directory') || url.pathname.endsWith('/query/directory-resource')) return route.fulfill({json: envelope()});
        if (url.pathname.endsWith('/query/resource-map')) return route.fulfill({json: {total: 1, mapped: 1, cells: [point]}});
        return route.fulfill({status: 401, json: {error: {code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.'}}});
    });
});
test('default resource map has keyboard-accessible pins, visit information, and focus restoration', async ({page}) => {
    await page.goto('/map?zip=60608');
    const marker = page.getByRole('button', {name: resource.name, exact: true});
    await marker.focus(); await page.keyboard.press('Enter');
    const detail = page.getByRole('dialog');
    await expect(detail.getByRole('heading', {name: resource.name})).toBeVisible();
    await expect(detail.getByRole('region', {name: 'Published hours'})).toContainText('Tuesday by appointment');
    await expect(detail.getByRole('link', {name: 'Get directions'})).toHaveAttribute('href', /41.85/);
    await expect(detail.getByText(resource.exactPublicAddress.streetAddress, {exact: true})).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(detail).not.toBeVisible();
    await expect(marker).toBeFocused();
    await expect(page.locator('.pw-explorer__result-meta')).toContainText('1.2 km');
    const violations = (await new AxeBuilder({page}).analyze()).violations;
    expect(violations).toEqual([]);
});
test('clusters include resources beyond the first page and expand to an exact place', async ({page}) => {
    await page.route('**/api/query/resource-map?**', route => {
        const zoom = Number(new URL(route.request().url()).searchParams.get('mapZoom'));
        return route.fulfill({json: {total: 150, mapped: zoom < 13 ? 150 : 1, cells: zoom < 13 ? [{...point, count: 150, resourceUri: null, west: -87.675, east: -87.665, south: 41.845, north: 41.855}] : [point]}});
    });
    await page.goto('/map?zip=60608&r=20000');
    await page.getByRole('button', {name: '150 resources. Open to explore.', exact: true}).click();
    await expect(page.getByRole('button', {name: resource.name, exact: true})).toBeVisible();
});
test('mobile map and list preserve the search, details, and map instance', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/nearby?nearby=resources&zip=60608&r=5000');
    const map = page.locator('.pw-resource-map__canvas');
    await expect(map).toBeVisible();
    await map.evaluate(el => el.setAttribute('data-continuity', 'same-map'));
    await page.getByRole('searchbox', {name: 'Find a resource'}).fill('WIC clinic');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('WIC clinic');
    await page.getByRole('button', {name: 'List', exact: true}).click();
    await page.locator('.pw-explorer__result').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: 'Map', exact: true}).click();
    await expect(map).toHaveAttribute('data-continuity', 'same-map');
    await expect(page.getByRole('searchbox')).toHaveValue('WIC clinic');
    expect(new URL(page.url()).searchParams.get('r')).toBe('5000');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('resource filter changes query the server and Back restores the filter', async ({page}) => {
    const queries: URL[] = [];
    page.on('request', req => { if (req.url().includes('/query/directory?')) queries.push(new URL(req.url())); });
    await page.goto('/map?zip=60608');
    await page.getByRole('button', {name: 'Filters', exact: true}).click();
    await page.getByRole('combobox', {name: 'Service', exact: true}).selectOption('food');
    await expect.poll(() => queries.at(-1)?.searchParams.get('service')).toBe('food');
    await page.getByRole('combobox', {name: 'Program or benefit', exact: true}).selectOption('wic');
    await expect.poll(() => queries.at(-1)?.searchParams.get('program')).toBe('wic');
    await page.getByRole('combobox', {name: 'Search distance', exact: true}).selectOption('5000');
    await expect.poll(() => queries.at(-1)?.searchParams.get('radiusKm')).toBe('5');
    await page.getByRole('button', {name: 'Clear filters'}).click();
    await expect.poll(() => queries.at(-1)?.searchParams.has('service')).toBe(false);
    await page.goBack();
    await expect(page.getByRole('combobox', {name: 'Service', exact: true})).toHaveValue('food');
    await expect(page.getByRole('combobox', {name: 'Program or benefit', exact: true})).toHaveValue('wic');
});
test('list and marker errors retry independently without claiming zero results', async ({page}) => {
    let failed = true;
    await page.route('**/api/query/resource-map?**', route => failed ? route.fulfill({status: 503, json: {error: {code: 'UNAVAILABLE', message: 'Try again.'}}}) : route.fulfill({json: {total: 1, mapped: 1, cells: [point]}}));
    await page.goto('/map?zip=60608');
    await expect(page.locator('.pw-explorer__result')).toHaveCount(1);
    await expect(page.locator('.pw-resource-map__status')).toContainText('Map markers could not be loaded.');
    failed = false;
    await page.locator('.pw-resource-map__status').getByRole('button', {name: 'Retry'}).click();
    await expect(page.getByRole('button', {name: resource.name, exact: true})).toBeVisible();
});
