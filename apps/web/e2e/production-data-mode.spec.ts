import { expect, test } from '@playwright/test';

test('offline state is explicit and does not promise queued mutations', async ({
    context,
    page,
}) => {
    await page.goto('/');
    await context.setOffline(true);
    await expect(page.getByRole('alert')).toContainText('You are offline.');
    await expect(page.getByRole('alert')).toContainText(
        'does not queue mutations offline',
    );
    await context.setOffline(false);
    await expect(page.getByText('You are offline.')).toHaveCount(0);
});

test('showcase origin is visible and stale retained results are disclosed', async ({
    page,
}) => {
    await page.route('**/api/**', async route => {
        const requestUrl = new URL(route.request().url());
        const path = requestUrl.pathname.replace(
            /^\/api/,
            '',
        );
        if (path === '/status') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    maintenance: {
                        active: false,
                        reasonCodes: [],
                        publicMessage: '',
                        environmentOverride: false,
                        declaredAt: null,
                        declaredBy: null,
                    },
                }),
            });
            return;
        }
        if (path === '/query/feed') {
            if (requestUrl.searchParams.get('searchText') === 'grocery') {
                await route.abort('failed');
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [
                        {
                            uri: 'at://did:plc:example/app.patchwork.aid.post/1',
                            authorDid: 'did:plc:example',
                            title: 'Synthetic grocery delivery',
                            summary: 'Fictional showcase request.',
                            category: 'food',
                            status: 'open',
                            urgency: 'medium',
                            createdAt: '2026-07-28T00:00:00.000Z',
                            updatedAt: '2026-07-28T00:00:00.000Z',
                            approximateGeo: {
                                latitude: 41.88,
                                longitude: -87.7,
                                precisionKm: 3,
                            },
                            recordOrigin: 'synthetic',
                        },
                    ],
                }),
            });
            return;
        }
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
                error: {
                    code: 'AUTHENTICATION_REQUIRED',
                    message: 'Authentication required.',
                },
            }),
        });
    });

    await page.goto('/feed');
    await expect(page.getByText('Synthetic showcase')).toBeVisible();
    await page.getByLabel('Search text').fill('grocery');
    await expect(page.getByRole('alert')).toContainText(
        'Showing previously loaded results; they may be stale.',
    );
    await expect(page.getByText('Synthetic grocery delivery')).toBeVisible();
});

test('API failure stays visible and never substitutes fixture discovery data', async ({
    page,
}) => {
    let discoveryRequests = 0;
    await page.route('**/api/**', async route => {
        if (route.request().url().includes('/query/map')) discoveryRequests += 1;
        await route.abort('failed');
    });

    await page.goto(
        '/map?tab=nearby&r=20000&lat=41.88&lng=-87.63&area=Disposable+test+area',
    );
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(
        'The service could not complete this request.',
    );
    await expect(page.getByText('NETWORK_ERROR')).toHaveCount(0);
    await expect(page.getByText('API unavailable')).toBeVisible();
    await expect(page.getByText('Need groceries before 21:00')).toHaveCount(0);

    await page.getByRole('button', { name: 'Retry discovery' }).click();
    await expect.poll(() => discoveryRequests).toBeGreaterThan(1);
});

