import { expect, test } from '@playwright/test';

const subjectUri =
    'at://did:plc:subject/app.patchwork.aid.post/browser-safety-1';

test.beforeEach(async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'browser-csrf-token',
            url: baseURL,
        },
    ]);
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname.replace(/^\/api/, '');
        if (apiPath === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:viewer',
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
        if ((apiPath === '/query/feed' || apiPath === '/query/map')) {
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
                            uri: subjectUri,
                            authorDid: 'did:plc:subject',
                            title: 'Suspicious request',
                            summary: 'This record should expose safety actions.',
                            status: 'open',
                            category: 'food',
                            urgency: 'medium',
                            approximateGeo: { latitude: 41.85, longitude: -87.93, precisionKm: 1 },
                            updatedAt: '2026-07-11T00:00:00.000Z',
                        },
                    ],
                }),
            });
            return;
        }
        await route.fallback();
    });
});

test('authenticated user reports a discovered request with private details', async ({
    page,
}) => {
    let reportBody: Record<string, unknown> | undefined;
    await page.route('**/api/reports', async route => {
        reportBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ reportId: '41', created: true }),
        });
    });

    await page.goto('/feed?lat=41.85&lng=-87.93&r=65000');
    await page.getByRole('button', { name: 'Report suspicious request' }).click();
    await page.getByLabel('Report reason').selectOption('fraud');
    await page
        .getByLabel('Private report details')
        .fill('The request asks for prepaid gift cards.');
    await page.getByRole('button', { name: 'Submit report' }).click();

    await expect(page.getByText('Report submitted.')).toBeVisible();
    expect(reportBody).toMatchObject({
        subjectUri,
        reason: 'fraud',
        details: 'The request asks for prepaid gift cards.',
        commandId: expect.any(String),
    });
    expect(reportBody).not.toHaveProperty('reporterDid');
    expect(reportBody).not.toHaveProperty('actorDid');
});

test('authenticated user confirms a private block against the record author', async ({
    page,
}) => {
    let blockBody: Record<string, unknown> | undefined;
    let csrfHeader: string | undefined;
    await page.route('**/api/blocks', async route => {
        blockBody = route.request().postDataJSON() as Record<string, unknown>;
        csrfHeader = route.request().headers()['x-csrf-token'];
        await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ blockId: '51', created: true }),
        });
    });

    await page.goto('/feed?lat=41.85&lng=-87.93&r=65000');
    await page
        .getByRole('button', { name: 'Block author of Suspicious request' })
        .click();
    await expect(
        page.getByRole('alertdialog', { name: 'Confirm block author' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirm block author' }).click();

    await expect(page.getByText('Author blocked.')).toBeVisible();
    expect(blockBody).toMatchObject({
        subjectDid: 'did:plc:subject',
        reason: 'Blocked from a discovered aid request.',
        commandId: expect.any(String),
    });
    expect(blockBody).not.toHaveProperty('blockerDid');
    expect(blockBody).not.toHaveProperty('actorDid');
    expect(csrfHeader).toBe('browser-csrf-token');
});

test('record owner closes with compare-and-swap then deletes the AT record', async ({
    page,
}) => {
    await page.unroute('**/api/**');
    const mutationBodies: Record<string, unknown>[] = [];
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname.replace(/^\/api/, '');
        if (apiPath === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:viewer',
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
        if ((apiPath === '/query/feed' || apiPath === '/query/map')) {
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
                            uri: 'at://did:plc:viewer/app.patchwork.aid.post/owned-1',
                            cid: 'cid-open',
                            authorDid: 'did:plc:viewer',
                            title: 'Owned request',
                            summary: 'Owner can close and delete this record.',
                            status: 'open',
                            category: 'food',
                            urgency: 'medium',
                            approximateGeo: { latitude: 41.85, longitude: -87.93, precisionKm: 1 },
                            updatedAt: '2026-07-11T00:00:00.000Z',
                        },
                    ],
                }),
            });
            return;
        }
        if (apiPath === '/at/aid-posts/close') {
            mutationBodies.push(route.request().postDataJSON());
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    uri: 'at://did:plc:viewer/app.patchwork.aid.post/owned-1',
                    cid: 'cid-closed',
                    record: {
                        $type: 'app.patchwork.aid.post',
                        version: '1.0.0',
                        title: 'Owned request',
                        description: 'Owner can close and delete this record.',
                        category: 'food',
                        urgency: 'medium',
                        status: 'closed',
                        location: {
                            latitude: 41.85,
                            longitude: -87.93,
                            precisionKm: 1,
                        },
                        createdAt: '2026-07-11T00:00:00.000Z',
                        updatedAt: '2026-07-11T01:00:00.000Z',
                    },
                }),
            });
            return;
        }
        if (
            apiPath === '/at/aid-posts' &&
            route.request().method() === 'DELETE'
        ) {
            mutationBodies.push(route.request().postDataJSON());
            await route.fulfill({ status: 204, body: '' });
            return;
        }
        await route.fallback();
    });

    await page.goto('/feed?lat=41.85&lng=-87.93&r=65000');
    await page.getByRole('button', { name: 'Close owned request' }).click();
    await expect(page.getByText('Request closed.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete owned request' }).click();
    await page.getByRole('button', { name: 'Confirm delete request' }).click();

    await expect(page.getByText('Owned request')).toHaveCount(0);
    expect(mutationBodies).toEqual([
        expect.objectContaining({ expectedCid: 'cid-open' }),
        expect.objectContaining({ expectedCid: 'cid-closed' }),
    ]);
    for (const body of mutationBodies) {
        expect(body).not.toHaveProperty('actorDid');
        expect(body).not.toHaveProperty('authorDid');
    }
});

