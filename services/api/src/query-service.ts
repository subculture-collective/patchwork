import { z, ZodError } from 'zod';
import {
    DiscoveryIndexStore,
    FirehoseConsumer,
    buildPhase3FixtureFirehoseEvents,
    validateAidQueryInput,
    validateAidFeedQueryInput,
    validateDirectoryQueryInput,
    type ApiQueryAidResponse,
    type ApiQueryDirectoryResponse,
    type ApiQueryErrorResponse,
    type NormalizedFirehoseEvent,
    type ProjectionFreshness,
} from '@patchwork/shared';
import type { Pool } from 'pg';

export interface ApiRouteResult {
    statusCode: number;
    body:
        | ApiQueryAidResponse
        | ApiQueryDirectoryResponse
        | ApiVolunteerQueryResponse
        | ApiQueryErrorResponse;
}

export interface ApiVolunteerProfile {
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
    serviceArea:
        | {
              areaLabel: string;
              noPermanentAddress: boolean;
              approximateGeo?: {
                  latitude: number;
                  longitude: number;
                  precisionKm: number;
              };
          }
        | null;
    updatedAt: string;
    recordOrigin?: 'synthetic' | 'sourced-public' | 'visitor-created';
}

export interface ApiVolunteerQueryResponse {
    total: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    results: ApiVolunteerProfile[];
    projectionFreshness?: ProjectionFreshness;
}

const readNumber = (
    params: URLSearchParams,
    key: string,
): number | undefined => {
    const value = params.get(key);
    if (value === null || value.trim() === '') {
        return undefined;
    }

    return Number(value);
};

const readString = (
    params: URLSearchParams,
    key: string,
): string | undefined => {
    const value = params.get(key);
    if (value === null || value.trim() === '') {
        return undefined;
    }

    return value;
};

const formatValidationError = (error: ZodError): ApiQueryErrorResponse => {
    return {
        error: {
            code: 'INVALID_QUERY',
            message: 'Query parameters failed validation.',
            details: {
                issues: error.issues.map(issue => ({
                    path: issue.path.join('.'),
                    message: issue.message,
                })),
            },
        },
    };
};

export class ApiDiscoveryQueryService {
    constructor(private readonly store: DiscoveryIndexStore) {}

    applyNormalizedEvents(events: readonly NormalizedFirehoseEvent[]): void {
        this.store.applyEvents(events);
    }

    queryMap(params: URLSearchParams, _viewerDid?: string): ApiRouteResult {
        try {
            const input = validateAidQueryInput({
                latitude: readNumber(params, 'latitude'),
                longitude: readNumber(params, 'longitude'),
                radiusKm: readNumber(params, 'radiusKm'),
                category: readString(params, 'category'),
                urgency: readString(params, 'urgency'),
                status: readString(params, 'status'),
                freshnessHours: readNumber(params, 'freshnessHours'),
                searchText: readString(params, 'searchText'),
                page: readNumber(params, 'page'),
                pageSize: readNumber(params, 'pageSize'),
            });

            const result = this.store.queryMap(input);
            return {
                statusCode: 200,
                body: {
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    hasNextPage: result.hasNextPage,
                    results: result.items,
                },
            };
        } catch (error) {
            if (error instanceof ZodError) {
                return {
                    statusCode: 400,
                    body: formatValidationError(error),
                };
            }

            throw error;
        }
    }

    queryFeed(params: URLSearchParams, _viewerDid?: string): ApiRouteResult {
        try {
            const input = validateAidFeedQueryInput({
                latitude: readNumber(params, 'latitude'),
                longitude: readNumber(params, 'longitude'),
                radiusKm: readNumber(params, 'radiusKm'),
                category: readString(params, 'category'),
                urgency: readString(params, 'urgency'),
                status: readString(params, 'status'),
                freshnessHours: readNumber(params, 'freshnessHours'),
                searchText: readString(params, 'searchText'),
                page: readNumber(params, 'page'),
                pageSize: readNumber(params, 'pageSize'),
            });

            const result = this.store.queryFeed(input);
            return {
                statusCode: 200,
                body: {
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    hasNextPage: result.hasNextPage,
                    results: result.items,
                },
            };
        } catch (error) {
            if (error instanceof ZodError) {
                return {
                    statusCode: 400,
                    body: formatValidationError(error),
                };
            }

            throw error;
        }
    }

