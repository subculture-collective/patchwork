import { defaultDiscoveryFilterState } from '../../discovery-filters';
import { buildFeedViewModel, createFeedCard } from '../../feed-ux';
import { validatePostingDraft } from '../../posting-form';
import {
    buildResourceOverlayViewModel,
    openResourceDetailPanel,
    resolveResourceDirectoryUiState,
    type ResourceDirectoryCard,
} from '../../resource-directory-ux';

export const feedSurfacePreview = buildFeedViewModel(
    [
        createFeedCard({
            id: 'feed-1',
            title: 'Need evening meal support',
            description: 'Two households need meal kits before 21:00.',
            category: 'food',
            urgency: 5,
            status: 'open',
            updatedAt: '2026-02-27T18:00:00.000Z',
            location: { lat: 1.3001, lng: 103.8001, precisionKm: 1 },
        }),
        createFeedCard({
            id: 'feed-2',
            title: 'Clinic transport needed',
            description: 'Wheelchair-access transport request to clinic.',
            category: 'transport',
            urgency: 4,
            status: 'in-progress',
            updatedAt: '2026-02-27T17:10:00.000Z',
            location: { lat: 1.305, lng: 103.812, precisionKm: 1 },
        }),
    ],
    {
        ...defaultDiscoveryFilterState,
        status: undefined,
    },
);

export const toFeedSurfaceTone = (
    tone: 'default' | 'neutral' | 'info' | 'success' | 'danger',
): 'default' | 'neutral' | 'info' | 'success' | 'danger' => tone;

export const postingSurfaceValidation = validatePostingDraft({
    title: 'Need urgent grocery support',
    description: 'Family with mobility constraints needs delivery tonight.',
    category: 'food',
    urgency: 4,
    accessibilityTags: ['wheelchair', 'quiet-arrival'],
    location: {
        lat: 1.3012,
        lng: 103.8012,
        precisionMeters: 250,
    },
    timeWindow: {
        startAt: '2026-02-27T19:00:00.000Z',
        endAt: '2026-02-27T22:00:00.000Z',
    },
});

const resourceSurfaceCards: ResourceDirectoryCard[] = [
    {
        uri: 'at://did:example:resource/app.patchwork.directory.resource/food-01',
        id: 'food-01',
        name: 'Sunrise Food Bank',
        category: 'food-bank',
        location: {
            lat: 1.3004,
            lng: 103.801,
            precisionMeters: 180,
            areaLabel: 'Central district',
        },
        openHours: 'Daily · 09:00–20:00',
        eligibilityNotes: 'Walk-ins accepted, ID optional',
        contact: { phone: '+1-555-0110' },
    },
    {
        uri: 'at://did:example:resource/app.patchwork.directory.resource/clinic-01',
        id: 'clinic-01',
        name: 'Neighborhood Clinic',
        category: 'clinic',
        location: {
            lat: 1.3055,
            lng: 103.808,
            precisionMeters: 220,
            areaLabel: 'North lane',
        },
        openHours: 'Mon–Sat · 10:00–18:00',
        eligibilityNotes: 'Urgent triage available',
        contact: { phone: '+1-555-0191' },
    },
];

export const resourceSurfacePreview = buildResourceOverlayViewModel(
    resourceSurfaceCards,
    {
        ...defaultDiscoveryFilterState,
        status: undefined,
        category: 'food',
        center: { lat: 1.3, lng: 103.8 },
        radiusMeters: 5000,
    },
    {
        category: 'food-bank',
    },
);

export const resourceSurfaceUiState = resolveResourceDirectoryUiState({
    loading: false,
    resources: resourceSurfacePreview.cards,
    activeCategoryFilter: resourceSurfacePreview.activeCategoryFilter,
});

const selectedResourceUri =
    resourceSurfacePreview.cards[0]?.uri ?? resourceSurfaceCards[0]!.uri;

export const resourceSurfaceDetail = openResourceDetailPanel(
    resourceSurfacePreview.cards,
    selectedResourceUri,
);

export const volunteerSurfacePreview = {
    profileComplete: true,
    fullyVerified: false,
    verificationTier: 'basic' as const,
    verificationExpired: false,
    renewalNeeded: true,
    summary: {
        approved: 2,
        pending: 1,
        rejected: 0,
    },
};
