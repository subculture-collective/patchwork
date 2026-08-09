import {
    aidPostSchema,
    type AidPostRecord,
} from '@patchwork/at-lexicons';
import { PUBLIC_MIN_PRECISION_KM } from '@patchwork/shared';

export const aidPostingCategories = [
    'food',
    'shelter',
    'medical',
    'transport',
    'childcare',
    'other',
] as const;

export type AidPostingCategory = (typeof aidPostingCategories)[number];

const aidPostRecordNsid = 'app.patchwork.aid.post' as const;

export type AidPostLexiconRecord = AidPostRecord;

const validateAidPostRecord = (payload: unknown): AidPostLexiconRecord => {
    return aidPostSchema.parse(payload);
};

export interface PostingTimeWindow {
    startAt: string;
    endAt: string;
}

export interface PostingLocation {
    lat: number;
    lng: number;
    precisionMeters: number;
    areaLabel?: string;
}

/**
 * Pending file attachment in a posting draft.
 */
export interface DraftAttachment {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    /** Local object URL for preview, or the uploaded URL. */
    previewUrl: string;
}

/** Allowed MIME types for draft attachments. */
export const DRAFT_ATTACHMENT_ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
] as const;

/** Maximum attachment size in bytes (10 MB). */
export const DRAFT_ATTACHMENT_MAX_SIZE = 10 * 1024 * 1024;

/** Maximum attachments per draft. */
export const DRAFT_ATTACHMENT_MAX_COUNT = 5;

export interface AidPostingDraft {
    title: string;
    description: string;
    category?: AidPostingCategory;
    urgency?: 1 | 2 | 3 | 4 | 5;
    accessibilityTags: string[];
    location?: PostingLocation;
    timeWindow?: PostingTimeWindow;
    attachments?: DraftAttachment[];
}

export interface NormalizedAidPostingDraft {
    title: string;
    description: string;
    category: AidPostingCategory;
    urgency: 1 | 2 | 3 | 4 | 5;
    accessibilityTags: string[];
    location: PostingLocation;
    timeWindow?: PostingTimeWindow;
}

export interface PostingValidationIssue {
    field: string;
    message: string;
}

export interface PostingValidationResult {
    ok: boolean;
    errors: PostingValidationIssue[];
    normalizedDraft?: NormalizedAidPostingDraft;
}

export class PostingValidationError extends Error {
    constructor(readonly issues: PostingValidationIssue[]) {
        super('Posting draft validation failed.');
        this.name = 'PostingValidationError';
    }
}

export interface PostingPayloadMetadata {
    localId: string;
    accessibilityTags: string[];
    timeWindow?: PostingTimeWindow;
}

export interface AidPostMutationPayload {
    record: AidPostLexiconRecord;
    metadata: PostingPayloadMetadata;
}

const minimumPublicPrecisionMeters = PUBLIC_MIN_PRECISION_KM * 1000;

const normalizeAccessibilityTags = (tags: readonly string[]): string[] => {
    const normalized = tags
        .map(tag => tag.trim().toLowerCase())
        .filter(tag => tag.length > 0)
        .slice(0, 8);

    return [...new Set(normalized)];
};

const normalizeLocation = (
    location: PostingLocation | undefined,
): PostingLocation | undefined => {
    if (!location) {
        return undefined;
    }

    if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
        return undefined;
    }

    if (location.lat < -90 || location.lat > 90 || location.lng < -180 || location.lng > 180) {
        return undefined;
    }

    return {
        lat: Number(location.lat.toFixed(6)),
        lng: Number(location.lng.toFixed(6)),
        precisionMeters: Math.max(
            minimumPublicPrecisionMeters,
            Math.round(location.precisionMeters),
        ),
        areaLabel: location.areaLabel?.trim() || undefined,
    };
};

const normalizeTimeWindow = (
    timeWindow: PostingTimeWindow | undefined,
): PostingTimeWindow | undefined => {
    if (!timeWindow) {
        return undefined;
    }

    const startAtMs = Date.parse(timeWindow.startAt);
    const endAtMs = Date.parse(timeWindow.endAt);
    if (Number.isNaN(startAtMs) || Number.isNaN(endAtMs)) {
        return undefined;
    }

    return {
        startAt: new Date(startAtMs).toISOString(),
        endAt: new Date(endAtMs).toISOString(),
    };
};