    queryDirectory(params: URLSearchParams): ApiRouteResult {
        try {
            const input = validateDirectoryQueryInput({
                category: readString(params, 'category'),
                status: readString(params, 'status'),
                operationalStatus: readString(params, 'operationalStatus'),
                latitude: readNumber(params, 'latitude'),
                longitude: readNumber(params, 'longitude'),
                radiusKm: readNumber(params, 'radiusKm'),
                freshnessHours: readNumber(params, 'freshnessHours'),
                searchText: readString(params, 'searchText'),
                page: readNumber(params, 'page'),
                pageSize: readNumber(params, 'pageSize'),
            });

            const result = this.store.queryDirectory(input);
            return {
                statusCode: 200,
                body: {
                    total: result.total,
                    page: result.page,
                    pageSize: result.pageSize,
                    hasNextPage: result.hasNextPage,
                    results: result.items,
                },
            };
        } catch (error) {
            if (error instanceof ZodError) {
                return {
                    statusCode: 400,
                    body: formatValidationError(error),
                };
            }

            throw error;
        }
    }

    queryVolunteers(_params: URLSearchParams): ApiRouteResult {
        return {
            statusCode: 200,
            body: {
                total: 0,
                page: 1,
                pageSize: 20,
                hasNextPage: false,
                results: [],
            },
        };
    }
}

const createQueryServiceFromNormalizedEvents = (
    normalizedEvents: readonly NormalizedFirehoseEvent[],
): ApiDiscoveryQueryService => {
    const store = new DiscoveryIndexStore();
    store.applyEvents(normalizedEvents);
    return new ApiDiscoveryQueryService(store);
};

export const createFixtureQueryService = (): ApiDiscoveryQueryService => {
    const consumer = new FirehoseConsumer();
    const ingested = consumer.ingest(buildPhase3FixtureFirehoseEvents());
    return createQueryServiceFromNormalizedEvents(ingested.normalizedEvents);
};

interface ProjectionRow {
    uri: string;
    cid: string | null;
    title: string;
    description: string;
    category: string;
    urgency: string;
    status: string;
    searchable_text: string;
    latitude: number;
    longitude: number;
    precision_km: number;
    record_created_at: Date | string;
    record_updated_at: Date | string;
    source_cursor: string | number;
    projected_at: Date | string;
    record_origin: 'synthetic' | 'sourced-public' | 'visitor-created';
}

interface DirectoryProjectionRow {
    uri: string;
    cid: string | null;
    name: string;
    service_area: string;
    category: string;
    verification_status: string;
    contact: {
        url?: string;
        phone?: string;
    };
    searchable_text: string;
    latitude: number | null;
    longitude: number | null;
    precision_km: number | null;
    open_hours: string | null;
    eligibility_notes: string | null;
    operational_status: string;
    record_created_at: Date | string;
    record_updated_at: Date | string;
    source_cursor: string | number;
    projected_at: Date | string;
    record_origin: 'synthetic' | 'sourced-public' | 'visitor-created';
}

interface ProjectionStateRow {
    latest_cursor: string | number | null;
    heartbeat_at: Date | string;
}

interface VolunteerProjectionQueryRow {
    uri: string;
    cid: string | null;
    display_name: string;
    bio: string | null;
    capabilities: string[];
    availability: string;
    contact_preference: string;
    skills: string[];
    languages: string[];
    service_area_label: string | null;
    no_permanent_address: boolean;
    latitude: number | null;
    longitude: number | null;
    precision_km: number | null;
    searchable_text: string;
    record_updated_at: Date | string;
    projected_at: Date | string;
    record_origin: 'synthetic' | 'sourced-public' | 'visitor-created';
}

const volunteerQuerySchema = z
    .object({
        capability: z.string().min(1).max(64).optional(),
        language: z.string().min(2).max(35).optional(),
        availability: z
            .enum([
                'immediate',
                'within-24h',
                'scheduled',
                'unavailable',
            ])
            .optional(),
        searchText: z.string().max(200).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
    })
    .strict();

const authorDidFromUri = (uri: string): string => {
    const match = /^at:\/\/([^/]+)\//.exec(uri);
    if (!match?.[1]) throw new Error('Projection URI does not contain an author DID.');
    return match[1];
};