test('map requests location and loads an approximate nearby area automatically', async ({ page }) => {
    let discoveryRequests = 0;
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'geolocation', {
            configurable: true,
            value: {
                getCurrentPosition: (
                    success: PositionCallback,
                ) => success({
                    coords: {
                        latitude: 41.881234,
                        longitude: -87.632345,
                        accuracy: 100,
                        altitude: null,
                        altitudeAccuracy: null,
                        heading: null,
                        speed: null,
                        toJSON: () => ({}),
                    },
                    timestamp: Date.now(),
                    toJSON: () => ({}),
                }),
            },
        });
    });
    await page.route('**/api/**', async route => {
        const requestUrl = new URL(route.request().url());
        const path = requestUrl.pathname.replace(/^\/api/, '');
        if (path.startsWith('/query/')) {
            discoveryRequests += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    total: 0,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [],
                }),
            });
            return;
        }
        if (path === '/status') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    maintenance: {
                        active: false,
                        reasonCodes: [],
                        publicMessage: '',
                        environmentOverride: false,
                        declaredAt: null,
                        declaredBy: null,
                    },
                }),
            });
            return;
        }
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
                error: {
                    code: 'AUTHENTICATION_REQUIRED',
                    message: 'Authentication required.',
                },
            }),
        });
    });

    await page.goto('/map');

    await expect(page).toHaveURL(/lat=41\.88/);
    await expect(page).toHaveURL(/lng=-87\.63/);
    await expect(page).toHaveURL(/area=Near\+you/);
    await expect(page.getByText(/rounded, approximate version/)).toBeVisible();
    await expect(page.getByLabel('Approximate area label')).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Confirm approximate area' }),
    ).toHaveCount(0);
    await expect(page.getByText('API unavailable')).toHaveCount(0);
    await expect(page.getByText(/^API sync issue:/)).toHaveCount(0);
    await expect(page.getByText(/^Public-place sync issue:/)).toHaveCount(0);
    expect(discoveryRequests).toBeGreaterThan(0);
});

test('public home advertises only implemented demonstration capabilities', async ({
    page,
}) => {
    await page.goto('/');

    await expect(page.getByRole('status')).toContainText(
        'Demonstration environment',
    );
    await expect(
        page.getByRole('heading', {
            name: 'Find help. Offer help. Strengthen your neighborhood.',
        }),
    ).toBeVisible();
    await expect(
        page.getByText(
            'Public discovery uses approximate areas, never exact addresses.',
        ),
    ).toBeVisible();
    await expect(page.getByText('127', { exact: true })).toHaveCount(0);
    await expect(page.getByText('11m', { exact: true })).toHaveCount(0);
    await expect(page.getByText('42', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/localhost:4[012]00/)).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Open chat handoff' }),
    ).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Volunteer' })).toBeHidden();
    await expect(page.getByRole('link', { name: 'Chat' })).toBeHidden();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const more = page.locator('#secondary-navigation-links');
    await expect(more.getByRole('link', { name: 'Volunteer' })).toBeVisible();
    await expect(more.getByRole('link', { name: 'Organizations' })).toBeVisible();
    await expect(more.getByRole('link', { name: 'Scheduling' })).toHaveCount(0);
    await expect(more.getByRole('link', { name: 'Feedback' })).toHaveCount(0);
    await expect(more.getByRole('link', { name: 'Groups' })).toHaveCount(0);
    await expect(more.getByRole('link', { name: 'Chat' })).toHaveCount(0);
});

test('direct deferred feedback route never exposes fixture implementations', async ({
    page,
}) => {
    for (const route of ['/feedback']) {
        await page.goto(route);
        await expect(
            page.getByRole('region', { name: 'Deferred from the alpha' }),
        ).toBeVisible();
        await expect(page.locator('form')).toHaveCount(0);
    }
});

