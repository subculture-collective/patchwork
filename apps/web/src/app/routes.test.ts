import { describe, expect, it } from 'vitest';
import {
    appRoutes,
    authenticatedRoutes,
    normalizeRoute,
    resolveNavRoutes,
    routeLabelKeys,
} from './routes';

describe('app routes', () => {
    it('labels every route', () => {
        for (const route of appRoutes) {
            expect(routeLabelKeys[route]).toMatch(/^route\./);
        }
    });

    it('falls back to home for unknown paths', () => {
        expect(normalizeRoute('/map')).toBe('/map');
        expect(normalizeRoute('/does-not-exist')).toBe('/');
    });

    it('hides account routes from signed-out production visitors', () => {
        const nav = resolveNavRoutes('api', undefined);
        expect(nav.account).toEqual([]);
        expect(nav.secondary).toEqual(['/volunteer', '/organizations']);
    });

    it('shows moderation only to moderators and admins', () => {
        expect(resolveNavRoutes('api', { role: 'member' }).account).not.toContain('/moderation');
        expect(resolveNavRoutes('api', { role: 'moderator' }).account).toContain('/moderation');
        expect(resolveNavRoutes('api', { role: 'admin' }).account).toContain('/moderation');
    });

    it('never lists legal pages or duplicates in fixture navigation', () => {
        const nav = resolveNavRoutes('fixture', undefined);
        const all = [...nav.primary, ...nav.account, ...nav.secondary];
        expect(all.some((route) => route.startsWith('/legal/'))).toBe(false);
        expect(new Set(all).size).toBe(all.length);
    });

    it('requires a session for private coordination routes', () => {
        expect(authenticatedRoutes.has('/chat')).toBe(true);
        expect(authenticatedRoutes.has('/map')).toBe(false);
    });
});