const freshnessForRows = (
    rows: readonly { projected_at: Date | string }[],
    state: ProjectionStateRow | undefined,
): ProjectionFreshness => {
    if (!state) {
        return { latestCursor: null, projectedAt: null, lagSeconds: null };
    }
    const observedAtMs = new Date(state.heartbeat_at).getTime();
    const projectedAtMs =
        rows.length === 0 ? null : Math.max(
            ...rows.map(row => new Date(row.projected_at).getTime()),
        );
    return {
        latestCursor:
            state.latest_cursor === null ? null : Number(state.latest_cursor),
        projectedAt:
            projectedAtMs === null ? null : new Date(projectedAtMs).toISOString(),
        observedAt: new Date(observedAtMs).toISOString(),
        lagSeconds: Math.max(0, (Date.now() - observedAtMs) / 1_000),
    };
};

export const assessProjectionReadiness = (
    freshness: ProjectionFreshness,
    maxLagSeconds: number,
): { ready: true } | { ready: false; reason: string } => {
    if (freshness.lagSeconds === null) {
        return { ready: false, reason: 'Projection freshness is unavailable' };
    }
    if (freshness.lagSeconds > maxLagSeconds) {
        return {
            ready: false,
            reason: `Projection lag exceeds ${maxLagSeconds} seconds`,
        };
    }
    return { ready: true };
};

export class PostgresProjectionQueryService {
    constructor(private readonly pool: Pool) {}

    async queryAidPost(params: URLSearchParams, viewerDid?: string): Promise<ApiRouteResult> {
        const uri = params.get('uri');
        if (!uri || !/^at:\/\/did:[^/]+\/app\.patchwork\.aid\.post\/[^/]+$/.test(uri)) {
            return { statusCode: 400, body: { error: { code: 'INVALID_QUERY', message: 'A request URI is required.' } } };
        }
        const snapshot = await this.loadSnapshot(viewerDid, uri);
        const result = createQueryServiceFromNormalizedEvents(snapshot.events).queryFeed(new URLSearchParams());
        if ('error' in result.body) return result;
        const body = result.body as ApiQueryAidResponse;
        if (body.results.length === 0) return { statusCode: 404, body: { error: { code: 'NOT_FOUND', message: 'This request is unavailable.' } } };
        return { ...result, body: { ...body, results: body.results.map(row => ({ ...row, recordOrigin: snapshot.origins.get(row.uri) ?? 'visitor-created' })) } };
    }

    async queryMap(
        params: URLSearchParams,
        viewerDid?: string,
    ): Promise<ApiRouteResult> {
        return this.queryAid(params, 'map', viewerDid);
    }

    async queryFeed(
        params: URLSearchParams,
        viewerDid?: string,
    ): Promise<ApiRouteResult> {
        return this.queryAid(params, 'feed', viewerDid);
    }

    async queryResource(params: URLSearchParams): Promise<ApiRouteResult> {
        const uri = params.get('uri');
        if (!uri || !/^at:\/\/did:[^/]+\/app\.patchwork\.directory\.resource\/[^/]+$/.test(uri)) {
            return { statusCode: 400, body: { error: { code: 'INVALID_QUERY', message: 'A resource URI is required.' } } };
        }
        const result = await this.queryDirectory(new URLSearchParams(), uri);
        if ('error' in result.body) return result;
        if (!result.body.results.length) return { statusCode: 404, body: { error: { code: 'NOT_FOUND', message: 'This resource is unavailable.' } } };
        return result;
    }

