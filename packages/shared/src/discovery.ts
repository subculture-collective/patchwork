import { z } from 'zod';
import { type AidPostRecord } from '@patchwork/at-lexicons';
import {
    type ApproximateGeoPoint,
    type NormalizedAidPost,
    type NormalizedDirectoryResource,
    type NormalizedFirehoseEvent,
} from './firehose.js';
import {
    computeDiscoveryRank,
    type RankingBreakdown,
    rankCardsDeterministically,
} from './ranking.js';
import { isoDateTimeSchema } from './schemas.js';

export interface IndexedAidRecord extends NormalizedAidPost {
    uri: string;
    authorDid: string;
    cid?: string;
}

export interface IndexedDirectoryRecord extends NormalizedDirectoryResource {
    uri: string;
    authorDid: string;
    cid?: string;
}

export interface PaginationInput {
    page?: number;
    pageSize?: number;
}

export interface AidQueryInput extends PaginationInput {
    latitude: number;
    longitude: number;
    radiusKm: number;
    category?: AidPostRecord['category'];
    urgency?: AidPostRecord['urgency'];
    minimumUrgency?: AidPostRecord['urgency'];
    status?: AidPostRecord['status'];
    freshnessHours?: number;
    searchText?: string;
    nowIso?: string;
}

/** Feed supports a global, newest-first view before the visitor selects an area. */
export interface AidFeedQueryInput extends Omit<AidQueryInput, 'latitude' | 'longitude' | 'radiusKm'> {
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
}

export interface DirectoryQueryInput extends PaginationInput {
    category?: string;
    status?: 'unverified' | 'community-verified' | 'partner-verified';
    operationalStatus?: 'open' | 'limited' | 'closed';
    latitude?: number;
    longitude?: number;
    radiusKm?: number;
    freshnessHours?: number;
    searchText?: string;
    nowIso?: string;
}

export interface PaginatedQueryResult<T> {
    total: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    items: T[];
}

export interface RankedAidCard {
    uri: string;
    authorDid: string;
    cid?: string;
    title: string;
    summary: string;
    category: AidPostRecord['category'];
    urgency: AidPostRecord['urgency'];
    status: AidPostRecord['status'];
    approximateGeo: ApproximateGeoPoint;
    createdAt: string;
    updatedAt: string;
    /** Present only when an explicit area was supplied. */
    distanceKm?: number;
    ranking: RankingBreakdown;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

export interface DirectoryCard {
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
    approximateGeo?: ApproximateGeoPoint;
    exactPublicAddress?: {
        kind: 'exact-public-resource';
        streetAddress: string;
        latitude: number;
        longitude: number;
        approvalExpiresAt: string;
    };
    openHours?: string;
    eligibilityNotes?: string;
    operationalStatus: 'open' | 'limited' | 'closed';
    createdAt: string;
    updatedAt: string;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

const MAX_PAGE_SIZE = 100;

const toTokenSet = (value: string): Set<string> => {
    return new Set(
        value
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(token => token.length >= 2),
    );
};

const geoBucket = ({ latitude, longitude }: ApproximateGeoPoint): string => {
    return `${Math.round(latitude * 10) / 10}:${Math.round(longitude * 10) / 10}`;
};

const addToIndex = (
    index: Map<string, Set<string>>,
    key: string,
    uri: string,
): void => {
    const bucket = index.get(key) ?? new Set<string>();
    bucket.add(uri);
    index.set(key, bucket);
};

const removeFromIndex = (
    index: Map<string, Set<string>>,
    key: string,
    uri: string,
): void => {
    const bucket = index.get(key);
    if (!bucket) {
        return;
    }

    bucket.delete(uri);
    if (bucket.size === 0) {
        index.delete(key);
    }
};

const haversineDistanceKm = (
    latitudeA: number,
    longitudeA: number,
    latitudeB: number,
    longitudeB: number,
): number => {
    const radiusKm = 6_371;
    const toRadians = (value: number): number => (value * Math.PI) / 180;

    const dLat = toRadians(latitudeB - latitudeA);
    const dLon = toRadians(longitudeB - longitudeA);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(latitudeA)) *
            Math.cos(toRadians(latitudeB)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((radiusKm * c).toFixed(3));
};

const ensurePagination = (
    input: PaginationInput,
): { page: number; pageSize: number } => {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Math.floor(input.pageSize ?? 20)),
    );

    return { page, pageSize };
};

