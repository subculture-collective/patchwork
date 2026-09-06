import {
    aidCategories,
    aidStatuses,
    type AidCategory,
    type AidStatus,
    type DiscoveryFilterState,
} from '../discovery-filters';
import { createFeedCard } from '../feed-ux';
import type { NormalizedAidPostingDraft } from '../posting-form';
import type {
    DirectoryResourceCategory,
    ResourceDirectoryCard,
    ResourceDetail,
} from '../resource-directory-ux';
import {
    type FeedRecordEnvelope,
} from './discovery-runtime';
import type {
    AccountPreferences,
    Notification,
    NotificationFilter,
    NotificationType,
    ModerationAuditRecord,
    ModerationPolicyAction,
    ModerationQueueItem,
    SettingsChangeAudit,
    UserSettings,
} from '@patchwork/shared';
import {
    aidPostSchema,
    directoryResourceSchema,
    volunteerProfileSchema,
    type AidPostRecord,
    type DirectoryResourceRecord,
    type VolunteerProfileRecord,
} from '@patchwork/at-lexicons';
import { enforceMinimumGeoPrecisionKm } from '@patchwork/shared';
import {
    CURRENT_POLICY_VERSION,
    accountPreferenceSchema,
    requiredPolicyDocuments,
} from '@patchwork/shared';

export type ApiDataOrigin = 'api' | 'fixture' | 'idle' | 'unavailable';

export interface ApiClientSuccess<TData> {
    ok: true;
    data: TData;
}

export interface ApiClientFailure {
    ok: false;
    error: string;
    code: string;
    kind: 'network' | 'authentication' | 'validation' | 'conflict' | 'server';
    retryable: boolean;
}

export type ApiClientResult<TData> = ApiClientSuccess<TData> | ApiClientFailure;

export interface PagedResult<T> {
    items: T[];
    page: number;
    pageSize: number;
    total: number;
    hasNextPage: boolean;
    projectionFreshness?: unknown;
}

export type AidPostReportReason = 'spam' | 'abuse' | 'fraud' | 'other';

export interface AccountOnboardingStatus {
    policyVersion: string;
    requiredDocuments: string[];
    consentRequired: boolean;
    acceptedAt: string | null;
}

export interface SafetyMutationResult {
    created: boolean;
}

export interface MaintenanceState {
    active: boolean;
    reasonCodes: string[];
    publicMessage: string;
    activatedAt: string | null;
    resumedAt: string | null;
    version: number;
    updatedAt: string;
    environmentOverride: boolean;
}

export type MaintenanceReasonCode =
    | 'privacy'
    | 'authorization'
    | 'abuse'
    | 'integrity'
    | 'moderation-backlog'
    | 'monitoring'
    | 'backup';

export interface ChatInitiationApiResult {
    conversationUri: string;
    created: boolean;
    transportPath: 'atproto-direct' | 'resource-fallback' | 'manual-fallback';
    fallbackNotice?: {
        code: 'RECIPIENT_CAPABILITY_MISSING';
        message: string;
        safeForUser: true;
        transportPath?:
            | 'atproto-direct'
            | 'resource-fallback'
            | 'manual-fallback';
    };
}

export interface AidPostCreateApiInput {
    draft: NormalizedAidPostingDraft;
    rkey: string;
    now?: string;
    trustScore?: number;
}

const DEFAULT_API_BASE_URL = '/api';
const DEFAULT_BROWSER_ORIGIN = 'http://localhost';
const REQUEST_TIMEOUT_MS = 6_000;
const DEFAULT_NEARBY_RADIUS_KM = 20;
const DEFAULT_FEED_RADIUS_KM = 100;
const DEFAULT_DISCOVERY_PAGE_SIZE = 20;

const csrfHeaders = (): Record<string, string> => {
    if (typeof document === 'undefined') return {};
    for (const cookie of document.cookie.split(';')) {
        const [name, ...parts] = cookie.trim().split('=');
        if (name === 'patchwork_csrf') {
            try {
                return { 'x-csrf-token': decodeURIComponent(parts.join('=')) };
            } catch {
                return {};
            }
        }
    }
    return {};
};

const newIdempotencyKey = (): string => globalThis.crypto.randomUUID();

type AidQueryScope = 'map' | 'feed';

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const readString = (
    value: Record<string, unknown>,
    key: string,
): string | undefined => {
    const raw = value[key];
    return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
};

const readNumber = (
    value: Record<string, unknown>,
    key: string,
): number | undefined => {
    const raw = value[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }

    if (typeof raw === 'string' && raw.trim().length > 0) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return undefined;
};

const toApiUrgency = (
    minUrgency: DiscoveryFilterState['minUrgency'],
): 'low' | 'medium' | 'high' | 'critical' | undefined => {
    if (!minUrgency) {
        return undefined;
    }

    if (minUrgency >= 5) {
        return 'critical';
    }
    if (minUrgency >= 4) {
        return 'high';
    }
    if (minUrgency >= 3) {
        return 'medium';
    }

    return 'low';
};

const toFreshnessHours = (since: string | undefined): number | undefined => {
    if (!since) {
        return undefined;
    }

    const parsed = Date.parse(since);
    if (Number.isNaN(parsed)) {
        return undefined;
    }

    const hours = Math.ceil(Math.max(0, Date.now() - parsed) / 3_600_000);
    return Math.max(1, hours);
};

const toRadiusKm = (radiusMeters: number): number => {
    const km = radiusMeters / 1000;
    return Math.min(250, Math.max(0.3, Number(km.toFixed(2))));
};

const buildAidQueryParams = (
    state: DiscoveryFilterState,
    scope: AidQueryScope,
    page = 1,
): URLSearchParams => {
    const fallbackRadiusKm =
        scope === 'feed' && state.feedTab === 'latest' ?
            DEFAULT_FEED_RADIUS_KM
        :   DEFAULT_NEARBY_RADIUS_KM;

    const center = scope === 'map' || state.feedTab === 'nearby' ? state.center : undefined;
    const radiusKm =
        state.radiusMeters !== undefined ?
            toRadiusKm(state.radiusMeters)
        :   fallbackRadiusKm;

    const params = new URLSearchParams({
        page: String(page),
        pageSize: String(DEFAULT_DISCOVERY_PAGE_SIZE),
    });
    if (center) {
        params.set('latitude', center.lat.toFixed(6));
        params.set('longitude', center.lng.toFixed(6));
        params.set('radiusKm', String(radiusKm));
    }

    if (state.category) {
        params.set('category', state.category);
    }

    if (state.status) {
        params.set('status', state.status);
    }

    const urgency = toApiUrgency(state.minUrgency);
    if (urgency) {
        params.set('urgency', urgency);
    }

    if (state.text) {
        params.set('searchText', state.text);
    }

    const freshnessHours = toFreshnessHours(state.since);
    if (freshnessHours) {
        params.set('freshnessHours', String(freshnessHours));
    }

    return params;
};

const buildDirectoryQueryParams = (
    state: DiscoveryFilterState,
    page = 1,
): URLSearchParams => {
    const center = state.center;
    const radiusKm =
        state.radiusMeters !== undefined ?
            toRadiusKm(state.radiusMeters)
        :   DEFAULT_NEARBY_RADIUS_KM;

    const params = new URLSearchParams({
        page: String(page),
        pageSize: String(DEFAULT_DISCOVERY_PAGE_SIZE),
    });
    if (center) {
        params.set('latitude', center.lat.toFixed(6));
        params.set('longitude', center.lng.toFixed(6));
        params.set('radiusKm', String(radiusKm));
    }

    if (state.text) {
        params.set('searchText', state.text);
    }

    const freshnessHours = toFreshnessHours(state.since);
    if (freshnessHours) {
        params.set('freshnessHours', String(freshnessHours));
    }

    return params;
};

const readApiBaseUrl = (): string => {
    const configured = import.meta.env.VITE_API_BASE_URL;
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured;
    }

    return DEFAULT_API_BASE_URL;
};

const joinApiPath = (basePath: string, path: string): string => {
    const trimmedBase = basePath.replace(/\/+$/, '');
    const trimmedPath = path.replace(/^\/+/, '');

    if (!trimmedBase) {
        return `/${trimmedPath}`;
    }

    return `${trimmedBase}/${trimmedPath}`;
};