test('map area selection is explicit, reversible, historical, and remembers style', async ({
    page,
}) => {
    await page.route('**/api/**', async route => {
        const requestUrl = new URL(route.request().url());
        const path = requestUrl.pathname.replace(/^\/api/, '');
        if (path === '/status') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    maintenance: {
                        active: false,
                        reasonCodes: [],
                        publicMessage: '',
                        environmentOverride: false,
                        declaredAt: null,
                        declaredBy: null,
                    },
                }),
            });
            return;
        }
        if (path === '/query/map') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [{
                        uri: 'at://did:plc:map/app.patchwork.aid.post/area',
                        authorDid: 'did:plc:map',
                        title: 'Area filter request',
                        summary: 'Approximate test request.',
                        category: 'food',
                        status: 'open',
                        urgency: 'high',
                        createdAt: '2026-08-04T00:00:00.000Z',
                        updatedAt: '2026-08-04T00:00:00.000Z',
                        approximateGeo: {
                            latitude: 40.73,
                            longitude: -73.98,
                            precisionKm: 1,
                        },
                        recordOrigin: 'synthetic',
                    }],
                }),
            });
            return;
        }
        if (path === '/query/directory') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    total: 0,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [],
                }),
            });
            return;
        }
        await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({
                error: {
                    code: 'AUTHENTICATION_REQUIRED',
                    message: 'Authentication required.',
                },
            }),
        });
    });

    await page.goto(
        '/map?tab=nearby&r=20000&lat=40.72&lng=-73.99&area=Disposable+test+area',
    );
    await expect(page.getByText('Area filter request')).toBeVisible();
    await page.locator('.mh-map-circle').first().click();
    // Selecting or zooming changes the viewport, never the active discovery query.
    await expect(page).toHaveURL(/(?:\?|&)r=20000(?:&|$)/);
    await expect(page.getByRole('region', { name: 'Details for Area filter request' })).toBeVisible();
    await page.getByRole('button', { name: 'Search this area' }).click();
    await expect(page).not.toHaveURL(/(?:\?|&)r=20000(?:&|$)/);
    const searchedUrl = page.url();
    await page.goBack();
    await expect(page).toHaveURL(/(?:\?|&)r=20000(?:&|$)/);
    await page.goForward();
    await expect(page).toHaveURL(searchedUrl);

    await page.locator('.mh-map-style-control label').filter({ hasText: 'Outline' }).click();
    await expect(page.getByRole('radio', { name: 'Outline' })).toBeChecked();
    await expect(page.locator('.mh-map-style-outline')).toBeVisible();
    await page.reload();
    await expect(page.locator('.mh-map-style-outline')).toBeVisible();
    await page.getByRole('button', { name: 'Clear area filter' }).click();
    await expect(page).not.toHaveURL(/(?:\?|&)r=/);
    await expect(page.getByText('Filtered to this area')).toHaveCount(0);
});

test('legal routes show aligned unapproved buyer-ready policy boundaries', async ({
    page,
}) => {
    await page.goto('/legal/terms');
    await expect(
        page.getByRole('heading', { name: 'Terms of Service' }),
    ).toBeVisible();
    await expect(page.getByText('at least 18')).toBeVisible();
    await expect(page.getByText(/Messages are server-readable/)).toBeVisible();
    await expect(page.getByText(/operationally NO-GO/)).toBeVisible();

    await page.goto('/legal/privacy');
    await expect(
        page.getByRole('heading', { name: 'Privacy Policy' }),
    ).toBeVisible();
    await expect(page.getByText(/encrypted peer channel/)).toBeVisible();
    await expect(page.getByText(/clean access is authenticated/)).toBeVisible();

    await page.goto('/legal/community-guidelines');
    await expect(
        page.getByRole('heading', { name: 'Community Guidelines' }),
    ).toBeVisible();
    await expect(page.getByText(/two business days/)).toBeVisible();
    await expect(page.getByText(/not an emergency response/)).toBeVisible();
});

