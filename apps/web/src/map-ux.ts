import {
    toMapDiscoveryQuery,
    type AidCategory,
    type AidStatus,
    type DiscoveryCenter,
    type DiscoveryFilterState,
    type SharedAidDiscoveryQuery,
} from './discovery-filters.js';
import { haversineDistanceMeters } from './geo-utils.js';

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
}

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

export function buildMapViewModel(
    cards: readonly MapAidCard[],
    state: DiscoveryFilterState,
): MapViewModel {
    const query = toMapDiscoveryQuery(state);
    const filteredCards = filterMapCards(cards, state);
    return {
        query,
        filteredCards,
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
