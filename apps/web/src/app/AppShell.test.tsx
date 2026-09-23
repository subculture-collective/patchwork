// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import '../i18n';
import type { AuthSessionSummary } from '../auth/auth-api';
import { AppShell } from './AppShell';
import { resolveNavRoutes } from './routes';

const render = (
    session?: AuthSessionSummary | null,
    currentRoute: '/' | '/map' = '/map',
) => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
        <AppShell
            appTitle='Patchwork'
            currentRoute={currentRoute}
            navRoutes={resolveNavRoutes('api', session ? {} : undefined)}
            auth={{ status: 'ready', session, onLogout: () => undefined }}
            locale='en'
            onChangeLocale={() => undefined}
            onRouteClick={() => undefined}
        >
            <p>Page body</p>
        </AppShell>,
    );
    return container;
};

describe('AppShell accessibility', () => {
    it('puts the skip link first and targets a focusable main region', () => {
        const container = render();
        const firstFocusable = container.querySelector('a, button, input, select');
        expect(firstFocusable?.getAttribute('href')).toBe('#main-content');
        const target = container.querySelector('#main-content');
        expect(target?.getAttribute('tabindex')).toBe('-1');
        expect(target?.closest('main')).not.toBeNull();
    });

    it('renders exactly one labelled nav element', () => {
        const navs = render().querySelectorAll('nav');
        expect(navs).toHaveLength(1);
        expect(navs[0]?.getAttribute('aria-label')).toBeTruthy();
    });

    it('marks only the current route as the current page in the main nav', () => {
        const current = render().querySelectorAll('nav a[aria-current="page"]');
        expect(current).toHaveLength(1);
        expect(current[0]?.getAttribute('href')).toBe('/map');
    });

    it('shows the handle, never the DID, for a signed-in account', () => {
        const text = render({
            did: 'did:plc:shell-test',
            handle: 'neighbor.example',
            expiresAt: '2099-01-01T00:00:00.000Z',
        })
            .textContent;
        expect(text).toContain('@neighbor.example');
        expect(text).not.toContain('did:plc:shell-test');
    });

    it('does not render the mobile menu contents until it is opened', () => {
        const container = render();
        expect(container.querySelector('#mobile-navigation .mh-mobile-nav')).toBeNull();
    });
});
