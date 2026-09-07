export const CONTRACT_VERSION = '0.9.0-phase9';

export type DomainName =
    | 'identity'
    | 'aid-records'
    | 'geo'
    | 'ranking'
    | 'messaging'
    | 'moderation'
    | 'directory'
    | 'volunteer-onboarding'
    | 'anti-spam'
    | 'privacy';

export type HealthStatus = 'ok' | 'degraded' | 'not_ready';

export interface ServiceHealth {
    service: 'api' | 'indexer' | 'moderation-worker';
    status: HealthStatus;
    contractVersion: string;
    did: string;
    checks?: Record<string, { status: HealthStatus; message?: string }>;
}

export interface ApiQueryAidRequest {
    latitude: number;
    longitude: number;
    radiusKm: number;
    category?:
        | 'food'
        | 'shelter'
        | 'medical'
        | 'transport'
        | 'childcare'
        | 'other';
    urgency?: 'low' | 'medium' | 'high' | 'critical';
    status?: 'open' | 'in-progress' | 'resolved' | 'closed';
    freshnessHours?: number;
    searchText?: string;
    page?: number;
    pageSize?: number;
}

export interface AidRecordSummary {
    postalCode?: string;
    uri: string;
    authorDid: string;
    title: string;
    summary: string;
    status: 'open' | 'in-progress' | 'resolved' | 'closed';
    category:
        | 'food'
        | 'shelter'
        | 'medical'
        | 'transport'
        | 'childcare'
        | 'other';
    urgency: 'low' | 'medium' | 'high' | 'critical';
    approximateGeo?: {
        latitude: number;
        longitude: number;
        precisionKm: number;
    };
    /** Omitted for the global Latest feed until the visitor selects an area. */
    distanceKm?: number;
    ranking: {
        distanceBandScore: number;
        recencyScore: number;
        trustScore: number;
        finalScore: number;
    };
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

export interface DiscoveryMapAggregates {
    requestCount: number;
    locatedRequestCount: number;
    truncated: boolean;
    cells: Array<{ latitude: number; longitude: number; count: number; radiusKm: number; postalCode?: string }>;
}

export interface ApiQueryAidResponse {
    total: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    results: AidRecordSummary[];
    aggregates?: DiscoveryMapAggregates;
    projectionFreshness?: ProjectionFreshness;
}

export interface ProjectionFreshness {
    latestCursor: number | null;
    projectedAt: string | null;
    observedAt?: string | null;
    lagSeconds: number | null;
}

export interface ApiQueryDirectoryRequest {
    category?: string;
    status?: 'unverified' | 'community-verified' | 'partner-verified';
    operationalStatus?: 'open' | 'limited' | 'closed';
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
    freshnessHours?: number;
    searchText?: string;
    page?: number;
    pageSize?: number;
}

export interface DirectoryRecordSummary {
    uri: string;
    authorDid: string;
    cid?: string;
    name: string;
    category: string;
    serviceArea: string;
    status: 'unverified' | 'community-verified' | 'partner-verified';
    contact: {
        url?: string;
        phone?: string;
    };
    approximateGeo?: {
        latitude: number;
        longitude: number;
        precisionKm: number;
    };
    openHours?: string;
    eligibilityNotes?: string;
    operationalStatus: 'open' | 'limited' | 'closed';
    createdAt: string;
    updatedAt: string;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

export interface VolunteerVerificationCheckpointState {
    identityCheck: 'pending' | 'approved' | 'rejected';
    safetyTraining: 'pending' | 'approved' | 'rejected';
    communityReference: 'pending' | 'approved' | 'rejected';
}

export interface VolunteerMatchingPreferences {
    preferredCategories: Array<
        'food' | 'shelter' | 'medical' | 'transport' | 'childcare' | 'other'
    >;
    preferredUrgencies: Array<'low' | 'medium' | 'high' | 'critical'>;
    maxDistanceKm: number;
    acceptsLateNight?: boolean;
}

export interface VolunteerProfileSummary {
    did: string;
    displayName: string;
    capabilities: string[];
    availability: 'immediate' | 'within-24h' | 'scheduled' | 'unavailable';
    contactPreference: 'chat-only' | 'chat-or-call';
    skills: string[];
    availabilityWindows: string[];
    verificationCheckpoints: VolunteerVerificationCheckpointState;
    matchingPreferences: VolunteerMatchingPreferences;
    createdAt: string;
    updatedAt: string;
}

export interface ApiQueryDirectoryResponse {
    total: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    results: DirectoryRecordSummary[];
    projectionFreshness?: ProjectionFreshness;
}

export interface ApiQueryErrorResponse {
    error: {
        code: 'INVALID_QUERY' | 'UNSUPPORTED_ROUTE' | 'NOT_FOUND';
        message: string;
        details?: Record<string, unknown>;
    };
}

export interface ApiChatInitiationRequest {
    aidPostUri: string;
    initiatedByDid: string;
    recipientDid: string;
    initiatedFrom: 'map' | 'feed' | 'detail';
}

export interface ApiChatInitiationResponse {
    conversationUri: string;
    created: boolean;
    transportPath: 'atproto-direct' | 'resource-fallback' | 'manual-fallback';
    fallbackNotice?: {
        code: 'RECIPIENT_CAPABILITY_MISSING';
        message: string;
        safeForUser: true;
    };
}

export interface ApiChatSafetyEvaluationResponse {
    allowed: boolean;
    code:
        | 'OK'
        | 'BLOCKED'
        | 'RATE_LIMITED'
        | 'DUPLICATE_BLOCKED'
        | 'ABUSE_FLAGGED';
    userMessage: string;
    matchedKeywords: string[];
}

export interface ApiChatSafetyMetricsResponse {
    metrics: {
        evaluated: number;
        blockedByRelationship: number;
        rateLimited: number;
        duplicateBlocked: number;
        abuseKeywordFlags: number;
        suspiciousSignals: number;
    };
}

export interface ModerationQueueSummary {
    queueId: string;
    subjectUri: string;
    subjectType: 'aid-post' | 'conversation' | 'directory-resource' | 'other';
    queueStatus: 'queued' | 'resolved';
    visibility: 'visible' | 'delisted' | 'suspended';
    appealState: 'none' | 'pending' | 'under-review' | 'upheld' | 'rejected';
    latestReason: string;
    reportCount: number;
    updatedAt: string;
}

export interface IndexerNormalizedAidEvent {
    eventId: string;
    atUri: string;
    authorDid: string;
    normalizedAt: string;
    domain: Extract<
        DomainName,
        'aid-records' | 'geo' | 'ranking' | 'directory'
    >;
}

export interface ModerationDecisionEvent {
    eventId: string;
    subjectUri: string;
    action: 'none' | 'label' | 'hide' | 'escalate';
    reason: string;
    decidedAt: string;
}
export interface AidFeedQueryRequest {
    radiusKm: number;
    categories: string[];
    urgency: 'low' | 'medium' | 'high' | 'critical';
    status: 'open' | 'in-progress' | 'closed';
}

export interface AidFeedQueryResponse {
    requestId: string;
    total: number;
    items: Array<{
        id: string;
        title: string;
        summary: string;
        urgency: AidFeedQueryRequest['urgency'];
        status: AidFeedQueryRequest['status'];
    }>;
}

export interface FirehoseNormalizedEvent {
    type: 'firehose.normalized';
    recordUri: string;
    authorDid: string;
    indexedAt: string;
    action: 'create' | 'update' | 'delete';
    seq: number;
}

export interface ModerationReviewRequestedEvent {
    type: 'moderation.review.requested';
    subjectUri: string;
    reason: string;
    requestedAt: string;
}

export type ServiceEvent =
    | FirehoseNormalizedEvent
    | ModerationReviewRequestedEvent;

/**
 * Assignment workflow contract types.
 */
export interface AssignmentRequest {
    postUri: string;
    assigneeDid: string;
    assignerDid: string;
}

export interface AcceptAssignmentRequest {
    postUri: string;
    assigneeDid: string;
}

export interface DeclineAssignmentRequest {
    postUri: string;
    assigneeDid: string;
    reason?: string;
}

export interface HandoffCompletionRequest {
    postUri: string;
    assigneeDid: string;
    notes?: string;
    recipientConfirmed?: boolean;
    deliveryMethod?: 'in_person' | 'shipped' | 'digital' | 'other';
}

export interface AssignmentResponse {
    postUri: string;
    assigneeDid: string;
    status: 'pending' | 'accepted' | 'declined' | 'timed_out';
    assignedAt: string;
}

/**
 * Attachment contract types.
 */
export interface AddAttachmentRequest {
    postUri: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
    uploadedBy: string;
}

export interface AttachmentResponse {
    id: string;
    postUri: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
    uploadedBy: string;
    uploadedAt: string;
    moderationStatus: 'pending' | 'approved' | 'rejected';
}

export const serviceContractStubs = {
    api: {
        request: {
            latitude: 40.7128,
            longitude: -74.006,
            radiusKm: 5,
            category: 'food',
            urgency: 'high',
            status: 'open',
            freshnessHours: 24,
        } satisfies ApiQueryAidRequest,
        response: {
            total: 0,
            page: 1,
            pageSize: 20,
            hasNextPage: false,
            results: [],
        } satisfies ApiQueryAidResponse,
        chatInitiation: {
            aidPostUri:
                'at://did:example:alice/app.patchwork.aid.post/post-123',
            initiatedByDid: 'did:example:helper',
            recipientDid: 'did:example:alice',
            initiatedFrom: 'map',
        } satisfies ApiChatInitiationRequest,
        chatInitiationResponse: {
            conversationUri:
                'at://did:example:alice/app.patchwork.conversation.meta/conv-123',
            created: true,
            transportPath: 'atproto-direct',
        } satisfies ApiChatInitiationResponse,
    },
    indexer: {
        event: {
            type: 'firehose.normalized',
            recordUri: 'at://did:example:alice/app.patchwork.aid.post/abc123',
            authorDid: 'did:example:alice',
            indexedAt: new Date(0).toISOString(),
            action: 'create',
            seq: 1,
        } satisfies FirehoseNormalizedEvent,
    },
    moderationWorker: {
        event: {
            type: 'moderation.review.requested',
            subjectUri: 'at://did:example:alice/app.patchwork.aid.post/abc123',
            reason: 'stub-reason',
            requestedAt: new Date(0).toISOString(),
        } satisfies ModerationReviewRequestedEvent,
    },
};
