import { test, expect } from '@playwright/test';

test('service requirements are optional, temporary and preserve unknown evidence', async ({
    page,
}) => {
    const uri = 'at://did:plc:service/app.patchwork.directory.resource/clinic';
    const evidence = {
        sourceUrl: 'https://example.org/requirements',
        sourceName: 'Provider',
        confirmedAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        reviewStatus: 'reviewed',
    };
    const resource = {
        uri,
        authorDid: 'did:plc:service',
        name: 'Community clinic',
        category: 'clinic',
        serviceArea: 'Chicago',
        status: 'unverified',
        operationalStatus: 'unknown',
        contact: { url: 'https://example.org' },
        approximateGeo: { latitude: 41.85, longitude: -87.67, precisionKm: 1 },
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        serviceProfile: {
            version: 1,
            services: [
                {
                    id: 'clinic',
                    name: 'Adult services',
                    eligibility: [
                        {
                            question: 'ageYears',
                            operator: 'at-least',
                            value: 18,
                            description: 'Age 18 or older',
                            evidence,
                        },
                    ],
                    appointment: { value: 'required', evidence },
                    hours: {
                        evidence,
                        value: {
                            timezone: 'America/Chicago',
                            weekly: [{ day: 1, start: 1320, end: 120 }],
                            exceptions: [{ date: '2026-12-25', intervals: [] }],
                        },
                    },
                },
            ],
        },
    };
    const calls: string[] = [];
    await page.route('**/api/**', (route) => {
        calls.push(
            route.request().url() + String(route.request().postData() ?? ''),
        );
        if (route.request().url().includes('/query/directory'))
            return route.fulfill({
                json: {
                    results: [resource],
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                },
            });
        return route.fulfill({
            status: 401,
            json: {
                error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' },
            },
        });
    });
    await page.goto('/resources?resource=' + encodeURIComponent(uri));
    await page
        .getByText('Service hours and closures · America/Chicago', {
            exact: true,
        })
        .click();
    await expect(page.getByText(/Monday: 22:00–02:00/)).toBeVisible();
    await expect(page.getByText(/2026-12-25: Scheduled closed/)).toBeVisible();
    await page
        .getByText('Check published requirements', { exact: true })
        .click();
    await expect(
        page.getByText('More information needed', { exact: true }),
    ).toBeVisible();
    await page
        .getByRole('spinbutton', { name: 'Age in years', exact: true })
        .fill('17');
    await expect(
        page.getByText('A published requirement is not met', { exact: true }),
    ).toBeVisible();
    await page
        .getByRole('spinbutton', { name: 'Age in years', exact: true })
        .fill('18');
    await expect(
        page.getByText('Potential match — confirm with the provider', {
            exact: true,
        }),
    ).toBeVisible();
    expect(calls.some((call) => call.includes('ageYears'))).toBe(false);
    const storage = await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toContain('ageYears');
    expect(page.url()).not.toContain('ageYears');
    await page.reload();
    await page
        .getByText('Check published requirements', { exact: true })
        .click();
    await expect(
        page.getByRole('spinbutton', { name: 'Age in years', exact: true }),
    ).toHaveValue('');
    await expect(
        page.getByText('Appointment required', { exact: true }),
    ).toBeVisible();
});
