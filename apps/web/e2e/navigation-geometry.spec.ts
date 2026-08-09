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

        const toggle = page.getByRole('button', { name: /menu/i });
        if (width <= 900) {
            await expect(toggle).toBeVisible();
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            const mapLink = page.getByRole('link', { name: /map/i }).first();
            await expect(mapLink).toBeVisible();
            await mapLink.click();
            await expect(page).toHaveURL(/\/map/);
        } else {
            await expect(page.getByRole('link', { name: /map/i }).first()).toBeVisible();
        }
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

    const chatLink = page.getByRole('link', { name: 'Chat', exact: true });
    await expect(chatLink).toBeVisible();
    const bounds = await chatLink.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await chatLink.click();
    await expect(page).toHaveURL(/\/chat/);
});

test('secondary routes remain visible at 200 percent text sizing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: /menu/i }).click();

    for (const name of ['Chat', 'Groups', 'Volunteer', 'Organizations']) {
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

    const groupsLink = page.getByRole('link', { name: 'Groups', exact: true });
    await expect(groupsLink).toBeVisible();
    const isForeground = await groupsLink.evaluate(element => {
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
