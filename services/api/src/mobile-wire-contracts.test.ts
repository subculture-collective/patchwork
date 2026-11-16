import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PostgresProjectionQueryService } from './query-service.js';
import { PublicHttpError, toPublicError } from './http/error-response.js';

const root = new URL('../../../packages/mobile-contracts/', import.meta.url);
const read = <T = unknown>(path: string): T =>
    JSON.parse(readFileSync(new URL(path, root), 'utf8')) as T;
const schema = (name: string) => z.fromJSONSchema(
    read<Parameters<typeof z.fromJSONSchema>[0]>(`schemas/${name}.schema.json`),
);
const now = '2026-11-15T12:00:00.000Z';
const row = {
    uri: 'at://did:example:mobile-fixture/app.patchwork.aid.post/demo',
    cid: 'demo-cid', title: 'Share spare groceries',
    description: 'Fictional example for native contract tests.',
    post_type: 'offer', status: 'open', category: 'food', urgency: 'low',
    postal_code: null, county_id: null,
    latitude: null, longitude: null, precision_km: null, distance_km: null,
    record_created_at: now, record_updated_at: now, record_origin: 'synthetic',
};
const feed = async (rows: object[], state: object | null = null) => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{
        rows, total: String(rows.length), projected_at: rows.length ? now : null, state,
    }] }) } as unknown as Pool;
    return new PostgresProjectionQueryService(pool).queryFeed(new URLSearchParams());
};

afterEach(() => vi.useRealTimers());

describe('server-owned mobile wire fixtures', () => {
    it.each(['feed-global', 'feed-area', 'feed-empty', 'feed-legacy', 'feed-additive'])(
        'validates the reader-facing %s example', name => {
            expect(schema('feed').safeParse(read(`fixtures/${name}.json`)).success).toBe(true);
        },
    );

    it.each(['error-invalid-query', 'error-auth', 'error-internal'])(
        'validates the safe %s envelope', name => {
            expect(schema('error').safeParse(read(`fixtures/${name}.json`)).success).toBe(true);
        },
    );

    it('matches current global and empty production feed presentation', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now);
        expect(await feed([row])).toEqual({ statusCode: 200, body: read('fixtures/feed-global.json') });
        expect(await feed([])).toEqual({ statusCode: 200, body: read('fixtures/feed-empty.json') });
    });

    it('canonicalizes county geometry rather than returning an arbitrary row point', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(now);
        const result = await feed([{
            ...row, county_id: '17031', latitude: 1, longitude: 2,
            precision_km: 1, distance_km: 3,
        }], { latest_cursor: '7', heartbeat_at: now });
        expect(result).toEqual({ statusCode: 200, body: read('fixtures/feed-area.json') });
    });

    it('matches invalid query validation before touching the database', async () => {
        const query = vi.fn();
        const service = new PostgresProjectionQueryService({ query } as unknown as Pool);
        expect(await service.queryFeed(new URLSearchParams({ page: '0' })))
            .toEqual({ statusCode: 400, body: read('fixtures/error-invalid-query.json') });
        expect(query).not.toHaveBeenCalled();
    });

    it('matches auth errors and never publishes internal exception diagnostics', () => {
        expect(toPublicError(new PublicHttpError(
            401, 'AUTHENTICATION_REQUIRED', 'An authenticated session is required.',
        ), 'mobile-fixture-request').body).toEqual(read('fixtures/error-auth.json'));
        expect(toPublicError(new Error('private diagnostic canary'), 'mobile-fixture-request').body)
            .toEqual(read('fixtures/error-internal.json'));
    });

    it('accepts additions and unknown states while rejecting malformed required fields', () => {
        const future = read<{ results: { status: string }[] }>('fixtures/feed-additive.json');
        expect(future.results[0]?.status).toBe('future-state');
        expect(schema('feed').safeParse(future).success).toBe(true);
        const valid = read<Record<string, unknown>>('fixtures/feed-global.json');
        expect(schema('feed').safeParse({ ...valid, results: null }).success).toBe(false);
        expect(schema('feed').safeParse({ ...valid, page: 0 }).success).toBe(false);
        const { results: _results, ...missing } = valid;
        expect(schema('feed').safeParse(missing).success).toBe(false);
        expect(schema('error').safeParse({ error: { message: 'Missing code' } }).success).toBe(false);
    });
});
