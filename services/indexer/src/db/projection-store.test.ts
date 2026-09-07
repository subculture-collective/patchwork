import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    buildPhase3FixtureFirehoseEvents,
    normalizeFirehoseEvent,
    recordNsid,
    type NormalizedFirehoseEvent,
} from '@patchwork/shared';
import { InMemoryCheckpointStore } from '../checkpoint.js';
import { runIndexerMigrations } from '../migrate.js';
import { IndexerPipeline } from '../pipeline.js';
import { PostgresDeadLetterStore } from './dead-letter-store.js';
import { PostgresProjectionStore } from './projection-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const createEvent = (overrides: Partial<NormalizedFirehoseEvent> = {}): NormalizedFirehoseEvent => ({
    eventId: '100:aid-post:create',
    seq: 100,
    action: 'create',
    uri: `at://did:plc:alice/${recordNsid.aidPost}/post-1`,
    collection: recordNsid.aidPost,
    authorDid: 'did:plc:alice',
    receivedAt: '2026-07-11T12:00:00.000Z',
    payload: {
        kind: 'aid-post',
        title: 'Food support needed',
        description: 'Shelf-stable groceries requested.',
        category: 'food',
        urgency: 'high',
        status: 'open',
        createdAt: '2026-07-11T11:00:00.000Z',
        updatedAt: '2026-07-11T11:00:00.000Z',
        searchableText: 'food support needed shelf stable groceries requested',
        approximateGeo: {
            latitude: 41.88,
            longitude: -87.63,
            precisionKm: 3,
        },
        trustScore: 0.5,
    },
    ...overrides,
});

const createDirectoryEvent = (
    overrides: Partial<NormalizedFirehoseEvent> = {},
): NormalizedFirehoseEvent => ({
    eventId: '200:directory-resource:create',
    seq: 200,
    action: 'create',
    uri: `at://did:plc:resource-owner/${recordNsid.directoryResource}/resource-1`,
    collection: recordNsid.directoryResource,
    authorDid: 'did:plc:resource-owner',
    receivedAt: '2026-07-11T12:00:00.000Z',
    payload: {
        kind: 'directory-resource',
        name: 'Community Pantry',
        serviceArea: 'Near North Side',
        category: 'food-bank',
        verificationStatus: 'community-verified',
        contact: { url: 'https://pantry.example' },
        approximateGeo: {
            latitude: 41.9,
            longitude: -87.64,
            precisionKm: 2,
        },
        openHours: 'Mon-Fri 09:00-17:00',
        eligibilityNotes: 'Open to local residents.',
        operationalStatus: 'open',
        createdAt: '2026-07-11T11:00:00.000Z',
        updatedAt: '2026-07-11T11:00:00.000Z',
        searchableText:
            'community pantry near north side food bank community verified',
        trustScore: 0.8,
    },
    ...overrides,
});

const createVolunteerEvent = (
    overrides: Partial<NormalizedFirehoseEvent> = {},
): NormalizedFirehoseEvent => ({
    eventId: '300:volunteer-profile:create',
    seq: 300,
    action: 'create',
    uri: `at://did:plc:volunteer/${recordNsid.volunteerProfile}/main`,
    collection: recordNsid.volunteerProfile,
    authorDid: 'did:plc:volunteer',
    receivedAt: '2026-07-11T12:00:00.000Z',
    payload: {
        kind: 'volunteer-profile',
        displayName: 'Alex Rivera',
        bio: 'Neighborhood delivery volunteer.',
        capabilities: ['food-delivery'],
        availability: 'within-24h',
        contactPreference: 'chat-only',
        skills: ['meal delivery'],
        languages: ['en', 'es'],
        serviceArea: {
            areaLabel: 'Near North Side',
            noPermanentAddress: true,
            approximateGeo: {
                latitude: 41.9,
                longitude: -87.64,
                precisionKm: 2,
            },
        },
        createdAt: '2026-07-11T11:00:00.000Z',
        updatedAt: '2026-07-11T11:00:00.000Z',
        searchableText:
            'alex rivera neighborhood delivery volunteer food delivery',
        trustScore: 0.5,
    },
    ...overrides,
});

