/**
 * Simple synchronous string hash (djb2 + hex) for deterministic ID generation.
 * Browser-safe replacement for node:crypto createHash('sha256').
 */
const simpleHash = (input: string, length: number): string => {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < input.length; i++) {
        const ch = input.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return n.toString(16).padStart(length, '0').slice(0, length);
};
import {
    recordNsid,
    type AidPostRecord,
    type ConversationMetaRecord,
    validateRecordPayload,
} from '@patchwork/at-lexicons';
import { deepClone } from './clone.js';
import { atUriSchema, didSchema, isoDateTimeSchema } from './schemas.js';

export type ChatInitiationSurface = 'map' | 'feed' | 'detail';

export type ChatFlowErrorCode =
    | 'UNAUTHORIZED'
    | 'INVALID_PARTICIPANTS'
    | 'INVALID_CONTEXT';

export class ChatFlowError extends Error {
    constructor(
        readonly code: ChatFlowErrorCode,
        message: string,
        readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'ChatFlowError';
    }
}

export interface CreatePostLinkedChatInput {
    aidPostUri: string;
    initiatedByDid: string;
    recipientDid: string;
    initiatedFrom: ChatInitiationSurface;
    now?: string;
    allowInitiation?: boolean;
    allowedParticipantDids?: readonly string[];
}

export interface PostLinkedChatContext {
    conversationUri: string;
    record: ConversationMetaRecord;
    requestContext: {
        aidPostUri: string;
        initiatedFrom: ChatInitiationSurface;
        initiatedByDid: string;
        recipientDid: string;
    };
}

const buildConversationKey = (
    aidPostUri: string,
    participantDids: readonly string[],
): string => {
    return simpleHash(`${aidPostUri}|${participantDids.join('|')}`, 24);
};

const validateInitiationPermission = (
    input: CreatePostLinkedChatInput,
): void => {
    if (input.allowInitiation === false) {
        throw new ChatFlowError(
            'UNAUTHORIZED',
            'Chat initiation is disabled for the current actor.',
            {
                initiatedByDid: input.initiatedByDid,
                recipientDid: input.recipientDid,
            },
        );
    }

    if (input.allowedParticipantDids) {
        const allowed = new Set(input.allowedParticipantDids);
        if (
            !allowed.has(input.initiatedByDid) ||
            !allowed.has(input.recipientDid)
        ) {
            throw new ChatFlowError(
                'UNAUTHORIZED',
                'Chat initiation failed participant authorization checks.',
                {
                    initiatedByDid: input.initiatedByDid,
                    recipientDid: input.recipientDid,
                },
            );
        }
    }
};

export const createPostLinkedChatContext = (
    input: CreatePostLinkedChatInput,
): PostLinkedChatContext => {
    const aidPostUri = atUriSchema.parse(input.aidPostUri);
    const initiatedByDid = didSchema.parse(input.initiatedByDid);
    const recipientDid = didSchema.parse(input.recipientDid);

    if (initiatedByDid === recipientDid) {
        throw new ChatFlowError(
            'INVALID_PARTICIPANTS',
            '1:1 chat initiation requires two distinct participants.',
            { initiatedByDid, recipientDid },
        );
    }

    validateInitiationPermission(input);

    const participantDids = [initiatedByDid, recipientDid].sort((left, right) =>
        left.localeCompare(right),
    );
    const conversationKey = buildConversationKey(aidPostUri, participantDids);
    const conversationUri = `at://${participantDids[0]}/${recordNsid.conversationMeta}/conv-${conversationKey}`;
    const now = isoDateTimeSchema.parse(input.now ?? new Date().toISOString());

    const recordCandidate = {
        $type: recordNsid.conversationMeta,
        version: '1.0.0',
        aidPostUri,
        participantDids,
        status: 'open',
        createdAt: now,
    } satisfies ConversationMetaRecord;

    const record = validateRecordPayload(
        recordNsid.conversationMeta,
        recordCandidate,
    );

    return {
        conversationUri,
        record,
        requestContext: {
            aidPostUri,
            initiatedFrom: input.initiatedFrom,
            initiatedByDid,
            recipientDid,
        },
    };
};

export interface VolunteerRoutingCandidate {
    id: string;
    did: string;
    availability: 'immediate' | 'within-24h' | 'scheduled' | 'unavailable';
    trustScore: number;
    matchesCategory: boolean;
    preferredCategories?: readonly AidPostRecord['category'][];
    preferredUrgencyLevels?: readonly AidPostRecord['urgency'][];
    maxDistanceKm?: number;
    distanceKm?: number;
    verificationCheckpointScore?: number;
}