    async queryDirectory(params: URLSearchParams, resourceUri?: string): Promise<ApiRouteResult> {
        const snapshot = await this.loadDirectorySnapshot(resourceUri);
        const service = createQueryServiceFromNormalizedEvents(snapshot.events);
        const result = service.queryDirectory(params);
        if ('error' in result.body) return result;
        const exactLocations = await this.pool.query<{
            resource_uri: string;
            street_address: string;
            latitude: number;
            longitude: number;
            approval_expires_at: Date | string;
        }>(
            `SELECT e.resource_uri, e.street_address, e.latitude,
                    e.longitude, e.approval_expires_at
             FROM exact_public_address_requests e
             WHERE e.resource_uri = ANY($1::text[]) AND e.status = 'approved'
               AND e.confidential_facility = FALSE
               AND e.approval_expires_at > NOW()
               AND EXISTS (
                   SELECT 1 FROM verification_applications v
                   WHERE v.subject_type = 'organization'
                     AND v.organization_id = e.organization_id
                     AND v.subject_ref = e.organization_id::text
                     AND v.status = 'approved' AND v.expires_at > NOW()
               )
               AND EXISTS (
                   SELECT 1 FROM verification_applications v
                   WHERE v.subject_type = 'resource'
                     AND v.organization_id = e.organization_id
                     AND v.subject_ref = e.resource_uri
                     AND v.status = 'approved' AND v.expires_at > NOW()
               )
               AND EXISTS (
                   SELECT 1
                   FROM organization_resource_stewardships s
                   WHERE s.organization_id = e.organization_id
                     AND s.resource_uri = e.resource_uri
                     AND s.status = 'active'
               )`,
            [(result.body as ApiQueryDirectoryResponse).results.map(row => row.uri)],
        );
        const exactByUri = new Map(
            exactLocations.rows.map(row => [
                row.resource_uri,
                {
                    kind: 'exact-public-resource' as const,
                    streetAddress: row.street_address,
                    latitude: Number(row.latitude),
                    longitude: Number(row.longitude),
                    approvalExpiresAt: new Date(
                        row.approval_expires_at,
                    ).toISOString(),
                },
            ]),
        );
        const body = result.body as ApiQueryDirectoryResponse;
        return {
            ...result,
            body: {
                ...body,
                results: body.results.map(row => ({
                    ...row,
                    recordOrigin:
                        snapshot.origins.get(row.uri) ?? 'visitor-created',
                    ...(exactByUri.has(row.uri) ?
                        { exactPublicAddress: exactByUri.get(row.uri) }
                    :   {}),
                })),
                projectionFreshness: snapshot.freshness,
            },
        };
    }

    async queryVolunteers(
        params: URLSearchParams,
        viewerDid?: string,
    ): Promise<ApiRouteResult> {
        try {
            const input = volunteerQuerySchema.parse({
                capability: readString(params, 'capability'),
                language: readString(params, 'language'),
                availability: readString(params, 'availability'),
                searchText: readString(params, 'searchText'),
                page: readNumber(params, 'page') ?? 1,
                pageSize: readNumber(params, 'pageSize') ?? 20,
            });
            const [result, stateResult, blockResult] = await Promise.all([
                this.pool.query<VolunteerProjectionQueryRow>(
                    `SELECT uri, cid, display_name, bio, capabilities,
                            availability, contact_preference, skills,
                            languages, service_area_label,
                            no_permanent_address, latitude, longitude,
                            precision_km, searchable_text,
                            record_updated_at, projected_at, record_origin
                     FROM indexer_volunteer_profile_projections
                     ORDER BY record_updated_at DESC, uri`,
                ),
                this.pool.query<ProjectionStateRow>(
                    `SELECT latest_cursor, heartbeat_at
                     FROM indexer_projection_state
                     WHERE singleton = TRUE`,
                ),
                viewerDid ?
                    this.pool.query<{ excluded_did: string }>(
                        `SELECT CASE
                             WHEN blocker_did = $1 THEN subject_did
                             ELSE blocker_did
                         END AS excluded_did
                         FROM user_blocks
                         WHERE (blocker_did = $1 OR subject_did = $1)
                           AND deleted_at IS NULL
                           AND (
                               retention_until IS NULL
                               OR retention_until > NOW()
                           )`,
                        [viewerDid],
                    )
                :   Promise.resolve({
                        rows: [] as { excluded_did: string }[],
                    }),
            ]);
            const excluded = new Set(
                blockResult.rows.map(row => row.excluded_did),
            );
            const search = input.searchText?.toLowerCase();
            const filtered = result.rows.filter(row => {
                const authorDid = authorDidFromUri(row.uri);
                return (
                    !excluded.has(authorDid) &&
                    (!input.capability ||
                        row.capabilities.includes(input.capability)) &&
                    (!input.language ||
                        row.languages.includes(input.language)) &&
                    (!input.availability ||
                        row.availability === input.availability) &&
                    (!search || row.searchable_text.includes(search))
                );
            });
            const start = (input.page - 1) * input.pageSize;
            const pageRows = filtered.slice(start, start + input.pageSize);
            return {
                statusCode: 200,
                body: {
                    total: filtered.length,
                    page: input.page,
                    pageSize: input.pageSize,
                    hasNextPage: start + input.pageSize < filtered.length,
                    results: pageRows.map(row => {
                        const hasGeo =
                            row.latitude !== null &&
                            row.longitude !== null &&
                            row.precision_km !== null;
                        return {
                            uri: row.uri,
                            cid: row.cid,
                            authorDid: authorDidFromUri(row.uri),
                            displayName: row.display_name,
                            bio: row.bio,
                            capabilities: row.capabilities,
                            availability: row.availability,
                            contactPreference: row.contact_preference,
                            skills: row.skills,
                            languages: row.languages,
                            serviceArea:
                                row.service_area_label ?
                                    {
                                        areaLabel:
                                            row.service_area_label,
                                        noPermanentAddress:
                                            row.no_permanent_address,
                                        ...(hasGeo ?
                                            {
                                                approximateGeo: {
                                                    latitude: Number(
                                                        row.latitude,
                                                    ),
                                                    longitude: Number(
                                                        row.longitude,
                                                    ),
                                                    precisionKm: Number(
                                                        row.precision_km,
                                                    ),
                                                },
                                            }
                                        :   {}),
                                    }
                                :   null,
                            updatedAt: new Date(
                                row.record_updated_at,
                            ).toISOString(),
                            recordOrigin: row.record_origin,
                        };
                    }),
                    projectionFreshness: freshnessForRows(
                        result.rows,
                        stateResult.rows[0],
                    ),
                },
            };
        } catch (error) {
            if (error instanceof ZodError) {
                return {
                    statusCode: 400,
                    body: formatValidationError(error),
                };
            }
            throw error;
        }
    }

