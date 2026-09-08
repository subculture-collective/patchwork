import { describe, expect, it } from 'vitest';
import snapshot from './seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { parsePublicResourceCatalog, publicResourceCatalog, publicResourceSeed } from './public-resource-catalog.js';

describe('sourced public resource seed', () => {
    it('includes public addresses and official links without claiming ownership', () => {
        expect(new Set(publicResourceSeed.map(resource => resource.countyId))).toEqual(new Set(publicResourceCatalog.scope.countyIds));
        expect(new Set(publicResourceSeed.map(resource => resource.category))).toEqual(new Set(['food-bank', 'clinic', 'other', 'shelter', 'legal-aid']));
        for (const resource of publicResourceSeed) {
            expect(resource.claimStatus).toBe('unclaimed');
            expect(resource.streetAddress).not.toBe('');
            expect(resource.source.url).toMatch(/^https:\/\//);
            expect(resource.operationalStatus).toBe('unknown');
            expect(resource.latitude).toBeGreaterThan(-90);
            expect(resource.latitude).toBeLessThan(90);
            expect(resource.longitude).toBeGreaterThan(-180);
            expect(resource.longitude).toBeLessThan(180);
        }
    });

    it('covers every state without importing artificial activity', () => {
        const states = new Set(publicResourceSeed.map(resource => resource.state));
        for (const state of 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ')) expect(states.has(state as never)).toBe(true);
        const national = publicResourceSeed.filter(resource => resource.sourceId === 'hrsa-national');
        expect(national.length).toBeGreaterThan(10000);
        expect(national.every(resource => resource.id.startsWith('hrsa-site-') && resource.services?.includes('health'))).toBe(true);
        expect(national.every(resource => new URL(resource.website).hostname.includes('.'))).toBe(true);
        const food = publicResourceSeed.filter(resource => resource.sourceId.startsWith('vivery-network-'));
        const housing = publicResourceSeed.filter(resource => resource.sourceId === 'hud-current');
        expect(food.length).toBeGreaterThan(10000);
        expect(food.every(resource => resource.services?.includes('food') && resource.coordinateBasis === 'publisher-address')).toBe(true);
        expect(housing.length).toBeGreaterThan(400);
        expect(housing.every(resource => resource.services?.includes('housing') && resource.coordinateBasis === 'census-address-range')).toBe(true);
    });

    it('keeps the source closure and omits that branch from the active seed', () => {
        const branch = publicResourceCatalog.resources.find(resource => resource.name.startsWith('Galewood-Mont Clare'));
        expect(branch?.operationalStatus).toBe('closed');
        expect(publicResourceSeed.some(resource => resource.id === branch?.id)).toBe(false);
    });

    it('rejects missing addresses, invalid ZIPs and duplicate source IDs', () => {
        const first = snapshot.resources[0]!;
        for (const resource of [{ ...first, streetAddress: '' }, { ...first, postalCode: '00000' }]) {
            expect(() => parsePublicResourceCatalog({ ...snapshot, resources: [resource] })).toThrow();
        }
        expect(() => parsePublicResourceCatalog({ ...snapshot, resources: [first, first] })).toThrow('Duplicate');
        expect(() => parsePublicResourceCatalog({ ...snapshot, resources: [first, { ...first, id: 'different-source-id' }] })).toThrow('Duplicate');
        expect(() => parsePublicResourceCatalog({ ...snapshot, resources: [{ ...first, sourceId: 'missing' }] })).toThrow('provenance');
    });
});
