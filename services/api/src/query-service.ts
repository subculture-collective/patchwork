import { queryProjected, discoveryDataset } from './projected-discovery.js';
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
                minimumUrgency: readString(params, 'minimumUrgency'),
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
                minimumUrgency: readString(params, 'minimumUrgency'),
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
        const result = await queryProjected(this.pool, new URLSearchParams({ dataset: params.get('dataset') ?? 'all' }), 'feed', viewerDid, uri);
        if ('error' in result.body) return result;
        if (!result.body.results.length) return { statusCode: 404, body: { error: { code: 'NOT_FOUND', message: 'This request is unavailable.' } } };
        return result;
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
        const result = await this.queryDirectory(new URLSearchParams({ dataset: params.get('dataset') ?? 'all' }), uri);
        if ('error' in result.body) return result;
        if (!result.body.results.length) return { statusCode: 404, body: { error: { code: 'NOT_FOUND', message: 'This resource is unavailable.' } } };
        return result;
    }

    async queryDirectory(params: URLSearchParams, resourceUri?: string): Promise<ApiRouteResult> {
        const result = await queryProjected(this.pool, params, 'directory', undefined, resourceUri);
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
                    ...(exactByUri.has(row.uri) ?
                        { exactPublicAddress: exactByUri.get(row.uri) }
                    :   {}),
                })),
            },
        };
    }

    async queryVolunteers(
        params: URLSearchParams,
        viewerDid?: string,
    ): Promise<ApiRouteResult> {
        try {
            const dataset = discoveryDataset(params);
            const input = volunteerQuerySchema.parse({
                capability: readString(params, 'capability'),
                language: readString(params, 'language'),
                availability: readString(params, 'availability'),
                searchText: readString(params, 'searchText'),
                page: readNumber(params, 'page') ?? 1,
                pageSize: readNumber(params, 'pageSize') ?? 20,
            });
            const start = (input.page - 1) * input.pageSize;
            const [result, stateResult] = await Promise.all([
                this.pool.query<{ rows: VolunteerProjectionQueryRow[]; total: string }>(`WITH filtered AS MATERIALIZED (
                    SELECT p.* FROM indexer_volunteer_profile_projections p
                    WHERE ($1::boolean IS NULL OR (record_origin = 'synthetic') = $1)
                        AND ($2::text IS NULL OR capabilities ? $2::text)
                        AND ($3::text IS NULL OR languages ? $3::text)
                        AND ($4::text IS NULL OR availability = $4)
                        AND ($5::text IS NULL OR strpos(searchable_text, $5) > 0)
                        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.deleted_at IS NULL
                            AND (b.retention_until IS NULL OR b.retention_until > NOW())
                            AND ((b.blocker_did = $6 AND b.subject_did = split_part(p.uri, '/', 3)) OR (b.subject_did = $6 AND b.blocker_did = split_part(p.uri, '/', 3))))
                    ), paged AS (SELECT * FROM filtered ORDER BY record_updated_at DESC, uri COLLATE "C" LIMIT $7 OFFSET $8)
                    SELECT (SELECT count(*)::text FROM filtered) AS total, coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb) AS rows`,
                    [dataset === 'all' ? null : dataset === 'demo', input.capability ?? null, input.language ?? null, input.availability ?? null, input.searchText?.toLowerCase() ?? null, viewerDid ?? null, input.pageSize, start]),
                this.pool.query<ProjectionStateRow>('SELECT latest_cursor, heartbeat_at FROM indexer_projection_state WHERE singleton = TRUE'),
            ]);
            const total = Number(result.rows[0]?.total ?? 0);
            const pageRows = result.rows[0]?.rows ?? [];
            return {
                statusCode: 200,
                body: {
                    total,
                    page: input.page,
                    pageSize: input.pageSize,
                    hasNextPage: start + input.pageSize < total,
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
                        pageRows,
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
        const result = await this.pool.query<ProjectionStateRow>('SELECT latest_cursor, heartbeat_at FROM indexer_projection_state WHERE singleton = TRUE');
        return freshnessForRows([], result.rows[0]);
    }

    private async queryAid(
        params: URLSearchParams,
        scope: 'map' | 'feed',
        viewerDid?: string,
    ): Promise<ApiRouteResult> {
        return queryProjected(this.pool, params, scope, viewerDid);
    }
}
