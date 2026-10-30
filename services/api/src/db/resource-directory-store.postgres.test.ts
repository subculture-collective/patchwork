import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { currentDirectoryAssertion, resourceDirectorySchema } from '@patchwork/shared';
import { persistResourceDirectory, readDirectoryAssertions } from './resource-directory-store.js';
import { backfillResourceDirectory } from './backfill-resource-directory.js';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const prefix = `at://zzzz-directory-test/${randomUUID()}`;
const entity = (name: string) => `${prefix}/${name}`;
const evidence = { sourceId: 'publisher-one', sourceName: 'Publisher', sourceUrl: 'https://example.org/services',
    observedAt: '2026-09-20T00:00:00Z', confirmedAt: '2026-09-01T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z',
    reviewState: 'reviewed', conflictState: 'none', rawSha256: 'a'.repeat(64) };
const graph = () => resourceDirectorySchema.parse({ version: 1,
    organizations: [{ id: entity('org'), name: 'Community aid' }],
    places: [{ id: entity('site-a'), name: 'Community center', visibility: 'public' },
        { id: entity('site-b'), name: 'Confidential site', visibility: 'confidential' }],
    services: [{ id: entity('food'), name: 'Meals', organizationId: entity('org'), delivery: 'in-person' },
        { id: entity('phone'), name: 'Phone advice', delivery: 'remote' },
        { id: entity('advice'), name: 'Advice', delivery: 'hybrid' }],
    serviceLocations: [{ id: entity('food-a'), serviceId: entity('food'), placeId: entity('site-a') },
        { id: entity('food-b'), serviceId: entity('food'), placeId: entity('site-b') },
        { id: entity('advice-a'), serviceId: entity('advice'), placeId: entity('site-a') }],
    assertions: [{ id: entity('cost-one'), subjectType: 'service', subjectId: entity('food'), field: 'cost', value: 'Free', evidence },
        { id: entity('cost-two'), subjectType: 'service', subjectId: entity('food'), field: 'cost', value: '$5 suggested',
            evidence: { ...evidence, sourceId: 'publisher-two', conflictState: 'open' } }],
});
afterAll(async () => {
    for (const table of ['directory_assertions', 'directory_service_locations', 'directory_services', 'directory_places', 'directory_organizations'])
        await pool.query(`DELETE FROM ${table} WHERE strpos(id,$1)>0`, [prefix]);
    await pool.query('DELETE FROM resource_service_profiles WHERE strpos(resource_uri,$1)>0', [prefix]);
    await pool.query('DELETE FROM resource_service_profile_history WHERE strpos(resource_uri,$1)>0', [prefix]);
    await pool.query('DELETE FROM public_resource_listings WHERE strpos(resource_uri,$1)>0', [prefix]);
    await pool.end();
});

