import {
    useEffect,
    useRef,
    useState,
    type MouseEvent,
    type PropsWithChildren,
    type ReactNode,
} from 'react';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { buttonClassName } from '../components/Button';
import { useLocale } from '../i18n';
import type { AuthSessionSummary } from '../auth/auth-api';
import {
    routeLabelKeys,
    type AppRoute,
    type NavRouteGroups,
} from './routes';

type Locale = 'en' | 'es';

export interface AppShellAuth {
    status: string;
    session?: AuthSessionSummary | null;
    onLogout: () => void;
}

interface AppShellProps {
    appTitle: string;
    currentRoute: AppRoute;
    navRoutes: NavRouteGroups;
    auth: AppShellAuth;
    locale: Locale;
    onChangeLocale: (locale: Locale) => void;
    onRouteClick: (event: MouseEvent<HTMLAnchorElement>, route: AppRoute) => void;
    /** Page-level notices (offline, maintenance) rendered above the content. */
    notices?: ReactNode;
    mainContentRef?: React.RefObject<HTMLDivElement | null>;
}

/** Routes offered as one-tap destinations in the mobile tab bar. */
const tabBarRoutes: readonly AppRoute[] = ['/', '/map', '/feed', '/resources'];

const tabIcons: Partial<Record<AppRoute, IconName>> = {
    '/': 'home',
    '/map': 'map',
    '/feed': 'list',
    '/resources': 'resources',
};