export interface ResourceRoutingCandidate {
    id: string;
    verificationStatus:
        | 'unverified'
        | 'community-verified'
        | 'partner-verified';
    supportsCategory: boolean;
    currentlyOpen: boolean;
}

export interface RoutingAssistantInput {
    aidPostUri: string;
    requesterDid: string;
    aidCategory: AidPostRecord['category'];
    urgency: AidPostRecord['urgency'];
    postAuthorDid?: string;
    volunteerCandidates: readonly VolunteerRoutingCandidate[];
    resourceCandidates: readonly ResourceRoutingCandidate[];
    now?: string;
}

export interface RoutingCandidateScore {
    destinationKind:
        | 'post-author'
        | 'volunteer-pool'
        | 'verified-resource'
        | 'manual-fallback';
    destinationId: string;
    priority: number;
    reasons: string[];
}

export interface RoutingDecision {
    destinationKind: RoutingCandidateScore['destinationKind'];
    destinationId: string;
    destinationDid?: string;
    matchedRule:
        | 'RULE_POST_AUTHOR'
        | 'RULE_VOLUNTEER_POOL'
        | 'RULE_VERIFIED_RESOURCE'
        | 'RULE_MANUAL_FALLBACK';
    machineRationale: string[];
    humanRationale: string;
    priorityOrderUsed: {
        postAuthor: number;
        volunteerPool: number;
        verifiedResource: number;
    };
    orderedCandidates: RoutingCandidateScore[];
    decidedAt: string;
}

export const ROUTING_PRIORITY_ORDER = Object.freeze({
    postAuthor: 300,
    volunteerPool: 200,
    verifiedResource: 160,
});

const volunteerAvailabilityBonus = (
    availability: VolunteerRoutingCandidate['availability'],
): number => {
    if (availability === 'immediate') {
        return 35;
    }
    if (availability === 'within-24h') {
        return 20;
    }
    if (availability === 'scheduled') {
        return 10;
    }
    return -1000;
};

const resourceVerificationBonus = (
    verificationStatus: ResourceRoutingCandidate['verificationStatus'],
): number => {
    if (verificationStatus === 'partner-verified') {
        return 25;
    }
    if (verificationStatus === 'community-verified') {
        return 10;
    }
    return -20;
};

const toHumanRationale = (candidate: RoutingCandidateScore): string => {
    if (candidate.destinationKind === 'post-author') {
        return 'Routing to the original post author for the fastest direct response.';
    }

    if (candidate.destinationKind === 'volunteer-pool') {
        return 'Routing to the best-matching volunteer based on availability and trust.';
    }

    if (candidate.destinationKind === 'verified-resource') {
        return 'Routing to the strongest verified resource match for this request.';
    }

    return 'No deterministic recipient qualified; fallback handoff is required.';
};

const byPriorityThenId = (
    left: RoutingCandidateScore,
    right: RoutingCandidateScore,
): number => {
    if (left.priority !== right.priority) {
        return right.priority - left.priority;
    }

    return left.destinationId.localeCompare(right.destinationId);
};