test('owner can recover when private lifecycle transition outpaces public AT sync', async ({
    page,
}) => {
    await page.unroute('**/api/**');
    const postUri =
        'at://did:plc:viewer/app.patchwork.aid.post/sync-recovery-1';
    let syncAttempts = 0;
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const apiPath = url.pathname.replace(/^\/api/, '');
        if (apiPath === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:viewer',
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
        if ((apiPath === '/query/feed' || apiPath === '/query/map')) {
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
                            uri: postUri,
                            cid: 'cid-before-sync',
                            authorDid: 'did:plc:viewer',
                            title: 'Lifecycle sync recovery',
                            summary: 'Private and public status must converge.',
                            status: 'open',
                            category: 'food',
                            urgency: 'medium',
                            approximateGeo: { latitude: 41.85, longitude: -87.93, precisionKm: 1 },
                            updatedAt: '2026-07-11T00:00:00.000Z',
                        },
                    ],
                }),
            });
            return;
        }
        if (apiPath === '/aid/post/lifecycle') {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
                postUri, currentStatus: syncAttempts > 0 ? 'resolved' : 'open',
                validTransitions: syncAttempts > 0 ? ['archived'] : ['resolved'],
                timeline: [], updatedAt: '2026-07-11T01:00:00.000Z',
            }) });
            return;
        }
        if (apiPath === '/aid/post/transition') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    postUri,
                    previousStatus: 'open',
                    currentStatus: 'resolved',
                    transition: {
                        from: 'open',
                        to: 'resolved',
                        actorDid: 'did:plc:viewer',
                        actorRole: 'requester',
                        timestamp: '2026-07-11T01:00:00.000Z',
                    },
                    timeline: [],
                    updatedAt: '2026-07-11T01:00:00.000Z',
                }),
            });
            return;
        }
        if (apiPath === '/at/aid-posts/status/reconcile') {
            syncAttempts += 1;
            if (syncAttempts === 1) {
                await route.fulfill({
                    status: 503,
                    contentType: 'application/json',
                    body: JSON.stringify({
                        error: {
                            code: 'PDS_UNAVAILABLE',
                            message: 'The AT server is temporarily unavailable.',
                            retryable: true,
                        },
                    }),
                });
                return;
            }
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    uri: postUri,
                    cid: 'cid-after-sync',
                    record: {
                        $type: 'app.patchwork.aid.post',
                        version: '1.0.0',
                        title: 'Lifecycle sync recovery',
                        description: 'Private and public status must converge.',
                        category: 'food',
                        urgency: 'medium',
                        status: 'resolved',
                        location: {
                            latitude: 41.85,
                            longitude: -87.93,
                            precisionKm: 1,
                        },
                        createdAt: '2026-07-11T00:00:00.000Z',
                        updatedAt: '2026-07-11T01:00:00.000Z',
                    },
                }),
            });
            return;
        }
        await route.fallback();
    });

    await page.goto('/feed?lat=41.85&lng=-87.93&r=65000');
    await page
        .getByRole('button', { name: 'Resolve: Lifecycle sync recovery' })
        .click();
    await expect(
        page.getByText(/The request was saved. Its public listing still needs to be synchronized./),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Retry public update' }).click();

    await expect(
        page.getByText(/The request was saved. Its public listing still needs to be synchronized./),
    ).toHaveCount(0);
    await expect(page.getByText('The change was saved. Public discovery is updating.')).toBeVisible();
    expect(syncAttempts).toBe(2);
});
