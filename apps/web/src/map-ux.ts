import {
    toMapDiscoveryQuery,
    type AidCategory,
    type AidStatus,
    type DiscoveryCenter,
    type DiscoveryFilterState,
    type SharedAidDiscoveryQuery,
} from './discovery-filters.js';
import { haversineDistanceMeters } from './geo-utils.js';
import { PUBLIC_MIN_PRECISION_KM } from '@patchwork/shared';

export interface MapAidLocation {
    lat: number;
    lng: number;
    precisionKm: number;
    areaLabel?: string;
}

/**
 * Canonical lifecycle statuses from the lifecycle state machine.
 */
export type MapLifecycleStatus =
    | 'open'
    | 'triaged'
    | 'assigned'
    | 'in_progress'
    | 'resolved'
    | 'archived';

export interface MapAidCard {
    id: string;
    title: string;
    summary: string;
    category: AidCategory;
    status: AidStatus;
    lifecycleStatus?: MapLifecycleStatus;
    urgency: 1 | 2 | 3 | 4 | 5;
    updatedAt: string;
    location?: MapAidLocation;
}

export interface ApproximateMapMarker {
    id: string;
    lat: number;
    lng: number;
    radiusMeters: number;
    label: string;
    urgency: MapAidCard['urgency'];
    status: MapAidCard['status'];
    lifecycleStatus?: MapLifecycleStatus;
}

export interface MapCluster {
    id: string;
    count: number;
    postIds: string[];
    lat: number;
    lng: number;
    radiusMeters: number;
    urgencyMax: 1 | 2 | 3 | 4 | 5;
    status: AidStatus;
    label: string;
}

export type MapTriageAction =
    | 'contact_helper'
    | 'mark_in_progress'
    | 'mark_resolved'
    | 'transition_triaged'
    | 'transition_assigned'
    | 'transition_in_progress'
    | 'transition_resolved'
    | 'transition_archived';

export interface MapDetailDrawerAction {
    action: MapTriageAction;
    label: string;
    ariaLabel: string;
}

export interface MapDetailDrawerModel {
    open: boolean;
    selectedPostId?: string;
    title?: string;
    summary?: string;
    status?: AidStatus;
    lifecycleStatus?: MapLifecycleStatus;
    primaryCtaLabel?: string;
    primaryCtaAriaLabel?: string;
    actions: MapDetailDrawerAction[];
}

export interface MapViewModel {
    query: SharedAidDiscoveryQuery;
    filteredCards: MapAidCard[];
    markers: ApproximateMapMarker[];
    clusters: MapCluster[];
}

const normalizePrecision = (precisionKm: number): number => {
    return Math.max(PUBLIC_MIN_PRECISION_KM * 1000, Math.round(precisionKm * 1000));
};

const snapLocation = (
    lat: number,
    lng: number,
    precisionMeters: number,
): { lat: number; lng: number } => {
    const metersPerLatDegree = 111_320;
    const latStep = precisionMeters / metersPerLatDegree;
    const lngStep =
        precisionMeters /
        Math.max(1, metersPerLatDegree * Math.cos((lat * Math.PI) / 180));

    return {
        lat: Number((Math.round(lat / latStep) * latStep).toFixed(6)),
        lng: Number((Math.round(lng / lngStep) * lngStep).toFixed(6)),
    };
};

const stableHash = (value: string): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
};

const displaceLocation = (
    id: string,
    location: { lat: number; lng: number },
    precisionMeters: number,
): { lat: number; lng: number } => {
    const angle =
        (stableHash(`angle:${id}`) / 0x1_0000_0000) * Math.PI * 2;
    const distanceRatio =
        0.3 + (stableHash(`distance:${id}`) / 0x1_0000_0000) * 0.15;
    const distanceMeters = precisionMeters * distanceRatio;
    const metersPerLatDegree = 111_320;
    const lat =
        location.lat +
        (Math.cos(angle) * distanceMeters) / metersPerLatDegree;
    const lng =
        location.lng +
        (Math.sin(angle) * distanceMeters) /
            Math.max(
                1,
                metersPerLatDegree * Math.cos((location.lat * Math.PI) / 180),
            );

    return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
    };
};

const cardMatchesText = (card: MapAidCard, text: string): boolean => {
    const haystack = [card.title, card.summary, card.location?.areaLabel]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(text.toLowerCase());
};

const cardInRadius = (
    card: MapAidCard,
    center: DiscoveryCenter,
    radiusMeters: number,
): boolean => {
    if (!card.location) {
        return false;
    }

    return haversineDistanceMeters(center, card.location) <= radiusMeters;
};

