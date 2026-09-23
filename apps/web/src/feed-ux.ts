import {
    toFeedDiscoveryQuery,
    type AidCategory,
    type AidStatus,
    type DiscoveryFilterState,
    type SharedAidDiscoveryQuery,
} from './discovery-filters.js';
import { haversineDistanceMeters } from './geo-utils.js';
import { PUBLIC_MIN_PRECISION_KM } from '@patchwork/shared';
// ---------------------------------------------------------------------------
// Local reputation types (avoids cross-workspace runtime import issues)
// ---------------------------------------------------------------------------

type TrustLevel = 'new' | 'emerging' | 'established' | 'trusted' | 'exemplary';

interface ReputationScore {
    overall: number;
    reliability: number;
    responsiveness: number;
    communityRating: number;
    trustLevel: TrustLevel;
    computedAt: string;
}

const TRUST_LEVEL_LABELS: Readonly<Record<TrustLevel, string>> = {
    new: 'New',
    emerging: 'Emerging',
    established: 'Established',
    trusted: 'Trusted',
    exemplary: 'Exemplary',
};

const TRUST_LEVEL_TONES: Readonly<
    Record<TrustLevel, 'neutral' | 'info' | 'success'>
> = {
    new: 'neutral',
    emerging: 'neutral',
    established: 'info',
    trusted: 'success',
    exemplary: 'success',
};

/**
 * Canonical lifecycle statuses from the lifecycle state machine.
 * These map to the RequestStatus type in packages/shared/src/lifecycle.ts.
 */
export type LifecycleStatus =
    | 'open'
    | 'triaged'
    | 'assigned'
    | 'in_progress'
    | 'resolved'
    | 'archived';

/**
 * A recorded status transition in the audit timeline.
 */
export interface FeedStatusTransition {
    from: LifecycleStatus;
    to: LifecycleStatus;
    actorDid: string;
    actorRole: string;
    timestamp: string;
    reason?: string;
}

/**
 * Assignment info displayed on feed cards.
 */
export interface FeedAssignmentInfo {
    assigneeDid: string;
    status: 'pending' | 'accepted' | 'declined' | 'timed_out';
    assignedAt: string;
}

/**
 * Attachment preview displayed on feed cards.
 */
export interface FeedAttachmentPreview {
    id: string;
    filename: string;
    mimeType: string;
    url: string;
    moderationStatus: 'pending' | 'approved' | 'rejected';
}

export interface FeedAidCard {
    id: string;
    title: string;
    description: string;
    category: AidCategory;
    status: AidStatus;
    lifecycleStatus?: LifecycleStatus;
    validTransitions?: LifecycleStatus[];
    urgency: 1 | 2 | 3 | 4 | 5;
    accessibilityTags: string[];
    createdAt: string;
    updatedAt: string;
    location?: {
        lat: number;
        lng: number;
        precisionKm: number;
    };
    timeline?: FeedStatusTransition[];
    assignment?: FeedAssignmentInfo;
    attachments?: FeedAttachmentPreview[];
    volunteerReputation?: ReputationScore;
}

export interface FeedBadge {
    label: string;
    tone: 'default' | 'neutral' | 'info' | 'success' | 'danger';
}

/**
 * View model for displaying a volunteer's reputation badge on a feed card.
 */
export interface ReputationBadgeViewModel {
    trustLevel: TrustLevel;
    label: string;
    tone: 'neutral' | 'info' | 'success';
    overallScore: number | null;
    showScore: boolean;
    ariaLabel: string;
}

/**
 * Transform a ReputationScore into a display-ready badge view model.
 *
 * Returns null when no reputation data is available.
 */
export function toReputationBadge(
    score: ReputationScore | undefined,
): ReputationBadgeViewModel | null {
    if (!score) {
        return null;
    }

    const label = TRUST_LEVEL_LABELS[score.trustLevel];
    const tone = TRUST_LEVEL_TONES[score.trustLevel];
    const showScore = score.trustLevel !== 'new' && score.overall > 0;

    return {
        trustLevel: score.trustLevel,
        label,
        tone,
        overallScore: showScore ? score.overall : null,
        showScore,
        ariaLabel: showScore
            ? `Reputation: ${label} (${score.overall}/100)`
            : `Reputation: ${label}`,
    };
}

export interface FeedTransitionAction {
    targetStatus: LifecycleStatus;
    label: string;
    ariaLabel: string;
}

export interface FeedCardPresentation {
    id: string;
    urgencyBadge: FeedBadge;
    statusBadge: FeedBadge;
    lifecycleBadge?: FeedBadge;
    assignmentBadge?: FeedBadge;
    reputationBadge: ReputationBadgeViewModel | null;
    canEdit: boolean;
    canClose: boolean;
    transitionActions: FeedTransitionAction[];
    timelineEntryCount: number;
    attachmentCount: number;
    visibleAttachments: FeedAttachmentPreview[];
}

