import { describe, expect, it } from 'vitest';
import { defaultDiscoveryFilterState } from './discovery-filters.js';
import {
    buildResourceOverlayViewModel,
    openResourceDetailPanel,
    resolveResourceDirectoryUiState,
    type ResourceDirectoryCard,
} from './resource-directory-ux.js';

const buildResource = (
    overrides: Partial<ResourceDirectoryCard> = {},
): ResourceDirectoryCard => {
    return {
        uri: 'at://did:example:org/app.patchwork.directory.resource/resource-1',
        id: 'resource-1',
        name: 'Neighborhood Clinic',
        category: 'clinic',
        location: {
            lat: 1.3001,
            lng: 103.8001,
            precisionMeters: 200,
            areaLabel: 'Central',
        },
        openHours: 'Walk-in evenings',
        eligibilityNotes: 'No insurance required',
        contact: {
            phone: '+1-555-0100',
        },
        ...overrides,
    };
};

describe('phase 6 resource directory overlays + details ui', () => {
    it('updates overlays by shared discovery filters and category selection', () => {
        const cards: ResourceDirectoryCard[] = [
            buildResource({
                uri: 'at://did:example:a/app.patchwork.directory.resource/clinic-1',
                id: 'clinic-1',
                name: 'Central Clinic',
                category: 'clinic',
            }),
            buildResource({
                uri: 'at://did:example:b/app.patchwork.directory.resource/food-1',
                id: 'food-1',
                name: 'Sunrise Food Bank',
                category: 'food-bank',
                openHours: 'Daily meal packs',
                eligibilityNotes: 'Families prioritized',
            }),
            buildResource({
                uri: 'at://did:example:c/app.patchwork.directory.resource/shelter-1',
                id: 'shelter-1',
                name: 'Harbor Shelter',
                category: 'shelter',
                location: {
                    lat: 1.39,
                    lng: 103.89,
                    precisionMeters: 300,
                    areaLabel: 'Harbor',
                },
            }),
        ];

        const view = buildResourceOverlayViewModel(
            cards,
            {
                ...defaultDiscoveryFilterState,
                category: 'food',
                text: 'meal',
                center: { lat: 1.3, lng: 103.8 },
                radiusMeters: 5000,
            },
            {
                category: 'food-bank',
            },
        );

        expect(view.cards).toHaveLength(1);
        expect(view.cards[0]?.id).toBe('food-1');
        expect(view.overlays).toHaveLength(1);
        expect(view.overlays[0]?.radiusMeters).toBe(300);
        expect(view.query.category).toBe('food');
    });

    it('shows hours and eligibility details in resource panel', () => {
        const cards = [
            buildResource({
                uri: 'at://did:example:org/app.patchwork.directory.resource/clinic-2',
                id: 'clinic-2',
                name: 'Northside Clinic',
                openHours: 'Mon-Fri 18:00-22:00',
                eligibilityNotes: 'Urgent care for walk-ins',
            }),
        ];

        const detail = openResourceDetailPanel(cards, cards[0]!.uri);

        expect(detail.open).toBe(true);
        expect(detail.title).toBe('Northside Clinic');
        expect(detail.openHours).toBe('Mon-Fri 18:00-22:00');
        expect(detail.eligibilityNotes).toBe('Urgent care for walk-ins');
        expect(
            detail.actions.some(action => action.id === 'request_intake'),
        ).toBe(true);
    });

    it('uses moderator-approved public-place coordinates exactly', () => {
        const resource = buildResource({
            exactPublicAddress: {
                kind: 'exact-public-resource',
                streetAddress: '100 Public Way',
                latitude: 40.7128123,
                longitude: -74.0060123,
                approvalExpiresAt: '2099-01-01T00:00:00.000Z',
            },
        });

        const view = buildResourceOverlayViewModel(
            [resource],
            defaultDiscoveryFilterState,
        );

        expect(view.overlays[0]).toMatchObject({
            lat: 40.712812,
            lng: -74.006012,
            radiusMeters: 0,
            exact: true,
        });
    });

    it('falls back to an approximate overlay after exact approval expires', () => {
        const resource = buildResource({
            exactPublicAddress: {
                kind: 'exact-public-resource',
                streetAddress: '100 Old Way',
                latitude: 40.7128123,
                longitude: -74.0060123,
                approvalExpiresAt: '2020-01-01T00:00:00.000Z',
            },
        });

        const view = buildResourceOverlayViewModel(
            [resource],
            defaultDiscoveryFilterState,
        );

        expect(view.overlays[0]).toMatchObject({
            lat: 1.3001,
            lng: 103.8001,
            exact: false,
        });
    });

    it('returns accessible loading/error/empty/ready ui states', () => {
        const loading = resolveResourceDirectoryUiState({
            loading: true,
            resources: [],
        });
        expect(loading.status).toBe('loading');
        expect(loading.ariaLiveMessage).toMatch(/Loading/i);

        const error = resolveResourceDirectoryUiState({
            loading: false,
            errorMessage: 'Request timed out',
            resources: [],
        });
        expect(error.status).toBe('error');
        expect(error.ariaLiveMessage).toMatch(/failed to load/i);

        const empty = resolveResourceDirectoryUiState({
            loading: false,
            resources: [],
            activeCategoryFilter: 'clinic',
        });
        expect(empty.status).toBe('empty');
        expect(empty.message).toMatch(/No resources found/i);

        const ready = resolveResourceDirectoryUiState({
            loading: false,
            resources: [buildResource()],
        });
        expect(ready.status).toBe('ready');
        expect(ready.ariaLiveMessage).toContain('1 directory resources loaded');
    });
});

it('sorts and labels nearby resources by distance even without API distance fields', () => {
    const cards = [
        buildResource({ id: 'far', name: 'A far resource', location: { lat: 41.98, lng: -87.63, precisionMeters: 1000 } }),
        buildResource({ id: 'near', name: 'Z near resource', location: { lat: 41.88, lng: -87.63, precisionMeters: 1000 } }),
    ];
    const view = buildResourceOverlayViewModel(cards, { ...defaultDiscoveryFilterState, feedTab: 'nearby', center: { lat: 41.88, lng: -87.63 }, radiusMeters: 20000 });
    expect(view.cards.map(card => card.id)).toEqual(['near', 'far']);
    expect(view.cards[0]?.distanceMeters).toBe(0);
});
