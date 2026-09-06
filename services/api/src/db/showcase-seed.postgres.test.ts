import { REGIONAL_SEED_VERSION, regionalAreas } from './chicagoland-seed.js';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountPrivacyService } from '../account-privacy-service.js';
import {
    SHOWCASE_SEED_VERSION,
    seedBuyerReadyShowcase,
} from './showcase-seed.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const visitorUri =
    'at://did:plc:showcase-visitor-sentinel/app.patchwork.aid.post/visitor';

describePostgres('buyer-ready showcase seed', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeEach(async () => {
        await pool.query(
            `DELETE FROM indexer_aid_post_projections WHERE uri = $1`,
            [visitorUri],
        );
    });

    afterAll(async () => {
        await pool.query(
            `DELETE FROM indexer_aid_post_projections WHERE uri = $1`,
            [visitorUri],
        );
        await pool.end();
    });

    it('is deterministic and idempotent without replacing visitor records', async () => {
        const first = await seedBuyerReadyShowcase(pool);
        await pool.query(
            `INSERT INTO indexer_aid_post_projections (
                 uri, collection, author_did_hash, title, description,
                 category, urgency, status, searchable_text, latitude,
                 longitude, precision_km, record_created_at,
                 record_updated_at, source_cursor, source_event_id
             ) VALUES (
                 $1, 'app.patchwork.aid.post',
                 repeat('a', 64), 'Visitor sentinel', 'Must survive refresh.',
                 'other', 'low', 'open', 'visitor sentinel',
                 41.8, -87.7, 2, NOW(), NOW(), 999999,
                 'visitor-sentinel'
             )`,
            [visitorUri],
        );
        const replay = await seedBuyerReadyShowcase(pool);

        expect(replay).toEqual(first);
        expect(first).toMatchObject({
            seedVersion: SHOWCASE_SEED_VERSION,
            metadataRecords: 1065,
        });
        const counts = await pool.query<{
            origin: string;
            count: string;
        }>(
            `SELECT origin, COUNT(*)::text AS count
             FROM showcase_record_metadata
             WHERE seed_version = $1
             GROUP BY origin ORDER BY origin`,
            [SHOWCASE_SEED_VERSION],
        );
        expect(counts.rows).toEqual([
            { origin: 'sourced-public', count: '1' },
            { origin: 'synthetic', count: '40' },
        ]);
        expect(
            (
                await pool.query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count
                     FROM indexer_aid_post_projections
                     WHERE uri = $1 AND record_origin = 'visitor-created'
                       AND seed_version IS NULL`,
                    [visitorUri],
                )
            ).rows[0]?.count,
        ).toBe('1');
    });

    it('uses fictional, non-routable, approximate-only records and attributed public provenance', async () => {
        await seedBuyerReadyShowcase(pool);
        const volunteer = await pool.query<{
            display_name: string;
            precision_km: number;
            no_permanent_address: boolean;
        }>(
            `SELECT display_name, precision_km, no_permanent_address
             FROM indexer_volunteer_profile_projections
             WHERE seed_version = $1`,
            [SHOWCASE_SEED_VERSION],
        );
        expect(volunteer.rows).toHaveLength(7);
        expect(volunteer.rows).toContainEqual({
            display_name: 'Jordan Example',
            precision_km: 5,
            no_permanent_address: true,
        });
        expect(volunteer.rows.every(row => row.precision_km >= 3)).toBe(true);
        const directory = await pool.query<{ contact: { url: string } }>(
            `SELECT contact FROM indexer_directory_resource_projections
             WHERE seed_version = $1`,
            [SHOWCASE_SEED_VERSION],
        );
        expect(directory.rows).toHaveLength(9);
        expect(directory.rows.every(row =>
            /^https:\/\/showcase\.invalid\//.test(row.contact.url),
        )).toBe(true);
        const countyCoverage = await pool.query<{
            county: string;
            aid_count: string;
        }>(
            `SELECT CASE
                        WHEN searchable_text ILIKE '%cook county%' THEN 'Cook'
                        WHEN searchable_text ILIKE '%dupage county%' THEN 'DuPage'
                    END AS county,
                    COUNT(*)::text AS aid_count
             FROM indexer_aid_post_projections
             WHERE seed_version = $1
               AND searchable_text ILIKE ANY (ARRAY['%cook county%', '%dupage county%'])
             GROUP BY county ORDER BY county`,
            [SHOWCASE_SEED_VERSION],
        );
        expect(countyCoverage.rows).toEqual([
            { county: 'Cook', aid_count: '6' },
            { county: 'DuPage', aid_count: '6' },
        ]);
        const sourced = await pool.query<{
            origin: string;
            source_url: string;
            non_endorsement_label: string;
            non_participation_disclosure: boolean;
        }>(
            `SELECT o.origin, o.source_url, o.non_endorsement_label,
                    m.non_participation_disclosure
             FROM organizations o
             JOIN showcase_record_metadata m
               ON m.entity_type = 'organization'
              AND m.entity_key = o.organization_id::text
             WHERE o.origin = 'sourced-public'`,
        );
        expect(sourced.rows).toEqual([
            expect.objectContaining({
                origin: 'sourced-public',
                source_url:
                    'https://cloud.citynews.chicago.gov/Newsletter',
                non_participation_disclosure: true,
                non_endorsement_label: expect.stringContaining(
                    'does not participate',
                ),
            }),
        ]);
    });

    it('seeds hundreds of clearly fictional requests and organizations across all regional areas', async () => {
        await seedBuyerReadyShowcase(pool);
        const posts = await pool.query(`SELECT title, description, latitude, longitude, precision_km FROM indexer_aid_post_projections WHERE seed_version=$1`, [REGIONAL_SEED_VERSION]);
        expect(posts.rows).toHaveLength(512);
        expect(posts.rows.every(row => /Makebelieve|Talltale|Notreal|Fiction|Pretend|Daydream|Whatif|Rainbow/.test(row.title) && row.description.includes('fictional neighbor') && row.precision_km === 5)).toBe(true);
        for (const [city,county,state] of regionalAreas) {
            expect(posts.rows.filter(row => row.description.includes(`${city} · ${county} County, ${state}`))).toHaveLength(8);
        }
        const orgs = await pool.query(`SELECT o.name,o.description,o.origin FROM organizations o JOIN showcase_record_metadata m ON m.entity_type='organization' AND m.entity_key=o.organization_id::text WHERE m.seed_version=$1`, [REGIONAL_SEED_VERSION]);
        expect(orgs.rows).toHaveLength(256);
        expect(orgs.rows.every(row => /Imaginary|Makebelieve|Pretend|Fictional/.test(row.name) && row.origin === 'synthetic')).toBe(true);
        const resources = await pool.query(`SELECT name,contact,verification_status,precision_km FROM indexer_directory_resource_projections WHERE seed_version=$1`, [REGIONAL_SEED_VERSION]);
        expect(resources.rows).toHaveLength(256);
        expect(resources.rows.every(row => new URL(row.contact.url).hostname === 'showcase.invalid' && row.verification_status === 'unverified' && row.precision_km === 5)).toBe(true);
        expect(new Set(regionalAreas.map(([,county,state]) => `${county},${state}`)).size).toBe(14);
    });

    it('keeps origin immutable and refuses an untagged reserved-key collision', async () => {
        await seedBuyerReadyShowcase(pool);
        await expect(
            pool.query(
                `UPDATE showcase_record_metadata
                 SET origin = 'visitor-created', seed_version = NULL
                 WHERE entity_type = 'notification'`,
            ),
        ).rejects.toThrow(/origin metadata is immutable/);

        await pool.query(
            `DELETE FROM showcase_record_metadata
             WHERE entity_type = 'notification'`,
        );
        await expect(seedBuyerReadyShowcase(pool)).rejects.toThrow(
            /SHOWCASE_KEY_COLLISION/,
        );
        await pool.query(
            `DELETE FROM notification_intents
             WHERE notification_id = '60000000-0000-4000-8000-000000000006'`,
        );
        await seedBuyerReadyShowcase(pool);
    });

    it('labels showcase exports and excludes showcase identities from deactivation', async () => {
        await seedBuyerReadyShowcase(pool);
        const privacy = new AccountPrivacyService(pool);
        const exported = await privacy.exportFor(
            'did:plc:showcase-requester',
        );
        expect(exported['subject']).toMatchObject({
            did: 'did:plc:showcase-requester',
            recordOrigin: 'synthetic',
        });
        const exportedAidPosts = (exported['data'] as {
            publicAidPosts: Array<{ recordOrigin: string }>;
        }).publicAidPosts;
        expect(exportedAidPosts).toHaveLength(13);
        expect(exportedAidPosts.every(post => post.recordOrigin === 'synthetic')).toBe(true);
        await expect(
            privacy.deactivate(
                'did:plc:showcase-requester',
                'showcase-deactivation-must-fail',
            ),
        ).rejects.toThrow('SHOWCASE_ACCOUNT_IMMUTABLE');
        expect(
            (
                await pool.query<{ count: string }>(
                    `SELECT COUNT(*)::text AS count
                     FROM account_preferences
                     WHERE did = 'did:plc:showcase-requester'`,
                )
            ).rows[0]?.count,
        ).toBe('1');
    });
});
