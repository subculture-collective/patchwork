import { expect, test } from '@playwright/test';

const requesterState = process.env['PATCHWORK_E2E_REQUESTER_STATE'];
const helperState = process.env['PATCHWORK_E2E_HELPER_STATE'];
const exactLatitude = process.env['PATCHWORK_E2E_EXACT_LATITUDE'];
const exactLongitude = process.env['PATCHWORK_E2E_EXACT_LONGITUDE'];
const privateMarker = process.env['PATCHWORK_E2E_PRIVATE_MARKER'];
const liveEnvironmentAvailable = Boolean(
    process.env['PATCHWORK_E2E_BASE_URL'] &&
        requesterState &&
        helperState &&
        exactLatitude &&
        exactLongitude &&
        privateMarker,
);
const feedOrigin = { latitude: 40.7128, longitude: -74.006 };
const distanceFromFeedOriginKm = (latitude: number, longitude: number) => {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = radians(latitude - feedOrigin.latitude);
    const longitudeDelta = radians(longitude - feedOrigin.longitude);
    const a =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(radians(feedOrigin.latitude)) *
            Math.cos(radians(latitude)) *
            Math.sin(longitudeDelta / 2) ** 2;
    return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

test.describe('real two-account AT record lifecycle', () => {
    test.skip(
        !liveEnvironmentAvailable,
        'Requires an authorized staging URL, two OAuth storage states, and disposable coordinates.',
    );

    test('create, discover, report, block, close, and delete without leaking private inputs', async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        const latitude = Number(exactLatitude);
        const longitude = Number(exactLongitude);
        expect(Number.isFinite(latitude)).toBe(true);
        expect(Number.isFinite(longitude)).toBe(true);
        expect(distanceFromFeedOriginKm(latitude, longitude)).toBeLessThanOrEqual(
            100,
        );
        const requesterContext = await browser.newContext({
            storageState: requesterState!,
        });
        const helperContext = await browser.newContext({
            storageState: helperState!,
        });
        const requester = await requesterContext.newPage();
        const helper = await helperContext.newPage();
        const title = `Disposable alpha request ${Date.now().toString(36)}`;
        const privateDetails = privateMarker!;
        const responseBodies: string[] = [];
        for (const page of [requester, helper]) {
            page.on('response', async response => {
                if (response.request().resourceType() === 'document') return;
                const contentType = response.headers()['content-type'] ?? '';
                if (!contentType.includes('json')) return;
                responseBodies.push(await response.text().catch(() => ''));
            });
        }

        const postingArea = new URLSearchParams({
            tab: 'nearby',
            r: '20000',
            lat: exactLatitude!,
            lng: exactLongitude!,
            area: 'Disposable staging area',
        });
        await requester.goto(`/posting?${postingArea.toString()}`);
        await expect(requester.locator('.mh-auth-control').getByText(/^@/)).toBeVisible();
        await requester.getByLabel('Title').fill(title);
        await requester
            .getByLabel('Description')
            .fill('Disposable integration record. No private handoff data.');
        await expect(requester.getByLabel('Latitude')).toHaveCount(0);
        await expect(requester.getByLabel('Longitude')).toHaveCount(0);
        await expect(requester.getByLabel('Precision meters')).toHaveCount(0);
        await requester.getByRole('button', { name: 'Publish request' }).click();
        await expect(requester.getByText(/persisted via API\/DB/)).toBeVisible();

        await helper.goto('/feed', { waitUntil: 'networkidle' });
        await expect
            .poll(async () => {
                await helper.reload({ waitUntil: 'networkidle' });
                return helper.getByText(title).count();
            }, { timeout: 60_000, intervals: [2_000, 5_000, 10_000] })
            .toBe(1);
        await helper.getByRole('button', { name: new RegExp(`^Report ${title}, item \\d+ of \\d+$`) }).click();
        await helper.getByLabel('Report reason').selectOption('other');
        await helper.getByLabel('Private report details').fill(privateDetails);
        await helper.getByRole('button', { name: 'Submit report' }).click();
        await expect(helper.getByText('Report submitted.')).toBeVisible();
        await helper
            .getByRole('button', { name: new RegExp(`^Block author of ${title}, item \\d+ of \\d+$`) })
            .click();
        await helper.getByRole('button', { name: 'Confirm block author' }).click();
        await expect(helper.getByText('Author blocked.')).toBeVisible();

        await requester.goto('/feed', { waitUntil: 'networkidle' });
        await expect
            .poll(async () => {
                await requester.reload({ waitUntil: 'networkidle' });
                return requester.getByText(title).count();
            }, { timeout: 60_000, intervals: [2_000, 5_000, 10_000] })
            .toBe(1);
        await requester
            .getByRole('button', { name: `Resolve request "${title}"` })
            .click();
        await expect(requester.getByText('Resolved').first()).toBeVisible();
        await requester
            .getByRole('button', { name: `Close ${title.toLowerCase()}` })
            .click();
        await expect(requester.getByText('Request closed.')).toBeVisible();
        await requester
            .getByRole('button', { name: `Delete ${title.toLowerCase()}` })
            .click();
        await requester
            .getByRole('button', { name: 'Confirm delete request' })
            .click();
        await expect(requester.getByText(title)).toHaveCount(0);

        const observable = [
            requester.url(),
            helper.url(),
            await requester.locator('body').innerText(),
            await helper.locator('body').innerText(),
            ...responseBodies,
        ].join('\n');
        expect(observable).not.toContain(exactLatitude!);
        expect(observable).not.toContain(exactLongitude!);
        expect(observable).not.toContain(privateDetails);
        expect(observable).not.toMatch(/access_token|refresh_token|id_token/i);

        await requesterContext.close();
        await helperContext.close();
    });
});