export interface FeedViewModel {
    query: SharedAidDiscoveryQuery;
    cards: FeedAidCard[];
    presentations: FeedCardPresentation[];
}

export type FeedLifecycleAction =
    | { action: 'create'; card: FeedAidCard }
    | {
          action: 'edit';
          id: string;
          patch: Partial<Omit<FeedAidCard, 'id'>>;
      }
    | { action: 'close'; id: string; closedAt?: string }
    | {
          action: 'transition';
          id: string;
          targetStatus: LifecycleStatus;
          actorDid: string;
          actorRole: string;
          reason?: string;
      };

const cardMatchesText = (card: FeedAidCard, text: string): boolean => {
    const fragments = [
        card.title,
        card.description,
        card.accessibilityTags.join(' '),
    ].filter((fragment) => !!fragment && fragment.trim().length > 0);

    const haystack = fragments.join(' ').toLowerCase();
    const needle = text.toLowerCase();

    return haystack.includes(needle);
};

const toUrgencyBadge = (urgency: FeedAidCard['urgency']): FeedBadge => {
    if (urgency >= 5) {
        return { label: 'Critical', tone: 'danger' };
    }
    if (urgency >= 4) {
        return { label: 'High', tone: 'danger' };
    }
    if (urgency >= 3) {
        return { label: 'Medium', tone: 'info' };
    }
    return { label: 'Low', tone: 'neutral' };
};

const toStatusBadge = (status: AidStatus): FeedBadge => {
    if (status === 'open') {
        return { label: 'Open', tone: 'default' };
    }
    if (status === 'in-progress') {
        return { label: 'In progress', tone: 'info' };
    }
    if (status === 'resolved') {
        return { label: 'Resolved', tone: 'success' };
    }
    return { label: 'Closed', tone: 'neutral' };
};

const LIFECYCLE_BADGE_MAP: Record<LifecycleStatus, FeedBadge> = {
    open: { label: 'Open', tone: 'default' },
    triaged: { label: 'Triaged', tone: 'info' },
    assigned: { label: 'Assigned', tone: 'info' },
    in_progress: { label: 'In Progress', tone: 'info' },
    resolved: { label: 'Resolved', tone: 'success' },
    archived: { label: 'Archived', tone: 'neutral' },
};

const toLifecycleBadge = (
    lifecycleStatus: LifecycleStatus | undefined,
): FeedBadge | undefined => {
    if (!lifecycleStatus) {
        return undefined;
    }
    return LIFECYCLE_BADGE_MAP[lifecycleStatus];
};

/**
 * Build the set of transition actions available for a card based on its
 * lifecycle status. This is a simplified version that shows common transitions;
 * the full role-aware check is done server-side.
 */
const LIFECYCLE_TRANSITION_LABELS: Partial<
    Record<LifecycleStatus, Array<{ target: LifecycleStatus; label: string }>>
> = {
    open: [
        { target: 'triaged', label: 'Triage' },
        { target: 'resolved', label: 'Resolve' },
    ],
    triaged: [
        { target: 'assigned', label: 'Assign' },
        { target: 'resolved', label: 'Resolve' },
    ],
    assigned: [
        { target: 'in_progress', label: 'Start work' },
        { target: 'resolved', label: 'Resolve' },
    ],
    in_progress: [
        { target: 'resolved', label: 'Resolve' },
        { target: 'assigned', label: 'Reassign' },
    ],
    resolved: [{ target: 'archived', label: 'Archive' }],
};

const buildTransitionActions = (
    card: FeedAidCard,
): FeedTransitionAction[] => {
    const status = card.lifecycleStatus;
    if (!status) {
        return [];
    }

    const allowed = card.validTransitions;
    const transitions = (LIFECYCLE_TRANSITION_LABELS[status] ?? []).filter(
        transition => !allowed || allowed.includes(transition.target),
    );
    return transitions.map(({ target, label }) => ({
        targetStatus: target,
        label,
        ariaLabel: `${label} request "${card.title}"`,
    }));
};

const byUpdatedAtDesc = (left: FeedAidCard, right: FeedAidCard): number => {
    const leftMs = Date.parse(left.updatedAt);
    const rightMs = Date.parse(right.updatedAt);
    const safeLeft = Number.isNaN(leftMs) ? 0 : leftMs;
    const safeRight = Number.isNaN(rightMs) ? 0 : rightMs;

    if (safeLeft !== safeRight) {
        return safeRight - safeLeft;
    }

    return left.id.localeCompare(right.id);
};

