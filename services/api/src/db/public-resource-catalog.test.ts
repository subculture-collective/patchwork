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
            expect(resource.latitude).toBeGreaterThan(40.5);
            expect(resource.latitude).toBeLessThan(43);
            expect(resource.longitude).toBeGreaterThan(-90);
            expect(resource.longitude).toBeLessThan(-86);
        }
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
