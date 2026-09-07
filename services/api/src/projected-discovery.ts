import { lookupPostalArea } from '@patchwork/at-lexicons';
import { z, ZodError } from 'zod';
import type { Pool, QueryResultRow } from 'pg';
import { computeDiscoveryRank, validateAidFeedQueryInput, validateAidQueryInput, validateDirectoryQueryInput, type ApiQueryAidResponse, type ApiQueryDirectoryResponse, type DiscoveryMapAggregates } from '@patchwork/shared';
import type { ApiRouteResult } from './query-service.js';

export const discoveryDataset = (params: URLSearchParams) => z.enum(['all', 'community', 'demo']).parse(params.get('dataset') ?? 'all');
const number = (params: URLSearchParams, key: string) => params.has(key) && params.get(key)!.trim() ? Number(params.get(key)) : undefined;
const queryInput = (params: URLSearchParams) => ({
    latitude: number(params, 'latitude'), longitude: number(params, 'longitude'), radiusKm: number(params, 'radiusKm'),
    category: params.get('category') || undefined, status: params.get('status') || undefined,
    urgency: params.get('urgency') || undefined, minimumUrgency: params.get('minimumUrgency') || undefined, operationalStatus: params.get('operationalStatus') || undefined,
    freshnessHours: number(params, 'freshnessHours'), searchText: params.get('searchText') || undefined,
    page: number(params, 'page'), pageSize: number(params, 'pageSize'),
});
export interface BoundedPage<T> { rows: T[]; total: number; page: number; pageSize: number; now: string; aggregates?: DiscoveryMapAggregates; freshness: { latestCursor: number | null; projectedAt: string | null; observedAt: string | null; lagSeconds: number | null }; }

