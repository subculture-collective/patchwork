import { expect, test } from '@playwright/test';

const widths = [320, 360, 390, 768, 1024] as const;

test('authenticated navigation identifies the account by handle, not DID', async ({ page }) => {
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
        if (path === '/auth/session') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:navigation-user',
                        handle: 'neighbor.example',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    },
                }),
            });
        }
        if (path === '/account/onboarding') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    consentRequired: false,
                    acceptedAt: '2026-08-09T00:00:00.000Z',
                }),
            });
        }
        return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } }),
        });
    });

    await page.goto('/');
    await expect(page.getByText('@neighbor.example', { exact: true })).toBeVisible();
    await expect(page.getByText('did:plc:navigation-user', { exact: true })).toHaveCount(0);
});

for (const width of widths) {
    test(`primary navigation remains reachable at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/');

        const geometry = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            content: document.documentElement.scrollWidth,
        }));
        expect(geometry.content).toBeLessThanOrEqual(geometry.viewport);

        const navigation = page.getByRole('navigation', { name: 'Primary flows' });
        for (const name of ['Nearby', 'Ask', 'Resources', 'My activity']) {
            await expect(navigation.getByRole('link', { name, exact: true })).toBeVisible();
        }
        await navigation.getByRole('link', { name: 'Nearby', exact: true }).click();
        await expect(page).toHaveURL(/\/nearby\?.*view=list/);
        await page.getByRole('navigation', { name: 'Nearby view' }).getByRole('link', { name: 'Map', exact: true }).click();
        await expect(page).toHaveURL(/\/nearby\?.*view=map/);
        await expect(navigation.getByRole('link', { name: 'Nearby', exact: true })).toHaveAttribute('aria-current', 'page');

    });
}

test('mobile navigation closes on Escape and restores focus to its toggle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /menu/i });
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
});

test('secondary routes stay inside the mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/');

    await page.getByRole('button', { name: /menu/i }).click();

    const organizationsLink = page.getByRole('link', { name: 'Organizations', exact: true });
    await expect(organizationsLink).toBeVisible();
    const bounds = await organizationsLink.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await organizationsLink.click();
    await expect(page).toHaveURL(/\/organizations/);
});

test('secondary routes remain visible at 200 percent text sizing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: /menu/i }).click();

    for (const name of ['Volunteer', 'Organizations']) {
        const link = page.getByRole('link', { name, exact: true });
        await expect(link).toBeVisible();
        const bounds = await link.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
});

test('desktop secondary navigation renders above page content', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');

    const toggle = page.getByRole('button', { name: 'More', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const organizationsLink = page.getByRole('link', { name: 'Organizations', exact: true });
    await expect(organizationsLink).toBeVisible();
    const isForeground = await organizationsLink.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2,
        );
        return hit === element || element.contains(hit);
    });
    expect(isForeground).toBe(true);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
});

test('legacy discovery aliases canonicalize without trapping browser Back', async ({ page }) => {
    await page.goto('/');
    await page.goto('/map?dataset=demo&category=food&lat=41.85&lng=-87.93&r=20000');
    await expect(page).toHaveURL(/\/nearby\?.*view=map/);
    expect(new URL(page.url()).searchParams.get('dataset')).toBe('demo');
    await page.getByRole('navigation', { name: 'Nearby view' }).getByRole('link', { name: 'List', exact: true }).click();
    await expect(page).toHaveURL(/view=list/);
    expect(new URL(page.url()).searchParams.get('dataset')).toBe('demo');
    await page.goBack();
    await expect(page).toHaveURL(/view=map/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
});

test('activity aliases retain the selected connection', async ({ page }) => {
    await page.goto('/inbox?connection=handoff-target');
    await expect(page).toHaveURL(/\/activity\?/);
    expect(new URL(page.url()).searchParams.get('connection')).toBe('handoff-target');
});

test('map filter changes retain dataset and can be undone through Back', async ({ page }) => {
    await page.goto('/nearby?view=map&dataset=demo&lat=41.85&lng=-87.93&r=20000');
    await page.locator('summary').filter({ hasText: 'Location and filters' }).click();
    const before = page.url();
    await page.getByRole('button', { name: 'Food', exact: true }).click();
    expect(new URL(page.url()).searchParams.get('dataset')).toBe('demo');
    expect(page.url()).not.toBe(before);
    await page.goBack();
    await expect(page).toHaveURL(before);
});