describe('durable directory identities and field evidence', () => {
    it('persists many-to-many, remote and confidential services; replays without duplicate rows or renewed review', async () => {
        const value = graph();
        expect(await persistResourceDirectory(pool, value)).toEqual({ inserted: 11, replayed: false });
        expect(await persistResourceDirectory(pool, value)).toEqual({ inserted: 0, replayed: true });
        const claims = await readDirectoryAssertions(pool, 'service', entity('food'));
        expect(claims).toHaveLength(2);
        expect(claims.filter(item => currentDirectoryAssertion(item, new Date('2026-09-20')))).toHaveLength(1);
        expect(claims.filter(item => currentDirectoryAssertion(item, new Date('2026-11-01')))).toHaveLength(0);
        expect(await readDirectoryAssertions(pool, 'place', entity('site-a'))).toEqual([]);
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM directory_service_locations WHERE service_id=$1', [entity('phone')])).rows[0].count).toBe(0);
    });
    it('rolls back the entire graph on a changed assertion and preserves its original confirmation', async () => {
        const value = graph();
        await persistResourceDirectory(pool, value);
        value.organizations.push({ id: entity('rolled-back-org'), name: 'Must roll back' });
        value.assertions[0]!.evidence.confirmedAt = '2026-09-21T00:00:00Z';
        await expect(persistResourceDirectory(pool, value)).rejects.toThrow('explicit review');
        expect((await pool.query('SELECT 1 FROM directory_organizations WHERE id=$1', [entity('rolled-back-org')])).rowCount).toBe(0);
        expect((await readDirectoryAssertions(pool, 'service', entity('food')))[0]!.evidence.confirmedAt).toBe(evidence.confirmedAt);
    });
    it('enforces typed relationship foreign keys and detects corrupt evidence on readback', async () => {
        await persistResourceDirectory(pool, graph());
        await expect(pool.query(`INSERT INTO directory_service_locations(id,service_id,place_id,payload,content_sha256)
            VALUES($1,$2,$3,'{}',$4)`, [entity('bad-link'), entity('phone'), entity('missing-place'), 'a'.repeat(64)]))
            .rejects.toThrow('foreign key');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // The original store is preserved by rollback; read through this transaction to observe corruption.
            await client.query("UPDATE directory_assertions SET content_sha256=$2 WHERE id=$1", [entity('cost-one'), '0'.repeat(64)]);
            await expect(readDirectoryAssertions(client, 'service', entity('food'))).rejects.toThrow('hash mismatch');
        } finally { await client.query('ROLLBACK'); client.release(); }
    });
    it('previews, pages and replays legacy backfill without changing old profiles, listings or evidence dates', async () => {
        const profile = { version: 1, organizationName: 'Legacy provider', services: [{ id: 'food', name: 'Food', eligibility: [],
            cost: { value: 'Free', evidence: { sourceUrl: evidence.sourceUrl, sourceName: evidence.sourceName,
                confirmedAt: evidence.confirmedAt, expiresAt: evidence.expiresAt, reviewStatus: 'reviewed' } } }] };
        for (const suffix of ['legacy-a', 'legacy-b']) {
            await pool.query(`INSERT INTO public_resource_listings(resource_uri,source_name,source_url,source_retrieved_at,
                source_snapshot,source_expires_at,street_address,postal_code,latitude,longitude,public_access)
                VALUES($1,'Publisher',$2,'2026-09-01','{"name":"Legacy site"}','2026-10-01','Public address','60601',41,-87,'Public')`,
            [entity(suffix), evidence.sourceUrl]);
            await pool.query('INSERT INTO resource_service_profiles(resource_uri,profile,updated_at) VALUES($1,$2,$3)',
                [entity(suffix), JSON.stringify(profile), evidence.observedAt]);
        }
        const before = (await pool.query('SELECT * FROM resource_service_profiles WHERE resource_uri=$1', [entity('legacy-a')])).rows[0];
        const first = await backfillResourceDirectory(pool, { limit: 1, afterUri: prefix });
        expect(first.mode).toBe('preview');
        expect(first.nextAfterUri).toBe(entity('legacy-a'));
        expect((await pool.query('SELECT 1 FROM directory_services WHERE id=$1', [`legacy:${entity('legacy-a')}:service:food`])).rowCount).toBe(0);
        const applied = await backfillResourceDirectory(pool, { mode: 'persist', limit: 1, afterUri: prefix });
        expect(applied.profiles[0]).toMatchObject({ inserted: 5, replayed: false });
        expect((await backfillResourceDirectory(pool, { mode: 'persist', limit: 1, afterUri: prefix })).profiles[0]).toMatchObject({ inserted: 0, replayed: true });
        expect((await backfillResourceDirectory(pool, { mode: 'preview', limit: 1, afterUri: first.nextAfterUri })).profiles[0]!.resourceUri).toBe(entity('legacy-b'));
        expect((await pool.query('SELECT * FROM resource_service_profiles WHERE resource_uri=$1', [entity('legacy-a')])).rows[0]).toEqual(before);
        const assertion = (await readDirectoryAssertions(pool, 'service', `legacy:${entity('legacy-a')}:service:food`))[0]!;
        expect(assertion.evidence).toMatchObject({ confirmedAt: evidence.confirmedAt, expiresAt: evidence.expiresAt,
            observedAt: '2026-09-20T00:00:00.000Z', rawSha256: null });
        expect(assertion.evidence.sourceId).toMatch(/^legacy-url:/);
        // The old application can still update its profile and history after backfill.
        await pool.query('UPDATE resource_service_profiles SET revision=revision+1 WHERE resource_uri=$1', [entity('legacy-a')]);
        expect((await pool.query('SELECT revision FROM resource_service_profiles WHERE resource_uri=$1', [entity('legacy-a')])).rows[0].revision).toBe(2);
        expect((await pool.query('SELECT profile FROM resource_service_profile_history WHERE resource_uri=$1 AND revision=1', [entity('legacy-a')])).rows[0].profile).toEqual(profile);
    });
});
