import { z } from 'zod';
import {
    type AidPostRecord,
    type DirectoryResourceRecord,
    type VolunteerProfileRecord,
    type RecordByNsid,
    recordNsid,
    type RecordNsid,
    decodeRecordFromAt,
    validateRecordPayload,
} from '@patchwork/at-lexicons';
import {
    enforceMinimumGeoPrecisionKm,
    redactLogData,
    redactSensitiveText,
    toRedactedUriReference,
} from './privacy.js';
import { atUriRecordSchema, didSchema, isoDateTimeSchema } from './schemas.js';

const actionSchema = z.enum(['create', 'update', 'delete']);

const recordNsidEnumValues = [
    recordNsid.aidPost,
    recordNsid.volunteerProfile,
    recordNsid.conversationMeta,
    recordNsid.moderationReport,
    recordNsid.directoryResource,
] as const;

const envelopeSchema = z.object({
    seq: z.number().int().nonnegative(),
    receivedAt: isoDateTimeSchema.optional(),
    action: actionSchema,
    uri: atUriRecordSchema,
    collection: z.enum(recordNsidEnumValues),
    authorDid: didSchema.optional(),
    cid: z.string().min(1).max(200).optional(),
    revision: z.string().min(1).max(200).optional(),
    record: z.unknown().optional(),
    deleteReason: z.string().min(1).max(200).optional(),
    trustScore: z.number().min(0).max(1).optional(),
});

type Action = z.infer<typeof actionSchema>;
type FirehoseEnvelope = z.infer<typeof envelopeSchema>;

export interface ApproximateGeoPoint {
    latitude: number;
    longitude: number;
    precisionKm: number;
}

export interface NormalizedAidPost {
    postalCode?: string;
    kind: 'aid-post';
    title: string;
    description: string;
    category: AidPostRecord['category'];
    urgency: AidPostRecord['urgency'];
    status: AidPostRecord['status'];
    createdAt: string;
    updatedAt: string;
    searchableText: string;
    approximateGeo: ApproximateGeoPoint;
    trustScore: number;
}

export interface NormalizedDirectoryResource {
    kind: 'directory-resource';
    name: string;
    serviceArea: string;
    category: DirectoryResourceRecord['category'];
    verificationStatus: DirectoryResourceRecord['verificationStatus'];
    contact: DirectoryResourceRecord['contact'];
    approximateGeo?: ApproximateGeoPoint;
    openHours?: string;
    eligibilityNotes?: string;
    operationalStatus: 'open' | 'limited' | 'closed';
    createdAt: string;
    updatedAt: string;
    searchableText: string;
    trustScore: number;
}

export interface NormalizedVolunteerProfile {
    kind: 'volunteer-profile';
    displayName: string;
    bio?: string;
    capabilities: VolunteerProfileRecord['capabilities'];
    availability: VolunteerProfileRecord['availability'];
    contactPreference: VolunteerProfileRecord['contactPreference'];
    skills: string[];
    languages: string[];
    serviceArea?: {
        areaLabel: string;
        noPermanentAddress: boolean;
        approximateGeo?: ApproximateGeoPoint;
    };
    createdAt: string;
    updatedAt: string;
    searchableText: string;
    trustScore: number;
}

export interface NormalizedOpaqueRecord {
    kind: 'opaque-record';
    createdAt: string;
    updatedAt: string;
    searchableText: string;
    trustScore: number;
}

export type NormalizedRecordPayload =
    | NormalizedAidPost
    | NormalizedDirectoryResource
    | NormalizedVolunteerProfile
    | NormalizedOpaqueRecord;

export interface NormalizedFirehoseEvent {
    eventId: string;
    seq: number;
    action: Action;
    uri: string;
    collection: RecordNsid;
    authorDid: string;
    cid?: string;
    revision?: string;
    receivedAt: string;
    payload?: NormalizedRecordPayload;
    deleteReason?: string;
}

export type IngestionFailureCode =
    | 'MALFORMED_EVENT'
    | 'PARTIAL_EVENT'
    | 'VALIDATION_FAILED';

export interface IngestionFailure {
    code: IngestionFailureCode;
    message: string;
    seq: number | null;
    rawEvent: unknown;
}