const applyPagination = <T>(
    rows: readonly T[],
    pagination: { page: number; pageSize: number },
): PaginatedQueryResult<T> => {
    const start = (pagination.page - 1) * pagination.pageSize;
    const items = rows.slice(start, start + pagination.pageSize);

    return {
        total: rows.length,
        page: pagination.page,
        pageSize: pagination.pageSize,
        hasNextPage: start + pagination.pageSize < rows.length,
        items,
    };
};

export class DiscoveryIndexStore {
    private readonly aidRecords = new Map<string, IndexedAidRecord>();
    private readonly directoryRecords = new Map<
        string,
        IndexedDirectoryRecord
    >();

    private readonly aidCategoryIndex = new Map<string, Set<string>>();
    private readonly aidStatusIndex = new Map<string, Set<string>>();
    private readonly aidUrgencyIndex = new Map<string, Set<string>>();
    private readonly aidGeoIndex = new Map<string, Set<string>>();
    private readonly aidTextIndex = new Map<string, Set<string>>();

    private readonly directoryCategoryIndex = new Map<string, Set<string>>();
    private readonly directoryStatusIndex = new Map<string, Set<string>>();
    private readonly directoryOperationalStatusIndex = new Map<
        string,
        Set<string>
    >();
    private readonly directoryGeoIndex = new Map<string, Set<string>>();
    private readonly directoryTextIndex = new Map<string, Set<string>>();

    applyEvent(event: NormalizedFirehoseEvent): void {
        if (event.action === 'delete') {
            this.removeAid(event.uri);
            this.removeDirectory(event.uri);
            return;
        }

        if (!event.payload) {
            return;
        }

        if (event.payload.kind === 'aid-post') {
            this.upsertAid(event.uri, event.authorDid, event.payload, event.cid);
        }

        if (event.payload.kind === 'directory-resource') {
            this.upsertDirectory(
                event.uri,
                event.authorDid,
                event.payload,
                event.cid,
            );
        }
    }

    applyEvents(events: readonly NormalizedFirehoseEvent[]): void {
        for (const event of events) {
            this.applyEvent(event);
        }
    }

    queryMap(input: AidQueryInput): PaginatedQueryResult<RankedAidCard> {
        return this.queryRankedAid(input);
    }

    queryFeed(input: AidFeedQueryInput): PaginatedQueryResult<RankedAidCard> {
        if (
            input.latitude !== undefined &&
            input.longitude !== undefined &&
            input.radiusKm !== undefined
        ) {
            return this.queryRankedAid(input as AidQueryInput);
        }
        return this.queryLatestAid(input);
    }

    queryDirectory(
        input: DirectoryQueryInput,
    ): PaginatedQueryResult<DirectoryCard> {
        const nowIso = input.nowIso ?? new Date().toISOString();
        const nowMs = new Date(nowIso).getTime();
        const pagination = ensurePagination(input);

        const candidates = this.collectDirectoryCandidates(input);

        const filtered = candidates.filter(record => {
            if (
                input.latitude !== undefined &&
                input.longitude !== undefined &&
                input.radiusKm !== undefined
            ) {
                if (!record.approximateGeo) {
                    return false;
                }

                const distanceKm = haversineDistanceKm(
                    input.latitude,
                    input.longitude,
                    record.approximateGeo.latitude,
                    record.approximateGeo.longitude,
                );

                if (distanceKm > input.radiusKm) {
                    return false;
                }
            }

            if (input.freshnessHours !== undefined) {
                const recordMs = new Date(record.updatedAt).getTime();
                if (!Number.isFinite(recordMs)) {
                    return false;
                }

                const ageHours = (nowMs - recordMs) / 3_600_000;
                if (ageHours > input.freshnessHours) {
                    return false;
                }
            }

            if (
                input.searchText &&
                !record.searchableText.includes(input.searchText.toLowerCase())
            ) {
                return false;
            }

            return true;
        });

        const sorted = [...filtered]
            .map(record => ({
                uri: record.uri,
                authorDid: record.authorDid,
                ...(record.cid ? { cid: record.cid } : {}),
                name: record.name,
                category: record.category,
                serviceArea: record.serviceArea,
                status: record.verificationStatus,
                contact: record.contact,
                approximateGeo: record.approximateGeo,
                openHours: record.openHours,
                eligibilityNotes: record.eligibilityNotes,
                operationalStatus: record.operationalStatus,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
            }))
            .sort((left, right) => {
                const rightUpdated = new Date(right.updatedAt).getTime();
                const leftUpdated = new Date(left.updatedAt).getTime();
                if (rightUpdated !== leftUpdated) {
                    return rightUpdated - leftUpdated;
                }

                return left.uri.localeCompare(right.uri);
            });

        return applyPagination(sorted, pagination);
    }