const toClusterStatus = (cards: readonly MapAidCard[]): AidStatus => {
    if (cards.some(card => card.status === 'open')) {
        return 'open';
    }
    if (cards.some(card => card.status === 'in-progress')) {
        return 'in-progress';
    }
    if (cards.some(card => card.status === 'resolved')) {
        return 'resolved';
    }
    return 'closed';
};

export function toApproximateMapMarker(
    card: MapAidCard,
): ApproximateMapMarker | undefined {
    if (!card.location) {
        return undefined;
    }

    const precisionMeters = normalizePrecision(card.location.precisionKm);
    const snapped = snapLocation(card.location.lat, card.location.lng, precisionMeters);
    const displaced = displaceLocation(card.id, snapped, precisionMeters);

    return {
        id: card.id,
        lat: displaced.lat,
        lng: displaced.lng,
        radiusMeters: precisionMeters,
        label: card.location.areaLabel ?? card.category,
        urgency: card.urgency,
        status: card.status,
        lifecycleStatus: card.lifecycleStatus,
    };
}

export function filterMapCards(
    cards: readonly MapAidCard[],
    state: DiscoveryFilterState,
): MapAidCard[] {
    const query = toMapDiscoveryQuery(state);
    const sinceMs = query.since ? Date.parse(query.since) : undefined;

    return cards.filter(card => {
        if (query.text && !cardMatchesText(card, query.text)) {
            return false;
        }
        if (query.category && card.category !== query.category) {
            return false;
        }
        if (query.status && card.status !== query.status) {
            return false;
        }
        if (query.minUrgency && card.urgency < query.minUrgency) {
            return false;
        }
        if (sinceMs !== undefined && Date.parse(card.updatedAt) < sinceMs) {
            return false;
        }
        if (query.center && query.radiusMeters !== undefined) {
            return cardInRadius(card, query.center, query.radiusMeters);
        }

        return true;
    });
}

export function clusterMapCards(
    cards: readonly MapAidCard[],
    clusterDistanceMeters = 1200,
): MapCluster[] {
    const located = cards
        .map(card => ({ card, marker: toApproximateMapMarker(card) }))
        .filter(
            (
                value,
            ): value is { card: MapAidCard; marker: ApproximateMapMarker } =>
                Boolean(value.marker),
        );
    const parents = located.map((_, index) => index);
    const find = (index: number): number => {
        let root = index;
        while (parents[root] !== root) {
            root = parents[root] ?? root;
        }
        while (parents[index] !== index) {
            const next = parents[index] ?? index;
            parents[index] = root;
            index = next;
        }
        return root;
    };
    const union = (left: number, right: number): void => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) {
            parents[rightRoot] = leftRoot;
        }
    };

    for (let left = 0; left < located.length; left += 1) {
        for (let right = left + 1; right < located.length; right += 1) {
            const leftMarker = located[left]?.marker;
            const rightMarker = located[right]?.marker;
            if (
                leftMarker &&
                rightMarker &&
                haversineDistanceMeters(leftMarker, rightMarker) <=
                    clusterDistanceMeters
            ) {
                union(left, right);
            }
        }
    }

    const groups = new Map<number, typeof located>();
    for (let index = 0; index < located.length; index += 1) {
        const root = find(index);
        const group = groups.get(root) ?? [];
        const entry = located[index];
        if (entry) {
            group.push(entry);
            groups.set(root, group);
        }
    }

    return [...groups.values()].map(group => {
        const groupedCards = group.map(entry => entry.card);
        const markers = group.map(entry => entry.marker);
        const lat = markers.reduce((sum, marker) => sum + marker.lat, 0) / markers.length;
        const lng = markers.reduce((sum, marker) => sum + marker.lng, 0) / markers.length;
        const radiusMeters = Math.max(
            ...markers.map(
                marker =>
                    haversineDistanceMeters({ lat, lng }, marker) +
                    marker.radiusMeters,
            ),
        );
        const urgencyMax = Math.max(...groupedCards.map(card => card.urgency)) as
            | 1
            | 2
            | 3
            | 4
            | 5;

        return {
            id: `cluster-${groupedCards.map(card => card.id).sort().join('-')}`,
            count: groupedCards.length,
            postIds: groupedCards.map(card => card.id),
            lat,
            lng,
            radiusMeters,
            urgencyMax,
            status: toClusterStatus(groupedCards),
            label: `${groupedCards.length} ${groupedCards.length === 1 ? 'request' : 'requests'} in approximate area`,
        } satisfies MapCluster;
    });
}

