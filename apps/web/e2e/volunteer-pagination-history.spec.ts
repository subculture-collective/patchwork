import { expect, test } from '@playwright/test';

const profile = (page: number) => ({
    uri: `at://did:plc:helper-${page}/app.patchwork.volunteer.profile/profile-${page}`,
    cid: `bafy-${page}`,
    authorDid: `did:plc:helper-${page}`,
    displayName: `Helper ${page}`,
    bio: 'Public volunteer profile.',
    capabilities: ['food-delivery'],
    availability: 'within-24h',
    contactPreference: 'chat-only',
    skills: [],
    languages: ['en'],
    serviceArea: null,
    updatedAt: '2026-08-07T12:00:00.000Z',
});

test('volunteer pagination restores page one on browser Back without replaying page two', async ({ page }) => {
    const requestedPages: string[] = [];
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api/, '');
        const fulfill = (body: unknown) => route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(body),
        });
        // This is a public discovery journey. Introducing a session also
        // introduces onboarding remounts, whose reads are unrelated to Back.
        if (path === '/auth/session') return route.fulfill({ status: 401, json: { error: { code: 'AUTHENTICATION_REQUIRED' } } });
        if (path === '/query/volunteers') {
            const requested = url.searchParams.get('page') ?? '1';
            requestedPages.push(requested);
            const current = Number(requested);
            return fulfill({
                page: current,
                pageSize: 20,
                total: 2,
                hasNextPage: current === 1,
                results: [profile(current)],
            });
        }
        return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } }) });
    });

    await page.goto('/volunteer');
    await expect(page.getByText('Helper 1')).toBeVisible();
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(page).toHaveURL(/\/volunteer\?page=2/);
    await expect(page.getByText('Helper 2')).toBeVisible();
    const pageTwoRequests = requestedPages.filter(value => value === '2').length;
    expect(pageTwoRequests).toBeGreaterThan(0);
    // Snapshot immediately before Back, after the requested page rendered.
    const initialPageOneRequests = requestedPages.filter(value => value === '1').length;
    expect(initialPageOneRequests).toBeGreaterThan(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/volunteer$/);
    await expect(page.getByText('Helper 1')).toBeVisible();
    await expect.poll(
        () => requestedPages.filter(value => value === '1').length,
    ).toBe(initialPageOneRequests + 1);
    expect(requestedPages.filter(value => value === '2')).toHaveLength(pageTwoRequests);
});