    getStats(): {
        aidRecords: number;
        directoryRecords: number;
        geoBuckets: number;
        aidTextTerms: number;
        directoryTextTerms: number;
        directoryGeoBuckets: number;
    } {
        return {
            aidRecords: this.aidRecords.size,
            directoryRecords: this.directoryRecords.size,
            geoBuckets: this.aidGeoIndex.size,
            aidTextTerms: this.aidTextIndex.size,
            directoryTextTerms: this.directoryTextIndex.size,
            directoryGeoBuckets: this.directoryGeoIndex.size,
        };
    }

    private queryRankedAid(
        input: AidQueryInput,
    ): PaginatedQueryResult<RankedAidCard> {
        const nowIso = input.nowIso ?? new Date().toISOString();
        const nowMs = new Date(nowIso).getTime();
        const pagination = ensurePagination(input);
        const candidates = this.collectAidCandidates(input);

        const filtered = candidates
            .map(record => {
                const distanceKm = haversineDistanceKm(
                    input.latitude,
                    input.longitude,
                    record.approximateGeo.latitude,
                    record.approximateGeo.longitude,
                );

                return { record, distanceKm };
            })
            .filter(({ record, distanceKm }) => {
                if (distanceKm > input.radiusKm) {
                    return false;
                }

                if (input.freshnessHours !== undefined) {
                    const updatedMs = new Date(record.updatedAt).getTime();
                    if (!Number.isFinite(updatedMs)) {
                        return false;
                    }

                    const ageHours = (nowMs - updatedMs) / 3_600_000;
                    if (ageHours > input.freshnessHours) {
                        return false;
                    }
                }

                if (
                    input.searchText &&
                    !record.searchableText.includes(
                        input.searchText.toLowerCase(),
                    )
                ) {
                    return false;
                }

                return true;
            });

        const ranked = rankCardsDeterministically(
            filtered.map(({ record, distanceKm }) => ({
                uri: record.uri,
                distanceKm,
                createdAt: record.createdAt,
                trustScore: record.trustScore,
                updatedAt: record.updatedAt,
                record,
            })),
            nowIso,
        );

        const cards: RankedAidCard[] = ranked.map(entry => ({
            uri: entry.record.uri,
            authorDid: entry.record.authorDid,
            ...(entry.record.cid ? { cid: entry.record.cid } : {}),
            title: entry.record.title,
            summary: entry.record.description,
            category: entry.record.category,
            urgency: entry.record.urgency,
            status: entry.record.status,
            approximateGeo: entry.record.approximateGeo,
            createdAt: entry.record.createdAt,
            updatedAt: entry.record.updatedAt,
            distanceKm: entry.distanceKm,
            ranking: entry.ranking,
        }));

        return applyPagination(cards, pagination);
    }

    private queryLatestAid(
        input: AidFeedQueryInput,
    ): PaginatedQueryResult<RankedAidCard> {
        const nowIso = input.nowIso ?? new Date().toISOString();
        const nowMs = new Date(nowIso).getTime();
        const cards = this.collectAidCandidates(input as AidQueryInput)
            .filter(record => {
                if (input.freshnessHours !== undefined) {
                    const updatedMs = new Date(record.updatedAt).getTime();
                    if (!Number.isFinite(updatedMs) ||
                        (nowMs - updatedMs) / 3_600_000 > input.freshnessHours) return false;
                }
                return !input.searchText || record.searchableText.includes(input.searchText.toLowerCase());
            })
            .sort((left, right) => {
                const updated = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
                return updated || left.uri.localeCompare(right.uri);
            })
            .map(record => ({
                uri: record.uri,
                authorDid: record.authorDid,
                ...(record.cid ? { cid: record.cid } : {}),
                title: record.title,
                summary: record.description,
                category: record.category,
                urgency: record.urgency,
                status: record.status,
                approximateGeo: record.approximateGeo,
                createdAt: record.createdAt,
                updatedAt: record.updatedAt,
                // No fake distance: global feed is explicitly newest-first.
                ranking: computeDiscoveryRank({
                    distanceKm: Number.POSITIVE_INFINITY,
                    createdAt: record.createdAt,
                    trustScore: record.trustScore,
                    nowIso,
                }),
            }));
        return applyPagination(cards, ensurePagination(input));
    }

