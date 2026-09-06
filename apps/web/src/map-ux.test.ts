import { describe, expect, it } from 'vitest';
import { defaultDiscoveryFilterState } from './discovery-filters.js';
import { haversineDistanceMeters } from './geo-utils.js';
import {
    buildMapViewModel,
    clusterDistanceMetersForZoom,
    clusterExpansionZoom,
    clusterMapCards,
    filterMapCards,
    openMapDetailDrawer,
    toApproximateMapMarker,
    type MapAidCard,
} from './map-ux.js';

const buildCard = (overrides: Partial<MapAidCard>): MapAidCard => ({
    id: overrides.id ?? 'card-1',
    title: overrides.title ?? 'Need water',
    summary: overrides.summary ?? 'Need support in my area',
    category: overrides.category ?? 'food',
    status: overrides.status ?? 'open',
    urgency: overrides.urgency ?? 3,
    updatedAt: overrides.updatedAt ?? '2026-02-26T10:00:00.000Z',
    location: overrides.location,
});

describe('map ux', () => {
    it('clusters nearby cards without grid-boundary gaps', () => {
        const cards = [
            buildCard({
                id: 'near-1',
                location: { lat: 1.3, lng: 103.8, precisionKm: 1 },
            }),
            buildCard({
                id: 'near-2',
                location: { lat: 1.3002, lng: 103.8002, precisionKm: 1 },
            }),
        ];

        const clusters = clusterMapCards(cards, 1000);

        expect(clusters).toHaveLength(1);
        expect(clusters[0]?.count).toBe(2);
        expect(clusters[0]?.status).toBe('open');
    });

    it('combines and splits circles as zoom changes', () => {
        const cards = [
            buildCard({
                id: 'zoom-1',
                location: { lat: 40.7, lng: -74, precisionKm: 1 },
            }),
            buildCard({
                id: 'zoom-2',
                location: { lat: 40.75, lng: -74, precisionKm: 1 },
            }),
        ];

        const lowZoomClusters = clusterMapCards(
            cards,
            clusterDistanceMetersForZoom(8, 40.7),
        );
        const highZoomClusters = clusterMapCards(
            cards,
            clusterDistanceMetersForZoom(15, 40.7),
        );

        expect(lowZoomClusters).toHaveLength(1);
        expect(lowZoomClusters[0]?.count).toBe(2);
        expect(highZoomClusters).toHaveLength(2);
        expect(highZoomClusters.every(cluster => cluster.count === 1)).toBe(true);
    });

    it('groups broadly at first and expands at the first meaningful split zoom', () => {
        const cards = [
            buildCard({
                id: 'expand-1',
                location: { lat: 0, lng: 0, precisionKm: 1 },
            }),
            buildCard({
                id: 'expand-2',
                location: { lat: 0.02, lng: 0, precisionKm: 1 },
            }),
        ];

        expect(clusterDistanceMetersForZoom(10, 0)).toBeGreaterThan(
            clusterDistanceMetersForZoom(11, 0),
        );
        expect(clusterMapCards(cards, clusterDistanceMetersForZoom(10, 0))).toHaveLength(1);
        expect(clusterExpansionZoom(cards, cards.map(card => card.id), 10, 0)).toBe(12);
    });

    it('filters cards by category and radius interactions', () => {
        const cards = [
            buildCard({
                id: 'in-radius',
                category: 'food',
                location: { lat: 1.3, lng: 103.8, precisionKm: 1 },
            }),
            buildCard({
                id: 'out-radius',
                category: 'food',
                location: { lat: 1.35, lng: 103.85, precisionKm: 1 },
            }),
            buildCard({
                id: 'wrong-category',
                category: 'medical',
                location: { lat: 1.3001, lng: 103.8001, precisionKm: 1 },
            }),
        ];

        const filtered = filterMapCards(cards, {
            ...defaultDiscoveryFilterState,
            category: 'food',
            center: { lat: 1.3, lng: 103.8 },
            radiusMeters: 2500,
        });

        expect(filtered.map(card => card.id)).toEqual(['in-radius']);
    });

    it('enforces approximate-area marker precision floor', () => {
        const marker = toApproximateMapMarker(
            buildCard({
                id: 'approx-1',
                category: 'transport',
                location: {
                    lat: 1.30019,
                    lng: 103.80019,
                    precisionKm: 0.12,
                    areaLabel: 'Downtown West',
                },
            }),
        );

        expect(marker?.radiusMeters).toBeGreaterThanOrEqual(1000);
        expect(marker?.label).toBe('Downtown West');
        expect(
            Math.abs((marker?.lat ?? 0) - 1.30019) +
                Math.abs((marker?.lng ?? 0) - 103.80019),
        ).toBeGreaterThan(0.001);
    });

    it('uses a stable shared-area displacement without inventing separate request locations', () => {
        const location = { lat: 0, lng: 0, precisionKm: 1 };
        const first = toApproximateMapMarker(
            buildCard({ id: 'private-a', location }),
        );
        const repeat = toApproximateMapMarker(
            buildCard({ id: 'private-a', location }),
        );
        const different = toApproximateMapMarker(
            buildCard({ id: 'private-b', location }),
        );

        expect(first).toEqual(repeat);
        expect({ lat: first?.lat, lng: first?.lng }).toEqual({
            lat: different?.lat,
            lng: different?.lng,
        });
        expect({ lat: first?.lat, lng: first?.lng }).not.toEqual({
            lat: location.lat,
            lng: location.lng,
        });
        expect(
            haversineDistanceMeters(location, {
                lat: first?.lat ?? 0,
                lng: first?.lng ?? 0,
            }),
        ).toBeGreaterThanOrEqual(299);
        expect(
            haversineDistanceMeters(location, {
                lat: first?.lat ?? 0,
                lng: first?.lng ?? 0,
            }),
        ).toBeLessThanOrEqual(451);
    });

    it('does not fabricate location for missing geography', () => {
        const marker = toApproximateMapMarker(buildCard({ id: 'no-geo' }));
        expect(marker).toBeUndefined();
    });

    it('opens detail drawer with contact-helper CTA and triage actions', () => {
        const cards = [
            buildCard({
                id: 'drawer-1',
                title: 'Need water',
                status: 'open',
                location: { lat: 1.3, lng: 103.8, precisionKm: 1 },
            }),
        ];

        const viewModel = buildMapViewModel(cards, defaultDiscoveryFilterState);
        const drawer = openMapDetailDrawer(viewModel.filteredCards, 'drawer-1');

        expect(drawer.open).toBe(true);
        expect(drawer.primaryCtaLabel).toBe('Contact helper');
        expect(drawer.primaryCtaAriaLabel).toContain('Need water');
        expect(
            drawer.actions.some(action => action.action === 'contact_helper'),
        ).toBe(true);
    });
});
