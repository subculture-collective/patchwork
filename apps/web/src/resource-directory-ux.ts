import { mapAidCategoryToDirectoryCategories } from '@patchwork/shared';
import {
    type DiscoveryFilterState,
    type SharedAidDiscoveryQuery,
    toMapDiscoveryQuery,
} from './discovery-filters.js';
import { MINIMUM_GEO_PRIVACY_RADIUS_METERS } from './geo-constants.js';
import { haversineDistanceMeters } from './geo-utils.js';

export type DirectoryResourceCategory =
    | 'food-bank'
    | 'shelter'
    | 'clinic'
    | 'legal-aid'
    | 'hotline'
    | 'other';

export interface ResourceDirectoryCard {
    uri: string;
    authorDid?: string;
    cid?: string;
    id: string;
    name: string;
    category: DirectoryResourceCategory;
    serviceArea?: string;
    verificationStatus?:
        | 'unverified'
        | 'community-verified'
        | 'partner-verified';
    operationalStatus?: 'open' | 'limited' | 'closed';
    createdAt?: string;
    updatedAt?: string;
    location: {
        lat: number;
        lng: number;
        precisionMeters: number;
        areaLabel?: string;
    };
    openHours?: string;
    eligibilityNotes?: string;
    contact: {
        url?: string;
        phone?: string;
    };
    exactPublicAddress?: {
        kind: 'exact-public-resource';
        streetAddress: string;
        latitude: number;
        longitude: number;
        approvalExpiresAt: string;
    };
    distanceMeters?: number;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

export type ResourceDetail = Omit<ResourceDirectoryCard, 'location'> & { location?: ResourceDirectoryCard['location'] };

export interface ResourceOverlayMarker {
    uri: string;
    id: string;
    category: DirectoryResourceCategory;
    lat: number;
    lng: number;
    radiusMeters: number;
    label: string;
    exact: boolean;
}

export interface ResourceOverlayFilters {
    category?: DirectoryResourceCategory;
}

export interface ResourceOverlayViewModel {
    query: SharedAidDiscoveryQuery;
    cards: readonly ResourceDirectoryCard[];
    overlays: readonly ResourceOverlayMarker[];
    activeCategoryFilter?: DirectoryResourceCategory;
}

export const currentExactPublicAddress = (
    resource: Pick<ResourceDirectoryCard, 'exactPublicAddress'>,
    nowMs = Date.now(),
): ResourceDirectoryCard['exactPublicAddress'] | undefined => {
    const exact = resource.exactPublicAddress;
    const expiresAt = exact ? Date.parse(exact.approvalExpiresAt) : NaN;
    return exact && Number.isFinite(expiresAt) && expiresAt > nowMs
        ? exact
        : undefined;
};

export interface ResourceDetailAction {
    id: 'request_intake' | 'view_contact' | 'open_map';
    label: string;
    ariaLabel: string;
}

export interface ResourceDetailPanelModel {
    open: boolean;
    selectedUri?: string;
    title?: string;
    categoryLabel?: string;
    openHours?: string;
    eligibilityNotes?: string;
    exactPublicAddress?: string;
    exactAddressApprovalExpiresAt?: string;
    actions: readonly ResourceDetailAction[];
}

export type ResourceDirectoryUiState =
    | {
          status: 'loading';
          message: string;
          ariaLiveMessage: string;
      }
    | {
          status: 'error';
          message: string;
          ariaLiveMessage: string;
      }
    | {
          status: 'empty';
          message: string;
          ariaLiveMessage: string;
      }
    | {
          status: 'ready';
          message: string;
          ariaLiveMessage: string;
      };

const resourceMatchesText = (
    resource: ResourceDirectoryCard,
    text: string,
): boolean => {
    const haystack = [
        resource.name,
        resource.openHours ?? '',
        resource.eligibilityNotes ?? '',
        resource.location.areaLabel ?? '',
    ]
        .join(' ')
        .toLowerCase();

    return haystack.includes(text.toLowerCase());
};

const toOverlayMarker = (
    resource: ResourceDirectoryCard,
): ResourceOverlayMarker => {
    const exact = currentExactPublicAddress(resource);
    if (exact) {
        return {
            uri: resource.uri,
            id: resource.id,
            category: resource.category,
            lat: Number(exact.latitude.toFixed(6)),
            lng: Number(exact.longitude.toFixed(6)),
            radiusMeters: 0,
            label: resource.name,
            exact: true,
        };
    }

    const precisionMeters = Math.max(
        MINIMUM_GEO_PRIVACY_RADIUS_METERS,
        Math.round(resource.location.precisionMeters),
    );

    return {
        uri: resource.uri,
        id: resource.id,
        category: resource.category,
        lat: Number(resource.location.lat.toFixed(6)),
        lng: Number(resource.location.lng.toFixed(6)),
        radiusMeters: precisionMeters,
        label: resource.location.areaLabel ?? resource.name,
        exact: false,
    };
};

const toCategoryLabel = (category: DirectoryResourceCategory): string => {
    if (category === 'food-bank') {
        return 'Food bank';
    }
    if (category === 'legal-aid') {
        return 'Legal aid';
    }
    return category.charAt(0).toUpperCase() + category.slice(1);
};

export const filterResourceDirectoryCards = (
    cards: readonly ResourceDirectoryCard[],
    state: DiscoveryFilterState,
    filters: ResourceOverlayFilters = {},
): ResourceDirectoryCard[] => {
    const query = toMapDiscoveryQuery(state);
    const categoryFilters = mapAidCategoryToDirectoryCategories(state.category);

    return cards
        .filter(card => {
            if (filters.category && card.category !== filters.category) {
                return false;
            }

            if (
                categoryFilters.length > 0 &&
                !categoryFilters.includes(card.category)
            ) {
                return false;
            }

            if (query.text && !resourceMatchesText(card, query.text)) {
                return false;
            }

            if (query.center && query.radiusMeters !== undefined) {
                const distance = haversineDistanceMeters(
                    query.center,
                    card.location,
                );
                if (distance > query.radiusMeters) {
                    return false;
                }
            }

            return true;
        })
        .sort((left, right) => {
            if (
                left.distanceMeters !== undefined &&
                right.distanceMeters !== undefined &&
                left.distanceMeters !== right.distanceMeters
            ) {
                return left.distanceMeters - right.distanceMeters;
            }

            return left.name.localeCompare(right.name);
        });
};

export const buildResourceOverlayViewModel = (
    cards: readonly ResourceDirectoryCard[],
    state: DiscoveryFilterState,
    filters: ResourceOverlayFilters = {},
): ResourceOverlayViewModel => {
    const query = toMapDiscoveryQuery(state);
    const filtered = filterResourceDirectoryCards(cards, state, filters);

    return {
        query,
        cards: filtered,
        overlays: filtered.map(card => toOverlayMarker(card)),
        activeCategoryFilter: filters.category,
    };
};

export const openResourceDetailPanel = (
    cards: readonly ResourceDetail[],
    selectedUri: string,
): ResourceDetailPanelModel => {
    const selected = cards.find(card => card.uri === selectedUri);
    if (!selected) {
        return {
            open: false,
            actions: [],
        };
    }
    const exactPublicAddress = currentExactPublicAddress(selected);

    return {
        open: true,
        selectedUri,
        title: selected.name,
        categoryLabel: toCategoryLabel(selected.category),
        openHours: selected.openHours ?? 'Hours unavailable',
        eligibilityNotes:
            selected.eligibilityNotes ?? 'Eligibility details unavailable',
        exactPublicAddress: exactPublicAddress?.streetAddress,
        exactAddressApprovalExpiresAt:
            exactPublicAddress?.approvalExpiresAt,
        actions: [
            {
                id: 'request_intake',
                label: 'Request intake',
                ariaLabel: `Request intake from ${selected.name}`,
            },
            {
                id: 'view_contact',
                label: 'View contact info',
                ariaLabel: `View contact info for ${selected.name}`,
            },
            {
                id: 'open_map',
                label: 'Open map directions',
                ariaLabel: `Open map directions to ${selected.name}`,
            },
        ],
    };
};

export const closeResourceDetailPanel = (): ResourceDetailPanelModel => {
    return {
        open: false,
        actions: [],
    };
};

export const resolveResourceDirectoryUiState = (params: {
    loading: boolean;
    errorMessage?: string;
    resources: readonly ResourceDirectoryCard[];
    activeCategoryFilter?: DirectoryResourceCategory;
}): ResourceDirectoryUiState => {
    if (params.loading) {
        return {
            status: 'loading',
            message: 'Loading directory resources…',
            ariaLiveMessage: 'Loading resource directory results.',
        };
    }

    if (params.errorMessage) {
        return {
            status: 'error',
            message: params.errorMessage,
            ariaLiveMessage:
                'Resource directory failed to load. Please retry or adjust filters.',
        };
    }

    if (params.resources.length === 0) {
        const reason =
            params.activeCategoryFilter ?
                ` for ${toCategoryLabel(params.activeCategoryFilter)}`
            :   '';

        return {
            status: 'empty',
            message: `No resources found${reason}.`,
            ariaLiveMessage: `No resources match current filters${reason}.`,
        };
    }

    return {
        status: 'ready',
        message: `${params.resources.length} resources available.`,
        ariaLiveMessage: `${params.resources.length} directory resources loaded.`,
    };
};