    private collectAidCandidates(input: AidQueryInput): IndexedAidRecord[] {
        const sets: Set<string>[] = [];

        if (input.category) {
            sets.push(new Set(this.aidCategoryIndex.get(input.category) ?? []));
        }

        if (input.status) {
            sets.push(new Set(this.aidStatusIndex.get(input.status) ?? []));
        }

        if (input.urgency) {
            sets.push(new Set(this.aidUrgencyIndex.get(input.urgency) ?? []));
        }

        if (input.minimumUrgency) {
            const levels = ['low', 'medium', 'high', 'critical'] as const;
            sets.push(new Set(levels.slice(levels.indexOf(input.minimumUrgency)).flatMap(level => [...(this.aidUrgencyIndex.get(level) ?? [])])));
        }

        let uriSet: Set<string>;

        if (sets.length === 0) {
            // No filters specified: all aid records are candidates.
            uriSet = new Set(this.aidRecords.keys());
        } else {
            // Start intersection from the smallest filter set to minimize work.
            const [first, ...rest] = sets.sort((a, b) => a.size - b.size);

            uriSet = rest.reduce(
                (accumulator, current) =>
                    new Set([...accumulator].filter(uri => current.has(uri))),
                new Set(first),
            );
        }

        return [...uriSet]
            .map(uri => this.aidRecords.get(uri))
            .filter((value): value is IndexedAidRecord => Boolean(value));
    }

    private collectDirectoryCandidates(
        input: DirectoryQueryInput,
    ): IndexedDirectoryRecord[] {
        const sets: Set<string>[] = [];

        if (input.category) {
            sets.push(
                new Set(this.directoryCategoryIndex.get(input.category) ?? []),
            );
        }

        if (input.status) {
            sets.push(
                new Set(this.directoryStatusIndex.get(input.status) ?? []),
            );
        }

        if (input.operationalStatus) {
            sets.push(
                new Set(
                    this.directoryOperationalStatusIndex.get(
                        input.operationalStatus,
                    ) ?? [],
                ),
            );
        }

        let uriSet: Set<string>;

        if (sets.length === 0) {
            // No filters: include all directory records.
            uriSet = new Set(this.directoryRecords.keys());
        } else {
            // Start intersecting from the smallest filter set to avoid scanning all records.
            const [first, ...rest] = sets.sort((a, b) => a.size - b.size);

            uriSet = rest.reduce<Set<string>>((accumulator, current) => {
                // If either side is empty, intersection is empty.
                if (accumulator.size === 0 || current.size === 0) {
                    return new Set<string>();
                }

                const intersection = new Set<string>();
                for (const uri of accumulator) {
                    if (current.has(uri)) {
                        intersection.add(uri);
                    }
                }

                return intersection;
            }, new Set(first));
        }

        return [...uriSet]
            .map(uri => this.directoryRecords.get(uri))
            .filter((value): value is IndexedDirectoryRecord => Boolean(value));
    }

    private upsertAid(
        uri: string,
        authorDid: string,
        record: NormalizedAidPost,
        cid?: string,
    ): void {
        const existing = this.aidRecords.get(uri);
        if (existing) {
            this.removeAid(uri);
        }

        const indexed: IndexedAidRecord = {
            ...record,
            uri,
            authorDid,
            ...(cid ? { cid } : {}),
        };

        this.aidRecords.set(uri, indexed);

        addToIndex(this.aidCategoryIndex, indexed.category, uri);
        addToIndex(this.aidStatusIndex, indexed.status, uri);
        addToIndex(this.aidUrgencyIndex, indexed.urgency, uri);
        addToIndex(this.aidGeoIndex, geoBucket(indexed.approximateGeo), uri);

        for (const token of toTokenSet(indexed.searchableText)) {
            addToIndex(this.aidTextIndex, token, uri);
        }
    }

    private removeAid(uri: string): void {
        const existing = this.aidRecords.get(uri);
        if (!existing) {
            return;
        }

        this.aidRecords.delete(uri);
        removeFromIndex(this.aidCategoryIndex, existing.category, uri);
        removeFromIndex(this.aidStatusIndex, existing.status, uri);
        removeFromIndex(this.aidUrgencyIndex, existing.urgency, uri);
        removeFromIndex(
            this.aidGeoIndex,
            geoBucket(existing.approximateGeo),
            uri,
        );

        for (const token of toTokenSet(existing.searchableText)) {
            removeFromIndex(this.aidTextIndex, token, uri);
        }
    }

