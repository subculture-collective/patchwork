import { test, expect } from '@playwright/test';

test('save a public search, reload activity, reopen it and remove it without retaining precise location', async ({
    page,
    baseURL,
}) => {
    await page
        .context()
        .addCookies([
            { name: 'patchwork_csrf', value: 'test-csrf', url: baseURL! },
        ]);
    const saved: Record<string, unknown>[] = [];
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/auth/session'))
            return route.fulfill({
                json: {
                    session: {
                        did: 'did:plc:saved-user',
                        handle: 'saved.test',
                        expiresAt: '2099-01-01T00:00:00Z',
                    },
                },
            });
        if (path.endsWith('/account/onboarding'))
            return route.fulfill({
                json: {
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    consentRequired: false,
                    acceptedAt: '2026-09-01T00:00:00Z',
                },
            });
        if (path.endsWith('/account/saved-discovery')) {
            if (route.request().method() === 'PUT') {
                const body = route.request().postDataJSON();
                expect(body.search.center).toEqual({ lat: 41.85, lng: -87.67 });
                expect(body.search).not.toHaveProperty('eligibility');
                saved.push({
                    id: '8f7f1b75-3f3b-42c6-9847-f9382bf189a2',
                    ...body,
                    createdAt: '2026-09-10T00:00:00Z',
                });
                return route.fulfill({ json: { id: saved[0]!.id } });
            }
            if (route.request().method() === 'DELETE') {
                saved.length = 0;
                return route.fulfill({ json: { removed: true } });
            }
            return route.fulfill({ json: { items: saved } });
        }
        if (path.includes('/query/'))
            return route.fulfill({
                json: {
                    results: [],
                    total: 0,
                    page: 1,
                    pageSize: 100,
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
    await page.goto(
        '/nearby?nearby=resources&lat=41.851234&lng=-87.671234&r=5000&program=wic',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page
        .getByRole('button', { name: 'Resources (0)', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Save search', exact: true })
        .click();
    await expect(
        page.getByRole('button', { name: 'Saved', exact: true }),
    ).toBeDisabled();
    await page
        .getByRole('link', { name: 'View saved items', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Load saved items', exact: true })
        .click();
    await expect(
        page.getByRole('link', { name: 'Saved search · wic', exact: true }),
    ).toHaveAttribute('href', /lat=41.85/);
    await page.reload();
    await page
        .getByRole('button', { name: 'Load saved items', exact: true })
        .click();
    await page
        .getByRole('link', { name: 'Saved search · wic', exact: true })
        .click();
    expect(new URL(page.url()).searchParams.get('program')).toBe('wic');
    expect(new URL(page.url()).searchParams.get('lat')).toBe('41.85');
    await page.goto('/activity#saved-discovery');
    await page
        .getByRole('button', { name: 'Load saved items', exact: true })
        .click();
    await page
        .getByRole('button', { name: 'Remove Saved search · wic', exact: true })
        .click();
    await expect(
        page.getByRole('link', { name: 'Saved search · wic', exact: true }),
    ).toHaveCount(0);
});