describePostgres('PostgresProjectionStore', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeAll(async () => {
        await runIndexerMigrations({ pool });
    });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE indexer_projection_events,
                      indexer_projection_tombstones,
                      indexer_aid_post_projections,
                      indexer_directory_resource_projections,
                      indexer_volunteer_profile_projections,
                      indexer_dead_letters,
                      account_deactivations`,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('ingests a ZIP-only AT record without losing leading zeros or creating individual coordinates', async () => {
        const event = normalizeFirehoseEvent({
            seq: 500, receivedAt: '2026-09-06T12:00:00.000Z', action: 'create',
            uri: 'at://did:plc:postal/app.patchwork.aid.post/leading-zero',
            collection: recordNsid.aidPost, authorDid: 'did:plc:postal',
            record: { $type: recordNsid.aidPost, version: '2.0.0', title: 'Help with groceries',
                description: 'A grocery pickup is needed.', category: 'food', urgency: 'medium', status: 'open',
                location: { countryCode: 'US', postalCode: '00601' }, createdAt: '2026-09-06T12:00:00.000Z' },
        });
        expect(event.success).toBe(true);
        if (!event.success) throw new Error('ZIP record normalization failed.');
        await new PostgresProjectionStore(pool).apply(event.event);
        const stored = await pool.query('SELECT postal_code,latitude,longitude FROM indexer_aid_post_projections WHERE uri=$1',[event.event.uri]);
        expect(stored.rows[0].postal_code).toBe('00601');
        expect(event.event.payload?.kind).toBe('aid-post');
        if (event.event.payload?.kind === 'aid-post') {
            expect(stored.rows[0].latitude).toBe(event.event.payload.approximateGeo.latitude);
            expect(stored.rows[0].longitude).toBe(event.event.payload.approximateGeo.longitude);
        }
    });

    it('persists a normalized aid-post projection with privacy-safe identity and geography', async () => {
        const store = new PostgresProjectionStore(pool);
        const event = createEvent();

        await store.apply(event);
        const projection = await store.get(event.uri);

        expect(projection).toMatchObject({
            uri: event.uri,
            collection: recordNsid.aidPost,
            title: 'Food support needed',
            category: 'food',
            urgency: 'high',
            status: 'open',
            latitude: 41.88,
            longitude: -87.63,
            precisionKm: 3,
            sourceCursor: 100,
        });
        expect(projection?.authorDidHash).toMatch(/^[a-f0-9]{64}$/);
        expect(projection?.authorDidHash).not.toBe('did:plc:alice');
        expect(projection).not.toHaveProperty('authorDid');
    });

    it('persists, updates, and deletes durable directory-resource projections', async () => {
        const store = new PostgresProjectionStore(pool);
        const created = createDirectoryEvent();

        await store.apply(created);
        expect(await store.getDirectory(created.uri)).toMatchObject({
            uri: created.uri,
            collection: recordNsid.directoryResource,
            name: 'Community Pantry',
            category: 'food-bank',
            verificationStatus: 'community-verified',
            contact: { url: 'https://pantry.example' },
            latitude: 41.9,
            longitude: -87.64,
            precisionKm: 2,
            operationalStatus: 'open',
            sourceCursor: 200,
        });
        expect((await store.getDirectory(created.uri))?.authorDidHash).toMatch(
            /^[a-f0-9]{64}$/,
        );

        const payload = created.payload;
        if (payload?.kind !== 'directory-resource') {
            throw new Error('Expected directory-resource fixture payload.');
        }
        await store.apply(
            createDirectoryEvent({
                eventId: '210:directory-resource:update',
                seq: 210,
                action: 'update',
                payload: {
                    ...payload,
                    approximateGeo: undefined,
                    operationalStatus: 'limited',
                    updatedAt: '2026-07-11T12:10:00.000Z',
                },
            }),
        );
        expect(await store.getDirectory(created.uri)).toMatchObject({
            operationalStatus: 'limited',
            latitude: null,
            longitude: null,
            precisionKm: null,
            sourceCursor: 210,
        });

        await store.apply(
            createDirectoryEvent({
                eventId: '220:directory-resource:delete',
                seq: 220,
                action: 'delete',
                payload: undefined,
                deleteReason: 'deleted-upstream',
            }),
        );
        expect(await store.getDirectory(created.uri)).toBeNull();
    });

    it('persists public volunteer profiles without private matching or verification state', async () => {
        const store = new PostgresProjectionStore(pool);
        const created = createVolunteerEvent();
        await store.apply(created);

        const projection = await store.getVolunteer(created.uri);
        expect(projection).toMatchObject({
            displayName: 'Alex Rivera',
            capabilities: ['food-delivery'],
            languages: ['en', 'es'],
            serviceAreaLabel: 'Near North Side',
            noPermanentAddress: true,
            precisionKm: 2,
            sourceCursor: 300,
        });
        expect(projection?.authorDidHash).toMatch(/^[a-f0-9]{64}$/);
        expect(projection).not.toHaveProperty('contactEmail');
        expect(projection).not.toHaveProperty('matchingPreferences');
        expect(projection).not.toHaveProperty(
            'verificationCheckpoints',
        );

        await store.apply(
            createVolunteerEvent({
                eventId: '310:volunteer-profile:delete',
                seq: 310,
                action: 'delete',
                payload: undefined,
            }),
        );
        expect(await store.getVolunteer(created.uri)).toBeNull();
    });

    it('suppresses future projections and rebuild replay for a deactivated account', async () => {
        const store = new PostgresProjectionStore(pool);
        const event = createEvent();
        const didHash = createHash('sha256')
            .update(event.authorDid)
            .digest('hex');
        await pool.query(
            `INSERT INTO account_deactivations (
                did_hash, command_id, result, requested_at, retention_until
             ) VALUES ($1, 'projection-suppression-test',
                       '{"status":"deactivated"}', NOW(),
                       NOW() + INTERVAL '1 year')`,
            [didHash],
        );

        await store.apply(event);
        const directoryEvent = createDirectoryEvent({
            uri: `at://did:plc:alice/${recordNsid.directoryResource}/resource-1`,
            authorDid: 'did:plc:alice',
        });
        await store.apply(directoryEvent);
        const volunteerEvent = createVolunteerEvent({
            uri: `at://did:plc:alice/${recordNsid.volunteerProfile}/main`,
            authorDid: 'did:plc:alice',
        });
        await store.apply(volunteerEvent);
        expect(await store.get(event.uri)).toBeNull();
        expect(await store.getDirectory(directoryEvent.uri)).toBeNull();
        expect(await store.getVolunteer(volunteerEvent.uri)).toBeNull();

        await store.resetForRebuild();
        await store.apply({ ...event, eventId: '101:aid-post:rebuild', seq: 101 });
        await store.apply({
            ...directoryEvent,
            eventId: '201:directory-resource:rebuild',
            seq: 201,
        });
        await store.apply({
            ...volunteerEvent,
            eventId: '301:volunteer-profile:rebuild',
            seq: 301,
        });
        expect(await store.get(event.uri)).toBeNull();
        expect(await store.getDirectory(directoryEvent.uri)).toBeNull();
        expect(await store.getVolunteer(volunteerEvent.uri)).toBeNull();
    });

    it('applies a newer update once and ignores stale revisions', async () => {
        const store = new PostgresProjectionStore(pool);
        const created = createEvent();
        const initialPayload = created.payload;
        if (initialPayload?.kind !== 'aid-post') {
            throw new Error('Expected aid-post fixture payload.');
        }
        await store.apply(created);
        const updated = createEvent({
            eventId: '110:aid-post:update',
            seq: 110,
            action: 'update',
            payload: {
                ...initialPayload,
                title: 'Updated food support request',
                updatedAt: '2026-07-11T12:10:00.000Z',
            },
        });
        await store.apply(updated);
        await store.apply(updated);
        await store.apply(
            createEvent({
                eventId: '105:aid-post:stale-update',
                seq: 105,
                action: 'update',
                payload: {
                    ...initialPayload,
                    title: 'Stale title',
                    updatedAt: '2026-07-11T12:05:00.000Z',
                },
            }),
        );

        expect(await store.get(created.uri)).toMatchObject({
            title: 'Updated food support request',
            sourceCursor: 110,
        });
        const ledger = await pool.query(
            'SELECT event_id FROM indexer_projection_events ORDER BY source_cursor',
        );
        expect(ledger.rows).toHaveLength(3);
    });

    it('removes a projection on delete and prevents stale replay resurrection', async () => {
        const store = new PostgresProjectionStore(pool);
        const created = createEvent();
        await store.apply(created);
        await store.apply(
            createEvent({
                eventId: '120:aid-post:delete',
                seq: 120,
                action: 'delete',
                payload: undefined,
                deleteReason: 'deleted-upstream',
            }),
        );
        await store.apply(
            createEvent({
                eventId: '110:aid-post:stale-replay',
                seq: 110,
            }),
        );

        expect(await store.get(created.uri)).toBeNull();
        const tombstone = await pool.query<{
            uri_hash: string;
            source_cursor: string;
        }>('SELECT uri_hash, source_cursor FROM indexer_projection_tombstones');
        expect(tombstone.rows).toEqual([
            {
                uri_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
                source_cursor: '120',
            },
        ]);
        expect(JSON.stringify(tombstone.rows)).not.toContain(created.uri);
    });

    it('quarantines invalid events with bounded diagnostics and no raw payload', async () => {
        const store = new PostgresDeadLetterStore(pool);
        await store.append({
            code: 'VALIDATION_FAILED',
            message:
                'Invalid record from did:plc:alice at at://did:plc:alice/app.patchwork.aid.post/private',
            seq: 130,
            rawEvent: {
                token: 'do-not-store',
                location: { latitude: 41.881234, longitude: -87.631234 },
            },
        });
        const letters = await store.list();

        expect(letters).toEqual([
            expect.objectContaining({
                failureCode: 'VALIDATION_FAILED',
                sourceCursor: 130,
                diagnostic:
                    'Invalid record from did:[redacted] at at://[redacted]',
            }),
        ]);
        expect(JSON.stringify(letters)).not.toContain('do-not-store');
        expect(JSON.stringify(letters)).not.toContain('41.881234');
    });

    it('writes live pipeline output to the durable projection store before checkpointing', async () => {
        const projectionStore = new PostgresProjectionStore(pool);
        const checkpointStore = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore,
            deadLetterStore: new PostgresDeadLetterStore(pool),
        });
        const raw: Record<string, unknown> = {
            ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>),
            seq: 140,
        };

        await pipeline.ingestAndCheckpoint([raw]);

        const uri = String(raw.uri);
        expect(await projectionStore.get(uri)).toMatchObject({
            uri,
            sourceCursor: 140,
        });
        expect((await checkpointStore.load())?.cursor).toBe(140);
    });

    it('normalizes and persists a raw directory-resource event before checkpointing', async () => {
        const projectionStore = new PostgresProjectionStore(pool);
        const checkpointStore = new InMemoryCheckpointStore();
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore,
            deadLetterStore: new PostgresDeadLetterStore(pool),
        });
        const raw: Record<string, unknown> = {
            ...(buildPhase3FixtureFirehoseEvents()[2] as Record<string, unknown>),
            seq: 141,
        };

        await pipeline.ingestAndCheckpoint([raw]);

        const uri = String(raw.uri);
        expect(await projectionStore.getDirectory(uri)).toMatchObject({
            uri,
            collection: recordNsid.directoryResource,
            name: 'Downtown Community Pantry',
            category: 'food-bank',
            sourceCursor: 141,
        });
        expect((await checkpointStore.load())?.cursor).toBe(141);
    });

    it('dead-letters an invalid record and advances its durable cursor', async () => {
        const checkpointStore = new InMemoryCheckpointStore();
        const deadLetterStore = new PostgresDeadLetterStore(pool);
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore: new PostgresProjectionStore(pool),
            deadLetterStore,
        });
        const raw = {
            ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>),
            seq: 150,
            record: {
                $type: recordNsid.aidPost,
                title: 'Missing required fields',
            },
        };

        const result = await pipeline.ingestAndCheckpoint([raw]);

        expect(result).toMatchObject({
            normalizedCount: 0,
            failureCount: 1,
            quarantinedCount: 1,
            checkpointSeq: 150,
        });
        expect(await deadLetterStore.list()).toHaveLength(1);
        expect((await checkpointStore.load())?.cursor).toBe(150);
    });

    it('rebuilds to the same ordered projection state from the event sequence', async () => {
        const store = new PostgresProjectionStore(pool);
        const first = createEvent();
        const second = createEvent({
            eventId: '200:aid-post-2:create',
            seq: 200,
            uri: `at://did:plc:bob/${recordNsid.aidPost}/post-2`,
            authorDid: 'did:plc:bob',
        });
        const events = [first, second];
        for (const event of events) await store.apply(event);
        const before = await store.list();

        await store.resetForRebuild();
        for (const event of events) await store.apply(event);

        expect(await store.list()).toEqual(before);
    });

    it('does not checkpoint a projection outage and succeeds on redelivery', async () => {
        const durableStore = new PostgresProjectionStore(pool);
        const checkpointStore = new InMemoryCheckpointStore();
        let unavailable = true;
        const pipeline = new IndexerPipeline({
            checkpointStore,
            checkpointInterval: 1,
            projectionStore: {
                apply: async event => {
                    if (unavailable) throw new Error('database unavailable');
                    await durableStore.apply(event);
                },
            },
            deadLetterStore: new PostgresDeadLetterStore(pool),
        });
        const raw: Record<string, unknown> = {
            ...(buildPhase3FixtureFirehoseEvents()[0] as Record<string, unknown>),
            seq: 160,
        };

        await expect(pipeline.ingestAndCheckpoint([raw])).rejects.toThrow(
            'database unavailable',
        );
        expect(await checkpointStore.load()).toBeNull();

        unavailable = false;
        await pipeline.ingestAndCheckpoint([raw]);
        expect(await durableStore.get(String(raw.uri))).toMatchObject({
            sourceCursor: 160,
        });
        expect((await checkpointStore.load())?.cursor).toBe(160);
    });
});