    async getFreshness(): Promise<ProjectionFreshness> {
        return (await this.loadSnapshot()).freshness;
    }

    private async queryAid(
        params: URLSearchParams,
        scope: 'map' | 'feed',
        viewerDid?: string,
    ): Promise<ApiRouteResult> {
        const snapshot = await this.loadSnapshot(viewerDid);
        const service = createQueryServiceFromNormalizedEvents(snapshot.events);
        const result =
            scope === 'map' ? service.queryMap(params) : service.queryFeed(params);
        if ('error' in result.body) return result;
        const body = result.body as ApiQueryAidResponse;
        return {
            ...result,
            body: {
                ...body,
                results: body.results.map(row => ({
                    ...row,
                    recordOrigin:
                        snapshot.origins.get(row.uri) ?? 'visitor-created',
                })),
                projectionFreshness: snapshot.freshness,
            },
        };
    }

    private async loadSnapshot(viewerDid?: string, uri?: string): Promise<{
        events: NormalizedFirehoseEvent[];
        freshness: ProjectionFreshness;
        origins: Map<
            string,
            'synthetic' | 'sourced-public' | 'visitor-created'
        >;
    }> {
        const [result, stateResult, blockResult] = await Promise.all([
            this.pool.query<ProjectionRow>(
            `SELECT uri, cid, title, description, category, urgency, status,
                    searchable_text, latitude, longitude, precision_km,
                    record_created_at, record_updated_at, source_cursor,
                    projected_at, record_origin
             FROM indexer_aid_post_projections
             WHERE ($1::text IS NULL OR uri = $1)
             ORDER BY source_cursor, uri`,
                [uri ?? null],
            ),
            this.pool.query<ProjectionStateRow>(
                `SELECT latest_cursor, heartbeat_at
                 FROM indexer_projection_state
                 WHERE singleton = TRUE`,
            ),
            viewerDid ?
                this.pool.query<{ excluded_did: string }>(
                    `SELECT CASE
                         WHEN blocker_did = $1 THEN subject_did
                         ELSE blocker_did
                     END AS excluded_did
                     FROM user_blocks
                     WHERE (blocker_did = $1 OR subject_did = $1)
                       AND deleted_at IS NULL
                       AND (retention_until IS NULL OR retention_until > NOW())`,
                    [viewerDid],
                )
            :   Promise.resolve({ rows: [] as { excluded_did: string }[] }),
        ]);
        const excludedDids = new Set(
            blockResult.rows.map(row => row.excluded_did),
        );
        const events: NormalizedFirehoseEvent[] = result.rows
            .filter(row => !excludedDids.has(authorDidFromUri(row.uri)))
            .map(row => ({
                eventId: `projection:${row.source_cursor}:${row.uri}`,
                seq: Number(row.source_cursor),
                action: 'create',
                uri: row.uri,
                collection: 'app.patchwork.aid.post',
                authorDid: authorDidFromUri(row.uri),
                ...(row.cid ? { cid: row.cid } : {}),
                receivedAt: new Date(row.record_updated_at).toISOString(),
                payload: {
                    kind: 'aid-post',
                    title: row.title,
                    description: row.description,
                    category: row.category as 'food',
                    urgency: row.urgency as 'high',
                    status: row.status as 'open',
                    searchableText: row.searchable_text,
                    approximateGeo: {
                        latitude: Number(row.latitude),
                        longitude: Number(row.longitude),
                        precisionKm: Number(row.precision_km),
                    },
                    createdAt: new Date(row.record_created_at).toISOString(),
                    updatedAt: new Date(row.record_updated_at).toISOString(),
                    trustScore: 0.5,
                },
            }));
        return {
            events,
            freshness: freshnessForRows(result.rows, stateResult.rows[0]),
            origins: new Map(
                result.rows.map(row => [row.uri, row.record_origin]),
            ),
        };
    }