export interface IngestionMetrics {
    processed: number;
    normalized: number;
    failed: number;
    malformed: number;
    partial: number;
}

export interface IngestionLogEntry {
    level: 'info' | 'error';
    event: 'ingestion.normalized' | 'ingestion.failed';
    seq: number | null;
    action?: Action;
    uri?: string;
    code?: IngestionFailureCode;
    message: string;
}

const MAX_INGESTION_LOG_ENTRIES = 500;

export interface FirehoseBatchResult {
    normalizedEvents: NormalizedFirehoseEvent[];
    failures: IngestionFailure[];
    metrics: IngestionMetrics;
    checkpointSeq: number;
    logs: IngestionLogEntry[];
}

const zeroMetrics = (): IngestionMetrics => ({
    processed: 0,
    normalized: 0,
    failed: 0,
    malformed: 0,
    partial: 0,
});

const normalizeSearchableText = (...parts: string[]): string => {
    return parts
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const round = (value: number, decimals = 4): number =>
    Number(value.toFixed(decimals));

const quantizeCoordinate = (
    latitude: number,
    longitude: number,
    precisionKm: number,
): ApproximateGeoPoint => {
    const safePrecisionKm = enforceMinimumGeoPrecisionKm(precisionKm);

    const latitudeStep = safePrecisionKm / 111;
    const latitudeBucket = Math.round(latitude / latitudeStep) * latitudeStep;

    const longitudeDenominator = Math.max(
        Math.cos((latitude * Math.PI) / 180) * 111,
        20,
    );
    const longitudeStep = safePrecisionKm / longitudeDenominator;
    const longitudeBucket =
        Math.round(longitude / longitudeStep) * longitudeStep;

    return {
        latitude: round(latitudeBucket),
        longitude: round(longitudeBucket),
        precisionKm: round(safePrecisionKm, 2),
    };
};

const parseAuthorDidFromUri = (uri: string): string | null => {
    const parsed = /^at:\/\/([^/]+)\//.exec(uri);
    return parsed?.[1] ?? null;
};

const resolveReceivedAt = (event: FirehoseEnvelope): string => {
    if (event.receivedAt) {
        return event.receivedAt;
    }

    return new Date(event.seq).toISOString();
};

const normalizeOpaqueRecord = (
    record: RecordByNsid[RecordNsid],
    trustScore: number,
): NormalizedOpaqueRecord => {
    const createdAt =
        'createdAt' in record && typeof record.createdAt === 'string' ?
            record.createdAt
        :   new Date(0).toISOString();
    const updatedAt =
        'updatedAt' in record && typeof record.updatedAt === 'string' ?
            record.updatedAt
        :   createdAt;

    return {
        kind: 'opaque-record',
        createdAt,
        updatedAt,
        searchableText: normalizeSearchableText(JSON.stringify(record)),
        trustScore,
    };
};

const normalizeRecordPayload = (
    collection: RecordNsid,
    record: unknown,
    trustScore: number,
): NormalizedRecordPayload => {
    const validated = validateRecordPayload(
        collection,
        decodeRecordFromAt(collection, record),
    );

    if (collection === recordNsid.aidPost) {
        const aidRecord = validated as AidPostRecord;
        return {
            kind: 'aid-post',
            title: aidRecord.title,
            description: aidRecord.description,
            category: aidRecord.category,
            urgency: aidRecord.urgency,
            status: aidRecord.status,
            createdAt: aidRecord.createdAt,
            updatedAt: aidRecord.updatedAt ?? aidRecord.createdAt,
            searchableText: normalizeSearchableText(
                aidRecord.title,
                aidRecord.description,
                aidRecord.category,
                aidRecord.urgency,
                aidRecord.status,
            ),
            ...(aidRecord.location.postalCode ? { postalCode: aidRecord.location.postalCode } : {}),
            approximateGeo: aidRecord.location.postalCode ? {
                latitude: aidRecord.location.latitude, longitude: aidRecord.location.longitude, precisionKm: 1,
            } : quantizeCoordinate(
                aidRecord.location.latitude,
                aidRecord.location.longitude,
                aidRecord.location.precisionKm,
            ),
            trustScore,
        };
    }

    if (collection === recordNsid.directoryResource) {
        const directoryRecord = validated as DirectoryResourceRecord;
        return {
            kind: 'directory-resource',
            name: directoryRecord.name,
            serviceArea: directoryRecord.serviceArea,
            category: directoryRecord.category,
            verificationStatus: directoryRecord.verificationStatus,
            contact: directoryRecord.contact,
            approximateGeo:
                directoryRecord.location ?
                    quantizeCoordinate(
                        directoryRecord.location.latitude,
                        directoryRecord.location.longitude,
                        directoryRecord.location.precisionKm,
                    )
                :   undefined,
            openHours: directoryRecord.openHours,
            eligibilityNotes: directoryRecord.eligibilityNotes,
            operationalStatus: directoryRecord.operationalStatus ?? 'open',
            createdAt: directoryRecord.createdAt,
            updatedAt: directoryRecord.updatedAt ?? directoryRecord.createdAt,
            searchableText: normalizeSearchableText(
                directoryRecord.name,
                directoryRecord.serviceArea,
                directoryRecord.category,
                directoryRecord.verificationStatus,
                directoryRecord.openHours ?? '',
                directoryRecord.eligibilityNotes ?? '',
                directoryRecord.location?.areaLabel ?? '',
                directoryRecord.operationalStatus ?? 'open',
            ),
            trustScore,
        };
    }

    if (collection === recordNsid.volunteerProfile) {
        const volunteer = validated as VolunteerProfileRecord;
        const serviceArea = volunteer.serviceArea;
        return {
            kind: 'volunteer-profile',
            displayName: volunteer.displayName,
            bio: volunteer.bio,
            capabilities: [...volunteer.capabilities],
            availability: volunteer.availability,
            contactPreference: volunteer.contactPreference,
            skills: [...(volunteer.skills ?? [])],
            languages: [...(volunteer.languages ?? [])],
            serviceArea:
                serviceArea ?
                    {
                        areaLabel: serviceArea.areaLabel,
                        noPermanentAddress:
                            serviceArea.noPermanentAddress,
                        approximateGeo:
                            serviceArea.latitude !== undefined &&
                            serviceArea.longitude !== undefined &&
                            serviceArea.precisionKm !== undefined ?
                                quantizeCoordinate(
                                    serviceArea.latitude,
                                    serviceArea.longitude,
                                    serviceArea.precisionKm,
                                )
                            :   undefined,
                    }
                :   undefined,
            createdAt: volunteer.createdAt,
            updatedAt: volunteer.updatedAt ?? volunteer.createdAt,
            searchableText: normalizeSearchableText(
                volunteer.displayName,
                volunteer.bio ?? '',
                ...volunteer.capabilities,
                ...(volunteer.skills ?? []),
                ...(volunteer.languages ?? []),
                serviceArea?.areaLabel ?? '',
            ),
            trustScore,
        };
    }

    return normalizeOpaqueRecord(validated, trustScore);
};

const createFailure = (
    code: IngestionFailureCode,
    message: string,
    rawEvent: unknown,
    seq: number | null,
): IngestionFailure => ({
    code,
    message,
    rawEvent,
    seq,
});

export const normalizeFirehoseEvent = (
    rawEvent: unknown,
):
    | { success: true; event: NormalizedFirehoseEvent }
    | {
          success: false;
          failure: IngestionFailure;
      } => {
    const parsed = envelopeSchema.safeParse(rawEvent);

    if (!parsed.success) {
        return {
            success: false,
            failure: createFailure(
                'MALFORMED_EVENT',
                parsed.error.issues
                    .map(issue => `${issue.path.join('.')}: ${issue.message}`)
                    .join('; '),
                rawEvent,
                null,
            ),
        };
    }

    const envelope = parsed.data;
    const authorDid = envelope.authorDid ?? parseAuthorDidFromUri(envelope.uri);

    if (!authorDid) {
        return {
            success: false,
            failure: createFailure(
                'PARTIAL_EVENT',
                'authorDid is required and could not be derived from URI.',
                rawEvent,
                envelope.seq,
            ),
        };
    }

    if (envelope.action !== 'delete' && envelope.record === undefined) {
        return {
            success: false,
            failure: createFailure(
                'PARTIAL_EVENT',
                'record is required for create/update events.',
                rawEvent,
                envelope.seq,
            ),
        };
    }

    try {
        const event: NormalizedFirehoseEvent = {
            eventId: `${envelope.seq}:${envelope.uri}:${envelope.action}`,
            seq: envelope.seq,
            action: envelope.action,
            uri: envelope.uri,
            collection: envelope.collection,
            authorDid,
            cid: envelope.cid,
            revision: envelope.revision,
            receivedAt: resolveReceivedAt(envelope),
            deleteReason:
                envelope.action === 'delete' ?
                    (envelope.deleteReason ?? 'deleted-upstream')
                :   undefined,
            payload:
                envelope.action === 'delete' ?
                    undefined
                :   normalizeRecordPayload(
                        envelope.collection,
                        envelope.record,
                        envelope.trustScore ?? 0.5,
                    ),
        };

        return { success: true, event };
    } catch (error) {
        return {
            success: false,
            failure: createFailure(
                'VALIDATION_FAILED',
                error instanceof Error ?
                    error.message
                :   'unknown validation error',
                rawEvent,
                envelope.seq,
            ),
        };
    }
};

export class FirehoseConsumer {
    private metrics: IngestionMetrics = zeroMetrics();
    private checkpointSeq = -1;
    private logs: IngestionLogEntry[] = [];

    ingest(rawEvents: readonly unknown[]): FirehoseBatchResult {
        const normalizedEvents: NormalizedFirehoseEvent[] = [];
        const failures: IngestionFailure[] = [];

        for (const rawEvent of rawEvents) {
            this.metrics.processed += 1;

            const normalized = normalizeFirehoseEvent(rawEvent);
            if (!normalized.success) {
                this.metrics.failed += 1;
                if (normalized.failure.code === 'MALFORMED_EVENT') {
                    this.metrics.malformed += 1;
                }
                if (normalized.failure.code === 'PARTIAL_EVENT') {
                    this.metrics.partial += 1;
                }

                failures.push(normalized.failure);
                this.pushLog({
                    level: 'error',
                    event: 'ingestion.failed',
                    seq: normalized.failure.seq,
                    code: normalized.failure.code,
                    message: redactSensitiveText(normalized.failure.message),
                });
                continue;
            }

            this.metrics.normalized += 1;
            this.checkpointSeq = Math.max(
                this.checkpointSeq,
                normalized.event.seq,
            );
            normalizedEvents.push(normalized.event);
            this.pushLog({
                level: 'info',
                event: 'ingestion.normalized',
                seq: normalized.event.seq,
                action: normalized.event.action,
                uri: toRedactedUriReference(normalized.event.uri),
                message: `normalized ${normalized.event.collection}`,
            });
        }

        return {
            normalizedEvents,
            failures,
            metrics: { ...this.metrics },
            checkpointSeq: this.checkpointSeq,
            logs: [...this.logs],
        };
    }

    replay(rawEvents: readonly unknown[]): FirehoseBatchResult {
        this.reset();
        return this.ingest(rawEvents);
    }

    getMetrics(): IngestionMetrics {
        return { ...this.metrics };
    }

    getLogs(): IngestionLogEntry[] {
        return [...this.logs];
    }

    getCheckpointSeq(): number {
        return this.checkpointSeq;
    }

    reset(): void {
        this.metrics = zeroMetrics();
        this.checkpointSeq = -1;
        this.logs = [];
    }

    private pushLog(entry: IngestionLogEntry): void {
        const sanitized = redactLogData(entry) as IngestionLogEntry;
        this.logs.push(sanitized);

        if (this.logs.length > MAX_INGESTION_LOG_ENTRIES) {
            this.logs.splice(0, this.logs.length - MAX_INGESTION_LOG_ENTRIES);
        }
    }
}

export const buildPhase3FixtureFirehoseEvents = (): unknown[] => {
    return [
        {
            seq: 1,
            receivedAt: '2026-02-26T12:00:00.000Z',
            action: 'create',
            uri: 'at://did:example:alice/app.patchwork.aid.post/post-a',
            collection: recordNsid.aidPost,
            authorDid: 'did:example:alice',
            trustScore: 0.9,
            record: {
                $type: recordNsid.aidPost,
                version: '1.0.0',
                title: 'Need groceries for two days',
                description: 'Requesting pantry support near station area.',
                category: 'food',
                urgency: 'high',
                status: 'open',
                location: {
                    latitude: 40.713234,
                    longitude: -74.00576,
                    precisionKm: 3,
                },
                createdAt: '2026-02-26T11:00:00.000Z',
            },
        },
        {
            seq: 2,
            receivedAt: '2026-02-26T12:01:00.000Z',
            action: 'create',
            uri: 'at://did:example:bob/app.patchwork.aid.post/post-b',
            collection: recordNsid.aidPost,
            authorDid: 'did:example:bob',
            trustScore: 0.6,
            record: {
                $type: recordNsid.aidPost,
                version: '1.0.0',
                title: 'Wheelchair ride to clinic needed',
                description: 'Medical transport needed this afternoon.',
                category: 'medical',
                urgency: 'critical',
                status: 'in-progress',
                location: {
                    latitude: 40.729432,
                    longitude: -73.997129,
                    precisionKm: 2,
                },
                createdAt: '2026-02-26T10:30:00.000Z',
            },
        },
        {
            seq: 3,
            receivedAt: '2026-02-26T12:02:00.000Z',
            action: 'create',
            uri: 'at://did:example:carol/app.patchwork.directory.resource/resource-a',
            collection: recordNsid.directoryResource,
            authorDid: 'did:example:carol',
            trustScore: 0.95,
            record: {
                $type: recordNsid.directoryResource,
                version: '1.1.0',
                name: 'Downtown Community Pantry',
                category: 'food-bank',
                serviceArea: 'Downtown and east side',
                contact: {
                    url: 'https://example.org/pantry',
                },
                verificationStatus: 'community-verified',
                location: {
                    latitude: 40.712,
                    longitude: -74.003,
                    precisionKm: 1.5,
                    areaLabel: 'Downtown',
                },
                openHours: 'Mon-Fri 09:00-18:00',
                eligibilityNotes: 'Open to all residents',
                operationalStatus: 'open',
                createdAt: '2026-02-26T09:00:00.000Z',
            },
        },
        {
            seq: 4,
            receivedAt: '2026-02-26T12:03:00.000Z',
            action: 'update',
            uri: 'at://did:example:alice/app.patchwork.aid.post/post-a',
            collection: recordNsid.aidPost,
            authorDid: 'did:example:alice',
            trustScore: 0.9,
            record: {
                $type: recordNsid.aidPost,
                version: '1.0.0',
                title: 'Need groceries for two days',
                description: 'Requesting pantry support near station area.',
                category: 'food',
                urgency: 'high',
                status: 'in-progress',
                location: {
                    latitude: 40.713234,
                    longitude: -74.00576,
                    precisionKm: 3,
                },
                createdAt: '2026-02-26T11:00:00.000Z',
                updatedAt: '2026-02-26T12:03:00.000Z',
            },
        },
        {
            seq: 5,
            receivedAt: '2026-02-26T12:04:00.000Z',
            action: 'create',
            uri: 'at://did:example:drew/app.patchwork.directory.resource/resource-b',
            collection: recordNsid.directoryResource,
            authorDid: 'did:example:drew',
            trustScore: 0.75,
            record: {
                $type: recordNsid.directoryResource,
                version: '1.1.0',
                name: 'Night Shelter East',
                category: 'shelter',
                serviceArea: 'East district',
                contact: {
                    phone: '+1-555-0200',
                },
                verificationStatus: 'partner-verified',
                location: {
                    latitude: 40.728,
                    longitude: -73.998,
                    precisionKm: 2,
                    areaLabel: 'East District',
                },
                openHours: 'Daily 18:00-08:00',
                eligibilityNotes: 'Adults 18+ with same-day intake',
                operationalStatus: 'open',
                createdAt: '2026-02-25T23:00:00.000Z',
            },
        },
    ];
};