/** Filters, ranking, totals and pagination stay in PostgreSQL. Only one page crosses the wire. */
export async function readProjectionPage<T extends QueryResultRow>(pool: Pool, params: URLSearchParams, kind: 'map' | 'feed' | 'directory', viewerDid?: string, uri?: string): Promise<BoundedPage<T>> {
    const dataset = discoveryDataset(params);
    const raw = queryInput(params);
    const input = kind === 'directory' ? validateDirectoryQueryInput(raw) : kind === 'map' && (raw.latitude !== undefined || raw.longitude !== undefined || raw.radiusKm !== undefined) ? validateAidQueryInput(raw) : validateAidFeedQueryInput(raw);
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20;
    const values: unknown[] = [];
    const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
    const now = new Date().toISOString();
    const nowParam = bind(now);
    const where = [dataset === 'all' ? 'TRUE' : `p.record_origin ${dataset === 'demo' ? '=' : '<>'} 'synthetic'`];
    if (kind !== 'directory' && params.has('postalCode')) {
        const postalCode = z.string().regex(/^[0-9]{5}$/).parse(params.get('postalCode'));
        where.push(`p.postal_code = ${bind(postalCode)}`);
    }
    if (uri) where.push(`p.uri = ${bind(uri)}`);
    if (input.category) where.push(`p.category = ${bind(input.category)}`);
    if (input.status) where.push(`p.${kind === 'directory' ? 'verification_status' : 'status'} = ${bind(input.status)}`);
    if (kind !== 'directory' && raw.urgency) where.push(`p.urgency = ${bind(raw.urgency)}`);
    if (kind !== 'directory' && raw.minimumUrgency) {
        const levels = ['low', 'medium', 'high', 'critical'];
        where.push(`p.urgency = ANY(${bind(levels.slice(levels.indexOf(raw.minimumUrgency)))}::text[])`);
    }
    if (kind === 'directory' && raw.operationalStatus) where.push(`p.operational_status = ${bind(raw.operationalStatus)}`);
    if (input.searchText) where.push(`strpos(p.searchable_text, ${bind(input.searchText.toLowerCase())}) > 0`);
    if (input.freshnessHours) where.push(`p.record_updated_at >= ${nowParam}::timestamptz - ${bind(input.freshnessHours)}::double precision * INTERVAL '1 hour'`);
    if (viewerDid) {
        const viewer = bind(viewerDid);
        where.push(`NOT EXISTS (SELECT 1 FROM user_blocks b WHERE b.deleted_at IS NULL AND (b.retention_until IS NULL OR b.retention_until > NOW()) AND ((b.blocker_did = ${viewer} AND b.subject_did = split_part(p.uri, '/', 3)) OR (b.subject_did = ${viewer} AND b.blocker_did = split_part(p.uri, '/', 3))))`);
    }
    const located = input.latitude !== undefined && input.longitude !== undefined && input.radiusKm !== undefined;
    let distance = 'NULL::double precision';
    if (located) {
        if (kind !== 'directory') where.push('p.postal_code IS NOT NULL');
        const lat = bind(input.latitude), lng = bind(input.longitude);
        where.push('p.latitude IS NOT NULL AND p.longitude IS NOT NULL AND p.precision_km IS NOT NULL');
        where.push(`p.latitude BETWEEN ${bind(input.latitude! - input.radiusKm! / 111)}::double precision AND ${bind(input.latitude! + input.radiusKm! / 111)}::double precision`);
        // Haversine, clamped for floating-point noise at antipodes and across the dateline.
        distance = `6371 * 2 * asin(sqrt(least(1.0, greatest(0.0, power(sin(radians(p.latitude - ${lat}::double precision) / 2), 2) + cos(radians(${lat}::double precision)) * cos(radians(p.latitude)) * power(sin(radians(p.longitude - ${lng}::double precision) / 2), 2)))))`;
    }
    const table = kind === 'directory' ? `(SELECT base.*, coalesce(e.latitude,base.latitude) AS search_latitude,
        coalesce(e.longitude,base.longitude) AS search_longitude FROM indexer_directory_resource_projections base
        LEFT JOIN LATERAL (SELECT latitude,longitude FROM eligible_public_resource_addresses e WHERE e.resource_uri=base.uri
            ORDER BY basis DESC, valid_until DESC LIMIT 1) e ON TRUE)` : 'indexer_aid_post_projections';
    if (kind === 'directory') {
        distance = distance.replaceAll('p.latitude', 'p.search_latitude').replaceAll('p.longitude', 'p.search_longitude');
        for (let i=0;i<where.length;i++) where[i]=where[i]!.replaceAll('p.latitude', 'p.search_latitude').replaceAll('p.longitude', 'p.search_longitude');
    }
    const radius = located ? `WHERE distance_km <= ${bind(input.radiusKm)}::double precision` : '';
    // Keep six-decimal positive scores in floating point, matching the shared
    // rank contract without costly numeric conversions for every candidate.
    const score = kind !== 'directory' && located ? `floor(((CASE WHEN distance_km <= 2 THEN 1::double precision WHEN distance_km <= 5 THEN .82 WHEN distance_km <= 10 THEN .66 WHEN distance_km <= 25 THEN .48 ELSE .3 END) * .45 + floor(power(.5::double precision, greatest(0, extract(epoch FROM (${nowParam}::timestamptz - record_created_at))::double precision / 3600) / 24) * 1000000 + .5) / 1000000 * .35 + .1) * 1000000 + .5) DESC,` : '';
    const order = kind === 'directory' && located
        ? 'distance_km ASC, record_updated_at DESC, uri COLLATE "C"'
        : `${score} record_updated_at DESC, uri COLLATE "C"`;
    const limit = bind(pageSize), offset = bind((page - 1) * pageSize);
    const result = await pool.query<{ rows: T[]; aggregates: DiscoveryMapAggregates | null; total: string; projected_at: string | null; state: { latest_cursor: string | null; heartbeat_at: string } | null }>(`WITH candidates AS MATERIALIZED (
        SELECT p.uri, ${kind === 'directory' ? 'NULL::text' : 'p.postal_code'} AS postal_code, ${kind === 'directory' ? 'p.latitude' : 'CASE WHEN p.postal_code IS NOT NULL THEN p.latitude END'} AS latitude, ${kind === 'directory' ? 'p.longitude' : 'CASE WHEN p.postal_code IS NOT NULL THEN p.longitude END'} AS longitude, p.precision_km, p.record_created_at, p.record_updated_at, p.projected_at, ${distance} AS distance_km FROM ${table} p WHERE ${where.join(' AND ')}
    ), filtered AS MATERIALIZED (SELECT * FROM candidates ${radius}), paged AS (
        SELECT * FROM filtered ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
    ), page_records AS (
        SELECT p.*, page.distance_km, page.ordinal FROM (
            SELECT paged.*, row_number() OVER (ORDER BY ${order}) AS ordinal FROM paged
        ) page JOIN ${table} p ON p.uri = page.uri
    ), stats AS (
        SELECT count(*) AS total, count(latitude) AS located, max(projected_at) AS projected_at FROM filtered
    ), cells AS (
        SELECT least(89.995, greatest(-89.995, floor(latitude * 100) / 100 + .005)) AS latitude,
            least(179.995, greatest(-179.995, floor(longitude * 100) / 100 + .005)) AS longitude,
            count(*)::integer AS count, max(precision_km) + 1 AS "radiusKm", postal_code AS "postalCode"
        FROM filtered WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        GROUP BY 1, 2, postal_code ORDER BY 1, 2, postal_code
    ) SELECT ${nowParam}::timestamptz AS query_at, stats.total::text AS total, stats.projected_at,
        ${kind === 'map' ? `jsonb_build_object('requestCount', stats.total, 'locatedRequestCount', stats.located, 'truncated', (SELECT count(*) > 34000 FROM cells), 'cells', coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT * FROM cells LIMIT 34000) c), '[]'::jsonb))` : 'NULL::jsonb'} AS aggregates,
        coalesce((SELECT jsonb_agg(to_jsonb(r) - 'ordinal' ORDER BY r.ordinal) FROM page_records r), '[]'::jsonb) AS rows,
        (SELECT jsonb_build_object('latest_cursor', latest_cursor::text, 'heartbeat_at', heartbeat_at) FROM indexer_projection_state WHERE singleton = TRUE) AS state FROM stats`, values);
    const data = result.rows[0]!;
    return { rows: data.rows, total: Number(data.total), page, pageSize, now, ...(data.aggregates ? { aggregates: data.aggregates } : {}), freshness: {
        latestCursor: data.state?.latest_cursor ? Number(data.state.latest_cursor) : null,
        projectedAt: data.projected_at ? new Date(data.projected_at).toISOString() : null,
        observedAt: data.state ? new Date(data.state.heartbeat_at).toISOString() : null,
        lagSeconds: data.state ? Math.max(0, (Date.now() - Date.parse(data.state.heartbeat_at)) / 1000) : null,
    } };
}
const iso = (value: string) => new Date(value).toISOString();
const common = (row: QueryResultRow) => ({ uri: row.uri as string, authorDid: String(row.uri).split('/')[2]!, ...(row.cid ? { cid: row.cid as string } : {}), createdAt: iso(row.record_created_at), updatedAt: iso(row.record_updated_at), recordOrigin: row.record_origin });
export async function queryProjected(pool: Pool, params: URLSearchParams, kind: 'map' | 'feed' | 'directory', viewerDid?: string, uri?: string): Promise<ApiRouteResult> {
    try {
        const result = await readProjectionPage(pool, params, kind, viewerDid, uri);
        const results = result.rows.map(row => {
            const postalArea = kind !== 'directory' && row.postal_code ? lookupPostalArea(row.postal_code) : undefined;
            const geo = kind !== 'directory' ? (postalArea ? { latitude: postalArea.latitude, longitude: postalArea.longitude, precisionKm: 1 } : undefined) : row.latitude !== null && row.longitude !== null && row.precision_km !== null ? { latitude: Number(row.latitude), longitude: Number(row.longitude), precisionKm: Number(row.precision_km) } : undefined;
            return kind === 'directory' ? { ...common(row), name: row.name, category: row.category, serviceArea: row.service_area, status: row.verification_status, contact: row.contact, ...(geo ? { approximateGeo: geo } : {}), ...(row.open_hours ? { openHours: row.open_hours } : {}), ...(row.eligibility_notes ? { eligibilityNotes: row.eligibility_notes } : {}), operationalStatus: row.operational_status } : {
                ...common(row), ...(row.postal_code ? { postalCode: row.postal_code } : {}), title: row.title, summary: row.description, category: row.category, urgency: row.urgency, status: row.status,
                ...(geo ? { approximateGeo: geo } : {}), ...(row.distance_km !== null ? { distanceKm: Number(row.distance_km) } : {}),
                ranking: computeDiscoveryRank({ distanceKm: row.distance_km === null ? Infinity : Number(row.distance_km), createdAt: iso(row.record_created_at), trustScore: .5, nowIso: result.now }),
            };
        });
        return { statusCode: 200, body: { total: result.total, page: result.page, pageSize: result.pageSize, hasNextPage: result.page * result.pageSize < result.total, results, ...(result.aggregates ? { aggregates: result.aggregates } : {}), projectionFreshness: result.freshness } as ApiQueryAidResponse | ApiQueryDirectoryResponse };
    } catch (error) {
        if (error instanceof ZodError) return { statusCode: 400, body: { error: { code: 'INVALID_QUERY', message: 'Query parameters failed validation.' } } };
        throw error;
    }
}