test('authenticated production settings expose durable account controls only', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'account-controls-csrf',
            url: baseURL,
        },
    ]);
    let deactivated = false;
    let exportRequests = 0;
    let preferences = {
        audience: 'authenticated',
        notifications: { inApp: true, email: true, push: false },
        language: 'en',
        location: { sharing: 'approximate', noPermanentAddress: false },
    };
    let deactivationBody: unknown;
    let deactivationCsrf: string | undefined;
    await page.route('**/api/**', async route => {
        const request = route.request();
        const apiPath = new URL(request.url()).pathname.replace(/^\/api/, '');
        if (apiPath === '/auth/session') {
            if (deactivated) {
                await route.fulfill({
                    status: 401,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: {
                            code: 'AUTHENTICATION_REQUIRED',
                            message: 'Authentication required.',
                        },
                    }),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:account-controls',
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
                    requiredDocuments: [
                        'terms-of-use',
                        'privacy-notice',
                        'community-guidelines',
                        'synthetic-data-disclosure',
                        'location-sharing-consent',
                    ],
                    consentRequired: false,
                    acceptedAt: '2026-07-28T00:00:00.000Z',
                }),
            });
            return;
        }
        if (apiPath === '/account/preferences') {
            if (request.method() === 'PUT') {
                preferences = request.postDataJSON().preferences;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ preferences }),
            });
            return;
        }
        if (apiPath === '/account/export') {
            exportRequests += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    formatVersion: '1.0',
                    generatedAt: '2026-07-28T00:00:00.000Z',
                    subject: { did: 'did:plc:account-controls' },
                    data: {},
                    exclusions: [],
                }),
            });
            return;
        }
        if (apiPath === '/account/deactivate') {
            deactivationBody = request.postDataJSON();
            deactivationCsrf = request.headers()['x-csrf-token'];
            deactivated = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    status: 'deactivated',
                    effectiveAt: '2026-07-28T00:00:00.000Z',
                    removed: {},
                    revoked: { browserSessions: 1, oauthSessions: 1 },
                    retained: { deactivationReceipt: 1 },
                }),
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

    await page.goto('/settings');

    await expect(
        page.getByRole('heading', { name: 'Account privacy' }),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Download data export' }),
    ).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Deactivate account' }),
    ).toBeVisible();
    await expect(page.getByText('Privacy and delivery preferences')).toBeVisible();
    await page
        .getByRole('article', { name: 'Privacy and delivery preferences' })
        .getByRole('combobox', { name: /^Profile visibility/ })
        .selectOption('hidden');
    await page.getByLabel('I do not have a permanent address').check();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Preferences saved.')).toBeVisible();
    expect(preferences).toMatchObject({
        audience: 'hidden',
        location: { noPermanentAddress: true },
    });

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download data export' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
        'patchwork-account-export.json',
    );
    expect(exportRequests).toBe(1);

    await page.getByRole('button', { name: 'Deactivate account' }).click();
    await expect(
        page.getByRole('alertdialog', {
            name: 'Confirm deactivation',
        }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Keep account active' }).click();
    await expect(
        page.getByRole('alertdialog', {
            name: 'Confirm deactivation',
        }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Deactivate account' }).click();
    await page.getByRole('button', { name: 'Confirm deactivation' }).click();

    await expect(
        page.getByRole('region', { name: 'Sign in required' }),
    ).toBeVisible();
    expect(deactivationBody).toEqual({});
    expect(deactivationCsrf).toBe('account-controls-csrf');
});

test('expired policy consent blocks protected UI until every policy and 18+ assertion is accepted', async ({
    page,
}) => {
    let consentBody: unknown;
    await page.route('**/api/**', async route => {
        const request = route.request();
        const apiPath = new URL(request.url()).pathname.replace(/^\/api/, '');
        if (apiPath === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:renew-consent',
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
                    requiredDocuments: [
                        'terms-of-use',
                        'privacy-notice',
                        'community-guidelines',
                        'synthetic-data-disclosure',
                        'location-sharing-consent',
                    ],
                    consentRequired: true,
                    acceptedAt: null,
                }),
            });
            return;
        }
        if (apiPath === '/account/consent') {
            consentBody = request.postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    policyVersion: '2026-07-28',
                    requiredDocuments: [
                        'terms-of-use',
                        'privacy-notice',
                        'community-guidelines',
                        'synthetic-data-disclosure',
                        'location-sharing-consent',
                    ],
                    consentRequired: false,
                    acceptedAt: '2026-07-28T12:00:00.000Z',
                }),
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

    await page.goto('/settings');
    await expect(
        page.getByText('Material changes require a new acceptance'),
    ).toBeVisible();
    const continueButton = page.getByRole('button', {
        name: 'Accept and continue',
    });
    await expect(continueButton).toBeDisabled();
    for (const checkbox of await page.getByRole('checkbox').all()) {
        await checkbox.check();
    }
    await continueButton.click();
    await expect(
        page.getByRole('heading', { name: 'Account privacy' }),
    ).toBeVisible();
    expect(consentBody).toEqual({
        policyVersion: '2026-07-28',
        asserted18OrOlder: true,
        acceptedDocuments: [
            'terms-of-use',
            'privacy-notice',
            'community-guidelines',
            'synthetic-data-disclosure',
            'location-sharing-consent',
        ],
    });
    expect(JSON.stringify(consentBody)).not.toContain('did:');
});
