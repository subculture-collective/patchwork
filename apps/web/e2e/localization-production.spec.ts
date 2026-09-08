import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const actor = 'did:plc:localization-browser-actor';
const peer = 'did:plc:localization-browser-peer';
const connectionId = '51111111-1111-4111-8111-111111111111';

const routes = {
    en: [
        ['/', 'Patchwork'],
        ['/nearby', 'Nearby'],
        ['/posting', 'Ask for help'],
        ['/resources', 'Resource directory'],
        ['/volunteer', 'Volunteer profiles'],
        ['/organizations', 'Organizations'],
        ['/verification', 'Verification'],
        ['/inbox', 'My activity'],
        ['/scheduling', 'Connection scheduling'],
        ['/notifications', 'Notification center'],
        ['/moderation', 'Moderator safety console'],
        ['/settings', 'Account privacy'],
        [
            '/chat',
            'Talk with neighbors you are connected with, or with members of your groups.',
        ],
        [
            '/groups',
            'Coordinate with a group. Invite people, manage membership, and talk in shared rooms.',
        ],
        ['/legal/terms', 'Terms of Service'],
        ['/legal/privacy', 'Privacy Policy'],
        ['/legal/community-guidelines', 'Community Guidelines'],
        ['/login', 'Sign in to take part.'],
        ['/signup', 'Join your neighbors.'],
        ['/auth/callback?error=access_denied', 'Let’s get you back on track.'],
    ],
    es: [
        ['/', 'Patchwork'],
        ['/nearby', 'Cerca de ti'],
        ['/posting', 'Pedir ayuda'],
        ['/resources', 'Directorio de recursos'],
        ['/volunteer', 'Perfiles de voluntariado'],
        ['/organizations', 'Organizaciones'],
        ['/verification', 'Verificación'],
        ['/inbox', 'Mi actividad'],
        ['/scheduling', 'Programación de la conexión'],
        ['/notifications', 'Centro de notificaciones'],
        ['/moderation', 'Consola de seguridad de moderación'],
        ['/settings', 'Privacidad de la cuenta'],
        [
            '/chat',
            'Habla con vecinos con quienes te has conectado o con miembros de tus grupos.',
        ],
        [
            '/groups',
            'Coordínate con un grupo. Invita personas, administra miembros y conversa en salas compartidas.',
        ],
        ['/legal/terms', 'Términos del servicio'],
        ['/legal/privacy', 'Política de privacidad'],
        ['/legal/community-guidelines', 'Normas de la comunidad'],
        ['/login', 'Inicia sesión para participar.'],
        ['/signup', 'Únete a tu comunidad.'],
        ['/auth/callback?error=access_denied', 'Volvamos a encaminarte.'],
    ],
} as const;

const mockProductionSession = async (page: Page, language: 'en' | 'es') => {
    await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname.replace(
            /^\/api/,
            '',
        );
        const fulfill = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        if (path === '/auth/session') {
            return fulfill({
                session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' },
            });
        }
        if (path === '/account/onboarding') {
            return fulfill({
                policyVersion: '2026-07-28',
                requiredDocuments: [],
                consentRequired: false,
                acceptedAt: '2026-08-05T00:00:00Z',
            });
        }
        if (path === '/account/preferences') {
            return fulfill({
                preferences: {
                    privacy: 'private',
                    notifications: { inApp: true, email: false, push: false },
                    visibility: 'authenticated',
                    language,
                    location: { sharing: 'hidden', noPermanentAddress: false },
                },
            });
        }
        if (path === '/coordination/mine') {
            return fulfill({
                offers: [],
                connections: [
                    {
                        id: connectionId,
                        offerId: 'offer',
                        requestUri: `at://${actor}/app.patchwork.aid.post/localization`,
                        status: 'active',
                        requesterDid: actor,
                        helperDid: peer,
                        counterpartDid: peer,
                        acceptedAt: '2026-08-05T00:00:00Z',
                        completedAt: null,
                        updatedAt: '2026-08-05T00:00:00Z',
                    },
                ],
            });
        }
        if (path === '/inbox') return fulfill({ items: [], unread: 0 });
        if (path === '/outcomes/mine') return fulfill({ feedback: [] });
        if ((path === '/query/feed' || path === '/query/map')) return fulfill({
            total: 0,
            page: 1,
            pageSize: 20,
            hasNextPage: false,
            results: [],
        });
        if (path === '/coordination/windows') return fulfill({ windows: [] });
        if (path === '/groups') {
            return fulfill({
                groups: [],
                invitations: [],
                outgoingInvitations: [],
            });
        }
        if (path === '/chat/conversations') return fulfill({ conversations: [] });
        return fulfill(
            { error: { code: 'NOT_FOUND', message: 'Not found.' } },
            404,
        );
    });
};

for (const locale of ['en', 'es'] as const) {
    for (const [path, expectedCopy] of routes[locale]) {
        test(`${path} is complete, accessible, and reflows in ${locale}`, async ({
            page,
        }) => {
            await mockProductionSession(page, locale);
            await page.setViewportSize({ width: 320, height: 800 });
            await page.addInitScript((selected) => {
                localStorage.setItem('patchwork-locale', selected);
                document.documentElement.style.fontSize = '200%';
            }, locale);
            await page.goto(path);
            await page.waitForLoadState('networkidle');
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            await expect(
                page
                    .getByText(expectedCopy, { exact: true })
                    .filter({ visible: true })
                    .first(),
                path,
            ).toBeVisible();
            if (path === '/inbox') {
                await expect(
                    page.getByText(
                        locale === 'es'
                            ? 'Intercambio privado de ubicación exacta'
                            : 'Private exact-location exchange',
                        { exact: true },
                    ),
                ).toBeVisible();
            }
            const dimensions = await page.evaluate(() => ({
                viewport: document.documentElement.clientWidth,
                content: document.documentElement.scrollWidth,
            }));
            expect(dimensions.content, path).toBeLessThanOrEqual(
                dimensions.viewport,
            );
            const results = await new AxeBuilder({ page })
                .withTags([
                    'wcag2a',
                    'wcag2aa',
                    'wcag21a',
                    'wcag21aa',
                    'wcag22aa',
                ])
                .analyze();
            expect(results.violations, path).toEqual([]);
        });
    }

    test(`skip navigation retains keyboard focus in ${locale}`, async ({
        page,
    }) => {
        await mockProductionSession(page, locale);
        await page.addInitScript(
            (selected) => localStorage.setItem('patchwork-locale', selected),
            locale,
        );
        await page.goto('/');
        await page.keyboard.press('Tab');
        await expect(page.locator('a[href="#main-content"]')).toBeFocused();
    });
}

test('language switching preserves in-progress production form state', async ({
    page,
}) => {
    await mockProductionSession(page, 'en');
    await page.goto(
        '/posting?tab=nearby&r=20000&lat=41.88&lng=-87.63&area=Disposable+test+area',
    );
    await page
        .getByLabel('What do you need?', { exact: true })
        .fill('Groceries for a neighbor');
    await page.getByLabel('Language').selectOption('es');
    await expect(
        page.getByRole('heading', { name: 'Pedir ayuda' }),
    ).toBeVisible();
    await expect(
        page.getByLabel('¿Qué necesitas?', { exact: true }),
    ).toHaveValue('Groceries for a neighbor');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});
