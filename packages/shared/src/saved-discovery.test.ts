import { describe, it, expect } from 'vitest';
import { savedDiscoveryInputSchema } from './saved-discovery.js';
describe('saved discovery privacy contract', () => {
    it('accepts public filters and retains leading-zero ZIPs', () => {
        expect(
            savedDiscoveryInputSchema.parse({
                kind: 'search',
                search: { postalCode: '01001', resourceProgram: 'wic' },
            }),
        ).toMatchObject({
            search: { postalCode: '01001', resourceProgram: 'wic' },
        });
    });
    it('rejects precise coordinates, eligibility profiles and unknown fields instead of persisting them', () => {
        for (const search of [
            { center: { lat: 41.123456, lng: -87.654321 } },
            { eligibility: { income: 20000 } },
            { origin: { lat: 41, lng: -87 } },
            { postalCode: '1234' },
            { center: { lat: 91, lng: 0 } },
        ])
            expect(
                savedDiscoveryInputSchema.safeParse({ kind: 'search', search })
                    .success,
            ).toBe(false);
        expect(
            savedDiscoveryInputSchema.safeParse({
                kind: 'search',
                search: {
                    center: { lat: 41.12, lng: -87.65 },
                    radiusMeters: 5000,
                },
            }).success,
        ).toBe(true);
    });
});
