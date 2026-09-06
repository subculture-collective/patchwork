import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const actor = 'did:plc:localization-browser-actor';
const peer = 'did:plc:localization-browser-peer';
const connectionId = '51111111-1111-4111-8111-111111111111';

const routes = {
    en: [
        ['/', 'Patchwork'],
        ['/map', 'Nearby map'],
        ['/feed', 'Feed operations'],
        ['/posting', 'Create request'],
        ['/resources', 'Resource directory'],
        ['/volunteer', 'Volunteer profiles'],
        ['/organizations', 'Organizations'],
        ['/verification', 'Verification'],
        ['/inbox', 'Coordination inbox'],
        ['/scheduling', 'Connection scheduling'],
        ['/notifications', 'Notification center'],
        ['/moderation', 'Moderator safety console'],
        ['/settings', 'Account privacy'],
        ['/chat', 'Bounded text conversations for active accepted connections and current group-room members.'],
        ['/groups', 'Private coordination spaces with explicit roles, expiring invitations, and immediate access checks.'],
        ['/legal/terms', 'Terms of Service'],
        ['/legal/privacy', 'Privacy Policy'],
        ['/legal/community-guidelines', 'Community Guidelines'],
        ['/login', 'Come on in. Your neighbors are here.'],
        ['/signup', 'Join your neighbors.'],
        ['/auth/callback?error=access_denied', 'Let’s get you back on track.'],
    ],
    es: [
        ['/', 'Patchwork'],
        ['/map', 'Mapa cercano'],
        ['/feed', 'Operaciones de noticias'],
        ['/posting', 'Crear solicitud'],
        ['/resources', 'Directorio de recursos'],
        ['/volunteer', 'Perfiles de voluntariado'],
        ['/organizations', 'Organizaciones'],
        ['/verification', 'Verificación'],
        ['/inbox', 'Bandeja de coordinación'],
        ['/scheduling', 'Programación de la conexión'],
        ['/notifications', 'Centro de notificaciones'],
        ['/moderation', 'Consola de seguridad de moderación'],
        ['/settings', 'Privacidad de la cuenta'],
        ['/chat', 'Conversaciones de texto limitadas para conexiones aceptadas activas y miembros actuales de salas de grupo.'],
        ['/groups', 'Espacios privados de coordinación con roles explícitos, invitaciones con vencimiento y controles de acceso inmediatos.'],
        ['/legal/terms', 'Términos del servicio'],
        ['/legal/privacy', 'Política de privacidad'],
        ['/legal/community-guidelines', 'Normas de la comunidad'],
        ['/login', 'Adelante. Tu comunidad está aquí.'],
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
        if (path === '/query/feed') return fulfill({
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
    await page.getByLabel('Title').fill('Groceries for a neighbor');
    await page.getByLabel('Language').selectOption('es');
    await expect(
        page.getByRole('heading', { name: 'Crear solicitud' }),
    ).toBeVisible();
    await expect(page.getByLabel('Título')).toHaveValue(
        'Groceries for a neighbor',
    );
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});