const resolveApiUrl = (path: string, params: URLSearchParams): string => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const baseUrl = readApiBaseUrl();

    let url: URL;
    if (/^https?:\/\//i.test(baseUrl)) {
        const parsedBase = new URL(baseUrl);
        url = new URL(
            joinApiPath(parsedBase.pathname, normalizedPath),
            `${parsedBase.origin}/`,
        );
        url.search = parsedBase.search;
    } else {
        const origin =
            typeof window !== 'undefined' ?
                window.location.origin
            :   DEFAULT_BROWSER_ORIGIN;
        const parsedBase = new URL(
            baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`,
            origin,
        );
        url = new URL(
            joinApiPath(parsedBase.pathname, normalizedPath),
            `${parsedBase.origin}/`,
        );
        url.search = parsedBase.search;
    }

    url.search = params.toString();
    return url.toString();
};

const toErrorMessage = (payload: unknown, fallback: string): string => {
    if (!isRecord(payload)) {
        return fallback;
    }

    const errorPayload = payload['error'];
    if (!isRecord(errorPayload)) {
        return fallback;
    }

    return readString(errorPayload, 'message') ?? fallback;
};

const toErrorCode = (payload: unknown, fallback: string): string => {
    if (!isRecord(payload) || !isRecord(payload['error'])) return fallback;
    return readString(payload['error'], 'code') ?? fallback;
};

const failureForResponse = (
    payload: unknown,
    status: number,
): ApiClientFailure => {
    const kind: ApiClientFailure['kind'] =
        status === 401 || status === 403 ? 'authentication'
        : status === 409 ? 'conflict'
        : status === 400 || status === 422 ? 'validation'
        : 'server';
    return {
        ok: false,
        error: toErrorMessage(payload, `API request failed (${status}).`),
        code: toErrorCode(payload, `HTTP_${status}`),
        kind,
        retryable: status === 408 || status === 429 || status >= 500,
    };
};

const networkFailure = (error: unknown): ApiClientFailure => ({
    ok: false,
    error:
        error instanceof Error ? error.message : 'Unable to reach API endpoint.',
    code: error instanceof DOMException && error.name === 'AbortError' ?
        'REQUEST_TIMEOUT'
    :   'NETWORK_ERROR',
    kind: 'network',
    retryable: true,
});

const invalidResponseFailure = (message: string): ApiClientFailure => ({
    ok: false,
    error: message,
    code: 'INVALID_API_RESPONSE',
    kind: 'validation',
    retryable: false,
});

const areaRequiredFailure = (): ApiClientFailure => ({
    ok: false,
    error: 'Choose an approximate area before loading nearby or map results.',
    code: 'AREA_REQUIRED',
    kind: 'validation',
    retryable: false,
});

const parseSafetyMutationResult = <
    TIdField extends 'reportId' | 'blockId',
>(
    payload: unknown,
    idField: TIdField,
): ApiClientResult<SafetyMutationResult & Record<TIdField, string>> => {
    if (!isRecord(payload)) {
        return invalidResponseFailure('Safety command response was malformed.');
    }
    const id = readString(payload, idField);
    const created = payload['created'];
    if (!id || typeof created !== 'boolean') {
        return invalidResponseFailure('Safety command response was malformed.');
    }
    return {
        ok: true,
        data: { [idField]: id, created } as unknown as SafetyMutationResult &
            Record<TIdField, string>,
    };
};

const parseOnboardingStatus = (
    payload: unknown,
): ApiClientResult<AccountOnboardingStatus> => {
    if (!isRecord(payload)) {
        return invalidResponseFailure('Onboarding response was malformed.');
    }
    const policyVersion = readString(payload, 'policyVersion');
    const requiredDocumentsRaw = payload['requiredDocuments'];
    if (
        !policyVersion ||
        !Array.isArray(requiredDocumentsRaw) ||
        !requiredDocumentsRaw.every(value => typeof value === 'string') ||
        typeof payload['consentRequired'] !== 'boolean' ||
        !(
            payload['acceptedAt'] === null ||
            typeof payload['acceptedAt'] === 'string'
        )
    ) {
        return invalidResponseFailure('Onboarding response was malformed.');
    }
    return {
        ok: true,
        data: {
            policyVersion,
            requiredDocuments: requiredDocumentsRaw,
            consentRequired: payload['consentRequired'],
            acceptedAt: payload['acceptedAt'],
        },
    };
};

export const fetchAccountOnboardingViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<AccountOnboardingStatus>> => {
    const result = await requestJson(
        '/account/onboarding',
        new URLSearchParams(),
        signal,
    );
    return result.ok ? parseOnboardingStatus(result.data) : result;
};

export const acceptCurrentPoliciesViaApi = async (): Promise<
    ApiClientResult<AccountOnboardingStatus>
> => {
    const result = await requestJsonPost('/account/consent', {
        policyVersion: CURRENT_POLICY_VERSION,
        asserted18OrOlder: true,
        acceptedDocuments: [...requiredPolicyDocuments],
    });
    return result.ok ? parseOnboardingStatus(result.data) : result;
};

export const fetchAccountPreferencesViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<AccountPreferences>> => {
    const result = await requestJson(
        '/account/preferences',
        new URLSearchParams(),
        signal,
    );
    if (!result.ok) return result;
    if (!isRecord(result.data)) {
        return invalidResponseFailure('Preferences response was malformed.');
    }
    const parsed = accountPreferenceSchema.safeParse(result.data['preferences']);
    return parsed.success ?
            { ok: true, data: parsed.data }
        :   invalidResponseFailure('Preferences response was malformed.');
};

export const updateAccountPreferencesViaApi = async (
    preferences: AccountPreferences,
): Promise<ApiClientResult<AccountPreferences>> => {
    const result = await requestJsonPut('/account/preferences', {
        preferences,
    });
    if (!result.ok) return result;
    if (!isRecord(result.data)) {
        return invalidResponseFailure('Preferences response was malformed.');
    }
    const parsed = accountPreferenceSchema.safeParse(result.data['preferences']);
    return parsed.success ?
            { ok: true, data: parsed.data }
        :   invalidResponseFailure('Preferences response was malformed.');
};

const requestJson = async (
    path: string,
    params: URLSearchParams,
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', () => controller.abort(), {
                once: true,
            });
        }
    }

    try {
        const response = await fetch(resolveApiUrl(path, params), {
            method: 'GET',
            credentials: 'include',
            headers: {
                accept: 'application/json',
            },
            signal: controller.signal,
        });

        const payload = await response.json().catch(() => undefined);

        if (!response.ok) {
            return failureForResponse(payload, response.status);
        }

        return {
            ok: true,
            data: payload,
        };
    } catch (error) {
        return networkFailure(error);
    } finally {
        clearTimeout(timeoutId);
    }
};

const requestJsonPost = async (
    path: string,
    body: unknown,
    signal?: AbortSignal,
    idempotencyKey?: string,
): Promise<ApiClientResult<unknown>> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', () => controller.abort(), {
                once: true,
            });
        }
    }

    try {
        const response = await fetch(
            resolveApiUrl(path, new URLSearchParams()),
            {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'idempotency-key': idempotencyKey ?? newIdempotencyKey(),
                    ...csrfHeaders(),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            },
        );

        const payload = await response.json().catch(() => undefined);

        if (!response.ok) {
            return failureForResponse(payload, response.status);
        }

        return {
            ok: true,
            data: payload,
        };
    } catch (error) {
        return networkFailure(error);
    } finally {
        clearTimeout(timeoutId);
    }
};

const requestJsonPut = async (
    path: string,
    body: unknown,
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    if (signal) {
        if (signal.aborted) {
            controller.abort();
        } else {
            signal.addEventListener('abort', () => controller.abort(), {
                once: true,
            });
        }
    }

    try {
        const response = await fetch(
            resolveApiUrl(path, new URLSearchParams()),
            {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'idempotency-key': newIdempotencyKey(),
                    ...csrfHeaders(),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            },
        );

        const payload = await response.json().catch(() => undefined);

        if (!response.ok) {
            return failureForResponse(payload, response.status);
        }

        return {
            ok: true,
            data: payload,
        };
    } catch (error) {
        return networkFailure(error);
    } finally {
        clearTimeout(timeoutId);
    }
};

const requestJsonDelete = async (
    path: string,
    body: unknown,
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> => {
    try {
        const response = await fetch(
            resolveApiUrl(path, new URLSearchParams()),
            {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'content-type': 'application/json',
                    accept: 'application/json',
                    'idempotency-key': newIdempotencyKey(),
                    ...csrfHeaders(),
                },
                body: JSON.stringify(body),
                signal,
            },
        );
        if (response.status === 204) return { ok: true, data: undefined };
        const payload = await response.json().catch(() => undefined);
        return response.ok ?
                { ok: true, data: payload }
            :   failureForResponse(payload, response.status);
    } catch (error) {
        return networkFailure(error);
    }
};

export interface AtAidPostResult {
    uri: string;
    cid: string;
    record: AidPostRecord;
}

const parseAtAidPostResult = (
    payload: unknown,
): ApiClientResult<AtAidPostResult> => {
    if (!isRecord(payload)) {
        return invalidResponseFailure('Aid-post response was malformed.');
    }
    const uri = readString(payload, 'uri');
    const cid = readString(payload, 'cid');
    const record = aidPostSchema.safeParse(payload['record']);
    if (!uri || !cid || !record.success) {
        return invalidResponseFailure('Aid-post response was malformed.');
    }
    return { ok: true, data: { uri, cid, record: record.data } };
};

export const createAtAidPostViaApi = async (
    record: AidPostRecord,
    signal?: AbortSignal,
    idempotencyKey?: string,
): Promise<ApiClientResult<AtAidPostResult>> => {
    const result = await requestJsonPost('/at/aid-posts', record, signal, idempotencyKey);
    return result.ok ? parseAtAidPostResult(result.data) : result;
};

export const updateAtAidPostViaApi = async (
    input: { uri: string; expectedCid: string; record: AidPostRecord },
    signal?: AbortSignal,
): Promise<ApiClientResult<AtAidPostResult>> => {
    const result = await requestJsonPut('/at/aid-posts', input, signal);
    return result.ok ? parseAtAidPostResult(result.data) : result;
};

export const closeAtAidPostViaApi = async (
    input: { uri: string; expectedCid: string; updatedAt: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<AtAidPostResult>> => {
    const result = await requestJsonPost('/at/aid-posts/close', input, signal);
    return result.ok ? parseAtAidPostResult(result.data) : result;
};

export const reconcileAidPostStatusViaApi = async (
    input: { uri: string; expectedCid: string; updatedAt: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<AtAidPostResult>> => {
    const result = await requestJsonPost(
        '/at/aid-posts/status/reconcile',
        input,
        signal,
    );
    return result.ok ? parseAtAidPostResult(result.data) : result;
};

export const deleteAtAidPostViaApi = async (
    input: { uri: string; expectedCid: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<void>> => {
    const result = await requestJsonDelete('/at/aid-posts', input, signal);
    return result.ok ? { ok: true, data: undefined } : result;
};

export interface AtDirectoryResourceResult {
    uri: string;
    cid: string;
    record: DirectoryResourceRecord;
}

const parseAtDirectoryResourceResult = (
    payload: unknown,
): ApiClientResult<AtDirectoryResourceResult> => {
    if (!isRecord(payload)) {
        return invalidResponseFailure(
            'Directory-resource response was malformed.',
        );
    }
    const uri = readString(payload, 'uri');
    const cid = readString(payload, 'cid');
    const record = directoryResourceSchema.safeParse(payload['record']);
    if (!uri || !cid || !record.success) {
        return invalidResponseFailure(
            'Directory-resource response was malformed.',
        );
    }
    return { ok: true, data: { uri, cid, record: record.data } };
};

export const getAtDirectoryResourceViaApi = async (
    uri: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<AtDirectoryResourceResult>> => {
    const result = await requestJson(
        '/at/directory-resources',
        new URLSearchParams({ uri }),
        signal,
    );
    return result.ok ? parseAtDirectoryResourceResult(result.data) : result;
};

export const createAtDirectoryResourceViaApi = async (
    record: DirectoryResourceRecord,
    signal?: AbortSignal,
): Promise<ApiClientResult<AtDirectoryResourceResult>> => {
    const result = await requestJsonPost(
        '/at/directory-resources',
        record,
        signal,
    );
    return result.ok ? parseAtDirectoryResourceResult(result.data) : result;
};

export const updateAtDirectoryResourceViaApi = async (
    input: {
        uri: string;
        expectedCid: string;
        record: DirectoryResourceRecord;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<AtDirectoryResourceResult>> => {
    const result = await requestJsonPut(
        '/at/directory-resources',
        input,
        signal,
    );
    return result.ok ? parseAtDirectoryResourceResult(result.data) : result;
};

export const deleteAtDirectoryResourceViaApi = async (
    input: { uri: string; expectedCid: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<void>> => {
    const result = await requestJsonDelete(
        '/at/directory-resources',
        input,
        signal,
    );
    return result.ok ? { ok: true, data: undefined } : result;
};

export interface VolunteerPrivateProfile {
    contactEmail: string | null;
    contactPhone: string | null;
    availabilityWindows: string[];
    matchingPreferences: {
        preferredCategories: string[];
        preferredUrgencies: string[];
        maxDistanceKm: number;
        acceptsLateNight: boolean;
    };
}

export interface AtVolunteerProfileResult {
    uri: string;
    cid: string;
    record: VolunteerProfileRecord;
    privateProfile: VolunteerPrivateProfile | null;
}

export interface VolunteerProfileCommandInput {
    profile: {
        displayName: string;
        bio?: string;
        capabilities: VolunteerProfileRecord['capabilities'];
        availability: VolunteerProfileRecord['availability'];
        contactPreference: VolunteerProfileRecord['contactPreference'];
        skills?: string[];
        languages?: string[];
        serviceArea?: VolunteerProfileRecord['serviceArea'];
    };
    privateProfile: VolunteerPrivateProfile;
}

const parseVolunteerPrivateProfile = (
    input: unknown,
): VolunteerPrivateProfile | null | undefined => {
    if (input === null) return null;
    if (!isRecord(input)) return undefined;
    const matching = input['matchingPreferences'];
    if (
        !isRecord(matching) ||
        !Array.isArray(input['availabilityWindows']) ||
        !Array.isArray(matching['preferredCategories']) ||
        !Array.isArray(matching['preferredUrgencies']) ||
        typeof matching['maxDistanceKm'] !== 'number' ||
        typeof matching['acceptsLateNight'] !== 'boolean' ||
        !(
            input['contactEmail'] === null ||
            typeof input['contactEmail'] === 'string'
        ) ||
        !(
            input['contactPhone'] === null ||
            typeof input['contactPhone'] === 'string'
        )
    ) {
        return undefined;
    }
    return input as unknown as VolunteerPrivateProfile;
};

const parseAtVolunteerProfileResult = (
    payload: unknown,
): ApiClientResult<AtVolunteerProfileResult> => {
    if (!isRecord(payload)) {
        return invalidResponseFailure(
            'Volunteer-profile response was malformed.',
        );
    }
    const uri = readString(payload, 'uri');
    const cid = readString(payload, 'cid');
    const record = volunteerProfileSchema.safeParse(payload['record']);
    const privateProfile = parseVolunteerPrivateProfile(
        payload['privateProfile'],
    );
    if (!uri || !cid || !record.success || privateProfile === undefined) {
        return invalidResponseFailure(
            'Volunteer-profile response was malformed.',
        );
    }
    return {
        ok: true,
        data: { uri, cid, record: record.data, privateProfile },
    };
};

export const getAtVolunteerProfileViaApi = async (
    uri: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<AtVolunteerProfileResult>> => {
    const result = await requestJson(
        '/at/volunteer-profile',
        new URLSearchParams({ uri }),
        signal,
    );
    return result.ok ? parseAtVolunteerProfileResult(result.data) : result;
};

export const createAtVolunteerProfileViaApi = async (
    input: VolunteerProfileCommandInput,
    signal?: AbortSignal,
): Promise<ApiClientResult<AtVolunteerProfileResult>> => {
    const result = await requestJsonPost(
        '/at/volunteer-profile',
        input,
        signal,
    );
    return result.ok ? parseAtVolunteerProfileResult(result.data) : result;
};

export const updateAtVolunteerProfileViaApi = async (
    input: VolunteerProfileCommandInput & {
        uri: string;
        expectedCid: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<AtVolunteerProfileResult>> => {
    const result = await requestJsonPut(
        '/at/volunteer-profile',
        input,
        signal,
    );
    return result.ok ? parseAtVolunteerProfileResult(result.data) : result;
};

export const deleteAtVolunteerProfileViaApi = async (
    input: { uri: string; expectedCid: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<void>> => {
    const result = await requestJsonDelete(
        '/at/volunteer-profile',
        input,
        signal,
    );
    return result.ok ? { ok: true, data: undefined } : result;
};

export interface VolunteerDiscoveryProfile {
    uri: string;
    cid: string | null;
    authorDid: string;
    displayName: string;
    bio: string | null;
    capabilities: string[];
    availability: string;
    contactPreference: string;
    skills: string[];
    languages: string[];
    serviceArea: {
        areaLabel: string;
        noPermanentAddress: boolean;
        approximateGeo?: {
            latitude: number;
            longitude: number;
            precisionKm: number;
        };
    } | null;
    updatedAt: string;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

export const fetchVolunteerProfilePageViaApi = async (
    filters: {
        searchText?: string;
        capability?: string;
        language?: string;
        availability?: string;
    } = {},
    page = 1,
    signal?: AbortSignal,
): Promise<ApiClientResult<PagedResult<VolunteerDiscoveryProfile>>> => {
    const params = new URLSearchParams({
        page: String(page),
        pageSize: String(DEFAULT_DISCOVERY_PAGE_SIZE),
    });
    for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, value);
    }
    const result = await requestJson('/query/volunteers', params, signal);
    if (!result.ok) return result;
    if (!isRecord(result.data) || !Array.isArray(result.data['results'])) {
        return invalidResponseFailure(
            'Volunteer discovery response was malformed.',
        );
    }
    const items = result.data['results'] as VolunteerDiscoveryProfile[];
    const envelope = pageEnvelope(result.data, items);
    return envelope ? { ok: true, data: envelope }
        : invalidResponseFailure('Volunteer discovery response was malformed.');
};

export const fetchVolunteerProfilesViaApi = async (
    filters: {
        searchText?: string;
        capability?: string;
        language?: string;
        availability?: string;
    } = {},
    signal?: AbortSignal,
): Promise<ApiClientResult<VolunteerDiscoveryProfile[]>> => {
    const result = await fetchVolunteerProfilePageViaApi(filters, 1, signal);
    return result.ok ? { ok: true, data: result.data.items } : result;
};

export type OrganizationRole = 'owner' | 'admin' | 'steward' | 'member';

export interface PublicOrganization {
    id: string;
    slug: string;
    name: string;
    description: string;
    origin: 'synthetic' | 'sourced-public' | 'visitor-created';
    provenance: {
        sourceUrl: string;
        retrievedAt: string;
        lastVerifiedAt: string;
    } | null;
    nonEndorsementLabel: string;
    createdAt: string;
    updatedAt: string;
}

export interface MyOrganization extends PublicOrganization {
    membership: {
        organizationId: string;
        memberDid: string;
        role: OrganizationRole;
        status: 'active';
        invitedByDid: string;
        joinedAt: string;
        updatedAt: string;
    };
}

export interface OrganizationMember {
    organizationId: string;
    memberDid: string;
    role: OrganizationRole;
    status: 'active';
    invitedByDid: string;
    joinedAt: string;
    updatedAt: string;
}

export interface OrganizationStewardship {
    id: string;
    organizationId: string;
    resourceUri: string;
    stewardDid: string;
    status: 'active' | 'due' | 'expired' | 'revoked';
    lastReconfirmedAt: string;
    reconfirmDueAt: string;
    createdAt: string;
    updatedAt: string;
}

const parseArrayProperty = <T>(
    payload: unknown,
    key: string,
    message: string,
): ApiClientResult<T[]> => {
    if (!isRecord(payload) || !Array.isArray(payload[key])) {
        return invalidResponseFailure(message);
    }
    return { ok: true, data: payload[key] as T[] };
};

export const fetchOrganizationsViaApi = async (
    searchText = '',
    signal?: AbortSignal,
): Promise<ApiClientResult<PublicOrganization[]>> => {
    const params = new URLSearchParams();
    if (searchText) params.set('searchText', searchText);
    const result = await requestJson('/organizations', params, signal);
    return result.ok ?
            parseArrayProperty<PublicOrganization>(
                result.data,
                'organizations',
                'Organization discovery response was malformed.',
            )
        :   result;
};

export const fetchMyOrganizationsViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<MyOrganization[]>> => {
    const result = await requestJson(
        '/organizations/mine',
        new URLSearchParams(),
        signal,
    );
    return result.ok ?
            parseArrayProperty<MyOrganization>(
                result.data,
                'organizations',
                'Organization membership response was malformed.',
            )
        :   result;
};

export const createOrganizationViaApi = async (
    input: { name: string; description: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ organization: PublicOrganization }>> => {
    const result = await requestJsonPost('/organizations', input, signal);
    return result.ok && isRecord(result.data) &&
            isRecord(result.data['organization']) ?
            {
                ok: true,
                data: result.data as unknown as {
                    organization: PublicOrganization;
                },
            }
        : result.ok ?
            invalidResponseFailure(
                'Organization create response was malformed.',
            )
        :   result;
};

export const inviteOrganizationMemberViaApi = async (
    input: {
        organizationId: string;
        inviteeDid: string;
        role: Exclude<OrganizationRole, 'owner'>;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ token: string }>> => {
    const result = await requestJsonPost(
        '/organizations/invitations',
        input,
        signal,
    );
    return result.ok && isRecord(result.data) &&
            typeof result.data['token'] === 'string' ?
            { ok: true, data: { token: result.data['token'] } }
        : result.ok ?
            invalidResponseFailure(
                'Organization invitation response was malformed.',
            )
        :   result;
};

export const acceptOrganizationInvitationViaApi = async (
    token: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ organizationId: string }>> => {
    const result = await requestJsonPost(
        '/organization-invitations/accept',
        { token },
        signal,
    );
    return result.ok && isRecord(result.data) &&
            typeof result.data['organizationId'] === 'string' ?
            {
                ok: true,
                data: { organizationId: result.data['organizationId'] },
            }
        : result.ok ?
            invalidResponseFailure(
                'Organization invitation acceptance was malformed.',
            )
        :   result;
};

export const fetchOrganizationMembersViaApi = async (
    organizationId: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<OrganizationMember[]>> => {
    const result = await requestJson(
        '/organizations/members',
        new URLSearchParams({ organizationId }),
        signal,
    );
    return result.ok ?
            parseArrayProperty<OrganizationMember>(
                result.data,
                'members',
                'Organization member response was malformed.',
            )
        :   result;
};

export const updateOrganizationMemberRoleViaApi = async (
    input: {
        organizationId: string;
        memberDid: string;
        role: Exclude<OrganizationRole, 'owner'>;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ membership: OrganizationMember }>> => {
    const result = await requestJsonPut(
        '/organizations/members/role',
        input,
        signal,
    );
    return result.ok && isRecord(result.data) &&
            isRecord(result.data['membership']) ?
            {
                ok: true,
                data: result.data as unknown as {
                    membership: OrganizationMember;
                },
            }
        : result.ok ?
            invalidResponseFailure(
                'Organization role response was malformed.',
            )
        :   result;
};

export const removeOrganizationMemberViaApi = async (
    input: { organizationId: string; memberDid: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ removed: string }>> => {
    const result = await requestJsonDelete(
        '/organizations/members',
        input,
        signal,
    );
    return result.ok && isRecord(result.data) &&
            typeof result.data['removed'] === 'string' ?
            { ok: true, data: { removed: result.data['removed'] } }
        : result.ok ?
            invalidResponseFailure(
                'Organization member removal response was malformed.',
            )
        :   result;
};

export const fetchOrganizationStewardshipsViaApi = async (
    organizationId: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<OrganizationStewardship[]>> => {
    const result = await requestJson(
        '/organizations/stewardships',
        new URLSearchParams({ organizationId }),
        signal,
    );
    return result.ok ?
            parseArrayProperty<OrganizationStewardship>(
                result.data,
                'stewardships',
                'Organization stewardship response was malformed.',
            )
        :   result;
};

export const assignOrganizationStewardshipViaApi = async (
    input: {
        organizationId: string;
        resourceUri: string;
        stewardDid: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ stewardship: OrganizationStewardship }>> => {
    const result = await requestJsonPost(
        '/organizations/stewardships',
        input,
        signal,
    );
    return result.ok && isRecord(result.data) &&
            isRecord(result.data['stewardship']) ?
            {
                ok: true,
                data: result.data as unknown as {
                    stewardship: OrganizationStewardship;
                },
            }
        : result.ok ?
            invalidResponseFailure(
                'Organization stewardship response was malformed.',
            )
        :   result;
};

export const reconfirmOrganizationStewardshipViaApi = async (
    input: { organizationId: string; stewardshipId: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ stewardship: OrganizationStewardship }>> => {
    const result = await requestJsonPost(
        '/organizations/stewardships/reconfirm',
        input,
        signal,
    );
    return result.ok && isRecord(result.data) &&
            isRecord(result.data['stewardship']) ?
            {
                ok: true,
                data: result.data as unknown as {
                    stewardship: OrganizationStewardship;
                },
            }
        : result.ok ?
            invalidResponseFailure(
                'Organization reconfirmation response was malformed.',
            )
        :   result;
};

export type VerificationSubjectType =
    | 'volunteer'
    | 'organization'
    | 'resource';
export type VerificationApplicationStatus =
    | 'pending'
    | 'under-review'
    | 'approved'
    | 'denied'
    | 'revoked'
    | 'expired';

export interface VerificationApplication {
    id: string;
    applicantDid: string;
    subjectType: VerificationSubjectType;
    organizationId: string | null;
    subjectRef: string;
    status: VerificationApplicationStatus;
    submittedAt: string;
    decidedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    updatedAt: string;
}

export interface VerificationEvidence {
    id: string;
    applicationId: string;
    kind: string;
    label: string;
    issuer: string | null;
    issuedAt: string | null;
    attachmentId: string | null;
    privateNotes: string | null;
    createdAt: string;
    attachment?: {
        id: string;
        status: string | null;
        detectedMime: string | null;
    } | null;
}

export interface VerificationAppeal {
    id: string;
    applicationId: string;
    applicantDid?: string;
    reason: string;
    status: string;
    submittedAt: string;
    resolvedAt?: string | null;
    resolutionNote?: string | null;
}

export interface ExactAddressRequest {
    id: string;
    organizationId: string;
    resourceUri: string;
    applicantDid?: string;
    streetAddress?: string;
    latitude?: number;
    longitude?: number;
    confidentialFacility: boolean;
    status: string;
    requestedAt: string;
    approvalExpiresAt?: string | null;
    decisionReason?: string | null;
}

export interface VerificationWorkspace {
    applications: VerificationApplication[];
    evidence: VerificationEvidence[];
    appeals: VerificationAppeal[];
    exactAddressRequests: ExactAddressRequest[];
}

export interface VerificationReviewQueue {
    applications: VerificationApplication[];
    evidence: VerificationEvidence[];
    appeals: VerificationAppeal[];
}

export type PrivateAttachmentPurpose =
    | 'verification-evidence'
    | 'aid-post'
    | 'moderation-evidence';

export type PrivateAttachmentStatus =
    | 'authorized'
    | 'uploaded'
    | 'scanning'
    | 'retry'
    | 'clean'
    | 'quarantined'
    | 'deletion-pending'
    | 'deleted';

export interface PrivateAttachment {
    id: string;
    purpose: PrivateAttachmentPurpose;
    subjectRef: string | null;
    filename: string;
    declaredMime: string;
    detectedMime: string | null;
    byteSize: number;
    status: PrivateAttachmentStatus;
    uploadExpiresAt: string;
    retentionExpiresAt: string;
    createdAt: string;
    updatedAt: string;
}

const attachmentStatuses = new Set<PrivateAttachmentStatus>([
    'authorized',
    'uploaded',
    'scanning',
    'retry',
    'clean',
    'quarantined',
    'deletion-pending',
    'deleted',
]);

const attachmentPurposes = new Set<PrivateAttachmentPurpose>([
    'verification-evidence',
    'aid-post',
    'moderation-evidence',
]);

const parsePrivateAttachment = (
    value: unknown,
): PrivateAttachment | undefined => {
    if (!isRecord(value)) return undefined;
    const purpose = value['purpose'];
    const status = value['status'];
    const subjectRef = value['subjectRef'];
    const detectedMime = value['detectedMime'];
    if (
        !readString(value, 'id') ||
        typeof purpose !== 'string' ||
        !attachmentPurposes.has(purpose as PrivateAttachmentPurpose) ||
        !(
            subjectRef === null ||
            typeof subjectRef === 'string'
        ) ||
        !readString(value, 'filename') ||
        !readString(value, 'declaredMime') ||
        !(
            detectedMime === null ||
            typeof detectedMime === 'string'
        ) ||
        typeof value['byteSize'] !== 'number' ||
        typeof status !== 'string' ||
        !attachmentStatuses.has(status as PrivateAttachmentStatus) ||
        !readString(value, 'uploadExpiresAt') ||
        !readString(value, 'retentionExpiresAt') ||
        !readString(value, 'createdAt') ||
        !readString(value, 'updatedAt')
    ) {
        return undefined;
    }
    return value as unknown as PrivateAttachment;
};

const parseAttachmentEnvelope = (
    payload: unknown,
): ApiClientResult<PrivateAttachment> => {
    if (!isRecord(payload)) {
        return invalidResponseFailure('Attachment response was malformed.');
    }
    const attachment = parsePrivateAttachment(payload['attachment']);
    return attachment ?
            { ok: true, data: attachment }
        :   invalidResponseFailure('Attachment response was malformed.');
};

export const fetchPrivateAttachmentsViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<PrivateAttachment[]>> => {
    const result = await requestJson(
        '/attachments',
        new URLSearchParams(),
        signal,
    );
    if (!result.ok) return result;
    if (!isRecord(result.data) || !Array.isArray(result.data['attachments'])) {
        return invalidResponseFailure('Attachment list was malformed.');
    }
    const attachments = result.data['attachments'].map(parsePrivateAttachment);
    if (attachments.some(attachment => !attachment)) {
        return invalidResponseFailure('Attachment list was malformed.');
    }
    return {
        ok: true,
        data: attachments as PrivateAttachment[],
    };
};

export const uploadPrivateAttachmentViaApi = async (
    file: File,
    purpose: PrivateAttachmentPurpose,
    subjectRef: string | null,
): Promise<ApiClientResult<PrivateAttachment>> => {
    const authorized = await requestJsonPost('/attachments/uploads', {
        filename: file.name,
        declaredMime: file.type,
        byteSize: file.size,
        purpose,
        subjectRef,
    });
    if (!authorized.ok) return authorized;
    if (
        !isRecord(authorized.data) ||
        !isRecord(authorized.data['upload'])
    ) {
        return invalidResponseFailure(
            'Attachment authorization response was malformed.',
        );
    }
    const attachment = parsePrivateAttachment(
        authorized.data['attachment'],
    );
    const uploadToken = readString(authorized.data['upload'], 'token');
    if (!attachment || !uploadToken) {
        return invalidResponseFailure(
            'Attachment authorization response was malformed.',
        );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
        const response = await fetch(
            resolveApiUrl(
                `/attachments/uploads/${attachment.id}`,
                new URLSearchParams(),
            ),
            {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'content-type': file.type,
                    accept: 'application/json',
                    'x-patchwork-upload-token': uploadToken,
                    ...csrfHeaders(),
                },
                body: file,
                signal: controller.signal,
            },
        );
        const payload = await response.json().catch(() => undefined);
        if (!response.ok) {
            return failureForResponse(payload, response.status);
        }
        return parseAttachmentEnvelope(payload);
    } catch (error) {
        return networkFailure(error);
    } finally {
        clearTimeout(timeoutId);
    }
};

export const requestPrivateAttachmentAccessViaApi = async (
    attachmentId: string,
): Promise<
    ApiClientResult<{ url: string; expiresAt: string }>
> => {
    const result = await requestJsonPost('/attachments/access', {
        attachmentId,
    });
    if (
        !result.ok ||
        !isRecord(result.data) ||
        !isRecord(result.data['access'])
    ) {
        return result.ok ?
                invalidResponseFailure(
                    'Attachment access response was malformed.',
                )
            :   result;
    }
    const url = readString(result.data['access'], 'url');
    const expiresAt = readString(result.data['access'], 'expiresAt');
    return url && expiresAt ?
            { ok: true, data: { url, expiresAt } }
        :   invalidResponseFailure(
                'Attachment access response was malformed.',
            );
};

export const deletePrivateAttachmentViaApi = async (
    attachmentId: string,
): Promise<ApiClientResult<void>> => {
    const result = await requestJsonDelete(
        `/attachments/${attachmentId}`,
        {},
    );
    return result.ok ? { ok: true, data: undefined } : result;
};

export const reviewPrivateAttachmentViaApi = async (
    attachmentId: string,
    action: 'quarantine' | 'release-for-rescan' | 'delete',
    reason: string,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/attachments/review', {
        attachmentId,
        action,
        reason,
    });

const parseVerificationWorkspace = (
    payload: unknown,
): ApiClientResult<VerificationWorkspace> => {
    if (
        !isRecord(payload) ||
        !Array.isArray(payload['applications']) ||
        !Array.isArray(payload['evidence']) ||
        !Array.isArray(payload['appeals']) ||
        !Array.isArray(payload['exactAddressRequests'])
    ) {
        return invalidResponseFailure(
            'Verification status response was malformed.',
        );
    }
    return { ok: true, data: payload as unknown as VerificationWorkspace };
};

export const fetchVerificationWorkspaceViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<VerificationWorkspace>> => {
    const result = await requestJson(
        '/verification/mine',
        new URLSearchParams(),
        signal,
    );
    return result.ok ? parseVerificationWorkspace(result.data) : result;
};

export const submitVerificationApplicationViaApi = async (
    input: {
        subjectType: VerificationSubjectType;
        organizationId?: string;
        resourceUri?: string;
        evidence: Array<{
            kind:
                | 'identity'
                | 'organization-registration'
                | 'service-authorization'
                | 'community-reference'
                | 'training'
                | 'other';
            label: string;
            issuer: string | null;
            issuedAt: string | null;
            attachmentId: string | null;
            privateNotes: string | null;
        }>;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/verification/applications', input, signal);

export const submitVerificationAppealViaApi = async (
    input: { applicationId: string; reason: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/verification/appeals', input, signal);

export const requestExactPublicAddressViaApi = async (
    input: {
        organizationId: string;
        resourceUri: string;
        streetAddress: string;
        latitude: number;
        longitude: number;
        confidentialFacility: boolean;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/verification/exact-address/requests', input, signal);

export const fetchVerificationReviewQueueViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<VerificationReviewQueue>> => {
    const result = await requestJson(
        '/verification/review',
        new URLSearchParams(),
        signal,
    );
    if (
        !result.ok ||
        !isRecord(result.data) ||
        !Array.isArray(result.data['applications']) ||
        !Array.isArray(result.data['evidence']) ||
        !Array.isArray(result.data['appeals'])
    ) {
        return result.ok ?
                invalidResponseFailure(
                    'Verification review response was malformed.',
                )
            :   result;
    }
    return { ok: true, data: result.data as unknown as VerificationReviewQueue };
};

export const decideVerificationViaApi = async (
    input: {
        applicationId: string;
        action: 'approve' | 'deny' | 'revoke' | 'renew';
        reason: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/verification/decisions', input, signal);

export const decideVerificationAppealViaApi = async (
    input: {
        appealId: string;
        decision: 'upheld' | 'denied';
        resolutionNote: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/verification/appeal-decisions', input, signal);

export const fetchExactAddressReviewQueueViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<ExactAddressRequest[]>> => {
    const result = await requestJson(
        '/verification/exact-address/review',
        new URLSearchParams(),
        signal,
    );
    return result.ok ?
            parseArrayProperty<ExactAddressRequest>(
                result.data,
                'requests',
                'Exact-address review response was malformed.',
            )
        :   result;
};

export const decideExactAddressViaApi = async (
    input: {
        requestId: string;
        decision: 'approve' | 'reject' | 'revoke';
        reason: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<unknown>> =>
    requestJsonPost('/verification/exact-address/decisions', input, signal);

// ---------------------------------------------------------------------------
// Settings API
// ---------------------------------------------------------------------------

export interface SettingsApiGetResponse {
    did: string;
    settings: UserSettings;
}

export interface SettingsApiUpdateResponse {
    did: string;
    settings: UserSettings;
    changesRecorded: number;
}

export interface SettingsApiAuditResponse {
    did: string;
    total: number;
    entries: SettingsChangeAudit[];
}

export interface AccountActionApiResponse {
    status: 'deactivated';
    effectiveAt: string;
    removed: Record<string, number>;
    revoked: Record<string, number>;
    retained: Record<string, number>;
}

export interface AccountExportApiResponse {
    formatVersion: '1.0';
    generatedAt: string;
    subject: { did: string; handle?: string };
    data: Record<string, unknown>;
    exclusions: Array<{ category: string; reason: string }>;
}

export const fetchSettingsFromApi = async (
    _did: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<SettingsApiGetResponse>> => {
    const result = await requestJsonPost('/account/settings/read', {}, signal);

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Settings response was malformed.');
    }

    return {
        ok: true,
        data: result.data as unknown as SettingsApiGetResponse,
    };
};

export const updateSettingsViaApi = async (
    did: string,
    settings: UserSettings,
    signal?: AbortSignal,
): Promise<ApiClientResult<SettingsApiUpdateResponse>> => {
    const result = await requestJsonPut(
        '/account/settings',
        { did, settings },
        signal,
    );

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Settings update response was malformed.');
    }

    return {
        ok: true,
        data: result.data as unknown as SettingsApiUpdateResponse,
    };
};

export const fetchSettingsAuditFromApi = async (
    did: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<SettingsApiAuditResponse>> => {
    const result = await requestJsonPost(
        '/account/settings/audit',
        { did },
        signal,
    );

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Audit trail response was malformed.');
    }

    return {
        ok: true,
        data: result.data as unknown as SettingsApiAuditResponse,
    };
};

export const deactivateAccountViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<AccountActionApiResponse>> => {
    const result = await requestJsonPost(
        '/account/deactivate',
        {},
        signal,
    );

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Deactivation response was malformed.');
    }

    return {
        ok: true,
        data: result.data as unknown as AccountActionApiResponse,
    };
};

export const exportDataViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<AccountExportApiResponse>> => {
    const result = await requestJson(
        '/account/export',
        new URLSearchParams(),
        signal,
    );

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Export response was malformed.');
    }

    const formatVersion = result.data['formatVersion'];
    const generatedAt = result.data['generatedAt'];
    const subject = result.data['subject'];
    const data = result.data['data'];
    const exclusions = result.data['exclusions'];
    if (
        formatVersion !== '1.0' ||
        typeof generatedAt !== 'string' ||
        !isRecord(subject) ||
        typeof subject['did'] !== 'string' ||
        !isRecord(data) ||
        !Array.isArray(exclusions)
    ) {
        return invalidResponseFailure('Export response was malformed.');
    }
    return {
        ok: true,
        data: result.data as unknown as AccountExportApiResponse,
    };
};

const parseAidCategory = (value: string | undefined): AidCategory => {
    if (value && aidCategories.includes(value as AidCategory)) {
        return value as AidCategory;
    }

    return 'other';
};

const parseAidStatus = (value: string | undefined): AidStatus => {
    if (value && aidStatuses.includes(value as AidStatus)) {
        return value as AidStatus;
    }

    return 'open';
};

const parseUrgency = (value: string | undefined): 1 | 2 | 3 | 4 | 5 => {
    if (value === 'critical') {
        return 5;
    }
    if (value === 'high') {
        return 4;
    }
    if (value === 'medium') {
        return 3;
    }

    return 2;
};

const toLexiconUrgency = (
    urgency: 1 | 2 | 3 | 4 | 5,
): 'low' | 'medium' | 'high' | 'critical' => {
    if (urgency >= 5) {
        return 'critical';
    }
    if (urgency >= 4) {
        return 'high';
    }
    if (urgency >= 3) {
        return 'medium';
    }

    return 'low';
};

const parseRecordIdFromUri = (uri: string, fallback: string): string => {
    const segments = uri.split('/').filter(Boolean);
    const candidate = segments.at(-1);

    return candidate && candidate.length > 0 ? candidate : fallback;
};

const parseRepositoryDidFromUri = (uri: string): string | undefined =>
    /^at:\/\/(did:[^/]+)\//.exec(uri)?.[1];

const parseDirectoryCategory = (
    value: string | undefined,
): DirectoryResourceCategory => {
    if (
        value === 'food-bank' ||
        value === 'shelter' ||
        value === 'clinic' ||
        value === 'legal-aid' ||
        value === 'hotline' ||
        value === 'other'
    ) {
        return value;
    }

    return 'other';
};

const parseDirectoryVerificationStatus = (
    value: string | undefined,
): ResourceDirectoryCard['verificationStatus'] => {
    return value === 'unverified' ||
        value === 'community-verified' ||
        value === 'partner-verified'
        ? value
        : undefined;
};

const parseDirectoryOperationalStatus = (
    value: string | undefined,
): ResourceDirectoryCard['operationalStatus'] => {
    return value === 'open' || value === 'limited' || value === 'closed'
        ? value
        : undefined;
};

const mapAidPayloadToRecords = (
    payload: unknown,
): FeedRecordEnvelope[] | undefined => {
    if (!isRecord(payload)) {
        return [];
    }

    const rows = payload['results'];
    if (!Array.isArray(rows)) {
        return [];
    }

    const mapped = rows.map((row, index) => {
            if (!isRecord(row)) {
                return undefined;
            }

            const uri = readString(row, 'uri');
            const authorDid = readString(row, 'authorDid');
            const cid = readString(row, 'cid');
            const title = readString(row, 'title');
            const summary = readString(row, 'summary');
            const category = readString(row, 'category');
            const status = readString(row, 'status');
            const urgency = readString(row, 'urgency');
            const updatedAt = readString(row, 'updatedAt');
            const recordOrigin = readString(row, 'recordOrigin');
            if (
                !uri ||
                !authorDid ||
                !title ||
                !summary ||
                !category ||
                !status ||
                !urgency ||
                !updatedAt
            ) {
                return undefined;
            }

            const approximateGeo =
                isRecord(row['approximateGeo']) ?
                    row['approximateGeo']
                :   undefined;

            const lat =
                approximateGeo ?
                    (readNumber(approximateGeo, 'latitude') ??
                    readNumber(approximateGeo, 'lat'))
                :   undefined;
            const lng =
                approximateGeo ?
                    (readNumber(approximateGeo, 'longitude') ??
                    readNumber(approximateGeo, 'lng'))
                :   undefined;

            const createdAt =
                readString(row, 'createdAt') ??
                updatedAt;

            return {
                aidPostUri: uri,
                recipientDid: authorDid,
                ...(cid ? { cid } : {}),
                ...(recordOrigin === 'synthetic' ||
                recordOrigin === 'sourced-public' ||
                recordOrigin === 'visitor-created' ?
                    { recordOrigin }
                :   {}),
                card: createFeedCard({
                    id: parseRecordIdFromUri(uri, `remote-${index}`),
                    title,
                    description: summary,
                    category: parseAidCategory(category),
                    status: parseAidStatus(status),
                    urgency: parseUrgency(urgency),
                    accessibilityTags: [],
                    createdAt,
                    updatedAt,
                    location:
                        lat !== undefined && lng !== undefined ?
                            {
                                lat,
                                lng,
                                precisionKm: enforceMinimumGeoPrecisionKm(
                                    approximateGeo ? (readNumber(approximateGeo, 'precisionKm') ?? 1) : 1,
                                ),
                            }
                        :   undefined,
                }),
            } satisfies FeedRecordEnvelope;
        });
    if (mapped.some(value => value === undefined)) return undefined;
    return mapped as FeedRecordEnvelope[];
};

const mapDirectoryPayloadToCards = (payload: unknown): ResourceDirectoryCard[] | undefined => {
    const details = mapDirectoryPayloadToDetails(payload);
    return details?.every(card => card.location) ? details as ResourceDirectoryCard[] : undefined;
};

const mapDirectoryPayloadToDetails = (
    payload: unknown,
): ResourceDetail[] | undefined => {
    if (!isRecord(payload)) {
        return [];
    }

    const rows = payload['results'];
    if (!Array.isArray(rows)) {
        return [];
    }

    const hasMalformedRow = rows.some(row => {
        if (!isRecord(row)) return true;
        const approximateGeo = row['approximateGeo'];
        return (
            !readString(row, 'uri') ||
            !readString(row, 'name') ||
            (approximateGeo !== undefined && (!isRecord(approximateGeo) ||
            (readNumber(approximateGeo, 'latitude') ?? readNumber(approximateGeo, 'lat')) === undefined ||
            (readNumber(approximateGeo, 'longitude') ?? readNumber(approximateGeo, 'lng')) === undefined))
        );
    });
    if (hasMalformedRow) return undefined;

    return rows.reduce<ResourceDetail[]>((cards, row, index) => {
        if (!isRecord(row)) {
            return cards;
        }

        const uri = readString(row, 'uri');
        const name = readString(row, 'name');
        const approximateGeo =
            isRecord(row['approximateGeo']) ? row['approximateGeo'] : undefined;

        const lat =
            approximateGeo ?
                (readNumber(approximateGeo, 'latitude') ??
                readNumber(approximateGeo, 'lat'))
            :   undefined;
        const lng =
            approximateGeo ?
                (readNumber(approximateGeo, 'longitude') ??
                readNumber(approximateGeo, 'lng'))
            :   undefined;
        const precisionKm =
            approximateGeo ?
                readNumber(approximateGeo, 'precisionKm')
            :   undefined;

        if (!uri || !name) {
            return cards;
        }

        const contact = isRecord(row['contact']) ? row['contact'] : {};
        const exactPublicAddress =
            isRecord(row['exactPublicAddress']) ?
                row['exactPublicAddress']
            :   undefined;
        const exactStreetAddress =
            exactPublicAddress ?
                readString(exactPublicAddress, 'streetAddress')
            :   undefined;
        const exactLatitude =
            exactPublicAddress ?
                readNumber(exactPublicAddress, 'latitude')
            :   undefined;
        const exactLongitude =
            exactPublicAddress ?
                readNumber(exactPublicAddress, 'longitude')
            :   undefined;
        const exactApprovalExpiresAt =
            exactPublicAddress ?
                readString(exactPublicAddress, 'approvalExpiresAt')
            :   undefined;

        cards.push({
            uri,
            authorDid: readString(row, 'authorDid'),
            cid: readString(row, 'cid'),
            id: parseRecordIdFromUri(uri, `remote-${index}`),
            name,
            category: parseDirectoryCategory(readString(row, 'category')),
            serviceArea: readString(row, 'serviceArea'),
            verificationStatus: parseDirectoryVerificationStatus(
                readString(row, 'status'),
            ),
            operationalStatus: parseDirectoryOperationalStatus(
                readString(row, 'operationalStatus'),
            ),
            createdAt: readString(row, 'createdAt'),
            updatedAt: readString(row, 'updatedAt'),
            recordOrigin:
                readString(row, 'recordOrigin') === 'synthetic' ||
                readString(row, 'recordOrigin') === 'sourced-public' ||
                readString(row, 'recordOrigin') === 'visitor-created' ?
                    (readString(row, 'recordOrigin') as
                        | 'synthetic'
                        | 'sourced-public'
                        | 'visitor-created')
                :   undefined,
            ...(lat !== undefined && lng !== undefined ? { location: {
                lat,
                lng,
                precisionMeters: Math.round(
                    enforceMinimumGeoPrecisionKm(precisionKm ?? 1) * 1000,
                ),
                areaLabel: readString(row, 'serviceArea'),
            } } : {}),
            openHours: readString(row, 'openHours'),
            eligibilityNotes: readString(row, 'eligibilityNotes'),
            contact: {
                url: readString(contact, 'url'),
                phone: readString(contact, 'phone'),
            },
            ...(exactStreetAddress &&
            exactLatitude !== undefined &&
            exactLongitude !== undefined &&
            exactApprovalExpiresAt ?
                {
                    exactPublicAddress: {
                        kind: 'exact-public-resource' as const,
                        streetAddress: exactStreetAddress,
                        latitude: exactLatitude,
                        longitude: exactLongitude,
                        approvalExpiresAt: exactApprovalExpiresAt,
                    },
                }
            :   {}),
        });

        return cards;
    }, []);
};

const pageEnvelope = <T>(
    payload: unknown,
    items: T[] | undefined,
): PagedResult<T> | undefined => {
    if (!isRecord(payload) || !items) return undefined;
    const page = readNumber(payload, 'page');
    const pageSize = readNumber(payload, 'pageSize');
    const total = readNumber(payload, 'total');
    if (!page || !pageSize || total === undefined || typeof payload.hasNextPage !== 'boolean') {
        return undefined;
    }
    return {
        items,
        page,
        pageSize,
        total,
        hasNextPage: payload.hasNextPage,
        ...(payload.projectionFreshness !== undefined
            ? { projectionFreshness: payload.projectionFreshness }
            : {}),
    };
};

export const appendDedupedPage = <T>(
    current: readonly T[],
    page: readonly T[],
    key: (item: T) => string,
): T[] => {
    const seen = new Set(current.map(key));
    const appended: T[] = [];
    for (const item of page) {
        const itemKey = key(item);
        if (seen.has(itemKey)) continue;
        seen.add(itemKey);
        appended.push(item);
    }
    return [...current, ...appended];
};

export const fetchFeedRecordPageFromApi = async (
    state: DiscoveryFilterState,
    scope: AidQueryScope,
    page = 1,
    signal?: AbortSignal,
): Promise<ApiClientResult<PagedResult<FeedRecordEnvelope>>> => {
    if ((scope === 'map' || state.feedTab === 'nearby') && !state.center) return areaRequiredFailure();
    const result = await requestJson(
        scope === 'map' ? '/query/map' : '/query/feed',
        buildAidQueryParams(state, scope, page),
        signal,
    );
    if (!result.ok) return result;
    const envelope = pageEnvelope(result.data, mapAidPayloadToRecords(result.data));
    if ((scope === 'map' || state.feedTab === 'nearby') && envelope?.items.some(record => !record.card.location)) {
        return invalidResponseFailure('Nearby discovery returned a request without an approximate location.');
    }
    return envelope ? { ok: true, data: envelope }
        : invalidResponseFailure('Discovery response was malformed.');
};

export const fetchFeedRecordsFromApi = async (
    state: DiscoveryFilterState,
    scope: AidQueryScope,
    signal?: AbortSignal,
): Promise<ApiClientResult<FeedRecordEnvelope[]>> => {
    const result = await fetchFeedRecordPageFromApi(state, scope, 1, signal);
    return result.ok ? { ok: true, data: result.data.items } : result;
};

export const fetchDirectoryCardPageFromApi = async (
    state: DiscoveryFilterState,
    page = 1,
    signal?: AbortSignal,
): Promise<ApiClientResult<PagedResult<ResourceDirectoryCard>>> => {
    if (!state.center) return areaRequiredFailure();
    const result = await requestJson('/query/directory', buildDirectoryQueryParams(state, page), signal);
    if (!result.ok) return result;
    const envelope = pageEnvelope(result.data, mapDirectoryPayloadToCards(result.data));
    return envelope ? { ok: true, data: envelope }
        : invalidResponseFailure('Directory response was malformed.');
};

export const fetchDirectoryCardsFromApi = async (
    state: DiscoveryFilterState,
    signal?: AbortSignal,
): Promise<ApiClientResult<ResourceDirectoryCard[]>> => {
    const result = await fetchDirectoryCardPageFromApi(state, 1, signal);
    return result.ok ? { ok: true, data: result.data.items } : result;
};

export const reportAidPostViaApi = async (
    input: {
        subjectUri: string;
        reason: AidPostReportReason;
        details?: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<SafetyMutationResult & { reportId: string }>> => {
    const commandId = newIdempotencyKey();
    const result = await requestJsonPost(
        '/reports',
        { commandId, ...input },
        signal,
    );
    if (!result.ok) return result;
    return parseSafetyMutationResult(result.data, 'reportId');
};

export const blockUserViaApi = async (
    input: { subjectDid: string; reason?: string },
    signal?: AbortSignal,
): Promise<ApiClientResult<SafetyMutationResult & { blockId: string }>> => {
    const commandId = newIdempotencyKey();
    const result = await requestJsonPost(
        '/blocks',
        { commandId, ...input },
        signal,
    );
    if (!result.ok) return result;
    return parseSafetyMutationResult(result.data, 'blockId');
};

export const initiateChatViaApi = async (
    input: {
        aidPostUri: string;
        initiatedByDid: string;
        recipientDid: string;
        initiatedFrom: 'map' | 'feed' | 'detail';
        allowInitiation: boolean;
        supportsAtprotoChat?: boolean;
        now?: string;
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<ChatInitiationApiResult>> => {
    const result = await requestJsonPost('/chat/initiate', input, signal);
    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Chat initiation response was malformed.');
    }

    const conversationUri = readString(result.data, 'conversationUri');
    if (!conversationUri) {
        return invalidResponseFailure(
            'Chat initiation did not return a conversation URI.',
        );
    }

    const fallbackNoticeRaw =
        isRecord(result.data['fallbackNotice']) ?
            result.data['fallbackNotice']
        :   undefined;

    return {
        ok: true,
        data: {
            conversationUri,
            created: result.data['created'] === true,
            transportPath:
                (
                    readString(result.data, 'transportPath') ===
                    'resource-fallback'
                ) ?
                    'resource-fallback'
                : (
                    readString(result.data, 'transportPath') ===
                    'manual-fallback'
                ) ?
                    'manual-fallback'
                :   'atproto-direct',
            fallbackNotice:
                fallbackNoticeRaw ?
                    {
                        code: 'RECIPIENT_CAPABILITY_MISSING',
                        message:
                            readString(fallbackNoticeRaw, 'message') ??
                            'Fallback transport path selected.',
                        safeForUser: true,
                        transportPath:
                            (
                                readString(
                                    fallbackNoticeRaw,
                                    'transportPath',
                                ) === 'resource-fallback'
                            ) ?
                                'resource-fallback'
                            : (
                                readString(
                                    fallbackNoticeRaw,
                                    'transportPath',
                                ) === 'manual-fallback'
                            ) ?
                                'manual-fallback'
                            : (
                                readString(
                                    fallbackNoticeRaw,
                                    'transportPath',
                                ) === 'atproto-direct'
                            ) ?
                                'atproto-direct'
                            :   undefined,
                    }
                :   undefined,
        },
    };
};

export type CoordinationOfferStatus =
    | 'pending'
    | 'accepted'
    | 'declined'
    | 'expired'
    | 'cancelled';

export interface CoordinationOffer {
    id: string;
    requestUri: string;
    direction: 'received' | 'sent';
    note: string | null;
    status: CoordinationOfferStatus;
    offeredAt: string;
    expiresAt: string;
    decidedAt: string | null;
    requesterDid?: string;
    helperDid?: string;
}

export interface CoordinationConnection {
    id: string;
    offerId: string;
    requestUri: string;
    status: 'active' | 'completed' | 'cancelled' | 'expired';
    requesterDid: string;
    helperDid: string;
    counterpartDid: string;
    acceptedAt: string;
    completedAt: string | null;
    updatedAt: string;
}

export type ExactLocationSignal =
    | {
          sequence: number;
          kind: 'description';
          payload: { type: 'offer' | 'answer'; sdp: string };
      }
    | {
          sequence: number;
          kind: 'candidate';
          payload: {
              candidate: string;
              sdpMid: string | null;
              sdpMLineIndex: number | null;
              usernameFragment: string | null;
          };
      }
    | {
          sequence: number;
          kind: 'end-of-candidates';
          payload: Record<string, never>;
      };

export interface ExactLocationSessionState {
    connectionId: string;
    consent: {
        actorConsented: boolean;
        peerConsented: boolean;
        freshForSeconds: number;
    };
    session: {
        id: string;
        status: 'pending' | 'active' | 'revoked' | 'expired';
        role: 'offerer' | 'answerer';
        singleUse: true;
        issuedAt: string;
        expiresAt: string;
        participantProof: string | null;
        expectedPeerProof: string | null;
        signals: ExactLocationSignal[];
    } | null;
    serverTime: string;
}

export interface ActivityInboxItem {
    id: string;
    type:
        | 'request'
        | 'offer'
        | 'assignment'
        | 'verification'
        | 'moderation'
        | 'expiry'
        | 'notification'
        | 'outcome'
        | 'scheduling';
    title: string;
    summary: string;
    actionUrl: string;
    metadata: Record<string, unknown>;
    occurredAt: string;
    readAt: string | null;
}

export interface MatchCandidate {
    candidateRef: string;
    kind: 'volunteer' | 'resource';
    label: string;
    rank: number;
    score: number;
    approximateDistanceKm: number | null;
    availability: string;
    verification: 'active' | 'not-active';
    explanations: string[];
    assignment: 'manual-only';
}

export interface OutcomeFeedback {
    id: string;
    connectionId: string;
    outcome: string;
    rating: number;
    comment: string | null;
    tags: string[];
    submittedAt: string;
}

const parseRecordPayload = <T>(
    payload: unknown,
    requiredKey: string,
    message: string,
): ApiClientResult<T> =>
    isRecord(payload) && payload[requiredKey] !== undefined ?
        { ok: true, data: payload as T }
    :   invalidResponseFailure(message);

export const fetchCoordinationViaApi = async (
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        offers: CoordinationOffer[];
        connections: CoordinationConnection[];
    }>
> => {
    const result = await requestJson(
        '/coordination/mine',
        new URLSearchParams(),
        signal,
    );
    if (!result.ok) return result;
    if (
        !isRecord(result.data) ||
        !Array.isArray(result.data['offers']) ||
        !Array.isArray(result.data['connections'])
    ) {
        return invalidResponseFailure(
            'Coordination workspace response was malformed.',
        );
    }
    return {
        ok: true,
        data: result.data as unknown as {
            offers: CoordinationOffer[];
            connections: CoordinationConnection[];
        },
    };
};

export const createCoordinationOfferViaApi = async (
    input: { requestUri: string; note: string | null },
    signal?: AbortSignal,
    idempotencyKey?: string,
): Promise<ApiClientResult<{ offer: CoordinationOffer }>> => {
    const result = await requestJsonPost(
        '/coordination/offers',
        input,
        signal,
        idempotencyKey,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'offer',
                'Offer response was malformed.',
            )
        :   result;
};

export const decideCoordinationOfferViaApi = async (
    input: {
        offerId: string;
        decision: 'accept' | 'decline' | 'cancel';
    },
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        offer: CoordinationOffer;
        connection: CoordinationConnection | null;
    }>
> => {
    const result = await requestJsonPost(
        '/coordination/offer-decisions',
        input,
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'offer',
                'Offer decision response was malformed.',
            )
        :   result;
};

export const transitionCoordinationConnectionViaApi = async (
    input: {
        connectionId: string;
        action: 'complete' | 'cancel';
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ connection: CoordinationConnection }>> => {
    const result = await requestJsonPost(
        '/coordination/connections',
        input,
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'connection',
                'Connection response was malformed.',
            )
        :   result;
};

export interface CoordinationWindow {
    id: string;
    connectionId: string;
    proposerDid: string;
    recipientDid: string;
    startAt: string;
    endAt: string;
    timezone: string;
    status: 'proposed' | 'confirmed' | 'declined' | 'cancelled' | 'expired';
    version: number;
    proposalExpiresAt: string;
    reminderEligibleAt: string;
    reminderSentAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export const fetchCoordinationWindowsViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<{ windows: CoordinationWindow[] }>> => {
    const result = await requestJson('/coordination/windows', new URLSearchParams(), signal);
    if (!result.ok) return result;
    const parsed = parseArrayProperty<CoordinationWindow>(result.data, 'windows', 'Schedule response was malformed.');
    return parsed.ok ? { ok: true, data: { windows: parsed.data } } : parsed;
};

export const proposeCoordinationWindowViaApi = async (
    input: { connectionId: string; startAt: string; endAt: string; timezone: string; expectedVersion?: number },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ window: CoordinationWindow }>> => {
    const result = await requestJsonPost('/coordination/windows', input, signal);
    return result.ok ? parseRecordPayload(result.data, 'window', 'Schedule proposal response was malformed.') : result;
};

export const decideCoordinationWindowViaApi = async (
    input: { connectionId: string; action: 'accept' | 'decline' | 'cancel'; expectedVersion: number },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ window: CoordinationWindow }>> => {
    const result = await requestJsonPost('/coordination/window-decisions', input, signal);
    return result.ok ? parseRecordPayload(result.data, 'window', 'Schedule decision response was malformed.') : result;
};

export interface ProductionGroupRoom {
    id: string;
    groupId: string;
    name: string;
    linkedRequestUri: string | null;
    status: 'active' | 'closed';
    version: number;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
}

export interface ProductionGroupMember {
    did: string;
    role: 'owner' | 'moderator' | 'member';
    status: 'active' | 'left' | 'removed';
    joinedAt: string;
    updatedAt: string;
}

export interface ProductionGroup {
    id: string;
    ownerDid: string;
    name: string;
    description: string;
    purpose: string;
    visibility: 'private' | 'public';
    status: 'active' | 'closed';
    version: number;
    actorRole: 'owner' | 'moderator' | 'member';
    rooms: ProductionGroupRoom[];
    members: ProductionGroupMember[];
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
}

export interface ProductionGroupInvitation {
    id: string;
    groupId: string;
    groupName: string;
    invitedByDid: string;
    role: 'moderator' | 'member';
    expiresAt: string;
    inviteeDid?: string;
}

export const fetchGroupsViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<{ groups: ProductionGroup[]; invitations: ProductionGroupInvitation[]; outgoingInvitations: ProductionGroupInvitation[] }>> => {
    const result = await requestJson('/groups', new URLSearchParams(), signal);
    if (!result.ok) return result;
    const groups = parseArrayProperty<ProductionGroup>(result.data, 'groups', 'Groups response was malformed.');
    const invitations = parseArrayProperty<ProductionGroupInvitation>(result.data, 'invitations', 'Groups response was malformed.');
    const outgoingInvitations = parseArrayProperty<ProductionGroupInvitation>(result.data, 'outgoingInvitations', 'Groups response was malformed.');
    if (!groups.ok) return groups;
    if (!invitations.ok) return invitations;
    if (!outgoingInvitations.ok) return outgoingInvitations;
    return {
        ok: true,
        data: {
            groups: groups.data,
            invitations: invitations.data,
            outgoingInvitations: outgoingInvitations.data,
        },
    };
};

const mutateGroup = async <T>(path: string, input: unknown, property: string): Promise<ApiClientResult<T>> => {
    const result = await requestJsonPost(path, input);
    return result.ok ? parseRecordPayload(result.data, property, 'Group response was malformed.') as ApiClientResult<T> : result;
};

export const createGroupViaApi = (input: {
    name: string; description: string; purpose: string;
    visibility: 'private' | 'public'; linkedRequestUri?: string;
}): Promise<ApiClientResult<{ group: ProductionGroup }>> => mutateGroup('/groups', input, 'group');

export const inviteGroupMemberViaApi = (input: {
    groupId: string; inviteeDid: string; role: 'moderator' | 'member';
}): Promise<ApiClientResult<{ invitation: { id: string; groupId: string; inviteeDid: string; role: string; token: string; expiresAt: string } }>> =>
    mutateGroup('/groups/invitations', input, 'invitation');

export const respondToGroupInvitationViaApi = (input: { token: string; action: 'accept' | 'reject' }): Promise<ApiClientResult<{ invitation: { id: string; status: string } }>> =>
    mutateGroup('/groups/invitation-responses', input, 'invitation');

export const revokeGroupInvitationViaApi = (input: { groupId: string; invitationId: string }): Promise<ApiClientResult<{ invitation: { id: string; status: string } }>> =>
    mutateGroup('/groups/invitation-revocations', input, 'invitation');

export const removeGroupMemberViaApi = (input: { groupId: string; memberDid: string }): Promise<ApiClientResult<{ member: ProductionGroupMember }>> =>
    mutateGroup('/groups/member-removals', input, 'member');

export const changeGroupMemberRoleViaApi = (input: { groupId: string; memberDid: string; role: 'moderator' | 'member' }): Promise<ApiClientResult<{ member: ProductionGroupMember }>> =>
    mutateGroup('/groups/role-changes', input, 'member');

export const leaveGroupViaApi = (groupId: string): Promise<ApiClientResult<{ member: ProductionGroupMember }>> =>
    mutateGroup('/groups/departures', { groupId }, 'member');

export const transferGroupOwnershipViaApi = async (input: { groupId: string; memberDid: string }): Promise<ApiClientResult<{ groupId: string; ownerDid: string }>> => {
    const result = await requestJsonPost('/groups/ownership-transfers', input);
    return result.ok && isRecord(result.data) ? { ok: true, data: result.data as { groupId: string; ownerDid: string } } :
        result.ok ? invalidResponseFailure('Group response was malformed.') : result;
};

export const closeGroupViaApi = async (groupId: string): Promise<ApiClientResult<{ groupId: string; status: 'closed' }>> => {
    const result = await requestJsonPost('/groups/closures', { groupId });
    return result.ok && isRecord(result.data) ? { ok: true, data: result.data as { groupId: string; status: 'closed' } } :
        result.ok ? invalidResponseFailure('Group response was malformed.') : result;
};

export const createGroupRoomViaApi = (input: { groupId: string; name: string; linkedRequestUri?: string }): Promise<ApiClientResult<{ room: ProductionGroupRoom }>> =>
    mutateGroup('/groups/rooms', input, 'room');

export const closeGroupRoomViaApi = (input: { groupId: string; roomId: string }): Promise<ApiClientResult<{ room: ProductionGroupRoom }>> =>
    mutateGroup('/groups/room-closures', input, 'room');

export interface ProductionChatConversation {
    id: string;
    kind: 'direct' | 'group';
    connectionId: string | null;
    roomId: string | null;
    title: string;
    counterpartDid?: string;
    groupId?: string;
    roomName?: string;
    status: 'active' | 'closed';
    version: number;
    unreadCount: number;
    lastSequence: number | null;
    lastReadSequence: number;
    lastMessageAt: string | null;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
}

export interface ProductionChatMessage {
    id: string;
    sequence: number;
    conversationId: string;
    authorDid: string | null;
    body: string | null;
    status: 'active' | 'redacted';
    deliveryState: 'delivered' | 'read' | null;
    createdAt: string;
    redactedAt: string | null;
}

export const fetchChatConversationsViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<{ conversations: ProductionChatConversation[] }>> => {
    const result = await requestJson('/chat/conversations', new URLSearchParams(), signal);
    if (!result.ok) return result;
    const conversations = parseArrayProperty<ProductionChatConversation>(
        result.data, 'conversations', 'Chat response was malformed.');
    return conversations.ok ? { ok: true, data: { conversations: conversations.data } } : conversations;
};

export const createChatConversationViaApi = async (
    input: { kind: 'direct'; connectionId: string } | { kind: 'group'; roomId: string },
): Promise<ApiClientResult<{ conversation: ProductionChatConversation; created: boolean }>> => {
    const result = await requestJsonPost('/chat/conversations', input);
    return result.ok ? parseRecordPayload(result.data, 'conversation', 'Chat response was malformed.') : result;
};

export const fetchChatMessagesViaApi = async (
    conversationId: string,
    options: { before?: number; limit?: number } = {},
    signal?: AbortSignal,
): Promise<ApiClientResult<{ messages: ProductionChatMessage[]; nextCursor: number | null }>> => {
    const query = new URLSearchParams({ conversationId });
    if (options.before !== undefined) query.set('before', String(options.before));
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    const result = await requestJson('/chat/messages', query, signal);
    if (!result.ok) return result;
    const messages = parseArrayProperty<ProductionChatMessage>(result.data, 'messages', 'Chat response was malformed.');
    if (!messages.ok) return messages;
    return isRecord(result.data) ? {
        ok: true,
        data: { messages: messages.data,
            nextCursor: typeof result.data['nextCursor'] === 'number' ? result.data['nextCursor'] : null },
    } : invalidResponseFailure('Chat response was malformed.');
};

export const sendChatMessageViaApi = async (input: {
    conversationId: string; clientMessageId: string; body: string;
}): Promise<ApiClientResult<{ message: ProductionChatMessage; created: boolean }>> => {
    const result = await requestJsonPost('/chat/messages', input);
    return result.ok ? parseRecordPayload(result.data, 'message', 'Chat response was malformed.') : result;
};

export const markChatReadViaApi = (input: {
    conversationId: string; throughMessageId: string;
}): Promise<ApiClientResult<{ conversationId: string; lastReadSequence: number }>> =>
    requestJsonPost('/chat/read', input) as Promise<ApiClientResult<{ conversationId: string; lastReadSequence: number }>>;

export const redactChatMessageViaApi = async (input: {
    conversationId: string; messageId: string;
}): Promise<ApiClientResult<{ message: ProductionChatMessage }>> => {
    const result = await requestJsonPost('/chat/messages/redactions', input);
    return result.ok ? parseRecordPayload(result.data, 'message', 'Chat response was malformed.') : result;
};

export const reportChatMessageViaApi = async (input: {
    conversationId: string; messageId: string;
    reason: 'abuse' | 'harassment' | 'spam' | 'fraud' | 'privacy' | 'other';
}): Promise<ApiClientResult<{ report: { id: string; status: 'pending' } }>> => {
    const result = await requestJsonPost('/chat/reports', input);
    return result.ok ? parseRecordPayload(result.data, 'report', 'Chat response was malformed.') : result;
};

const parseExactLocationState = (
    result: ApiClientResult<unknown>,
): ApiClientResult<ExactLocationSessionState> => {
    if (!result.ok) return result;
    if (
        !isRecord(result.data) ||
        typeof result.data['connectionId'] !== 'string' ||
        !isRecord(result.data['consent']) ||
        !(
            result.data['session'] === null ||
            isRecord(result.data['session'])
        )
    ) {
        return invalidResponseFailure(
            'Location-sharing session response was malformed.',
        );
    }
    return {
        ok: true,
        data: result.data as unknown as ExactLocationSessionState,
    };
};

export const fetchExactLocationSessionViaApi = async (
    connectionId: string,
    afterSequence = 0,
    signal?: AbortSignal,
): Promise<ApiClientResult<ExactLocationSessionState>> =>
    parseExactLocationState(
        await requestJson(
            '/location/session',
            new URLSearchParams({
                connectionId,
                after: String(afterSequence),
            }),
            signal,
        ),
    );

export const consentToExactLocationViaApi = async (
    connectionId: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<ExactLocationSessionState>> =>
    parseExactLocationState(
        await requestJsonPost(
            '/location/consent',
            { connectionId, consent: true },
            signal,
        ),
    );

export const sendExactLocationSignalViaApi = async (
    input:
        | {
              connectionId: string;
              sessionId: string;
              kind: 'description';
              payload: { type: 'offer' | 'answer'; sdp: string };
          }
        | {
              connectionId: string;
              sessionId: string;
              kind: 'candidate';
              payload: {
                  candidate: string;
                  sdpMid: string | null;
                  sdpMLineIndex: number | null;
                  usernameFragment: string | null;
              };
          }
        | {
              connectionId: string;
              sessionId: string;
              kind: 'end-of-candidates';
              payload: Record<string, never>;
          },
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        accepted: true;
        sequence: number;
        status: 'pending' | 'active';
        expiresAt: string;
    }>
> => {
    const result = await requestJsonPost('/location/signal', input, signal);
    return result.ok ?
            parseRecordPayload(
                result.data,
                'accepted',
                'Location signal response was malformed.',
            )
        :   result;
};

export const revokeExactLocationSessionViaApi = async (
    connectionId: string,
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        connectionId: string;
        status: 'revoked';
        revokedAt: string;
    }>
> => {
    const result = await requestJsonPost(
        '/location/revoke',
        { connectionId },
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'revokedAt',
                'Location revocation response was malformed.',
            )
        :   result;
};

export const fetchActivityInboxViaApi = async (
    unreadOnly = false,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ items: ActivityInboxItem[]; unread: number }>> => {
    const result = await requestJson(
        '/inbox',
        new URLSearchParams({ unread: String(unreadOnly) }),
        signal,
    );
    if (!result.ok) return result;
    if (
        !isRecord(result.data) ||
        !Array.isArray(result.data['items']) ||
        typeof result.data['unread'] !== 'number'
    ) {
        return invalidResponseFailure('Inbox response was malformed.');
    }
    return {
        ok: true,
        data: result.data as unknown as {
            items: ActivityInboxItem[];
            unread: number;
        },
    };
};

export const markActivityInboxReadViaApi = async (
    itemId: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ itemId: string; readAt: string }>> => {
    const result = await requestJsonPost('/inbox/read', { itemId }, signal);
    return result.ok ?
            parseRecordPayload(
                result.data,
                'readAt',
                'Inbox update response was malformed.',
            )
        :   result;
};

export interface NotificationChannelState {
    preferences: {
        inApp: boolean;
        email: boolean;
        push: boolean;
    };
    email: {
        address: string;
        verified: boolean;
    } | null;
    push: {
        supported: boolean;
        publicKey: string | null;
        activeSubscriptions: number;
    };
}

export const fetchNotificationsViaApi = async (
    input: {
        filter?: NotificationFilter;
        type?: NotificationType;
        cursor?: string;
        limit?: number;
    } = {},
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        items: Notification[];
        total: number;
        unread: number;
        nextCursor?: string;
    }>
> => {
    const params = new URLSearchParams();
    if (input.filter) params.set('filter', input.filter);
    if (input.type) params.set('type', input.type);
    if (input.cursor) params.set('cursor', input.cursor);
    if (input.limit) params.set('limit', String(input.limit));
    const result = await requestJson('/notifications', params, signal);
    if (
        !result.ok ||
        !isRecord(result.data) ||
        !Array.isArray(result.data['items']) ||
        typeof result.data['total'] !== 'number' ||
        typeof result.data['unread'] !== 'number'
    ) {
        return result.ok ?
                invalidResponseFailure(
                    'Notification response was malformed.',
                )
            :   result;
    }
    return {
        ok: true,
        data: result.data as unknown as {
            items: Notification[];
            total: number;
            unread: number;
            nextCursor?: string;
        },
    };
};

export const markNotificationReadViaApi = async (
    notificationId: string,
    read = true,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ updated: true }>> => {
    const result = await requestJsonPost(
        '/notifications/read',
        { notificationId, read },
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'updated',
                'Notification update response was malformed.',
            )
        :   result;
};

export const markAllNotificationsReadViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<{ updated: number }>> => {
    const result = await requestJsonPost(
        '/notifications/read-all',
        {},
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'updated',
                'Notification update response was malformed.',
            )
        :   result;
};

export const archiveNotificationViaApi = async (
    notificationId: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ archived: true }>> => {
    const result = await requestJsonPost(
        '/notifications/archive',
        { notificationId },
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'archived',
                'Notification archive response was malformed.',
            )
        :   result;
};

export const fetchNotificationChannelsViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<NotificationChannelState>> => {
    const result = await requestJson(
        '/notifications/channels',
        new URLSearchParams(),
        signal,
    );
    return result.ok && isRecord(result.data) ?
            {
                ok: true,
                data: result.data as unknown as NotificationChannelState,
            }
        : result.ok ?
            invalidResponseFailure(
                'Notification channel response was malformed.',
            )
        :   result;
};

export const requestNotificationEmailVerificationViaApi = async (
    email: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ expiresAt: string }>> => {
    const result = await requestJsonPost(
        '/notifications/email',
        { email },
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'expiresAt',
                'Email verification response was malformed.',
            )
        :   result;
};

export const confirmNotificationEmailViaApi = async (
    token: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ confirmed: true }>> => {
    const result = await requestJsonPost(
        '/notifications/email/confirm',
        { token },
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'confirmed',
                'Email confirmation response was malformed.',
            )
        :   result;
};

export const disableNotificationEmailViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<{ disabled: boolean }>> => {
    const result = await requestJsonDelete(
        '/notifications/email',
        {},
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'disabled',
                'Email disable response was malformed.',
            )
        :   result;
};

export const registerPushSubscriptionViaApi = async (
    subscription: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
    },
    signal?: AbortSignal,
): Promise<ApiClientResult<{ id: string }>> => {
    const result = await requestJsonPost(
        '/notifications/push',
        subscription,
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'id',
                'Push registration response was malformed.',
            )
        :   result;
};

export const revokePushSubscriptionViaApi = async (
    endpoint?: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<{ revoked: number }>> => {
    const result = await requestJsonDelete(
        '/notifications/push',
        { endpoint },
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'revoked',
                'Push revocation response was malformed.',
            )
        :   result;
};

export const matchRequestViaApi = async (
    input: {
        requestUri: string;
        requiredLanguages: string[];
        accessibilityNeeds: string[];
    },
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        requestUri: string;
        generatedAt: string;
        policy: {
            opaqueReputationScoreUsed: false;
            automaticAssignment: false;
            deterministicTieBreak: string;
        };
        candidates: MatchCandidate[];
    }>
> => {
    const result = await requestJsonPost(
        '/coordination/matches',
        input,
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'candidates',
                'Match response was malformed.',
            )
        :   result;
};

export const submitOutcomeFeedbackViaApi = async (
    input: {
        connectionId: string;
        outcome:
            | 'successful'
            | 'partially-successful'
            | 'unsuccessful'
            | 'no-response'
            | 'cancelled';
        rating: number;
        comment: string | null;
        tags: Array<
            | 'timely'
            | 'respectful'
            | 'clear-communication'
            | 'needs-follow-up'
            | 'safety-concern'
            | 'other'
        >;
    },
    signal?: AbortSignal,
): Promise<
    ApiClientResult<{
        feedback: OutcomeFeedback;
        safetyEscalated: boolean;
    }>
> => {
    const result = await requestJsonPost('/outcomes', input, signal);
    return result.ok ?
            parseRecordPayload(
                result.data,
                'feedback',
                'Outcome response was malformed.',
            )
        :   result;
};

export const fetchMyOutcomeFeedbackViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<{ feedback: OutcomeFeedback[] }>> => {
    const result = await requestJson(
        '/outcomes/mine',
        new URLSearchParams(),
        signal,
    );
    return result.ok ?
            parseRecordPayload(
                result.data,
                'feedback',
                'Outcome history response was malformed.',
            )
        :   result;
};

export interface LifecycleTransitionApiInput {
    postUri: string;
    targetStatus: string;
    reason?: string;
    now?: string;
}

export interface LifecycleTransitionApiResult {
    postUri: string;
    previousStatus: string;
    currentStatus: string;
    transition: {
        from: string;
        to: string;
        actorDid: string;
        actorRole: string;
        timestamp: string;
        reason?: string;
    };
    timeline: Array<{
        from: string;
        to: string;
        actorDid: string;
        actorRole: string;
        timestamp: string;
        reason?: string;
    }>;
    updatedAt: string;
}

export interface LifecycleQueryApiResult {
    postUri: string;
    currentStatus: string;
    statusLabel: string;
    timeline: Array<{
        from: string;
        to: string;
        actorDid: string;
        actorRole: string;
        timestamp: string;
        reason?: string;
    }>;
    validTransitions: string[];
    updatedAt: string;
    projectionReceipt?: ProjectionReceipt;
    publicSyncState?: 'pending' | 'synced' | 'failed';
    publicCid?: string;
}

export interface ProjectionReceipt {
    sourceUri: string;
    sourceCid?: string;
    state: 'pending' | 'projected' | 'failed';
    projectedAt?: string;
    lagSeconds?: number;
    retryAfterSeconds?: number;
    failureCode?: string;
}

const parseProjectionReceipt = (value: unknown): ProjectionReceipt | undefined => {
    if (!isRecord(value)) return undefined;
    const sourceUri = readString(value, 'sourceUri');
    const state = readString(value, 'state');
    if (!sourceUri || (state !== 'pending' && state !== 'projected' && state !== 'failed')) return undefined;
    return {
        sourceUri,
        state,
        ...(readString(value, 'sourceCid') ? { sourceCid: readString(value, 'sourceCid') } : {}),
        ...(readString(value, 'projectedAt') ? { projectedAt: readString(value, 'projectedAt') } : {}),
        ...(readNumber(value, 'lagSeconds') !== undefined ? { lagSeconds: readNumber(value, 'lagSeconds') } : {}),
        ...(readNumber(value, 'retryAfterSeconds') !== undefined ? { retryAfterSeconds: readNumber(value, 'retryAfterSeconds') } : {}),
        ...(readString(value, 'failureCode') ? { failureCode: readString(value, 'failureCode') } : {}),
    };
};

export const transitionAidPostViaApi = async (
    input: LifecycleTransitionApiInput,
    signal?: AbortSignal,
    idempotencyKey?: string,
): Promise<ApiClientResult<LifecycleTransitionApiResult>> => {
    const body = {
        postUri: input.postUri,
        targetStatus: input.targetStatus,
        reason: input.reason,
        now: input.now,
    };

    const result = await requestJsonPost(
        '/aid/post/transition',
        body,
        signal,
        idempotencyKey,
    );

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure(
            'Lifecycle transition response was malformed.',
        );
    }

    return {
        ok: true,
        data: result.data as unknown as LifecycleTransitionApiResult,
    };
};

export const queryAidPostLifecycleViaApi = async (
    postUri: string,
    signal?: AbortSignal,
): Promise<ApiClientResult<LifecycleQueryApiResult>> => {
    const result = await requestJson(
        '/aid/post/lifecycle',
        new URLSearchParams({ postUri }),
        signal,
    );

    if (!result.ok) {
        return result;
    }

    if (!isRecord(result.data)) {
        return invalidResponseFailure('Lifecycle query response was malformed.');
    }

    const projectionReceipt = parseProjectionReceipt(result.data['projectionReceipt']);
    return {
        ok: true,
        data: {
            ...(result.data as unknown as LifecycleQueryApiResult),
            ...(projectionReceipt ? { projectionReceipt } : {}),
        },
    };
};

export const createAidPostViaApi = async (
    input: AidPostCreateApiInput,
    signal?: AbortSignal,
): Promise<ApiClientResult<FeedRecordEnvelope>> => {
    const now = input.now ?? new Date().toISOString();
    const record = aidPostSchema.parse({
        $type: 'app.patchwork.aid.post',
        version: '1.0.0',
        title: input.draft.title,
        description: input.draft.description,
        category: input.draft.category,
        urgency: toLexiconUrgency(input.draft.urgency),
        status: 'open',
        location: {
            latitude: Number(input.draft.location.lat.toFixed(2)),
            longitude: Number(input.draft.location.lng.toFixed(2)),
            precisionKm: Math.max(
                1,
                Number((input.draft.location.precisionMeters / 1000).toFixed(3)),
            ),
        },
        createdAt: now,
        updatedAt: now,
    });

    const result = await createAtAidPostViaApi(record, signal, input.rkey);
    if (!result.ok) {
        return result;
    }
    const recipientDid = parseRepositoryDidFromUri(result.data.uri);
    if (!recipientDid) {
        return invalidResponseFailure(
            'Created aid-post URI did not contain a repository DID.',
        );
    }

    return {
        ok: true,
        data: {
            aidPostUri: result.data.uri,
            recipientDid,
            cid: result.data.cid,
            card: createFeedCard({
                id: parseRecordIdFromUri(result.data.uri, input.rkey),
                title: record.title,
                description: record.description,
                category: record.category,
                status: 'open',
                urgency: input.draft.urgency,
                accessibilityTags: input.draft.accessibilityTags,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt ?? record.createdAt,
                location: {
                    lat: record.location.latitude,
                    lng: record.location.longitude,
                    precisionKm: record.location.precisionKm,
                },
            }),
        },
    };
};

const readEnvelopeField = <T>(
    payload: unknown,
    field: string,
    invalidMessage: string,
): ApiClientResult<T> => {
    if (!isRecord(payload) || payload[field] === undefined) {
        return invalidResponseFailure(invalidMessage);
    }
    return { ok: true, data: payload[field] as T };
};

export const fetchPublicMaintenanceStatusViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<MaintenanceState>> => {
    const result = await requestJson('/status', new URLSearchParams(), signal);
    return result.ok ?
            readEnvelopeField(
                result.data,
                'maintenance',
                'Maintenance status response was malformed.',
            )
        :   result;
};

export const fetchModeratorMaintenanceViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<MaintenanceState>> => {
    const result = await requestJson(
        '/maintenance',
        new URLSearchParams(),
        signal,
    );
    return result.ok ?
            readEnvelopeField(
                result.data,
                'maintenance',
                'Moderator maintenance response was malformed.',
            )
        :   result;
};

export const declareMaintenanceViaApi = async (input: {
    reasonCodes: MaintenanceReasonCode[];
    publicMessage: string;
}): Promise<ApiClientResult<MaintenanceState>> => {
    const result = await requestJsonPost('/maintenance/declare', input);
    return result.ok ?
            readEnvelopeField(
                result.data,
                'maintenance',
                'Maintenance declaration response was malformed.',
            )
        :   result;
};

export const resumeMaintenanceViaApi = async (): Promise<
    ApiClientResult<MaintenanceState>
> => {
    const result = await requestJsonPost('/maintenance/resume', {});
    return result.ok ?
            readEnvelopeField(
                result.data,
                'maintenance',
                'Maintenance resume response was malformed.',
            )
        :   result;
};

export const fetchModerationQueueViaApi = async (
    signal?: AbortSignal,
): Promise<ApiClientResult<ModerationQueueItem[]>> => {
    const result = await requestJson(
        '/moderation/queue',
        new URLSearchParams(),
        signal,
    );
    if (!result.ok) return result;
    if (!isRecord(result.data) || !Array.isArray(result.data['results'])) {
        return invalidResponseFailure('Moderation queue response was malformed.');
    }
    return {
        ok: true,
        data: result.data['results'] as ModerationQueueItem[],
    };
};

export const fetchModerationAuditViaApi = async (
    subjectUri: string,
): Promise<ApiClientResult<ModerationAuditRecord[]>> => {
    const result = await requestJsonPost('/moderation/audit', { subjectUri });
    if (!result.ok) return result;
    if (!isRecord(result.data) || !Array.isArray(result.data['results'])) {
        return invalidResponseFailure('Moderation audit response was malformed.');
    }
    return {
        ok: true,
        data: result.data['results'] as ModerationAuditRecord[],
    };
};

export const applyModerationPolicyViaApi = async (input: {
    subjectUri: string;
    action: ModerationPolicyAction;
    reason: string;
    occurredAt?: string;
}): Promise<ApiClientResult<ModerationQueueItem>> => {
    const result = await requestJsonPost('/moderation/policy/apply', {
        ...input,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
    });
    return result.ok ?
            readEnvelopeField(
                result.data,
                'item',
                'Moderation action response was malformed.',
            )
        :   result;
};

export const fetchAidPostViaApi = async (uri: string, signal?: AbortSignal): Promise<ApiClientResult<FeedRecordEnvelope>> => {
    const result = await requestJson('/query/aid-post', new URLSearchParams({ uri }), signal);
    if (!result.ok) return result;
    const records = isRecord(result.data) ? mapAidPayloadToRecords(result.data) : undefined;
    if (!records?.[0]) return invalidResponseFailure('Request details were unavailable.');
    return { ok: true, data: records[0] };
};

export interface OwnedRequestReceipt {
    uri: string;
    title: string;
    status: string;
    sourceCid: string | null;
    sourceWrittenAt: string;
    publication: 'pending' | 'projected';
}
export async function fetchAccountRequestsViaApi(page = 1, signal?: AbortSignal): Promise<ApiClientResult<PagedResult<OwnedRequestReceipt>>> {
    const result = await requestJson('/account/requests', new URLSearchParams({ page: String(page) }), signal);
    if (!result.ok) return result;
    const data = result.data;
    if (!isRecord(data) || !Array.isArray(data.requests) || !Number.isSafeInteger(data.page)
        || data.pageSize !== 20 || !Number.isSafeInteger(data.total) || typeof data.hasNextPage !== 'boolean'
        || !data.requests.every((item: unknown) => isRecord(item) && typeof item.uri === 'string'
            && typeof item.title === 'string' && typeof item.status === 'string'
            && (item.sourceCid === null || typeof item.sourceCid === 'string') && typeof item.sourceWrittenAt === 'string'
            && (item.publication === 'pending' || item.publication === 'projected'))) {
        return invalidResponseFailure('Your requests response was malformed.');
    }
    return { ok: true, data: { items: data.requests as OwnedRequestReceipt[], page: data.page as number,
        pageSize: 20, total: data.total as number, hasNextPage: data.hasNextPage } };
}

export async function fetchResourceViaApi(uri: string, signal?: AbortSignal): Promise<ApiClientResult<ResourceDetail>> {
    const result = await requestJson('/query/directory-resource', new URLSearchParams({ uri }), signal);
    if (!result.ok) return result;
    const cards = isRecord(result.data) ? mapDirectoryPayloadToDetails(result.data) : [];
    if (!cards || cards.length !== 1 || cards[0]?.uri !== uri) return invalidResponseFailure('Resource details were unavailable.');
    return { ok: true, data: cards[0] };
}
