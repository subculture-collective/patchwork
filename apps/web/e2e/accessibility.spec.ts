import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Canonical routes only; alias and browser-history behavior belongs to navigation tests.
const A11Y_ROUTES = [
    { path: '/', label: 'home' },
    { path: '/nearby', label: 'nearby' },
    { path: '/posting', label: 'posting' },
    { path: '/resources', label: 'resources' },
    { path: '/volunteer', label: 'volunteer' },
    { path: '/organizations', label: 'organizations' },
    { path: '/verification', label: 'verification' },
    { path: '/activity', label: 'activity' },
    { path: '/moderation', label: 'moderation' },
    { path: '/chat', label: 'chat' },
    { path: '/settings', label: 'settings' },
    { path: '/login', label: 'login' },
    { path: '/legal/terms', label: 'terms' },
    { path: '/legal/privacy', label: 'privacy policy' },
    {
        path: '/legal/community-guidelines',
        label: 'community guidelines',
    },
] as const;

test('keyboard users can skip navigation and activate Nearby', async ({ page }) => {
    await page.goto('/');
    const skip = page.locator('a[href="#main-content"]');
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    // Start a fresh document to test the natural tab order, not programmatic focus.
    await page.goto('/');
    const nearby = page.getByRole('navigation', { name: 'Primary flows' })
        .getByRole('link', { name: 'Nearby', exact: true });
    for (let step = 0; step < 12; step++) {
        await page.keyboard.press('Tab');
        if (await nearby.evaluate(element => element === document.activeElement)) break;
    }
    await expect(nearby).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/nearby(?:\?|$)/);
    await expect(nearby).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('#patchwork-a11y-announcer-polite')).not.toBeEmpty();
});

test.describe('Form accessibility', () => {
    test('AT login form inputs have associated labels', async ({ page }) => {
        await page.goto('/login?returnTo=%2Fposting');
        await page.waitForLoadState('networkidle');

        // Check that label-input associations exist
        const labels = page.locator('label[for]');
        const labelCount = await labels.count();

        expect(labelCount).toBeGreaterThan(0);

        for (let i = 0; i < labelCount; i++) {
            const label = labels.nth(i);
            const forAttr = await label.getAttribute('for');
            if (forAttr) {
                const inputExists = await page.evaluate(
                    inputId => document.getElementById(inputId) !== null,
                    forAttr,
                );
                expect(inputExists).toBe(true);
            }
        }
        await expect(
            page.getByRole('button', { name: 'Continue with Bluesky' }),
        ).toBeVisible();
    });

    test('volunteer discovery is public and account editing requires sign-in', async ({ page }) => {
        await page.goto('/volunteer');
        await page.waitForLoadState('networkidle');
        await expect(
            page.getByRole('heading', { name: 'Volunteer profiles' }),
        ).toBeVisible();
        await expect(
            page.getByLabel('Search public profiles'),
        ).toBeVisible();
        await expect(
            page.getByRole('region', { name: 'Sign in to volunteer' }),
        ).toBeVisible();
        await expect(page.getByLabel('Private contact email')).toHaveCount(0);
    });

    test('chat requires authentication before any conversation data or mutation UI', async ({
        page,
    }) => {
        await page.goto('/chat');
        await expect(
            page.getByRole('region', { name: 'Sign in required' }),
        ).toBeVisible();
        await expect(
            page.getByRole('link', { name: 'Sign in to continue' }),
        ).toBeVisible();
        await expect(page.locator('#main-content').getByRole('button')).toHaveCount(0);
        await expect(page.locator('#main-content form')).toHaveCount(0);
    });
});

for (const route of A11Y_ROUTES) {
    test(`${route.label}: accessible structure, reflow, text sizing and reduced motion`, async ({ page }) => {
        await page.goto(route.path);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('main')).toBeVisible();
        await expect(page.locator('#main-content')).toBeVisible();
        await expect(page.locator('img:not([alt])')).toHaveCount(0);
        const audit = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
            .analyze();
        expect(audit.violations).toEqual([]);

        await page.setViewportSize({ width: 320, height: 800 });
        await expect.poll(() => page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )).toBeLessThanOrEqual(0);

        await page.setViewportSize({ width: 1280, height: 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await expect.poll(() => page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        )).toBeLessThanOrEqual(0);
        const motion = await page.evaluate(() => Math.max(0,
            ...[...document.querySelectorAll('*')].flatMap(element => {
                const style = getComputedStyle(element);
                return [...style.animationDuration.split(','), ...style.transitionDuration.split(',')]
                    .map(value => Number.parseFloat(value) * (value.trim().endsWith('ms') ? 1 : 1000));
            }),
        ));
        expect(motion).toBeLessThanOrEqual(0.1);
    });
}
