import type { WebDataMode } from '../features/data-mode';

export const appRoutes = [
    '/',
    '/map',
    '/feed',
    '/resources',
    '/volunteer',
    '/organizations',
    '/verification',
    '/posting',
    '/chat',
    '/settings',
    '/moderation',
    '/inbox',
    '/notifications',
    '/scheduling',
    '/feedback',
    '/groups',
    '/legal/terms',
    '/legal/privacy',
    '/legal/community-guidelines',
] as const;

export type AppRoute = (typeof appRoutes)[number];

export const routeLabelKeys: Readonly<Record<AppRoute, string>> = {
    '/': 'route.home',
    '/map': 'route.map',
    '/feed': 'route.feed',
    '/resources': 'route.resources',
    '/volunteer': 'route.volunteer',
    '/organizations': 'route.organizations',
    '/verification': 'route.verification',
    '/posting': 'route.posting',
    '/chat': 'route.chat',
    '/settings': 'route.settings',
    '/moderation': 'route.moderation',
    '/inbox': 'route.inbox',
    '/notifications': 'route.notifications',
    '/scheduling': 'route.scheduling',
    '/feedback': 'route.feedback',
    '/groups': 'route.groups',
    '/legal/terms': 'route.terms',
    '/legal/privacy': 'route.privacy',
    '/legal/community-guidelines': 'route.guidelines',
};

export const legalRoutes = [
    '/legal/terms',
    '/legal/privacy',
    '/legal/community-guidelines',
] as const satisfies readonly AppRoute[];

export type LegalRoute = (typeof legalRoutes)[number];

export const isLegalRoute = (route: AppRoute): route is LegalRoute =>
    (legalRoutes as readonly AppRoute[]).includes(route);

/** Routes that render a sign-in prompt when no session is present. */
export const authenticatedRoutes: ReadonlySet<AppRoute> = new Set<AppRoute>([
    '/posting',
    '/chat',
    '/inbox',
    '/scheduling',
    '/notifications',
    '/moderation',
    '/groups',
    '/settings',
]);

/** Routes without an API-backed implementation; only the fixture demo renders them. */
export const deferredFixtureRoutes: ReadonlySet<AppRoute> = new Set<AppRoute>([
    '/feedback',
]);

export const primaryRoutes: readonly AppRoute[] = [
    '/',
    '/map',
    '/feed',
    '/resources',
];

const fixtureAccountRoutes: readonly AppRoute[] = [
    '/volunteer',
    '/chat',
    '/settings',
];

const productionAccountRoutes: readonly AppRoute[] = [
    '/inbox',
    '/notifications',
    '/moderation',
    '/settings',
];

const fixtureSecondaryRoutes = appRoutes.filter(
    (route) =>
        !primaryRoutes.includes(route) &&
        !fixtureAccountRoutes.includes(route) &&
        !isLegalRoute(route),
);

export interface NavSession {
    role?: string;
}

export interface NavRouteGroups {
    primary: readonly AppRoute[];
    account: readonly AppRoute[];
    secondary: readonly AppRoute[];
}

export const resolveNavRoutes = (
    dataMode: WebDataMode,
    session: NavSession | undefined,
): NavRouteGroups => {
    if (dataMode === 'fixture') {
        return {
            primary: primaryRoutes,
            account: fixtureAccountRoutes,
            secondary: fixtureSecondaryRoutes,
        };
    }
    if (!session) {
        return {
            primary: primaryRoutes,
            account: [],
            secondary: ['/volunteer', '/organizations'],
        };
    }
    const canModerate =
        session.role === 'admin' || session.role === 'moderator';
    return {
        primary: primaryRoutes,
        account: productionAccountRoutes.filter(
            (route) => route !== '/moderation' || canModerate,
        ),
        secondary: [
            '/volunteer',
            '/organizations',
            '/posting',
            '/verification',
            '/chat',
            '/scheduling',
            '/groups',
        ],
    };
};

export const normalizeRoute = (pathname: string): AppRoute =>
    appRoutes.find((route) => route === pathname) ?? '/';

export const readCurrentRoute = (): AppRoute => {
    if (typeof window === 'undefined') {
        return '/';
    }
    return normalizeRoute(window.location.pathname);
};