    private upsertDirectory(
        uri: string,
        authorDid: string,
        record: NormalizedDirectoryResource,
        cid?: string,
    ): void {
        const existing = this.directoryRecords.get(uri);
        if (existing) {
            this.removeDirectory(uri);
        }

        const indexed: IndexedDirectoryRecord = {
            ...record,
            uri,
            authorDid,
            ...(cid ? { cid } : {}),
        };

        this.directoryRecords.set(uri, indexed);

        addToIndex(this.directoryCategoryIndex, indexed.category, uri);
        addToIndex(this.directoryStatusIndex, indexed.verificationStatus, uri);
        addToIndex(
            this.directoryOperationalStatusIndex,
            indexed.operationalStatus,
            uri,
        );

        if (indexed.approximateGeo) {
            addToIndex(
                this.directoryGeoIndex,
                geoBucket(indexed.approximateGeo),
                uri,
            );
        }

        for (const token of toTokenSet(indexed.searchableText)) {
            addToIndex(this.directoryTextIndex, token, uri);
        }
    }

    private removeDirectory(uri: string): void {
        const existing = this.directoryRecords.get(uri);
        if (!existing) {
            return;
        }

        this.directoryRecords.delete(uri);
        removeFromIndex(this.directoryCategoryIndex, existing.category, uri);
        removeFromIndex(
            this.directoryStatusIndex,
            existing.verificationStatus,
            uri,
        );
        removeFromIndex(
            this.directoryOperationalStatusIndex,
            existing.operationalStatus,
            uri,
        );

        if (existing.approximateGeo) {
            removeFromIndex(
                this.directoryGeoIndex,
                geoBucket(existing.approximateGeo),
                uri,
            );
        }

        for (const token of toTokenSet(existing.searchableText)) {
            removeFromIndex(this.directoryTextIndex, token, uri);
        }
    }
}

const aidQueryFields = {
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusKm: z.number().positive().max(250),
    category: z
        .enum(['food', 'shelter', 'medical', 'transport', 'childcare', 'other'])
        .optional(),
    urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    minimumUrgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    status: z.enum(['open', 'in-progress', 'resolved', 'closed']).optional(),
    freshnessHours: z
        .number()
        .int()
        .positive()
        .max(24 * 365)
        .optional(),
    searchText: z.string().min(1).max(120).optional(),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
    nowIso: isoDateTimeSchema.optional(),
};

const aidQuerySchema = z.object(aidQueryFields);

const aidFeedQuerySchema = z.object({
    ...aidQueryFields,
    latitude: aidQueryFields.latitude.optional(),
    longitude: aidQueryFields.longitude.optional(),
    radiusKm: aidQueryFields.radiusKm.optional(),
}).superRefine((value, ctx) => {
    const supplied = [value.latitude, value.longitude, value.radiusKm]
        .filter(value => value !== undefined).length;
    if (supplied !== 0 && supplied !== 3) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['latitude'],
            message: 'latitude, longitude, and radiusKm must be supplied together.',
        });
    }
});

const directoryQuerySchema = z
    .object({
        category: z.string().min(1).max(64).optional(),
        status: z
            .enum(['unverified', 'community-verified', 'partner-verified'])
            .optional(),
        operationalStatus: z.enum(['open', 'limited', 'closed']).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        radiusKm: z.number().positive().max(250).optional(),
        freshnessHours: z
            .number()
            .int()
            .positive()
            .max(24 * 365)
            .optional(),
        searchText: z.string().min(1).max(120).optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(MAX_PAGE_SIZE).optional(),
        nowIso: isoDateTimeSchema.optional(),
    })
    .superRefine((value, ctx) => {
        const geoProvided =
            value.latitude !== undefined ||
            value.longitude !== undefined ||
            value.radiusKm !== undefined;

        if (
            geoProvided &&
            (value.latitude === undefined ||
                value.longitude === undefined ||
                value.radiusKm === undefined)
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    'latitude, longitude, and radiusKm must be supplied together.',
                path: ['latitude'],
            });
        }
    });

export const validateAidQueryInput = (input: unknown): AidQueryInput =>
    aidQuerySchema.parse(input);

export const validateAidFeedQueryInput = (input: unknown): AidFeedQueryInput =>
    aidFeedQuerySchema.parse(input);

export const validateDirectoryQueryInput = (
    input: unknown,
): DirectoryQueryInput => directoryQuerySchema.parse(input);
