import {
    MAXIMUM_DISCOVERY_RADIUS_METERS,
    MINIMUM_DISCOVERY_RADIUS_METERS,
} from './geo-constants.js';

export const aidCategories = [
    'food',
    'shelter',
    'medical',
    'transport',
    'childcare',
    'other',
] as const;

export const aidStatuses = [
    'open',
    'in-progress',
    'resolved',
    'closed',
] as const;

export type AidCategory = (typeof aidCategories)[number];
export type AidStatus = (typeof aidStatuses)[number];
export type AidUrgency = 'low' | 'medium' | 'high' | 'critical';

export type FeedTab = 'latest' | 'nearby';

export interface DiscoveryCenter {
    lat: number;
    lng: number;
}

export interface DiscoveryFilterState {
    dataset?: 'all' | 'community' | 'demo';
    feedTab: FeedTab;
    text?: string;
    category?: AidCategory;
    status?: AidStatus;
    minUrgency?: 1 | 2 | 3 | 4 | 5;
    center?: DiscoveryCenter;
    /** User supplied context for a coarse point; it is never geocoded. */
    areaLabel?: string;
    radiusMeters?: number;
    since?: string;
}

export interface SharedAidDiscoveryQuery {
    text?: string;
    category?: AidCategory;
    status?: AidStatus;
    minUrgency?: 1 | 2 | 3 | 4 | 5;
    since?: string;
    center?: DiscoveryCenter;
    radiusMeters?: number;
}

export const defaultDiscoveryFilterState: Readonly<DiscoveryFilterState> =
    Object.freeze({
        feedTab: 'latest' as const,
        status: 'open' as const,
    });

const parseInteger = (value: string | undefined): number | undefined => {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
};

const parseFloatNumber = (value: string | undefined): number | undefined => {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
};

const clamp = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
};

const normalizeText = (text: string | undefined): string | undefined => {
    if (!text) {
        return undefined;
    }

    const normalized = text.trim();
    return normalized.length > 0 ? normalized : undefined;
};

const normalizeCategory = (
    category: string | undefined,
): AidCategory | undefined => {
    if (!category) {
        return undefined;
    }

    return aidCategories.find(value => value === category);
};

const normalizeStatus = (status: string | undefined): AidStatus | undefined => {
    if (!status) {
        return undefined;
    }

    const normalizedStatus = status === 'in_progress' ? 'in-progress' : status;
    return aidStatuses.find(value => value === normalizedStatus);
};

const normalizeUrgency = (
    value: number | undefined,
): DiscoveryFilterState['minUrgency'] => {
    if (value === undefined || Number.isNaN(value)) {
        return undefined;
    }

    return clamp(Math.round(value), 1, 5) as DiscoveryFilterState['minUrgency'];
};

const normalizeRadius = (
    radiusMeters: number | undefined,
): number | undefined => {
    if (radiusMeters === undefined || Number.isNaN(radiusMeters)) {
        return undefined;
    }

    return clamp(
        Math.round(radiusMeters),
        MINIMUM_DISCOVERY_RADIUS_METERS,
        MAXIMUM_DISCOVERY_RADIUS_METERS,
    );
};

const normalizeFeedTab = (
    value: string | null | undefined,
): FeedTab | undefined => {
    if (value === 'nearby' || value === 'latest') {
        return value;
    }

    return undefined;
};

const normalizeCenter = (
    center: DiscoveryCenter | undefined,
): DiscoveryCenter | undefined => {
    if (!center) {
        return undefined;
    }

    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
        return undefined;
    }

    if (
        center.lat < -90 ||
        center.lat > 90 ||
        center.lng < -180 ||
        center.lng > 180
    ) {
        return undefined;
    }

    return {
        lat: Number(center.lat.toFixed(6)),
        lng: Number(center.lng.toFixed(6)),
    };
};

const normalizeSince = (value: string | undefined): string | undefined => {
    if (!value) {
        return undefined;
    }

    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        return undefined;
    }

    return new Date(timestamp).toISOString();
};

export function normalizeDiscoveryFilterState(
    state: Partial<DiscoveryFilterState>,
): DiscoveryFilterState {
    const feedTab: FeedTab = state.feedTab === 'nearby' ? 'nearby' : 'latest';
    const text = normalizeText(state.text);
    const category = normalizeCategory(state.category);
    const status = normalizeStatus(state.status);
    const minUrgency = normalizeUrgency(state.minUrgency);
    const center = normalizeCenter(state.center);
    const areaLabel = normalizeText(state.areaLabel);
    const radiusMeters = normalizeRadius(state.radiusMeters);
    const since = normalizeSince(state.since);

    return {
        feedTab,
        // Legacy dataset links now open the same integrated discovery view.
        ...(text ? { text } : {}),
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(minUrgency ? { minUrgency } : {}),
        ...(center ? { center } : {}),
        ...(areaLabel ? { areaLabel } : {}),
        ...(radiusMeters ? { radiusMeters } : {}),
        ...(since ? { since } : {}),
    };
}

