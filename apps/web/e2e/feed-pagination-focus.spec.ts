import { expect, test } from '@playwright/test';

test('feed pagination announces appended records, preserves focus, and restores page one', async ({
    page,
}) => {
    const requestedPages: number[] = [];
    await page.route('**/api/**', async route => {
        const requestUrl = new URL(route.request().url());
        const path = requestUrl.pathname.replace(/^\/api/, '');
        const fulfill = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        if (path === '/auth/session') {
            return fulfill({
                session: {
                    did: 'did:plc:pagination-reviewer',
                    expiresAt: '2099-01-01T00:00:00.000Z',
                },
            });
        }
        if (path === '/account/onboarding') {
            return fulfill({
                policyVersion: '2026-07-28',
                requiredDocuments: [],
                consentRequired: false,
                acceptedAt: '2026-08-08T00:00:00.000Z',
            });
        }
        if (path === '/query/feed') {
            const requestedPage = Number(requestUrl.searchParams.get('page') ?? 1);
            requestedPages.push(requestedPage);
            const indices = requestedPage === 1
                ? Array.from({ length: 20 }, (_, index) => index + 1)
                : [21];
            return fulfill({
                total: 21,
                page: requestedPage,
                pageSize: 20,
                hasNextPage: requestedPage === 1,
                results: indices.map(index => ({
                    uri: `at://did:plc:author/app.patchwork.aid.post/${index}`,
                    authorDid: 'did:plc:author',
                    title: 'Same titled request',
                    summary: `Request ${index}`,
                    category: 'food',
                    status: 'open',
                    urgency: 'medium',
                    createdAt: '2026-08-08T00:00:00.000Z',
                    updatedAt: '2026-08-08T00:00:00.000Z',
                    recordOrigin: 'sourced-public',
                })),
            });
        }
        return fulfill(
            { error: { code: 'NOT_FOUND', message: 'Not found.' } },
            404,
        );
    });

    await page.goto('/feed', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', {
        name: 'Report Same titled request, item 1 of 20',
    })).toBeVisible();
    await expect(page.getByRole('button', {
        name: 'Report Same titled request, item 2 of 20',
    })).toBeVisible();

    const loadMore = page.getByRole('button', { name: 'Load more' });
    await loadMore.click();
    await expect(page).toHaveURL(/(?:\?|&)page=2(?:&|$)/);
    await expect(page.getByText('Loaded items 21 through 21.')).toBeVisible();
    await expect(page.getByText('21 / 21 loaded')).toBeFocused();

    await page.goBack();
    await expect(page).not.toHaveURL(/(?:\?|&)page=2(?:&|$)/);
    await expect.poll(() => requestedPages.filter(value => value === 1).length).toBeGreaterThan(1);
    await expect(page.getByText('20 / 21 loaded')).toBeVisible();
});
