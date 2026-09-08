import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('authenticated stewards publish, edit, and delete a directory resource', async ({
    page,
}) => {
    const did = 'did:plc:directory-steward';
    const uri = `at://${did}/app.patchwork.directory.resource/main`;
    let cid = 'bafy-created';
    let record: Record<string, unknown> | undefined;
    const methods: string[] = [];

    await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const apiPath = url.pathname.replace(/^\/api/, '');
        if (apiPath === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did,
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    },
                }),
            });
            return;
        }
        if (apiPath === '/account/onboarding') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    consentRequired: false,
                    acceptedAt: '2026-07-28T00:00:00.000Z',
                }),
            });
            return;
        }
        if (apiPath === '/query/directory') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    total: record ? 1 : 0,
                    page: 1,
                    pageSize: 100,
                    hasNextPage: false,
                    results:
                        record ?
                            [
                                {
                                    uri,
                                    cid,
                                    authorDid: did,
                                    name: record['name'],
                                    category: record['category'],
                                    serviceArea: record['serviceArea'],
                                    status: record['verificationStatus'],
                                    contact: record['contact'],
                                    approximateGeo: record['location'],
                                    openHours: record['openHours'],
                                    eligibilityNotes:
                                        record['eligibilityNotes'],
                                    operationalStatus:
                                        record['operationalStatus'],
                                    createdAt: record['createdAt'],
                                    updatedAt:
                                        record['updatedAt'] ??
                                        record['createdAt'],
                                },
                            ]
                        :   [],
                }),
            });
            return;
        }
        if (apiPath === '/at/directory-resources') {
            methods.push(request.method());
            if (request.method() === 'POST') {
                record = request.postDataJSON() as Record<string, unknown>;
            } else if (request.method() === 'PUT') {
                const body = request.postDataJSON() as {
                    record: Record<string, unknown>;
                };
                record = body.record;
                cid = 'bafy-updated';
            } else if (request.method() === 'DELETE') {
                record = undefined;
                await route.fulfill({ status: 204, body: '' });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ uri, cid, record }),
            });
            return;
        }
        await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'NOT_FOUND', message: 'Not found.' },
            }),
        });
    });

    await page.goto(
        '/resources?tab=nearby&r=20000&lat=41.88&lng=-87.63&area=Disposable+test+area',
    );
    await page.getByText('Add or manage a resource', { exact: true }).click();
    await page.getByRole('button', { name: 'Add a resource' }).click();
    await page.getByLabel('Resource name').fill('Northside Community Pantry');
    await page.getByLabel('Public service area').fill('Near North Side');
    await page.getByLabel('Public phone').fill('312-555-0100');
    await page.getByLabel('Latitude').fill('41.9');
    await page.getByLabel('Longitude').fill('-87.64');
    await page.getByLabel('Precision km').fill('2');
    const accessibility = await new AxeBuilder({ page })
        .include('form')
        .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.getByRole('button', { name: 'Publish resource' }).click();

    await expect(page.getByText(/Resource published/)).toBeVisible();
    expect(record).toMatchObject({
        verificationStatus: 'unverified',
        location: { precisionKm: 2 },
    });
    await expect(
        page.getByRole('button', { name: 'Manage listing' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Manage listing' }).click();
    await expect(
        page.getByRole('heading', { name: 'Edit directory resource' }),
    ).toBeVisible();
    const resourceName = page.getByLabel('Resource name');
    await resourceName.fill('Northside Mutual Aid Pantry');
    await expect(resourceName).toHaveValue('Northside Mutual Aid Pantry');
    await page.getByRole('button', { name: 'Save resource' }).click();
    await expect(page.getByText(/Resource updated/)).toBeVisible();
    expect(record?.['name']).toBe('Northside Mutual Aid Pantry');

    await page.getByRole('button', { name: 'Delete resource' }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();
    await expect(page.getByText(/Resource deleted/)).toBeVisible();
    expect(methods).toEqual(['POST', 'PUT', 'DELETE']);
});