export const AppShell = ({
    appTitle,
    currentRoute,
    navRoutes,
    auth,
    locale,
    onChangeLocale,
    onRouteClick,
    notices,
    mainContentRef,
    children,
}: PropsWithChildren<AppShellProps>) => {
    const { t } = useLocale();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isMoreOpen, setIsMoreOpen] = useState(false);
    const menuToggleRef = useRef<HTMLButtonElement>(null);
    const moreRef = useRef<HTMLDivElement>(null);
    const moreToggleRef = useRef<HTMLButtonElement>(null);

    // Close menus whenever the route changes (including back/forward).
    useEffect(() => {
        setIsMenuOpen(false);
        setIsMoreOpen(false);
    }, [currentRoute]);

    useEffect(() => {
        if (!isMoreOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setIsMoreOpen(false);
            moreToggleRef.current?.focus();
        };
        const onPointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !moreRef.current?.contains(event.target)
            ) {
                setIsMoreOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [isMoreOpen]);

    const handleClick = (
        event: MouseEvent<HTMLAnchorElement>,
        route: AppRoute,
    ) => {
        setIsMenuOpen(false);
        setIsMoreOpen(false);
        onRouteClick(event, route);
    };

    const routeLink = (route: AppRoute, className: string) => (
        <a
            key={route}
            href={route}
            className={className}
            aria-current={currentRoute === route ? 'page' : undefined}
            onClick={(event) => handleClick(event, route)}
        >
            {t(routeLabelKeys[route])}
        </a>
    );

    const signInHref = `/login?returnTo=${encodeURIComponent(currentRoute)}`;
    const handle = auth.session?.handle
        ? `@${auth.session.handle.replace(/^@/, '')}`
        : t('nav.accountFallback');

    const accountControl = (compact: boolean) => (
        <div className='mh-auth-control' aria-live='polite'>
            {auth.status === 'booting' ? (
                <span className='text-sm text-mh-textMuted'>
                    {t('runtime.checkingSession')}
                </span>
            ) : auth.session ? (
                <>
                    <span className='mh-auth-handle'>{handle}</span>
                    {auth.session.canManageSignupInvitations ? (
                        <a className='mh-nav-chip' href='/admin/invites'>
                            {t('route.invites')}
                        </a>
                    ) : null}
                    <button
                        type='button'
                        className={buttonClassName({
                            variant: 'secondary',
                            size: 'sm',
                        })}
                        onClick={auth.onLogout}
                    >
                        {t('runtime.signOut')}
                    </button>
                </>
            ) : (
                <a
                    className={buttonClassName({
                        variant: 'primary',
                        size: 'sm',
                        block: compact,
                    })}
                    href={signInHref}
                >
                    {t('runtime.signIn')}
                </a>
            )}
        </div>
    );

    const languageSelect = (id: string) => (
        <div className='mh-language'>
            <label htmlFor={id} className='sr-only'>
                {t('a11y.languageSwitcher')}
            </label>
            <select
                id={id}
                className='mh-input mh-language__select'
                value={locale}
                onChange={(event) =>
                    onChangeLocale(event.target.value as Locale)
                }
            >
                <option value='en'>{t('account.english')}</option>
                <option value='es'>{t('account.spanish')}</option>
            </select>
        </div>
    );

    return (
        <div className='mh-app'>
            <a href='#main-content' className='mh-skip-link'>
                {t('app.skipToContent')}
            </a>

            <header className='mh-app-header'>
                <div className='mh-masthead'>
                    <a
                        href='/'
                        className='mh-brand'
                        onClick={(event) => handleClick(event, '/')}
                    >
                        <span className='mh-brand-mark' aria-hidden='true'>
                            P
                        </span>
                        <span>
                            <strong>{appTitle}</strong>
                            <small>{t('runtime.tagline')}</small>
                        </span>
                    </a>

                    <div className='mh-app-header__tools'>
                        <div className='mh-network-status' role='status'>
                            <span aria-hidden='true' />{' '}
                            {t('runtime.environment')}
                        </div>
                        {languageSelect('header-language')}
                        {accountControl(false)}
                    </div>

                    <button
                        ref={menuToggleRef}
                        type='button'
                        className='mh-menu-toggle'
                        aria-expanded={isMenuOpen}
                        aria-controls='mobile-navigation'
                        onClick={() => setIsMenuOpen((open) => !open)}
                    >
                        <span className='mh-menu-toggle__icon' aria-hidden='true' />
                        {t('nav.menu')}
                    </button>
                </div>

                <Sheet
                    id='mobile-navigation'
                    open={isMenuOpen}
                    onClose={() => setIsMenuOpen(false)}
                    title={t('nav.menuTitle')}
                    closeLabel={t('common.close')}
                    placement='side'
                    returnFocusRef={menuToggleRef}
                >
                    {isMenuOpen ? (
                    <>
                    <div
                        role='navigation'
                        aria-label={t('nav.ariaLabel')}
                        className='mh-mobile-nav'
                    >
                        <p className='mh-eyebrow'>{t('nav.discoverGroup')}</p>
                        <div className='mh-mobile-nav__group'>
                            {navRoutes.primary.map((route) =>
                                routeLink(route, 'mh-mobile-nav__link'),
                            )}
                        </div>
                        {navRoutes.account.length > 0 ? (
                            <>
                                <p className='mh-eyebrow'>
                                    {t('nav.accountGroup')}
                                </p>
                                <div className='mh-mobile-nav__group'>
                                    {navRoutes.account.map((route) =>
                                        routeLink(
                                            route,
                                            'mh-mobile-nav__link',
                                        ),
                                    )}
                                </div>
                            </>
                        ) : null}
                        {navRoutes.secondary.length > 0 ? (
                            <>
                                <p className='mh-eyebrow'>
                                    {t('nav.secondaryGroup')}
                                </p>
                                <div className='mh-mobile-nav__group'>
                                    {navRoutes.secondary.map((route) =>
                                        routeLink(
                                            route,
                                            'mh-mobile-nav__link',
                                        ),
                                    )}
                                </div>
                            </>
                        ) : null}
                    </div>
                    <div className='mh-mobile-nav__prefs'>
                        <p className='mh-eyebrow'>
                            {t('nav.preferencesGroup')}
                        </p>
                        {languageSelect('menu-language')}
                        {accountControl(true)}
                        <p className='mh-network-status'>
                            <span aria-hidden='true' />{' '}
                            {t('runtime.environment')}
                        </p>
                    </div>
                    </>
                    ) : null}
                </Sheet>
            </header>

            <nav
                aria-label={t('nav.ariaLabel')}
                className='mh-desktop-nav'
            >
                <div className='mh-desktop-nav__primary'>
                    {navRoutes.primary.map((route) =>
                        routeLink(route, 'mh-nav-chip'),
                    )}
                </div>
                <div className='mh-desktop-nav__secondary'>
                    {navRoutes.account.map((route) =>
                        routeLink(route, 'mh-nav-chip'),
                    )}
                    {navRoutes.secondary.length > 0 ? (
                        <div className='mh-more' ref={moreRef}>
                            <button
                                ref={moreToggleRef}
                                type='button'
                                className='mh-nav-chip mh-more__toggle'
                                aria-expanded={isMoreOpen}
                                aria-controls='secondary-navigation-links'
                                onClick={() =>
                                    setIsMoreOpen((open) => !open)
                                }
                            >
                                {t('runtime.more')}
                                <Icon name='chevronDown' size={16} />
                            </button>
                            <div
                                id='secondary-navigation-links'
                                className='mh-more__panel'
                                hidden={!isMoreOpen}
                            >
                                {navRoutes.secondary.map((route) =>
                                    routeLink(route, 'mh-more__link'),
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </nav>

            <main className='mh-app-main'>
                {notices ? (
                    <div className='mh-app-notices'>{notices}</div>
                ) : null}
                <div
                    id='main-content'
                    ref={mainContentRef}
                    tabIndex={-1}
                    className='mh-main-content'
                >
                    {children}
                </div>
            </main>

            <footer className='mh-footer'>
                <p>{t('runtime.footer')}</p>
                <div role='navigation' aria-label={t('runtime.legalLabel')}>
                    {(
                        [
                            ['/legal/terms', 'legal.termsNav'],
                            ['/legal/privacy', 'legal.privacyNav'],
                            ['/legal/community-guidelines', 'legal.guidelinesNav'],
                        ] as const
                    ).map(([route, key]) => (
                        <a
                            key={route}
                            href={route}
                            onClick={(event) => handleClick(event, route)}
                        >
                            {t(key)}
                        </a>
                    ))}
                </div>
            </footer>

            <div
                role='navigation'
                aria-label={t('nav.quickLabel')}
                className='mh-tabbar'
            >
                {tabBarRoutes.map((route) => (
                    <a
                        key={route}
                        href={route}
                        className='mh-tabbar__link'
                        aria-current={currentRoute === route ? 'page' : undefined}
                        onClick={(event) => handleClick(event, route)}
                    >
                        <Icon name={tabIcons[route] ?? 'list'} size={22} />
                        <span>{t(routeLabelKeys[route])}</span>
                    </a>
                ))}
            </div>
        </div>
    );
};