const ASSIGNMENT_BADGE_MAP: Record<FeedAssignmentInfo['status'], FeedBadge> = {
    pending: { label: 'Awaiting Response', tone: 'info' },
    accepted: { label: 'Accepted', tone: 'success' },
    declined: { label: 'Declined', tone: 'danger' },
    timed_out: { label: 'Timed Out', tone: 'danger' },
};

const toAssignmentBadge = (
    assignment: FeedAssignmentInfo | undefined,
): FeedBadge | undefined => {
    if (!assignment) {
        return undefined;
    }
    return ASSIGNMENT_BADGE_MAP[assignment.status];
};

const toPresentation = (card: FeedAidCard): FeedCardPresentation => {
    const allAttachments = card.attachments ?? [];
    // Only show approved attachments in the visible list
    const visibleAttachments = allAttachments.filter(
        a => a.moderationStatus === 'approved',
    );

    return {
        id: card.id,
        urgencyBadge: toUrgencyBadge(card.urgency),
        statusBadge: toStatusBadge(card.status),
        lifecycleBadge: toLifecycleBadge(card.lifecycleStatus),
        assignmentBadge: toAssignmentBadge(card.assignment),
        reputationBadge: toReputationBadge(card.volunteerReputation),
        canEdit: card.status !== 'closed' && card.lifecycleStatus !== 'archived',
        canClose: card.status !== 'closed' && card.lifecycleStatus !== 'archived',
        transitionActions: buildTransitionActions(card),
        timelineEntryCount: card.timeline?.length ?? 0,
        attachmentCount: allAttachments.length,
        visibleAttachments,
    };
};

export function createFeedCard(input: {
    id: string;
    title: string;
    description: string;
    category: AidCategory;
    status?: AidStatus;
    urgency?: 1 | 2 | 3 | 4 | 5;
    accessibilityTags?: string[];
    createdAt?: string;
    updatedAt?: string;
    location?: { lat: number; lng: number; precisionKm: number };
}): FeedAidCard {
    const now = new Date().toISOString();

    return {
        id: input.id,
        title: input.title,
        description: input.description,
        category: input.category,
        status: input.status ?? 'open',
        urgency: input.urgency ?? 3,
        accessibilityTags: input.accessibilityTags ?? [],
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? input.createdAt ?? now,
        location: input.location ? {
            ...input.location,
            precisionKm: Math.max(PUBLIC_MIN_PRECISION_KM, input.location.precisionKm),
        } : undefined,
    };
}

export function buildFeedViewModel(
    cards: readonly FeedAidCard[],
    state: DiscoveryFilterState,
): FeedViewModel {
    const query = toFeedDiscoveryQuery(state);
    const sinceMs = query.since ? Date.parse(query.since) : undefined;

    const filtered = cards.filter(card => {
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
            if (!card.location) {
                return false;
            }

            const distance = haversineDistanceMeters(query.center, card.location);
            if (distance > query.radiusMeters) {
                return false;
            }
        }

        return true;
    });

    const sorted = [...filtered].sort(byUpdatedAtDesc);

    return {
        query,
        cards: sorted,
        presentations: sorted.map(toPresentation),
    };
}

/**
 * Map a lifecycle status to the legacy AidStatus for backward compatibility.
 */
const lifecycleToAidStatus = (
    lifecycleStatus: LifecycleStatus,
): AidStatus => {
    switch (lifecycleStatus) {
        case 'open':
            return 'open';
        case 'triaged':
        case 'assigned':
        case 'in_progress':
            return 'in-progress';
        case 'resolved':
            return 'resolved';
        case 'archived':
            return 'closed';
    }
};

export function applyFeedLifecycleAction(
    cards: readonly FeedAidCard[],
    input: FeedLifecycleAction,
): FeedAidCard[] {
    if (input.action === 'create') {
        return [input.card, ...cards];
    }

    if (input.action === 'edit') {
        return cards.map(card =>
            card.id === input.id ? { ...card, ...input.patch, id: card.id } : card,
        );
    }

    if (input.action === 'transition') {
        const now = new Date().toISOString();
        return cards.map(card => {
            if (card.id !== input.id) {
                return card;
            }

            const transitionEntry: FeedStatusTransition = {
                from: card.lifecycleStatus ?? 'open',
                to: input.targetStatus,
                actorDid: input.actorDid,
                actorRole: input.actorRole,
                timestamp: now,
                reason: input.reason,
            };

            return {
                ...card,
                lifecycleStatus: input.targetStatus,
                status: lifecycleToAidStatus(input.targetStatus),
                updatedAt: now,
                timeline: [...(card.timeline ?? []), transitionEntry],
            };
        });
    }

    const closedAt = input.closedAt ?? new Date().toISOString();
    return cards.map(card =>
        card.id === input.id ? { ...card, status: 'closed', updatedAt: closedAt } : card,
    );
}