const urgencyToLexicon = (
    urgency: 1 | 2 | 3 | 4 | 5,
): AidPostLexiconRecord['urgency'] => {
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

const urgencyFromLexicon = (
    urgency: AidPostLexiconRecord['urgency'],
): 1 | 2 | 3 | 4 | 5 => {
    if (urgency === 'critical') {
        return 5;
    }
    if (urgency === 'high') {
        return 4;
    }
    if (urgency === 'medium') {
        return 3;
    }
    return 2;
};

export function validatePostingDraft(draft: AidPostingDraft): PostingValidationResult {
    const errors: PostingValidationIssue[] = [];
    const title = draft.title.trim();
    const description = draft.description.trim();
    const tags = normalizeAccessibilityTags(draft.accessibilityTags);
    const location = normalizeLocation(draft.location);
    const timeWindow = normalizeTimeWindow(draft.timeWindow);

    if (title.length < 1 || title.length > 140) {
        errors.push({
            field: 'title',
            message: 'Title must be between 1 and 140 characters.',
        });
    }

    if (description.length < 1 || description.length > 5000) {
        errors.push({
            field: 'description',
            message: 'Description must be between 1 and 5000 characters.',
        });
    }

    if (!draft.category || !aidPostingCategories.includes(draft.category)) {
        errors.push({
            field: 'category',
            message: 'Category must be selected from the supported taxonomy.',
        });
    }

    if (!draft.urgency || draft.urgency < 1 || draft.urgency > 5) {
        errors.push({
            field: 'urgency',
            message: 'Urgency must be between 1 and 5.',
        });
    }

    if (!location) {
        errors.push({
            field: 'location',
            message: 'Approximate location is required.',
        });
    }

    if (draft.timeWindow && !timeWindow) {
        errors.push({
            field: 'timeWindow',
            message: 'Time window must contain valid ISO dates.',
        });
    }

    if (timeWindow && Date.parse(timeWindow.startAt) >= Date.parse(timeWindow.endAt)) {
        errors.push({
            field: 'timeWindow',
            message: 'Time window start must be earlier than end.',
        });
    }

    // Validate attachments
    if (draft.attachments && draft.attachments.length > 0) {
        if (draft.attachments.length > DRAFT_ATTACHMENT_MAX_COUNT) {
            errors.push({
                field: 'attachments',
                message: `Maximum ${DRAFT_ATTACHMENT_MAX_COUNT} attachments allowed.`,
            });
        }
        for (let i = 0; i < draft.attachments.length; i++) {
            const att = draft.attachments[i]!;
            if (att.sizeBytes > DRAFT_ATTACHMENT_MAX_SIZE) {
                errors.push({
                    field: `attachments[${i}]`,
                    message: `File "${att.filename}" exceeds 10 MB size limit.`,
                });
            }
            if (
                !(DRAFT_ATTACHMENT_ALLOWED_TYPES as readonly string[]).includes(
                    att.mimeType,
                )
            ) {
                errors.push({
                    field: `attachments[${i}]`,
                    message: `File type "${att.mimeType}" is not allowed. Allowed: images and PDF.`,
                });
            }
        }
    }

    if (errors.length > 0 || !draft.category || !draft.urgency || !location) {
        return {
            ok: false,
            errors,
        };
    }

    return {
        ok: true,
        errors: [],
        normalizedDraft: {
            title,
            description,
            category: draft.category,
            urgency: draft.urgency,
            accessibilityTags: tags,
            location,
            timeWindow,
        },
    };
}

const requireNormalizedDraft = (
    draft: AidPostingDraft,
): NormalizedAidPostingDraft => {
    const result = validatePostingDraft(draft);
    if (!result.ok || !result.normalizedDraft) {
        throw new PostingValidationError(result.errors);
    }

    return result.normalizedDraft;
};

export function buildAidPostCreatePayload(
    draft: AidPostingDraft,
    options?: { id?: string; now?: string },
): AidPostMutationPayload {
    const normalizedDraft = requireNormalizedDraft(draft);
    const now = options?.now ?? new Date().toISOString();
    const localId = options?.id ?? crypto.randomUUID();

    const recordCandidate = {
        $type: aidPostRecordNsid,
        version: '1.0.0',
        title: normalizedDraft.title,
        description: normalizedDraft.description,
        category: normalizedDraft.category,
        urgency: urgencyToLexicon(normalizedDraft.urgency),
        status: 'open',
        location: {
            latitude: normalizedDraft.location.lat,
            longitude: normalizedDraft.location.lng,
            precisionKm: Number((normalizedDraft.location.precisionMeters / 1000).toFixed(3)),
        },
        createdAt: now,
        updatedAt: now,
    } as const;

    const record = validateAidPostRecord(recordCandidate);

    return {
        record,
        metadata: {
            localId,
            accessibilityTags: normalizedDraft.accessibilityTags,
            timeWindow: normalizedDraft.timeWindow,
        },
    };
}

export function buildAidPostEditPayload(params: {
    existingRecord: AidPostLexiconRecord;
    draft: AidPostingDraft;
    metadata?: Pick<PostingPayloadMetadata, 'localId'>;
    now?: string;
}): AidPostMutationPayload {
    const normalizedDraft = requireNormalizedDraft(params.draft);
    const now = params.now ?? new Date().toISOString();
    const localId = params.metadata?.localId ?? crypto.randomUUID();

    const recordCandidate = {
        ...params.existingRecord,
        title: normalizedDraft.title,
        description: normalizedDraft.description,
        category: normalizedDraft.category,
        urgency: urgencyToLexicon(normalizedDraft.urgency),
        location: {
            latitude: normalizedDraft.location.lat,
            longitude: normalizedDraft.location.lng,
            precisionKm: Number((normalizedDraft.location.precisionMeters / 1000).toFixed(3)),
        },
        updatedAt: now,
    };

    const record = validateAidPostRecord(recordCandidate);

    return {
        record,
        metadata: {
            localId,
            accessibilityTags: normalizedDraft.accessibilityTags,
            timeWindow: normalizedDraft.timeWindow,
        },
    };
}

export function toPostingDraftFromRecord(
    record: AidPostLexiconRecord,
    metadata?: {
        accessibilityTags?: string[];
        timeWindow?: PostingTimeWindow;
    },
): AidPostingDraft {
    return {
        title: record.title,
        description: record.description,
        category: record.category,
        urgency: urgencyFromLexicon(record.urgency),
        accessibilityTags: [...(metadata?.accessibilityTags ?? [])],
        location: {
            lat: record.location.latitude,
            lng: record.location.longitude,
            precisionMeters: Math.round(record.location.precisionKm * 1000),
        },
        timeWindow: metadata?.timeWindow,
    };
}