export function clusterDistanceMetersForZoom(
    zoom: number,
    latitude: number,
): number {
    const clusterRadiusPixels =
        zoom <= 10 ? 96
        : zoom === 11 ? 52
        : 44;
    const metersPerPixel =
        (156_543.033_92 *
            Math.max(0.05, Math.cos((latitude * Math.PI) / 180))) /
        2 ** Math.max(0, zoom);
    return Math.max(250, metersPerPixel * clusterRadiusPixels);
}

export function clusterExpansionZoom(
    cards: readonly MapAidCard[],
    postIds: readonly string[],
    currentZoom: number,
    latitude: number,
): number {
    const selectedIds = new Set(postIds);
    const selectedCards = cards.filter(card => selectedIds.has(card.id));
    for (let zoom = Math.floor(currentZoom) + 1; zoom <= 18; zoom += 1) {
        if (
            clusterMapCards(
                selectedCards,
                clusterDistanceMetersForZoom(zoom, latitude),
            ).length > 1
        ) {
            return zoom;
        }
    }
    return Math.min(18, Math.floor(currentZoom) + 1);
}

export function buildMapViewModel(
    cards: readonly MapAidCard[],
    state: DiscoveryFilterState,
): MapViewModel {
    const query = toMapDiscoveryQuery(state);
    const filteredCards = filterMapCards(cards, state);
    const markers = filteredCards
        .map(toApproximateMapMarker)
        .filter((value): value is ApproximateMapMarker => Boolean(value));
    const clusters = clusterMapCards(filteredCards);

    return {
        query,
        filteredCards,
        markers,
        clusters,
    };
}

/**
 * Lifecycle transition actions available from the map detail drawer,
 * based on the current lifecycle status.
 */
const LIFECYCLE_DRAWER_TRANSITIONS: Partial<
    Record<
        MapLifecycleStatus,
        Array<{ action: MapTriageAction; label: string }>
    >
> = {
    open: [
        { action: 'transition_triaged', label: 'Triage' },
        { action: 'transition_resolved', label: 'Resolve' },
    ],
    triaged: [
        { action: 'transition_assigned', label: 'Assign' },
        { action: 'transition_resolved', label: 'Resolve' },
    ],
    assigned: [
        { action: 'transition_in_progress', label: 'Start work' },
        { action: 'transition_resolved', label: 'Resolve' },
    ],
    in_progress: [
        { action: 'transition_resolved', label: 'Resolve' },
        { action: 'transition_assigned', label: 'Reassign' },
    ],
    resolved: [{ action: 'transition_archived', label: 'Archive' }],
};

export function openMapDetailDrawer(
    cards: readonly MapAidCard[],
    selectedPostId: string,
): MapDetailDrawerModel {
    const selected = cards.find(card => card.id === selectedPostId);
    if (!selected) {
        return { open: false, actions: [] };
    }

    const actions: MapDetailDrawerAction[] = [
        {
            action: 'contact_helper',
            label: 'Contact helper',
            ariaLabel: `Contact helper for ${selected.title}`,
        },
    ];

    // Legacy triage actions (backward compatible)
    if (selected.status === 'open') {
        actions.push({
            action: 'mark_in_progress',
            label: 'Mark in progress',
            ariaLabel: `Mark ${selected.title} as in progress`,
        });
        actions.push({
            action: 'mark_resolved',
            label: 'Mark resolved',
            ariaLabel: `Mark ${selected.title} as resolved`,
        });
    }

    if (selected.status === 'in-progress') {
        actions.push({
            action: 'mark_resolved',
            label: 'Mark resolved',
            ariaLabel: `Mark ${selected.title} as resolved`,
        });
    }

    // Lifecycle state machine transition actions
    if (selected.lifecycleStatus) {
        const lifecycleTransitions =
            LIFECYCLE_DRAWER_TRANSITIONS[selected.lifecycleStatus] ?? [];
        for (const { action, label } of lifecycleTransitions) {
            actions.push({
                action,
                label,
                ariaLabel: `${label} request "${selected.title}"`,
            });
        }
    }

    return {
        open: true,
        selectedPostId: selected.id,
        title: selected.title,
        summary: selected.summary,
        status: selected.status,
        lifecycleStatus: selected.lifecycleStatus,
        primaryCtaLabel: 'Contact helper',
        primaryCtaAriaLabel: `Contact helper for ${selected.title}`,
        actions,
    };
}

export function closeMapDetailDrawer(): MapDetailDrawerModel {
    return {
        open: false,
        actions: [],
    };
}