export function applyDiscoveryFilterPatch(
    current: DiscoveryFilterState,
    patch: Partial<DiscoveryFilterState>,
): DiscoveryFilterState {
    return normalizeDiscoveryFilterState({
        ...current,
        ...patch,
    });
}

export function toggleCategoryFilter(
    current: DiscoveryFilterState,
    category: AidCategory,
): DiscoveryFilterState {
    return applyDiscoveryFilterPatch(current, {
        category: current.category === category ? undefined : category,
    });
}

export function toggleStatusFilter(
    current: DiscoveryFilterState,
    status: AidStatus,
): DiscoveryFilterState {
    return applyDiscoveryFilterPatch(current, {
        status: current.status === status ? undefined : status,
    });
}

export function toMapDiscoveryQuery(
    state: DiscoveryFilterState,
): SharedAidDiscoveryQuery {
    return {
        text: state.text,
        category: state.category,
        status: state.status,
        minUrgency: state.minUrgency,
        since: state.since,
        center: state.center,
        radiusMeters: state.radiusMeters,
    };
}

export function toFeedDiscoveryQuery(
    state: DiscoveryFilterState,
): SharedAidDiscoveryQuery {
    const includeNearby = state.feedTab === 'nearby';
    return {
        text: state.text,
        category: state.category,
        status: state.status,
        minUrgency: state.minUrgency,
        since: state.since,
        center: includeNearby ? state.center : undefined,
        radiusMeters: includeNearby ? state.radiusMeters : undefined,
    };
}

export function serializeDiscoveryFilterState(
    state: DiscoveryFilterState,
): string {
    const params = new URLSearchParams();


    if (state.feedTab === 'nearby') {
        params.set('tab', state.feedTab);
    }

    if (state.text) {
        params.set('q', state.text);
    }
    if (state.category) {
        params.set('cat', state.category);
    }
    if (state.status) {
        params.set('st', state.status);
    }
    if (state.minUrgency) {
        params.set('u', String(state.minUrgency));
    }
    if (state.radiusMeters) {
        params.set('r', String(state.radiusMeters));
    }
    if (state.center) {
        params.set('lat', String(state.center.lat));
        params.set('lng', String(state.center.lng));
    }
    if (state.areaLabel) {
        params.set('area', state.areaLabel);
    }
    if (state.since) {
        params.set('since', state.since);
    }

    const query = params.toString();
    return query.length > 0 ? `?${query}` : '';
}

export function parseDiscoveryFilterState(
    search: string,
    fallback: Partial<DiscoveryFilterState> = defaultDiscoveryFilterState,
): DiscoveryFilterState {
    const normalizedSearch = search.startsWith('?') ? search.slice(1) : search;
    const params = new URLSearchParams(normalizedSearch);

    const parsedTab = normalizeFeedTab(params.get('tab'));
    const parsedCategory = normalizeCategory(params.get('cat') ?? undefined);
    const parsedStatus = normalizeStatus(params.get('st') ?? undefined);
    const parsedCenter = {
        lat: parseFloatNumber(params.get('lat') ?? undefined) ?? Number.NaN,
        lng: parseFloatNumber(params.get('lng') ?? undefined) ?? Number.NaN,
    };

    return normalizeDiscoveryFilterState({
        ...fallback,

        feedTab:
            parsedTab ??
            fallback.feedTab ??
            defaultDiscoveryFilterState.feedTab,
        text: params.get('q') ?? fallback.text,
        category: parsedCategory ?? fallback.category,
        status: parsedStatus ?? fallback.status,
        minUrgency:
            (parseInteger(params.get('u') ?? undefined) as
                | DiscoveryFilterState['minUrgency']
                | undefined) ?? fallback.minUrgency,
        radiusMeters:
            parseInteger(params.get('r') ?? undefined) ?? fallback.radiusMeters,
        center:
            params.has('lat') || params.has('lng') ?
                parsedCenter
            :   fallback.center,
        areaLabel: params.get('area') ?? fallback.areaLabel,
        since: params.get('since') ?? fallback.since,
    });
}
