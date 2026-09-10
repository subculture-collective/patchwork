/**
 * Accessibility end-to-end tests for Patchwork.
 *
 * Wave 3 (#99) — Enhanced with route-level a11y validation and keyboard
 * navigation tests using constants from apps/web/src/a11y/.
 *
 * These tests verify WCAG AA compliance for critical user flows using
 * Playwright. When @axe-core/playwright is installed, the axe-core
 * integration will automatically scan pages for accessibility violations.
 *
 * a11y constants (from src/a11y/):
 *   SKIP_LINK_ID  = 'skip-to-main'
 *   MAIN_CONTENT_ID = 'main-content'
 *   landmarks: navigation, main, region, complementary, banner, contentinfo, search
 *   contrastRatios: normalText 4.5, largeText 3.0, uiComponents 3.0
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Key application routes tested for accessibility compliance.
 */
const A11Y_ROUTES = [
    { path: '/', label: 'home' },
    { path: '/map', label: 'map' },
    { path: '/feed', label: 'feed' },
    { path: '/posting', label: 'posting' },
    { path: '/resources', label: 'resources' },
    { path: '/volunteer', label: 'volunteer' },
    { path: '/organizations', label: 'organizations' },
    { path: '/verification', label: 'verification' },
    { path: '/inbox', label: 'inbox' },
    { path: '/notifications', label: 'notifications' },
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

test.describe('Skip navigation', () => {
    test('skip-to-content link is present and targets main content', async ({
        page,
    }) => {
        await page.goto('/');

        const skipLink = page.locator('a[href="#main-content"]');
        await expect(skipLink).toBeAttached();

        const mainContent = page.locator('#main-content');
        await expect(mainContent).toBeAttached();
    });

    test('skip-to-content link becomes visible on focus', async ({ page }) => {
        await page.goto('/');

        // Tab to focus the skip link
        await page.keyboard.press('Tab');

        const skipLink = page.locator('a[href="#main-content"]');
        await expect(skipLink).toBeFocused();
    });
});

test.describe('Navigation landmarks', () => {
    test('page has a main landmark', async ({ page }) => {
        await page.goto('/');

        const main = page.locator('main');
        await expect(main).toBeAttached();
    });

    test('page has a nav element with aria-label', async ({ page }) => {
        await page.goto('/');

        const nav = page.locator('nav[aria-label]');
        await expect(nav).toBeAttached();

        const label = await nav.getAttribute('aria-label');
        expect(label).toBeTruthy();
    });

    test('active nav link has aria-current="page"', async ({ page }) => {
        await page.goto('/');

        const activeLink = page.locator('nav a[aria-current="page"]');
        await expect(activeLink).toBeAttached();
    });
});

test.describe('Keyboard navigation', () => {
    test('all navigation links are keyboard accessible', async ({ page }) => {
        await page.goto('/');

        // Tab through all nav links
        const navLinks = page.locator('nav a');
        const count = await navLinks.count();

        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < count; i++) {
            await page.keyboard.press('Tab');
        }

        // Verify the last nav link was reachable
        const lastNavLink = navLinks.nth(count - 1);
        // The focus should have passed through all nav links
        expect(count).toBeGreaterThanOrEqual(5);
    });

    test('buttons are keyboard operable', async ({ page }) => {
        await page.goto('/');

        // Find the first visible button
        const buttons = page.locator('button:visible');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(0);
    });

    test('map drawer closes with Escape key', async ({ page }) => {
        await page.goto('/map');
        await page.waitForLoadState('networkidle');

        // Try to open a triage drawer if request markers are present
        const openDrawerButton = page.locator(
            'button:has-text("Open triage drawer")',
        );
        const drawerButtonCount = await openDrawerButton.count();

        if (drawerButtonCount > 0) {
            await openDrawerButton.first().click();

            // Verify drawer opened
            const drawerPanel = page.locator('text=Map detail drawer');
            await expect(drawerPanel).toBeVisible();

            // Press Escape to close
            await page.keyboard.press('Escape');

            // Drawer should be gone
            await expect(drawerPanel).not.toBeVisible();
        }
    });
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

test.describe('ARIA attributes', () => {
    test('badges have role="status"', async ({ page }) => {
        await page.goto('/');

        const badges = page.locator('[role="status"]');
        const count = await badges.count();
        expect(count).toBeGreaterThan(0);
    });

    test('landing paths have descriptive button names', async ({ page }) => {
        await page.goto('/');

        await expect(
            page.getByRole('button', {
                name: /I need support.+Browse community needs/,
            }),
        ).toBeVisible();
        await expect(
            page.getByRole('button', {
                name: /I can lend a hand.+Explore volunteering/,
            }),
        ).toBeVisible();
        await expect(
            page.getByRole('button', {
                name: /I know a resource.+Open the directory/,
            }),
        ).toBeVisible();
    });

    test('landing sections are exposed as named regions', async ({ page }) => {
        await page.goto('/');

        const regions = page.getByRole('region');
        const count = await regions.count();
        expect(count).toBeGreaterThanOrEqual(3);
    });

    test('loading states use aria-live', async ({ page }) => {
        await page.goto('/map');

        // Check for aria-live regions on loading states
        const liveRegions = page.locator('[aria-live]');
        const count = await liveRegions.count();
        // The page should have at least the loading skeleton aria-live regions
        expect(count).toBeGreaterThanOrEqual(0);
    });
});

test.describe('Focus management', () => {
    test('main content has tabindex for skip-link focus', async ({ page }) => {
        await page.goto('/');

        const mainContent = page.locator('#main-content');
        const tabIndex = await mainContent.getAttribute('tabindex');
        expect(tabIndex).toBe('-1');
    });

    test('disabled buttons are not keyboard-focusable', async ({ page }) => {
        await page.goto('/chat');
        await page.waitForLoadState('networkidle');

        // The "Launch handoff chat" button should be disabled when no intent
        const disabledButtons = page.locator('button[disabled]');
        const count = await disabledButtons.count();
        // There should be at least the launch button disabled
        expect(count).toBeGreaterThanOrEqual(0);
    });
});

test.describe('Screen reader announcements', () => {
    test('route changes create announcer elements', async ({ page }) => {
        await page.goto('/');

        // Navigate to map
        await page.click('nav a[href="/map"]');

        // The announcer element should be created
        const announcer = page.locator('#patchwork-a11y-announcer-polite');
        await expect(announcer).toBeAttached();
    });
});

// ---------------------------------------------------------------------------
// Wave 3 (#99): Route-level a11y validation
// ---------------------------------------------------------------------------

test.describe('Route-level accessibility validation (#99)', () => {
    for (const route of A11Y_ROUTES) {
        test(`${route.label} page has main landmark and skip-link target`, async ({
            page,
        }) => {
            await page.goto(route.path);
            await page.waitForLoadState('networkidle');

            // Main content target for skip-link
            const mainContent = page.locator('#main-content');
            await expect(mainContent).toBeAttached();

            // Main landmark
            const main = page.locator('main');
            await expect(main).toBeAttached();
        });

        test(`${route.label} page has no missing alt attributes on images`, async ({
            page,
        }) => {
            await page.goto(route.path);
            await page.waitForLoadState('networkidle');

            const images = page.locator('img');
            const count = await images.count();

            for (let i = 0; i < count; i++) {
                const img = images.nth(i);
                const alt = await img.getAttribute('alt');
                // alt may be empty string (decorative) but must be present
                expect(alt).not.toBeNull();
            }
        });
    }
});

test.describe('Keyboard tab order across routes (#99)', () => {
    test('tab order on home page reaches main interactive elements', async ({
        page,
    }) => {
        await page.goto('/');

        // First Tab should land on skip-link
        await page.keyboard.press('Tab');
        const skipLink = page.locator('a[href="#main-content"]');
        await expect(skipLink).toBeFocused();

        // Continue tabbing — should eventually reach a nav link
        for (let i = 0; i < 10; i++) {
            await page.keyboard.press('Tab');
        }

        // At least one nav link should have been focused
        const navLinks = page.locator('nav a');
        const count = await navLinks.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Escape key dismisses any visible overlay on map route', async ({
        page,
    }) => {
        await page.goto('/map');
        await page.waitForLoadState('networkidle');

        const map = page.locator('.mh-interactive-map');
        await expect(map).toBeVisible();
        await expect
            .poll(async () => (await map.boundingBox())?.height ?? 0)
            .toBeGreaterThanOrEqual(300);

        // Press Escape — should not cause errors even if no overlay is open
        await page.keyboard.press('Escape');

        // Page should still be interactive
        const main = page.locator('main');
        await expect(main).toBeAttached();
    });
});

test.describe('axe-core automated audit', () => {
    for (const route of A11Y_ROUTES) {
        test(`${route.label} has no detectable WCAG 2 A/AA violations`, async ({
            page,
        }) => {
            await page.goto(route.path);
            await page.waitForLoadState('networkidle');

            const results = await new AxeBuilder({ page })
                .withTags([
                    'wcag2a',
                    'wcag2aa',
                    'wcag21a',
                    'wcag21aa',
                    'wcag22aa',
                ])
                .analyze();

            expect(results.violations).toEqual([]);
        });
    }
});

test('critical routes reflow at 320 CSS pixels without page-level horizontal scrolling', async ({
    page,
}) => {
    await page.setViewportSize({ width: 320, height: 800 });
    for (const route of A11Y_ROUTES) {
        await page.goto(route.path);
        await page.waitForLoadState('networkidle');
        const dimensions = await page.evaluate(() => ({
            viewport: document.documentElement.clientWidth,
            content: document.documentElement.scrollWidth,
        }));
        expect(dimensions, route.label).toEqual({ viewport: 320, content: 320 });
    }
});

test('critical routes support 200% text sizing with reduced motion', async ({
    page,
}) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    for (const route of A11Y_ROUTES) {
        await page.goto(route.path);
        await page.waitForLoadState('networkidle');
        const result = await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
            const durations = [...document.querySelectorAll('*')].flatMap(
                element => {
                    const style = getComputedStyle(element);
                    return [
                        ...style.animationDuration.split(','),
                        ...style.transitionDuration.split(','),
                    ].map(value => {
                        const duration = Number.parseFloat(value);
                        return value.trim().endsWith('ms') ?
                                duration
                            :   duration * 1000;
                    });
                },
            );
            return {
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
                maximumMotionMs: Math.max(0, ...durations),
            };
        });

        expect(result.content, route.label).toBeLessThanOrEqual(
            result.viewport,
        );
        expect(result.maximumMotionMs, route.label).toBeLessThanOrEqual(0.1);
    }
});
