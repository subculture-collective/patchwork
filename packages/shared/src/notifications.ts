/**
 * Notification center and delivery channel contracts.
 *
 * Defines notification types, delivery channels (in-app, email, push, webhook),
 * user channel preferences, delivery status tracking, dedupe/retry policies,
 * and reliability metrics.
 */

// ---------------------------------------------------------------------------
// Notification types
// ---------------------------------------------------------------------------

export const NOTIFICATION_TYPES = [
    'offer_received',
    'offer_accepted',
    'offer_declined',
    'offer_expired',
    'connection_started',
    'connection_completed',
    'connection_cancelled',
    'lifecycle_changed',
    'verification_submitted',
    'verification_decided',
    'appeal_submitted',
    'appeal_decided',
    'account_expiry',
    'moderation_action',
    'attachment_action',
    'organization_action',
    'request_created',
    'request_assigned',
    'assignment_accepted',
    'assignment_declined',
    'handoff_completed',
    'message_received',
    'feedback_requested',
    'shift_reminder',
    'shift_conflict',
    'shift_no_show',
    'system_announcement',
    'saved_discovery_changed',
    'schedule_proposed',
    'schedule_changed',
    'schedule_confirmed',
    'schedule_declined',
    'schedule_cancelled',
    'schedule_reminder',
    'schedule_expired',
    'group_invited',
    'group_joined',
    'group_removed',
    'group_role_changed',
    'group_closed',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Delivery channels
// ---------------------------------------------------------------------------

export const DELIVERY_CHANNELS = [
    'in_app',
    'email',
    'push',
    'webhook',
] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

// ---------------------------------------------------------------------------
// Delivery status
// ---------------------------------------------------------------------------

export const DELIVERY_STATUSES = [
    'pending',
    'processing',
    'sent',
    'delivered',
    'failed',
    'retry',
    'dead_letter',
    'skipped',
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// ---------------------------------------------------------------------------
// Notification priority
// ---------------------------------------------------------------------------

export const NOTIFICATION_PRIORITIES = [
    'low',
    'normal',
    'high',
    'urgent',
] as const;

export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

// ---------------------------------------------------------------------------
// Notification item
// ---------------------------------------------------------------------------

export interface Notification {
    id: string;
    type: NotificationType;
    recipientDid: string;
    title: string;
    body: string;
    priority: NotificationPriority;
    read: boolean;
    archived: boolean;
    actionUrl?: string;
    metadata?: Record<string, unknown>;
    templateVersion?: string;
    deduplicationKey?: string;
    createdAt: string;
    updatedAt: string;
}

// ---------------------------------------------------------------------------
// Channel delivery attempt
// ---------------------------------------------------------------------------

export interface DeliveryAttempt {
    id: string;
    notificationId: string;
    channel: DeliveryChannel;
    status: DeliveryStatus;
    attemptNumber: number;
    sentAt?: string;
    deliveredAt?: string;
    failureReason?: string;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// Channel preferences
// ---------------------------------------------------------------------------

export interface ChannelPreference {
    channel: DeliveryChannel;
    enabled: boolean;
    /** Notification types that should be sent via this channel. Empty = all. */
    allowedTypes: NotificationType[];
    /** Quiet hours: suppress delivery during these hours (0-23). */
    quietHoursStart?: number;
    quietHoursEnd?: number;
}

export interface UserNotificationPreferences {
    userDid: string;
    channels: ChannelPreference[];
    /** Global mute - suppresses all non-urgent notifications. */
    globalMute: boolean;
    updatedAt: string;
}

export const DEFAULT_CHANNEL_PREFERENCES: readonly ChannelPreference[] = [
    { channel: 'in_app', enabled: true, allowedTypes: [] },
    { channel: 'email', enabled: false, allowedTypes: [] },
    { channel: 'push', enabled: false, allowedTypes: [] },
    { channel: 'webhook', enabled: false, allowedTypes: [] },
];

export const createDefaultPreferences = (
    userDid: string,
    now?: string,
): UserNotificationPreferences => ({
    userDid,
    channels: DEFAULT_CHANNEL_PREFERENCES.map((c) => ({ ...c })),
    globalMute: false,
    updatedAt: now ?? new Date().toISOString(),
});

// ---------------------------------------------------------------------------
// Dedupe policy
// ---------------------------------------------------------------------------

export interface DedupeKey {
    recipientDid: string;
    type: NotificationType;
    /** Context key for deduplication (e.g., postUri + type). */
    contextKey: string;
}

export const buildDedupeKey = (
    recipientDid: string,
    type: NotificationType,
    contextKey: string,
): string => `${recipientDid}:${type}:${contextKey}`;

/** Default dedupe window in milliseconds (5 minutes). */
export const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

export interface RetryPolicy {
    maxAttempts: number;
    backoffMs: number;
    backoffMultiplier: number;
}

export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
    maxAttempts: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
});

/**
 * Compute the delay before the next retry attempt.
 */
export const computeRetryDelay = (
    attemptNumber: number,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): number => {
    if (attemptNumber <= 0) return 0;
    return (
        policy.backoffMs * Math.pow(policy.backoffMultiplier, attemptNumber - 1)
    );
};

/**
 * Check whether a retry is allowed for the given attempt number.
 */
export const canRetryDelivery = (
    attemptNumber: number,
    policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): boolean => attemptNumber < policy.maxAttempts;

// ---------------------------------------------------------------------------
// Notification filter
// ---------------------------------------------------------------------------

export const NOTIFICATION_FILTERS = [
    'all',
    'unread',
    'read',
    'archived',
] as const;

export type NotificationFilter = (typeof NOTIFICATION_FILTERS)[number];

export const matchesNotificationFilter = (
    notification: Notification,
    filter: NotificationFilter,
): boolean => {
    switch (filter) {
        case 'all':
            return !notification.archived;
        case 'unread':
            return !notification.read && !notification.archived;
        case 'read':
            return notification.read && !notification.archived;
        case 'archived':
            return notification.archived;
    }
};

// ---------------------------------------------------------------------------
// Reliability metrics
// ---------------------------------------------------------------------------

export interface DeliveryReliabilityMetrics {
    totalSent: number;
    totalDelivered: number;
    totalFailed: number;
    totalSkipped: number;
    totalRetried: number;
    deliveryRate: number;
    byChannel: Record<
        DeliveryChannel,
        {
            sent: number;
            delivered: number;
            failed: number;
        }
    >;
    computedAt: string;
}

export const createEmptyMetrics = (
    now?: string,
): DeliveryReliabilityMetrics => ({
    totalSent: 0,
    totalDelivered: 0,
    totalFailed: 0,
    totalSkipped: 0,
    totalRetried: 0,
    deliveryRate: 1,
    byChannel: {
        in_app: { sent: 0, delivered: 0, failed: 0 },
        email: { sent: 0, delivered: 0, failed: 0 },
        push: { sent: 0, delivered: 0, failed: 0 },
        webhook: { sent: 0, delivered: 0, failed: 0 },
    },
    computedAt: now ?? new Date().toISOString(),
});

/**
 * Compute the delivery rate from metrics totals.
 * Returns 1.0 when no deliveries have been attempted.
 */
export const computeDeliveryRate = (
    delivered: number,
    total: number,
): number => {
    if (total === 0) return 1;
    return delivered / total;
};

// ---------------------------------------------------------------------------
// Channel routing
// ---------------------------------------------------------------------------

/**
 * Determine which channels a notification should be delivered through
 * based on user preferences.
 */
export const resolveChannels = (
    notification: Pick<Notification, 'type' | 'priority'>,
    preferences: UserNotificationPreferences,
): DeliveryChannel[] => {
    // Urgent notifications always go to in_app regardless of mute
    if (notification.priority === 'urgent') {
        const channels: DeliveryChannel[] = ['in_app'];
        for (const pref of preferences.channels) {
            if (pref.channel !== 'in_app' && pref.enabled) {
                if (
                    pref.allowedTypes.length === 0 ||
                    pref.allowedTypes.includes(notification.type)
                ) {
                    channels.push(pref.channel);
                }
            }
        }
        return channels;
    }

    // Global mute suppresses non-urgent notifications on external channels
    if (preferences.globalMute) {
        return ['in_app'];
    }

    const channels: DeliveryChannel[] = [];
    for (const pref of preferences.channels) {
        if (!pref.enabled) continue;
        if (
            pref.allowedTypes.length === 0 ||
            pref.allowedTypes.includes(notification.type)
        ) {
            channels.push(pref.channel);
        }
    }

    // Always include in_app as a minimum
    if (!channels.includes('in_app')) {
        channels.unshift('in_app');
    }

    return channels;
};
