import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordNsid, type NormalizedFirehoseEvent } from '@patchwork/shared';
import { PostgresCheckpointStore } from '../checkpoint.js';
import { runIndexerMigrations } from '../migrate.js';
import { PostgresJetstreamControlStore } from './jetstream-control-store.js';
import { PostgresProjectionComparison } from './projection-comparison.js';
import { PostgresProjectionStore } from './projection-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const hash = (value: string): string =>
    createHash('sha256').update(value).digest('hex');

const event = (cid: string, seq: number): NormalizedFirehoseEvent => ({
    eventId: `${seq}:aid-post:create`,
    seq,
    action: 'create',
    uri: `at://did:plc:alice/${recordNsid.aidPost}/one`,
    collection: recordNsid.aidPost,
    authorDid: 'did:plc:alice',
    cid,
    revision: `rev-${seq}`,
    receivedAt: '2026-08-14T12:00:00.000Z',
    payload: {
        kind: 'aid-post',
        title: 'Food support needed',
        description: 'Shelf-stable groceries requested.',
        category: 'food',
        urgency: 'high',
        status: 'open',
        createdAt: '2026-08-14T11:00:00.000Z',
        updatedAt: '2026-08-14T11:00:00.000Z',
        searchableText: 'food support needed',
        approximateGeo: {
            latitude: 41.88,
            longitude: -87.63,
            precisionKm: 3,
        },
        trustScore: 0.5,
    },
});

describePostgres('Jetstream v2 shadow projection', () => {
    const live = new Pool({ connectionString: databaseUrl });
    const shadow = new Pool({
        connectionString: databaseUrl,
        options: '-c search_path=jetstream_v2_shadow,public',
    });

    beforeAll(async () => runIndexerMigrations({ pool: live }));
    beforeEach(async () => {
        await live.query(
            `TRUNCATE public.indexer_checkpoints,
                      public.indexer_projection_events,
                      public.indexer_projection_tombstones,
                      public.indexer_aid_post_projections,
                      public.indexer_directory_resource_projections,
                      public.indexer_volunteer_profile_projections,
                      public.indexer_network_accounts,
                      jetstream_v2_shadow.indexer_projection_events,
                      jetstream_v2_shadow.indexer_projection_tombstones,
                      jetstream_v2_shadow.indexer_aid_post_projections,
                      jetstream_v2_shadow.indexer_directory_resource_projections,
                      jetstream_v2_shadow.indexer_volunteer_profile_projections,
                      jetstream_v2_shadow.indexer_network_accounts,
                      jetstream_v2_shadow.indexer_identity_cache,
                      jetstream_v2_shadow.indexer_repo_reconciliation_queue`,
        );
    });
    afterAll(async () => {
        await Promise.all([live.end(), shadow.end()]);
    });

    it('keeps cursor namespaces and projections isolated and comparable', async () => {
        const savedV1 = await new PostgresCheckpointStore(
            live,
            'jetstream-v1-time-us',
        ).save(1_723_650_000_000_000);
        const savedV2 = await new PostgresCheckpointStore(
            shadow,
            'jetstream-v2-seq',
        ).save(42);
        expect(savedV1.source).toBe('jetstream-v1-time-us');
        expect(savedV2.source).toBe('jetstream-v2-seq');
        const checkpoints = await live.query(
            `SELECT id, cursor FROM public.indexer_checkpoints ORDER BY id`,
        );
        expect(checkpoints.rows).toEqual([
            { id: 'jetstream-v1-time-us', cursor: '1723650000000000' },
            { id: 'jetstream-v2-seq', cursor: '42' },
        ]);

        await new PostgresProjectionStore(live).apply(event('cid-live', 100));
        await new PostgresProjectionStore(
            shadow,
            'patchwork-indexer-rebuild:v2-shadow',
        ).apply(
            event('cid-shadow', 101),
        );
        expect(await new PostgresProjectionComparison(live).compare()).toEqual([
            expect.objectContaining({
                collection: 'aid-posts',
                liveCount: 1,
                shadowCount: 1,
                cidMismatches: 1,
            }),
            expect.objectContaining({ collection: 'directory-resources' }),
            expect.objectContaining({ collection: 'volunteer-profiles' }),
        ]);
    });

    it('copies the legacy default checkpoint into the v1 namespace', async () => {
        await live.query(
            `INSERT INTO public.indexer_checkpoints (
                id, cursor, cursor_source, sequence
             ) VALUES (
                'default', 1723650000000000,
                'jetstream-v1-time-us', 9
             )`,
        );
        const checkpoint = await new PostgresCheckpointStore(
            live,
            'jetstream-v1-time-us',
        ).load();
        expect(checkpoint).toMatchObject({
            cursor: 1_723_650_000_000_000,
            source: 'jetstream-v1-time-us',
            sequence: 9,
        });
    });

    it('removes only shadow projections for an inactive network account', async () => {
        await new PostgresProjectionStore(live).apply(event('cid-live', 100));
        await new PostgresProjectionStore(
            shadow,
            'patchwork-indexer-rebuild:v2-shadow',
        ).apply(
            event('cid-shadow', 101),
        );
        const controls = new PostgresJetstreamControlStore(shadow);
        await controls.identity(102, 'did:plc:alice', {
            did: 'did:plc:alice' as never,
            handle: 'alice.test' as never,
        });
        await controls.sync(103, 'did:plc:alice', {
            did: 'did:plc:alice' as never,
            rev: '3jzfcijpj2z2a' as never,
        });
        await controls.account(104, 'did:plc:alice', {
            did: 'did:plc:alice' as never,
            active: false,
            status: 'deleted',
        });

        expect(
            (
                await live.query(
                    'SELECT COUNT(*) FROM public.indexer_aid_post_projections',
                )
            ).rows[0].count,
        ).toBe('1');
        expect(
            (
                await live.query(
                    `SELECT COUNT(*) FROM jetstream_v2_shadow.indexer_aid_post_projections`,
                )
            ).rows[0].count,
        ).toBe('0');
        expect(
            (
                await live.query(
                    `SELECT active FROM jetstream_v2_shadow.indexer_network_accounts
                     WHERE did_hash = $1`,
                    [hash('did:plc:alice')],
                )
            ).rows[0].active,
        ).toBe(false);
        expect(
            (
                await live.query(
                    `SELECT status FROM jetstream_v2_shadow.indexer_repo_reconciliation_queue`,
                )
            ).rows[0].status,
        ).toBe('pending');
    });

    it('does not let a stale inactive event erase a projection', async () => {
        await new PostgresProjectionStore(
            shadow,
            'patchwork-indexer-rebuild:v2-shadow',
        ).apply(event('cid-shadow', 101));
        const controls = new PostgresJetstreamControlStore(shadow);
        await controls.account(200, 'did:plc:alice', {
            did: 'did:plc:alice' as never,
            active: true,
        });
        await controls.account(199, 'did:plc:alice', {
            did: 'did:plc:alice' as never,
            active: false,
            status: 'deleted',
        });
        expect(
            (
                await shadow.query(
                    'SELECT COUNT(*) FROM indexer_aid_post_projections',
                )
            ).rows[0].count,
        ).toBe('1');
    });
});