    private async loadDirectorySnapshot(resourceUri?: string): Promise<{
        events: NormalizedFirehoseEvent[];
        freshness: ProjectionFreshness;
        origins: Map<
            string,
            'synthetic' | 'sourced-public' | 'visitor-created'
        >;
    }> {
        const [result, stateResult] = await Promise.all([
            this.pool.query<DirectoryProjectionRow>(
                `SELECT uri, cid, name, service_area, category,
                        verification_status, contact, searchable_text,
                        latitude, longitude, precision_km, open_hours,
                        eligibility_notes, operational_status,
                        record_created_at, record_updated_at, source_cursor,
                        projected_at, record_origin
                 FROM indexer_directory_resource_projections
                 WHERE ($1::text IS NULL OR uri = $1)
                 ORDER BY source_cursor, uri`,
                [resourceUri ?? null],
            ),
            this.pool.query<ProjectionStateRow>(
                `SELECT latest_cursor, heartbeat_at
                 FROM indexer_projection_state
                 WHERE singleton = TRUE`,
            ),
        ]);
        const events: NormalizedFirehoseEvent[] = result.rows.map(row => {
            const hasApproximateGeo =
                row.latitude !== null &&
                row.longitude !== null &&
                row.precision_km !== null;
            return {
                eventId: `projection:${row.source_cursor}:${row.uri}`,
                seq: Number(row.source_cursor),
                action: 'create',
                uri: row.uri,
                collection: 'app.patchwork.directory.resource',
                authorDid: authorDidFromUri(row.uri),
                ...(row.cid ? { cid: row.cid } : {}),
                receivedAt: new Date(row.record_updated_at).toISOString(),
                payload: {
                    kind: 'directory-resource',
                    name: row.name,
                    serviceArea: row.service_area,
                    category: row.category as 'food-bank',
                    verificationStatus:
                        row.verification_status as 'unverified',
                    contact: row.contact,
                    ...(hasApproximateGeo ?
                        {
                            approximateGeo: {
                                latitude: Number(row.latitude),
                                longitude: Number(row.longitude),
                                precisionKm: Number(row.precision_km),
                            },
                        }
                    :   {}),
                    ...(row.open_hours ? { openHours: row.open_hours } : {}),
                    ...(row.eligibility_notes ?
                        { eligibilityNotes: row.eligibility_notes }
                    :   {}),
                    operationalStatus: row.operational_status as 'open',
                    createdAt: new Date(row.record_created_at).toISOString(),
                    updatedAt: new Date(row.record_updated_at).toISOString(),
                    searchableText: row.searchable_text,
                    trustScore: 0.5,
                },
            };
        });
        return {
            events,
            freshness: freshnessForRows(result.rows, stateResult.rows[0]),
            origins: new Map(
                result.rows.map(row => [row.uri, row.record_origin]),
            ),
        };
    }
}
