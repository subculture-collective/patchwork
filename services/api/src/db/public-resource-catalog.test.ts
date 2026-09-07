import { describe, expect, it } from 'vitest';
import snapshot from './seed-data/chicago-public-libraries.json' with { type: 'json' };
import { parsePublicResourceCatalog, publicResourceCatalog, publicResourceSeed } from './public-resource-catalog.js';

describe('sourced public resource seed', () => {
    it('includes public addresses and official links without claiming ownership', () => {
        expect(publicResourceCatalog.resources).toHaveLength(82);
        expect(publicResourceSeed).toHaveLength(81);
        for (const resource of publicResourceSeed) {
            expect(resource.claimStatus).toBe('unclaimed');
            expect(resource.streetAddress).not.toBe('');
            expect(resource.website).toMatch(/^https:\/\/www\.chipublib\.org\//);
            expect(resource.latitude).toBeGreaterThan(41);
            expect(resource.latitude).toBeLessThan(43);
            expect(resource.longitude).toBeGreaterThan(-89);
            expect(resource.longitude).toBeLessThan(-87);
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
    });
});
