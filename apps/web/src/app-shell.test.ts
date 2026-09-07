import { describe, expect, it } from 'vitest';
import {
    getVisibleRoutes,
    isPublicRoute,
    publicRoutes,
} from './app-shell.js';
import type { PlatformRole } from '@patchwork/shared';

describe('app-shell route visibility', () => {
    describe('isPublicRoute', () => {
        it('accepts all defined public routes', () => {
            for (const route of publicRoutes) {
                expect(isPublicRoute(route)).toBe(true);
            }
        });

        it('rejects unknown routes', () => {
            expect(isPublicRoute('/admin')).toBe(false);
            expect(isPublicRoute('/dashboard')).toBe(false);
            expect(isPublicRoute('')).toBe(false);
        });
    });

    // -----------------------------------------------------------------
    // Role-visibility matrix (exhaustive)
    // -----------------------------------------------------------------

    describe('role-visibility matrix', () => {
        const legalRoutes = ['/legal/terms', '/legal/privacy', '/legal/community-guidelines'];
        const expectations: Record<PlatformRole, string[]> = {
            anonymous: ['/map', '/feed', '/resources', ...legalRoutes],
            user: ['/map', '/feed', '/resources', '/volunteer', '/settings', '/inbox', '/notifications', '/scheduling', '/feedback', '/groups', ...legalRoutes],
            verified_user: ['/map', '/feed', '/resources', '/volunteer', '/settings', '/inbox', '/notifications', '/scheduling', '/feedback', '/groups', ...legalRoutes],
            volunteer: ['/map', '/feed', '/resources', '/volunteer', '/settings', '/inbox', '/notifications', '/scheduling', '/feedback', '/groups', ...legalRoutes],
            moderator: ['/map', '/feed', '/resources', '/volunteer', '/settings', '/moderation', '/inbox', '/notifications', '/scheduling', '/feedback', '/groups', ...legalRoutes],
            admin: ['/map', '/feed', '/resources', '/volunteer', '/settings', '/moderation', '/inbox', '/notifications', '/scheduling', '/feedback', '/groups', ...legalRoutes],
            super_admin: ['/map', '/feed', '/resources', '/volunteer', '/settings', '/moderation', '/inbox', '/notifications', '/scheduling', '/feedback', '/groups', ...legalRoutes],
        };

        for (const [role, expectedRoutes] of Object.entries(expectations)) {
            it(`${role} sees exactly the expected routes`, () => {
                const visible = getVisibleRoutes(role as PlatformRole);
                const routes = visible.map(s => s.route);
                expect(routes).toEqual(expectedRoutes);
            });
        }
    });
});
