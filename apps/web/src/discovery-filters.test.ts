import { describe, expect, it } from 'vitest';
import {
    nearbyResourceIntent,
    applyDiscoveryFilterPatch,
    defaultDiscoveryFilterState,
    parseDiscoveryFilterState,
    serializeDiscoveryFilterState,
    toFeedDiscoveryQuery,
    toMapDiscoveryQuery,
    toggleCategoryFilter,
    toggleStatusFilter,
    type DiscoveryFilterState,
} from './discovery-filters.js';
import { buildDiscoveryFilterChipModel } from './discovery-primitives.js';

describe('discovery filters', () => {
    it('serializes and parses a stable URL state', () => {
        const initial: DiscoveryFilterState = {
            nearbyIntent: 'resources',
            feedTab: 'nearby',
            text: 'milk',
            category: 'food',
            resourceCategory: 'legal-aid',
            resourceService: 'housing',
            resourceProgram: 'housing-counseling',
            includeLibraries: true,
            status: 'open',
            minUrgency: 4,
            center: { lat: 1.3, lng: 103.8 },
            radiusMeters: 7000,
            since: '2026-02-26T00:00:00.000Z',
        };

        const queryString = serializeDiscoveryFilterState(initial);
        const parsed = parseDiscoveryFilterState(
            queryString,
            defaultDiscoveryFilterState,
        );

        expect(queryString.includes('tab=nearby')).toBe(true);
        expect(queryString.includes('libraries=1')).toBe(true);
        expect(parsed).toEqual(initial);
    });

    it('keeps libraries excluded unless explicitly enabled', () => {
        expect(parseDiscoveryFilterState('', defaultDiscoveryFilterState).includeLibraries).toBeUndefined();
        expect(parseDiscoveryFilterState('?libraries=1', defaultDiscoveryFilterState).includeLibraries).toBe(true);
        expect(serializeDiscoveryFilterState({...defaultDiscoveryFilterState,includeLibraries:true})).toContain('libraries=1');
    });

    it('normalizes invalid query values and preserves safe defaults', () => {
        const parsed = parseDiscoveryFilterState(
            '?program=invalid&service=invalid&cat=invalid&resourceType=invalid&st=unknown&u=99&r=12&lat=111&lng=103.81&tab=nearby&q=   ',
            defaultDiscoveryFilterState,
        );

        expect(parsed.feedTab).toBe('nearby');
        expect(parsed.status).toBe('open');
        expect(parsed.category).toBeUndefined();
        expect(parsed.resourceCategory).toBeUndefined();
        expect(parsed.resourceService).toBeUndefined();
        expect(parsed.resourceProgram).toBeUndefined();
        expect(parsed.minUrgency).toBe(5);
        expect(parsed.radiusMeters).toBe(300);
        expect(parsed.center).toBeUndefined();
        expect(parsed.text).toBeUndefined();
    });

    it('keeps request links and explicit intent distinct from resource refinements', () => {
        expect(nearbyResourceIntent({...defaultDiscoveryFilterState, postalCode:'60608'})).toBe(false);
        expect(nearbyResourceIntent({...defaultDiscoveryFilterState, resourceProgram:'wic'})).toBe(true);
        expect(nearbyResourceIntent({...defaultDiscoveryFilterState, nearbyIntent:'requests',resourceProgram:'wic'})).toBe(false);
        expect(nearbyResourceIntent(parseDiscoveryFilterState('?nearby=resources&zip=60608', defaultDiscoveryFilterState))).toBe(true);
    });

    it('map/feed query contracts share filters while latest feed omits location', () => {
        const state: DiscoveryFilterState = {
            feedTab: 'latest',
            text: 'infant formula',
            category: 'food',
            status: 'open',
            minUrgency: 3,
            center: { lat: 1.31, lng: 103.81 },
            radiusMeters: 7000,
        };

        const mapQuery = toMapDiscoveryQuery(state);
        const feedQuery = toFeedDiscoveryQuery(state);

        expect(mapQuery.center).toEqual({ lat: 1.31, lng: 103.81 });
        expect(mapQuery.radiusMeters).toBe(7000);
        expect(feedQuery.center).toBeUndefined();
        expect(feedQuery.radiusMeters).toBeUndefined();
    });

    it('supports category/status toggle interactions', () => {
        const base = defaultDiscoveryFilterState;
        const withCategory = toggleCategoryFilter(base, 'food');
        const withStatus = toggleStatusFilter(withCategory, 'in-progress');
        const removedCategory = toggleCategoryFilter(withStatus, 'food');

        expect(withCategory.category).toBe('food');
        expect(withStatus.status).toBe('in-progress');
        expect(removedCategory.category).toBeUndefined();
    });

    it('builds shared active-chip model across tabs/category/status/urgency', () => {
        const state = applyDiscoveryFilterPatch(defaultDiscoveryFilterState, {
            feedTab: 'nearby',
            category: 'transport',
            status: 'open',
            minUrgency: 4,
        });

        const model = buildDiscoveryFilterChipModel(state);
        expect(model.tabs.find(chip => chip.active)?.value).toBe('nearby');
        expect(model.categories.find(chip => chip.active)?.value).toBe(
            'transport',
        );
        expect(model.statuses.find(chip => chip.active)?.value).toBe('open');
        expect(model.urgency.find(chip => chip.active)?.value).toBe(4);
    });
});
