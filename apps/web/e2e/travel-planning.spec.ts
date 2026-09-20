import { expect, test } from '@playwright/test';

test('trip planning requests a fresh precise origin on consent and keeps it out of browser state', async ({ page }) => {
    const resourceUri = 'at://did:plc:public/app.patchwork.directory.resource/clinic';
    let locationCalls = 0;
    let travelBody: Record<string, unknown> | undefined;
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
            getCurrentPosition: (success: PositionCallback) => {
                (window as unknown as { __locationCalls: number }).__locationCalls = ((window as unknown as { __locationCalls: number }).__locationCalls ?? 0) + 1;
                success({ coords: { latitude: 41.881234, longitude: -87.632345, accuracy: 50,
                    altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
            },
        } });
    });
    await page.route('**/api/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/auth/session')) return route.fulfill({ json: { session: null } });
        if (path.endsWith('/query/directory-resource')) return route.fulfill({ json: { total: 1, results: [{
            uri: resourceUri, name: 'Community clinic', category: 'clinic', serviceArea: 'Chicago',
            contact: { url: 'https://clinic.example.org' }, operationalStatus: 'open',
            verificationStatus: 'partner-verified', recordOrigin: 'sourced-public',
            exactPublicAddress: { kind: 'sourced-public-resource', streetAddress: '100 W Lake St, Chicago, IL 60601',
                latitude: 41.885, longitude: -87.63, sourceExpiresAt: '2099-01-01T00:00:00.000Z', sourceUrl: 'https://clinic.example.org' },
        }] } });
        if (path.endsWith('/query/directory')) return route.fulfill({ json: { total: 0, page: 1, pageSize: 20, hasNextPage: false, results: [] } });
        if (path.endsWith('/travel/plan')) {
            travelBody = route.request().postDataJSON() as Record<string, unknown>;
            return route.fulfill({ json: { itineraries: [{
                startTime: '2026-09-19T18:00:00.000Z', endTime: '2026-09-19T18:22:00.000Z',
                durationSeconds: 1320, walkDistanceMeters: 320, legs: [{ mode: 'BUS', route: '22',
                    startTime: '2026-09-19T18:00:00.000Z', endTime: '2026-09-19T18:22:00.000Z',
                    durationSeconds: 1320, distanceMeters: 4500, from: 'State & Lake', to: 'Community clinic' }],
            }] } });
        }
        return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Unavailable.' } } });
    });

    await page.goto(`/resources?resource=${encodeURIComponent(resourceUri)}`);
    await expect(page.getByRole('heading', { name: 'Plan a trip' })).toBeVisible();
    locationCalls = await page.evaluate(() => (window as unknown as { __locationCalls?: number }).__locationCalls ?? 0);
    await page.getByRole('button', { name: 'Use my location and plan' }).first().click();
    await expect(page.getByRole('list', { name: 'Travel options' }).first()).toContainText('BUS 22');
    expect(await page.evaluate(() => (window as unknown as { __locationCalls?: number }).__locationCalls ?? 0)).toBe(locationCalls + 1);
    expect(travelBody).toMatchObject({ resourceUri, origin: { latitude: 41.881234, longitude: -87.632345 }, mode: 'transit' });
    expect(page.url()).not.toContain('41.881234');
    const browserState = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    expect(browserState).not.toContain('41.881234');
    expect(browserState).not.toContain('-87.632345');

    await page.reload();
    await expect(page.getByRole('list', { name: 'Travel options' })).toHaveCount(0);
});
