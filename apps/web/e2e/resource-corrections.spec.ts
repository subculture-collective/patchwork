import { test, expect } from '@playwright/test';
test('anonymous correction retries, private receipt recovery and reviewer follow-up', async ({
    page,
}) => {
    const uri =
        'at://did:plc:correction/app.patchwork.directory.resource/office';
    const resource = {
        uri,
        authorDid: 'did:plc:correction',
        name: 'Public office',
        category: 'other',
        serviceArea: 'Chicago',
        status: 'unverified',
        operationalStatus: 'unknown',
        contact: { url: 'https://example.org' },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let receipt = '';
    let attempts = 0;
    let status = 'needs-information';
    await page.route('**/api/**', (route) => {
        const url = route.request().url();
        const body = route.request().postDataJSON() ?? {};
        calls.push({ url, body });
        if (url.includes('/query/directory'))
            return route.fulfill({
                json: {
                    results: [resource],
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                },
            });
        if (url.endsWith('/resource-corrections')) {
            receipt = String(body.receipt);
            attempts++;
            return route.fulfill(
                attempts === 1
                    ? {
                          status: 503,
                          json: {
                              error: {
                                  code: 'UNAVAILABLE',
                                  message: 'Try again.',
                              },
                          },
                      }
                    : { json: { id: '123' } },
            );
        }
        if (url.endsWith('/resource-corrections/status'))
            return route.fulfill(
                body.receipt === receipt
                    ? {
                          json: {
                              correction: {
                                  id: '123',
                                  resource_uri: uri,
                                  category: 'contact',
                                  explanation: 'The phone number is incorrect.',
                                  status,
                                  revision: 2,
                                  response:
                                      'Please provide an official source.',
                              },
                          },
                      }
                    : {
                          status: 404,
                          json: { error: { message: 'Receipt unavailable.' } },
                      },
            );
        if (url.endsWith('/resource-corrections/respond')) {
            status = 'pending';
            return route.fulfill({ json: { updated: true } });
        }
        return route.fulfill({
            status: 401,
            json: {
                error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' },
            },
        });
    });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/resources?resource=' + encodeURIComponent(uri));
    await page
        .getByText('Report incorrect listing information', { exact: true })
        .click();
    await page
        .getByLabel('Explain the correction', { exact: true })
        .fill('The phone number is incorrect.');
    await page
        .getByRole('button', { name: 'Submit correction', exact: true })
        .click();
    await expect(page.getByText('Try again.', { exact: true })).toBeVisible();
    const originalReceipt = receipt;
    await page
        .getByRole('button', { name: 'Submit correction', exact: true })
        .click();
    await expect(
        page.getByText(
            'Correction received. Save your private receipt to check its status.',
            { exact: true },
        ),
    ).toBeVisible();
    expect(receipt).toBe(originalReceipt);
    expect(receipt).toMatch(/^[a-f0-9]{64}$/);
    expect(
        await page.evaluate(() =>
            JSON.stringify({ ...localStorage, ...sessionStorage }),
        ),
    ).not.toContain(receipt);
    expect(calls.every((call) => !call.url.includes(receipt))).toBe(true);
    await page.reload();
    await page
        .getByText('Report incorrect listing information', { exact: true })
        .click();
    await expect(
        page.getByLabel('Private correction receipt', { exact: true }),
    ).toHaveValue('');
    await page
        .getByLabel('Private correction receipt', { exact: true })
        .fill(receipt);
    await page
        .getByRole('button', { name: 'Check correction status', exact: true })
        .click();
    await expect(
        page.getByText('More information requested', { exact: true }),
    ).toBeVisible();
    await page
        .getByLabel('Additional information requested by the reviewer', {
            exact: true,
        })
        .fill('The official site now lists the correct phone number.');
    await page
        .getByRole('button', {
            name: 'Send additional information',
            exact: true,
        })
        .click();
    await expect(
        page.getByText('Awaiting review', { exact: true }),
    ).toBeVisible();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    expect(
        await page.evaluate(() =>
            JSON.stringify({ ...localStorage, ...sessionStorage }),
        ),
    ).not.toContain(receipt);
});

test('independent reviewer reloads a stale listing before applying a sourced correction', async ({
    page,
}) => {
    const uri =
        'at://did:plc:correction/app.patchwork.directory.resource/office';
    let decided = false;
    let attempts = 0;
    let updatedAt = '2026-09-01T00:00:00.000Z';
    const commands: Record<string, unknown>[] = [];
    await page.route('**/api/**', (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api/, '');
        if (path === '/auth/session')
            return route.fulfill({
                json: {
                    session: {
                        did: 'did:plc:reviewer',
                        handle: 'reviewer.test',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    },
                },
            });
        if (path === '/account/onboarding')
            return route.fulfill({
                json: {
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    consentRequired: false,
                    acceptedAt: '2026-07-28T12:00:00.000Z',
                },
            });
        if (path === '/organizations')
            return route.fulfill({ json: { organizations: [] } });
        if (path === '/organizations/resource-claims')
            return route.fulfill({ json: { claims: [], reviewer: true } });
        if (
            path === '/resource-corrections/review' &&
            route.request().method() === 'GET'
        )
            return route.fulfill({
                json: {
                    items: decided
                        ? []
                        : [
                              {
                                  id: '64fd03ef-189d-4fba-8d56-be571342ff46',
                                  resource_uri: uri,
                                  category: 'contact',
                                  explanation:
                                      'The listed phone number is incorrect.',
                                  status: 'pending',
                                  revision: 1,
                              },
                          ],
                    page: 1,
                    hasNextPage: false,
                },
            });
        if (path === '/resource-corrections/review') {
            commands.push(route.request().postDataJSON());
            attempts++;
            if (attempts === 1) {
                updatedAt = '2026-09-02T00:00:00.000Z';
                return route.fulfill({
                    status: 409,
                    json: {
                        error: {
                            code: 'RESOURCE_REVISION_CONFLICT',
                            message:
                                'The listing changed. Reload it before applying.',
                        },
                    },
                });
            }
            decided = true;
            return route.fulfill({ json: { updated: true } });
        }
        if (path === '/query/directory' || path === '/query/directory-resource')
            return route.fulfill({
                json: {
                    results: [
                        {
                            uri,
                            authorDid: 'did:plc:correction',
                            name: 'Public office',
                            category: 'other',
                            serviceArea: 'Chicago',
                            status: 'unverified',
                            operationalStatus: 'unknown',
                            contact: {
                                url: 'https://example.org',
                                phone: '111',
                            },
                            createdAt: '2026-09-01T00:00:00.000Z',
                            updatedAt,
                        },
                    ],
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                },
            });
        return route.fulfill({
            status: 404,
            json: { error: { message: 'Unavailable.' } },
        });
    });
    await page.goto('/organizations');
    await page
        .getByRole('button', { name: 'View resource claims', exact: true })
        .click();
    await page
        .getByRole('combobox', { name: 'Review decision', exact: true })
        .selectOption('applied');
    const save = page.getByRole('button', {
        name: 'Save correction decision',
        exact: true,
    });
    await expect(save).toBeDisabled();
    await page
        .getByRole('button', {
            name: 'Load current listing before applying',
            exact: true,
        })
        .click();
    await expect(save).toBeEnabled();
    await page
        .getByRole('combobox', { name: 'Field to correct', exact: true })
        .selectOption('phone');
    await page.getByLabel('Corrected information', { exact: true }).fill('222');
    await page
        .getByLabel('Verified public source link', { exact: true })
        .fill('https://example.org/contact');
    await page
        .getByLabel(
            'Response visible to the person who submitted this correction',
            { exact: true },
        )
        .fill('Verified the new phone number with the public provider page.');
    await save.click();
    await expect(
        page.getByText('The listing changed. Reload it before applying.', {
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole('button', {
            name: 'Load current listing before applying',
            exact: true,
        })
        .click();
    await save.click();
    await expect(
        page.getByText('No corrections to show.', { exact: true }),
    ).toBeVisible();
    expect(commands).toHaveLength(2);
    expect(commands[0]?.expectedUpdatedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(commands[1]?.expectedUpdatedAt).toBe('2026-09-02T00:00:00.000Z');
    expect(commands[1]?.patch).toEqual({
        contact: { url: 'https://example.org', phone: '222' },
    });
});
