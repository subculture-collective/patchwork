import type { Pool, PoolClient } from 'pg';
import { directoryAssertionSchema, resourceDirectorySchema, type DirectoryAssertion } from '@patchwork/shared';
import { hashRefreshValue } from './public-resource-refresh.js';

const subjects = { organization: 'organization_id', place: 'place_id', service: 'service_id',
    'service-location': 'service_location_id' } as const;
type Table = 'directory_organizations' | 'directory_places' | 'directory_services'
    | 'directory_service_locations' | 'directory_assertions';

async function insertImmutable(client: PoolClient, table: Table, payload: { id: string }, extra: Record<string, unknown>) {
    // Identifiers below are code-owned, never interpolated from publisher inputs.
    const keys = ['id', 'payload', 'content_sha256', ...Object.keys(extra)];
    const digest = hashRefreshValue(payload);
    const values = [payload.id, JSON.stringify(payload), digest, ...Object.values(extra)];
    const inserted = await client.query(`INSERT INTO ${table} (${keys.join(',')})
        VALUES (${values.map((_, index) => `$${index + 1}`).join(',')}) ON CONFLICT(id) DO NOTHING`, values);
    const stored = await client.query<{ content_sha256: string; payload: unknown }>(
        `SELECT content_sha256,payload FROM ${table} WHERE id=$1`, [payload.id]);
    if (stored.rows[0]?.content_sha256 !== digest || hashRefreshValue(stored.rows[0]?.payload) !== digest)
        throw new Error('Directory identity already contains different content; explicit review is required.');
    return inserted.rowCount ?? 0;
}

/** Additive immutable intake, never a publication or ownership operation. */
export async function persistResourceDirectory(pool: Pool, input: unknown) {
    const graph = resourceDirectorySchema.parse(input);
    const client = await pool.connect();
    let inserted = 0;
    const sorted = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
    try {
        await client.query('BEGIN');
        for (const entity of sorted(graph.organizations)) inserted += await insertImmutable(client, 'directory_organizations', entity, {});
        for (const entity of sorted(graph.places)) inserted += await insertImmutable(client, 'directory_places', entity, { visibility: entity.visibility });
        for (const entity of sorted(graph.services)) inserted += await insertImmutable(client, 'directory_services', entity,
            { organization_id: entity.organizationId ?? null, delivery: entity.delivery });
        for (const entity of sorted(graph.serviceLocations)) inserted += await insertImmutable(client, 'directory_service_locations', entity,
            { service_id: entity.serviceId, place_id: entity.placeId });
        for (const assertion of sorted(graph.assertions)) {
            const evidence = assertion.evidence;
            inserted += await insertImmutable(client, 'directory_assertions', assertion, {
                [subjects[assertion.subjectType]]: assertion.subjectId, field: assertion.field,
                source_id: evidence.sourceId, source_url: evidence.sourceUrl, raw_sha256: evidence.rawSha256,
                observed_at: evidence.observedAt, confirmed_at: evidence.confirmedAt, expires_at: evidence.expiresAt,
                review_state: evidence.reviewState, conflict_state: evidence.conflictState,
            });
        }
        await client.query('COMMIT');
        return { inserted, replayed: inserted === 0 };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}

/** Retain all competing/history rows; callers apply current-evidence qualification. */
export async function readDirectoryAssertions(pool: Pick<Pool, 'query'>, type: DirectoryAssertion['subjectType'], id: string) {
    const column = subjects[type];
    if (!column) throw new Error('Unknown directory subject type.');
    const result = await pool.query<{ payload: unknown; content_sha256: string }>(
        `SELECT payload,content_sha256 FROM directory_assertions WHERE ${column}=$1 ORDER BY id`, [id]);
    return result.rows.map(row => {
        if (hashRefreshValue(row.payload) !== row.content_sha256) throw new Error('Directory assertion hash mismatch.');
        const assertion = directoryAssertionSchema.parse(row.payload);
        if (assertion.subjectType !== type || assertion.subjectId !== id) throw new Error('Directory assertion subject mismatch.');
        return assertion;
    });
}