export class DeterministicRoutingAssistant {
    decide(input: RoutingAssistantInput): RoutingDecision {
        const aidPostUri = atUriSchema.parse(input.aidPostUri);
        const requesterDid = didSchema.parse(input.requesterDid);
        const decidedAt = isoDateTimeSchema.parse(
            input.now ?? new Date().toISOString(),
        );

        const candidates: RoutingCandidateScore[] = [];

        if (input.postAuthorDid) {
            const postAuthorDid = didSchema.parse(input.postAuthorDid);
            if (postAuthorDid !== requesterDid) {
                candidates.push({
                    destinationKind: 'post-author',
                    destinationId: postAuthorDid,
                    priority: ROUTING_PRIORITY_ORDER.postAuthor,
                    reasons: [
                        'post-author-eligible=true',
                        `aid-post=${aidPostUri}`,
                    ],
                });
            }
        }

        for (const volunteer of input.volunteerCandidates) {
            const volunteerDid = didSchema.parse(volunteer.did);
            const availabilityBonus = volunteerAvailabilityBonus(
                volunteer.availability,
            );

            if (availabilityBonus < 0) {
                continue;
            }

            if (
                volunteer.maxDistanceKm !== undefined &&
                volunteer.distanceKm !== undefined &&
                volunteer.distanceKm > volunteer.maxDistanceKm
            ) {
                continue;
            }

            const trustScore = Math.max(0, Math.min(1, volunteer.trustScore));
            const trustBonus = Math.round(trustScore * 20);
            const categoryBonus = volunteer.matchesCategory ? 12 : 0;
            const preferredCategoryBonus =
                volunteer.preferredCategories?.includes(input.aidCategory) ?
                    10
                :   0;
            const preferredUrgencyBonus =
                volunteer.preferredUrgencyLevels?.includes(input.urgency) ?
                    8
                :   0;
            const verificationBonus = Math.round(
                Math.max(
                    0,
                    Math.min(1, volunteer.verificationCheckpointScore ?? 0),
                ) * 10,
            );
            const urgencyBonus =
                input.urgency === 'critical' || input.urgency === 'high' ?
                    8
                :   0;

            candidates.push({
                destinationKind: 'volunteer-pool',
                destinationId: `volunteer:${volunteer.id}`,
                priority:
                    ROUTING_PRIORITY_ORDER.volunteerPool +
                    availabilityBonus +
                    trustBonus +
                    categoryBonus +
                    preferredCategoryBonus +
                    preferredUrgencyBonus +
                    verificationBonus +
                    urgencyBonus,
                reasons: [
                    `availability=${volunteer.availability}`,
                    `trust=${trustScore.toFixed(2)}`,
                    `category-match=${volunteer.matchesCategory}`,
                    `preferred-category=${volunteer.preferredCategories?.includes(input.aidCategory) ?? false}`,
                    `preferred-urgency=${volunteer.preferredUrgencyLevels?.includes(input.urgency) ?? false}`,
                    `distanceKm=${volunteer.distanceKm ?? 'n/a'}`,
                    `did=${volunteerDid}`,
                ],
            });
        }

        for (const resource of input.resourceCandidates) {
            if (!resource.supportsCategory || !resource.currentlyOpen) {
                continue;
            }

            const verificationBonus = resourceVerificationBonus(
                resource.verificationStatus,
            );
            const urgencyBonus =
                (
                    input.urgency === 'critical' &&
                    resource.verificationStatus !== 'unverified'
                ) ?
                    8
                :   0;

            candidates.push({
                destinationKind: 'verified-resource',
                destinationId: `resource:${resource.id}`,
                priority:
                    ROUTING_PRIORITY_ORDER.verifiedResource +
                    verificationBonus +
                    urgencyBonus,
                reasons: [
                    `verification=${resource.verificationStatus}`,
                    `supports-category=${resource.supportsCategory}`,
                    `open=${resource.currentlyOpen}`,
                ],
            });
        }

        const orderedCandidates = [...candidates].sort(byPriorityThenId);
        const top =
            orderedCandidates[0] ??
            ({
                destinationKind: 'manual-fallback',
                destinationId: 'manual-fallback',
                priority: 0,
                reasons: ['no-candidates-qualified=true'],
            } satisfies RoutingCandidateScore);

        return {
            destinationKind: top.destinationKind,
            destinationId: top.destinationId,
            destinationDid:
                top.destinationKind === 'post-author' ?
                    top.destinationId
                :   undefined,
            matchedRule:
                top.destinationKind === 'post-author' ? 'RULE_POST_AUTHOR'
                : top.destinationKind === 'volunteer-pool' ?
                    'RULE_VOLUNTEER_POOL'
                : top.destinationKind === 'verified-resource' ?
                    'RULE_VERIFIED_RESOURCE'
                :   'RULE_MANUAL_FALLBACK',
            machineRationale: [...top.reasons],
            humanRationale: toHumanRationale(top),
            priorityOrderUsed: { ...ROUTING_PRIORITY_ORDER },
            orderedCandidates,
            decidedAt,
        };
    }
}

export interface RecipientTransportCapability {
    recipientDid: string;
    supportsAtprotoChat: boolean;
    fallbackChannels: readonly ('phone' | 'url' | 'manual-review')[];
    detectedAt: string;
}

export type ConversationTransportPath =
    | 'atproto-direct'
    | 'resource-fallback'
    | 'manual-fallback';

export interface ConversationFallbackNotice {
    code: 'RECIPIENT_CAPABILITY_MISSING';
    message: string;
    safeForUser: true;
    transportPath: Exclude<ConversationTransportPath, 'atproto-direct'>;
}

const resolveTransportPath = (
    routingDecision: RoutingDecision,
    capability: RecipientTransportCapability,
): ConversationTransportPath => {
    if (capability.supportsAtprotoChat) {
        return 'atproto-direct';
    }

    if (routingDecision.destinationKind === 'verified-resource') {
        return 'resource-fallback';
    }

    return 'manual-fallback';
};

const buildFallbackNotice = (
    transportPath: ConversationTransportPath,
): ConversationFallbackNotice | undefined => {
    if (transportPath === 'atproto-direct') {
        return undefined;
    }

    return {
        code: 'RECIPIENT_CAPABILITY_MISSING',
        message:
            'Recipient cannot receive AT-native chat yet. We will use a safe fallback handoff path.',
        safeForUser: true,
        transportPath,
    };
};

export interface PersistConversationMetadataInput {
    chat: PostLinkedChatContext;
    routingDecision: RoutingDecision;
    recipientCapability: RecipientTransportCapability;
    status?: ConversationMetaRecord['status'];
    updatedAt?: string;
}

export interface PersistedConversationMetadata {
    conversationUri: string;
    aidPostUri: string;
    record: ConversationMetaRecord;
    requestContext: PostLinkedChatContext['requestContext'];
    routingDecision: RoutingDecision;
    recipientCapability: RecipientTransportCapability;
    transportPath: ConversationTransportPath;
    fallbackNotice?: ConversationFallbackNotice;
    audit: {
        lastUpdatedAt: string;
        moderationQueryableKey: string;
    };
}

export class ConversationMetadataStore {
    private readonly conversations = new Map<
        string,
        PersistedConversationMetadata
    >();

    upsertConversation(
        input: PersistConversationMetadataInput,
    ): PersistedConversationMetadata {
        const conversationUri = atUriSchema.parse(input.chat.conversationUri);
        const now = isoDateTimeSchema.parse(
            input.updatedAt ?? new Date().toISOString(),
        );
        const existing = this.conversations.get(conversationUri);
        const status =
            input.status ?? existing?.record.status ?? input.chat.record.status;

        const recordCandidate = {
            ...input.chat.record,
            status,
            createdAt:
                existing?.record.createdAt ?? input.chat.record.createdAt,
            updatedAt: now,
        } satisfies ConversationMetaRecord;

        const record = validateRecordPayload(
            recordNsid.conversationMeta,
            recordCandidate,
        );

        const recipientDid = didSchema.parse(
            input.recipientCapability.recipientDid,
        );
        const capability: RecipientTransportCapability = {
            ...input.recipientCapability,
            recipientDid,
            detectedAt: isoDateTimeSchema.parse(
                input.recipientCapability.detectedAt,
            ),
        };

        const transportPath = resolveTransportPath(
            input.routingDecision,
            capability,
        );
        const fallbackNotice = buildFallbackNotice(transportPath);

        const persisted: PersistedConversationMetadata = {
            conversationUri,
            aidPostUri: record.aidPostUri,
            record,
            requestContext: deepClone(input.chat.requestContext),
            routingDecision: deepClone(input.routingDecision),
            recipientCapability: capability,
            transportPath,
            fallbackNotice,
            audit: {
                lastUpdatedAt: now,
                moderationQueryableKey: `${record.aidPostUri}:${record.participantDids.join('|')}`,
            },
        };

        this.conversations.set(conversationUri, persisted);
        return deepClone(persisted);
    }

    getConversation(
        conversationUri: string,
    ): PersistedConversationMetadata | null {
        const normalizedUri = atUriSchema.parse(conversationUri);
        const found = this.conversations.get(normalizedUri);
        return found ? deepClone(found) : null;
    }

    listForAidPost(aidPostUri: string): PersistedConversationMetadata[] {
        const normalizedAidPostUri = atUriSchema.parse(aidPostUri);

        return [...this.conversations.values()]
            .filter(
                conversation =>
                    conversation.aidPostUri === normalizedAidPostUri,
            )
            .sort((left, right) =>
                left.conversationUri.localeCompare(right.conversationUri),
            )
            .map(value => deepClone(value));
    }

    listFallbackRequired(): PersistedConversationMetadata[] {
        return [...this.conversations.values()]
            .filter(
                conversation =>
                    conversation.transportPath !== 'atproto-direct' &&
                    conversation.fallbackNotice !== undefined,
            )
            .sort((left, right) =>
                left.conversationUri.localeCompare(right.conversationUri),
            )
            .map(value => deepClone(value));
    }
}

// ---------------------------------------------------------------------------
// Message status (Issue #122 - conversation UX)
// ---------------------------------------------------------------------------

export const messageStatuses = [
    'sending',
    'sent',
    'delivered',
    'read',
    'failed',
] as const;
export type MessageStatus = (typeof messageStatuses)[number];

export interface ConversationMessage {
    messageId: string;
    conversationUri: string;
    senderDid: string;
    text: string;
    status: MessageStatus;
    sequenceNumber: number;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
    failureReason?: string;
}

// ---------------------------------------------------------------------------
// Cursor-based pagination
// ---------------------------------------------------------------------------

export interface PaginationCursor {
    cursor?: string;
    limit: number;
}

export interface PaginatedMessages {
    messages: ConversationMessage[];
    nextCursor?: string;
    hasMore: boolean;
    total: number;
}

// ---------------------------------------------------------------------------
// In-memory conversation message store
// ---------------------------------------------------------------------------

export class ConversationMessageStore {
    private readonly messages = new Map<string, ConversationMessage>();
    private sequenceCounter = 0;

    addMessage(input: {
        conversationUri: string;
        senderDid: string;
        text: string;
        messageId?: string;
        createdAt?: string;
    }): ConversationMessage {
        const conversationUri = atUriSchema.parse(input.conversationUri);
        const senderDid = didSchema.parse(input.senderDid);
        const now = isoDateTimeSchema.parse(
            input.createdAt ?? new Date().toISOString(),
        );
        this.sequenceCounter += 1;

        const messageId =
            input.messageId ?? `msg-${this.sequenceCounter}-${Date.now()}`;

        const message: ConversationMessage = {
            messageId,
            conversationUri,
            senderDid,
            text: input.text,
            status: 'sent',
            sequenceNumber: this.sequenceCounter,
            createdAt: now,
            updatedAt: now,
            retryCount: 0,
        };

        this.messages.set(messageId, message);
        return deepClone(message);
    }

    updateMessageStatus(
        messageId: string,
        status: MessageStatus,
        failureReason?: string,
    ): ConversationMessage | null {
        const message = this.messages.get(messageId);
        if (!message) {
            return null;
        }

        message.status = status;
        message.updatedAt = new Date().toISOString();
        if (failureReason !== undefined) {
            message.failureReason = failureReason;
        }

        return deepClone(message);
    }

    retryMessage(messageId: string): ConversationMessage | null {
        const message = this.messages.get(messageId);
        if (!message || message.status !== 'failed') {
            return null;
        }

        message.status = 'sending';
        message.retryCount += 1;
        message.updatedAt = new Date().toISOString();
        message.failureReason = undefined;

        // Simulate immediate success after retry
        message.status = 'sent';

        return deepClone(message);
    }

    getConversationHistory(
        conversationUri: string,
        pagination: PaginationCursor,
    ): PaginatedMessages {
        const parsedUri = atUriSchema.parse(conversationUri);
        const allMessages = [...this.messages.values()]
            .filter(message => message.conversationUri === parsedUri)
            .sort((left, right) => {
                if (left.sequenceNumber !== right.sequenceNumber) {
                    return left.sequenceNumber - right.sequenceNumber;
                }
                return left.createdAt.localeCompare(right.createdAt);
            });

        const total = allMessages.length;
        let startIndex = 0;

        if (pagination.cursor) {
            const cursorSeq = Number.parseInt(pagination.cursor, 10);
            startIndex = allMessages.findIndex(
                message => message.sequenceNumber > cursorSeq,
            );
            if (startIndex === -1) {
                return {
                    messages: [],
                    hasMore: false,
                    total,
                };
            }
        }

        const limit = Math.min(pagination.limit, 100);
        const page = allMessages.slice(startIndex, startIndex + limit);
        const hasMore = startIndex + limit < total;
        const nextCursor =
            hasMore && page.length > 0
                ? String(page[page.length - 1]!.sequenceNumber)
                : undefined;

        return {
            messages: page.map(message => deepClone(message)),
            nextCursor,
            hasMore,
            total,
        };
    }

    getMessage(messageId: string): ConversationMessage | null {
        const found = this.messages.get(messageId);
        return found ? deepClone(found) : null;
    }
}


export {
    buildPhase5RoutingFixtures,
    type RoutingFixture,
} from './messaging-fixtures.js';
