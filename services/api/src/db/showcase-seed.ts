import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadApiConfig } from '@patchwork/shared';
import type { Pool, PoolClient } from 'pg';
import { createPostgresPool } from './discovery-events.js';

export const SHOWCASE_SEED_VERSION = 'chicagoland-demo-2026-09-04-v2';
const SEEDED_AT = '2026-09-04T12:00:00.000Z';
const RETENTION_UNTIL = '2027-09-04T12:00:00.000Z';
const SOURCE_URL = 'https://cloud.citynews.chicago.gov/Newsletter';
const REQUESTER_DID = 'did:plc:showcase-requester';
const HELPER_DID = 'did:plc:showcase-helper';
const VOLUNTEER_DID = 'did:plc:showcase-volunteer';
const SYSTEM_DID = 'did:plc:patchwork-showcase-system';
const REQUEST_URI =
    `at://${REQUESTER_DID}/app.patchwork.aid.post/showcase-grocery-delivery`;
const DIRECTORY_URI =
    `at://${SYSTEM_DID}/app.patchwork.directory.resource/showcase-pantry`;
const VOLUNTEER_URI =
    `at://${VOLUNTEER_DID}/app.patchwork.volunteer.profile/showcase-profile`;
const SYNTHETIC_ORG_ID = '10000000-0000-4000-8000-000000000001';
const SOURCED_ORG_ID = '20000000-0000-4000-8000-000000000002';
const OFFER_ID = '30000000-0000-4000-8000-000000000003';
const CONNECTION_ID = '40000000-0000-4000-8000-000000000004';
const FEEDBACK_ID = '50000000-0000-4000-8000-000000000005';
const NOTIFICATION_ID = '60000000-0000-4000-8000-000000000006';

const additionalAidSeeds = [
    {
        slug: 'cook-austin-grocery-pickup',
        title: 'Grocery pickup near Austin',
        description: 'A fictional neighbor needs a grocery pickup before Friday evening.',
        category: 'food', urgency: 'high', status: 'open',
        area: 'Austin, Chicago · Cook County', latitude: 41.895, longitude: -87.765, precisionKm: 3,
    },
    {
        slug: 'cook-cicero-clinic-ride',
        title: 'Ride to a clinic near Cicero',
        description: 'A fictional neighbor is looking for a round-trip ride to a daytime appointment.',
        category: 'transport', urgency: 'medium', status: 'open',
        area: 'Cicero · Cook County', latitude: 41.845, longitude: -87.754, precisionKm: 3,
    },
    {
        slug: 'cook-rogers-park-winter-coat',
        title: 'Warm coat needed in Rogers Park',
        description: 'A fictional family is seeking a clean adult winter coat in a medium size.',
        category: 'other', urgency: 'medium', status: 'open',
        area: 'Rogers Park, Chicago · Cook County', latitude: 42.010, longitude: -87.670, precisionKm: 3,
    },
    {
        slug: 'cook-evanston-childcare-swap',
        title: 'After-school childcare swap',
        description: 'Two fictional households want to coordinate a one-afternoon childcare exchange.',
        category: 'childcare', urgency: 'low', status: 'open',
        area: 'Evanston · Cook County', latitude: 42.046, longitude: -87.687, precisionKm: 4,
    },
    {
        slug: 'cook-south-shore-ramp-help',
        title: 'Help moving a portable ramp',
        description: 'A fictional resident needs two people to move a lightweight accessibility ramp.',
        category: 'medical', urgency: 'high', status: 'in-progress',
        area: 'South Shore, Chicago · Cook County', latitude: 41.760, longitude: -87.575, precisionKm: 4,
    },
    {
        slug: 'cook-oak-park-pet-supplies',
        title: 'Temporary pet food supply',
        description: 'A fictional neighbor could use one week of sealed cat food while between paychecks.',
        category: 'food', urgency: 'medium', status: 'open',
        area: 'Oak Park · Cook County', latitude: 41.885, longitude: -87.784, precisionKm: 3,
    },
    {
        slug: 'dupage-wheaton-pantry-pickup',
        title: 'Pantry pickup in Wheaton',
        description: 'A fictional household needs help collecting a prepaid pantry order this weekend.',
        category: 'food', urgency: 'high', status: 'open',
        area: 'Wheaton · DuPage County', latitude: 41.866, longitude: -88.107, precisionKm: 4,
    },
    {
        slug: 'dupage-naperville-medical-ride',
        title: 'Morning medical ride in Naperville',
        description: 'A fictional older adult is seeking a ride to and from a morning appointment.',
        category: 'transport', urgency: 'medium', status: 'open',
        area: 'Naperville · DuPage County', latitude: 41.750, longitude: -88.153, precisionKm: 5,
    },
    {
        slug: 'dupage-glen-ellyn-moving-boxes',
        title: 'Moving boxes and packing tape',
        description: 'A fictional renter is looking for reusable moving boxes and two rolls of tape.',
        category: 'shelter', urgency: 'low', status: 'open',
        area: 'Glen Ellyn · DuPage County', latitude: 41.877, longitude: -88.068, precisionKm: 3,
    },
    {
        slug: 'dupage-lombard-yard-help',
        title: 'One-hour outdoor cleanup help',
        description: 'A fictional neighbor with limited mobility needs help gathering light yard debris.',
        category: 'medical', urgency: 'medium', status: 'in-progress',
        area: 'Lombard · DuPage County', latitude: 41.880, longitude: -88.007, precisionKm: 4,
    },
    {
        slug: 'dupage-downers-grove-childcare',
        title: 'Childcare during a job interview',
        description: 'A fictional parent needs two hours of daytime childcare during an interview.',
        category: 'childcare', urgency: 'high', status: 'open',
        area: 'Downers Grove · DuPage County', latitude: 41.795, longitude: -88.010, precisionKm: 4,
    },
    {
        slug: 'dupage-west-chicago-blankets',
        title: 'Blankets for a temporary stay',
        description: 'A fictional household is seeking two clean blankets for temporary lodging.',
        category: 'shelter', urgency: 'medium', status: 'open',
        area: 'West Chicago · DuPage County', latitude: 41.884, longitude: -88.204, precisionKm: 5,
    },
] as const;

const additionalResourceSeeds = [
    { slug: 'cook-oak-park-food-pickup', name: 'Patchwork Demo Food Pickup', area: 'Oak Park · Cook County', category: 'food-bank', latitude: 41.885, longitude: -87.784, precisionKm: 3, hours: 'Demo hours: Tue and Thu, 10–2' },
    { slug: 'cook-cicero-welcome-center', name: 'Patchwork Demo Welcome Center', area: 'Cicero · Cook County', category: 'shelter', latitude: 41.845, longitude: -87.754, precisionKm: 3, hours: 'Demo hours: daily, 8–6' },
    { slug: 'cook-evanston-health-navigation', name: 'Patchwork Demo Health Navigation', area: 'Evanston · Cook County', category: 'clinic', latitude: 42.046, longitude: -87.687, precisionKm: 4, hours: 'Demo hours: Mon–Fri, 9–5' },
    { slug: 'cook-chicago-heights-tenant-desk', name: 'Patchwork Demo Tenant Help Desk', area: 'Chicago Heights · Cook County', category: 'legal-aid', latitude: 41.506, longitude: -87.635, precisionKm: 5, hours: 'Demo hours: Wed, 12–7' },
    { slug: 'dupage-wheaton-food-shelf', name: 'Patchwork Demo Food Shelf', area: 'Wheaton · DuPage County', category: 'food-bank', latitude: 41.866, longitude: -88.107, precisionKm: 4, hours: 'Demo hours: Mon, Wed and Sat' },
    { slug: 'dupage-naperville-welcome-desk', name: 'Patchwork Demo Overnight Welcome Desk', area: 'Naperville · DuPage County', category: 'shelter', latitude: 41.750, longitude: -88.153, precisionKm: 5, hours: 'Demo hours: daily, 5–10' },
    { slug: 'dupage-lombard-clinic-guide', name: 'Patchwork Demo Clinic Guide', area: 'Lombard · DuPage County', category: 'clinic', latitude: 41.880, longitude: -88.007, precisionKm: 4, hours: 'Demo hours: Mon–Fri, 8–4' },
    { slug: 'dupage-downers-grove-family-law', name: 'Patchwork Demo Family Legal Desk', area: 'Downers Grove · DuPage County', category: 'legal-aid', latitude: 41.795, longitude: -88.010, precisionKm: 4, hours: 'Demo hours: Tue and Thu, 1–6' },
] as const;

const additionalVolunteerSeeds = [
    { slug: 'cook-maya-example', name: 'Maya Example', bio: 'Fictional volunteer available for food pickup and short errands.', area: 'Oak Park and Austin · Cook County', capabilities: ['errands', 'delivery'], skills: ['grocery-shopping', 'car'], languages: ['en', 'es'], availability: 'within-24h', latitude: 41.890, longitude: -87.775, precisionKm: 6 },
    { slug: 'cook-luis-example', name: 'Luis Example', bio: 'Fictional bilingual volunteer offering translation and appointment accompaniment.', area: 'Cicero and Berwyn · Cook County', capabilities: ['companionship', 'translation'], skills: ['appointment-support'], languages: ['en', 'es'], availability: 'scheduled', latitude: 41.850, longitude: -87.785, precisionKm: 6 },
    { slug: 'cook-nia-example', name: 'Nia Example', bio: 'Fictional volunteer available for childcare swaps and supply coordination.', area: 'South Side Chicago · Cook County', capabilities: ['childcare', 'coordination'], skills: ['family-support'], languages: ['en'], availability: 'scheduled', latitude: 41.760, longitude: -87.620, precisionKm: 8 },
    { slug: 'dupage-priya-example', name: 'Priya Example', bio: 'Fictional volunteer offering rides and grocery delivery on weekends.', area: 'Wheaton and Glen Ellyn · DuPage County', capabilities: ['transport', 'delivery'], skills: ['car', 'grocery-shopping'], languages: ['en', 'hi'], availability: 'scheduled', latitude: 41.870, longitude: -88.085, precisionKm: 7 },
    { slug: 'dupage-sam-example', name: 'Sam Example', bio: 'Fictional volunteer available for light moving and outdoor tasks.', area: 'Lombard and Downers Grove · DuPage County', capabilities: ['moving', 'yard-help'], skills: ['lifting', 'basic-tools'], languages: ['en'], availability: 'within-24h', latitude: 41.840, longitude: -88.010, precisionKm: 7 },
    { slug: 'dupage-evan-example', name: 'Evan Example', bio: 'Fictional volunteer offering technology help and resource navigation.', area: 'Naperville and West Chicago · DuPage County', capabilities: ['technology', 'navigation'], skills: ['forms', 'device-setup'], languages: ['en'], availability: 'scheduled', latitude: 41.820, longitude: -88.180, precisionKm: 9 },
] as const;

const metadata: ReadonlyArray<readonly [string, string, 'synthetic' | 'sourced-public']> = [
    ['person', REQUESTER_DID, 'synthetic'],
    ['person', HELPER_DID, 'synthetic'],
    ['person', VOLUNTEER_DID, 'synthetic'],
    ['aid-post', REQUEST_URI, 'synthetic'],
    ['directory-resource', DIRECTORY_URI, 'synthetic'],
    ['volunteer-profile', VOLUNTEER_URI, 'synthetic'],
    ['request-workflow', REQUEST_URI, 'synthetic'],
    ['lifecycle-event', 'showcase-handoff-completed', 'synthetic'],
    ['coordination-offer', OFFER_ID, 'synthetic'],
    ['coordination-connection', CONNECTION_ID, 'synthetic'],
    ['outcome', FEEDBACK_ID, 'synthetic'],
    ['organization', SYNTHETIC_ORG_ID, 'synthetic'],
    ['organization', SOURCED_ORG_ID, 'sourced-public'],
    ['moderation-case', REQUEST_URI, 'synthetic'],
    ['notification', NOTIFICATION_ID, 'synthetic'],
    ...additionalAidSeeds.map(seed => [
        'aid-post',
        `at://${REQUESTER_DID}/app.patchwork.aid.post/${seed.slug}`,
        'synthetic',
    ] as const),
    ...additionalResourceSeeds.map(seed => [
        'directory-resource',
        `at://${SYSTEM_DID}/app.patchwork.directory.resource/${seed.slug}`,
        'synthetic',
    ] as const),
    ...additionalVolunteerSeeds.map(seed => [
        'volunteer-profile',
        `at://${VOLUNTEER_DID}/app.patchwork.volunteer.profile/${seed.slug}`,
        'synthetic',
    ] as const),
];

const manifestSha256 = createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex');

export interface ShowcaseSeedResult {
    seedVersion: string;
    manifestSha256: string;
    metadataRecords: number;
}

const didHash = (did: string): string =>
    createHash('sha256').update(did).digest('hex');

const assertNoVisitorCollision = async (
    client: PoolClient,
    table: string,
    keyColumn: string,
    key: string,
    entityType: string,
): Promise<void> => {
    const result = await client.query<{ tagged: boolean }>(
        `SELECT EXISTS (
             SELECT 1 FROM showcase_record_metadata
             WHERE entity_type = $2 AND entity_key = $1
               AND origin IN ('synthetic', 'sourced-public')
         ) AS tagged
         FROM ${table}
         WHERE ${keyColumn}::text = $1`,
        [key, entityType],
    );
    if (result.rows[0]?.tagged === false) {
        throw new Error(
            `SHOWCASE_KEY_COLLISION: refusing to replace untagged ${entityType} ${key}`,
        );
    }
};

const insertMetadata = async (client: PoolClient): Promise<void> => {
    for (const [entityType, entityKey, origin] of metadata) {
        await client.query(
            `INSERT INTO showcase_record_metadata (
                 entity_type, entity_key, origin, seed_version,
                 source_name, source_url, source_retrieved_at,
                 source_last_verified_at, non_participation_disclosure,
                 assigned_at
             ) VALUES (
                 $1, $2, $3, $4,
                 CASE WHEN $3 = 'sourced-public'
                      THEN 'City of Chicago' END,
                 CASE WHEN $3 = 'sourced-public' THEN $5 END,
                 CASE WHEN $3 = 'sourced-public' THEN $6::timestamptz END,
                 CASE WHEN $3 = 'sourced-public' THEN $6::timestamptz END,
                 $3 = 'sourced-public', $6
             )`,
            [
                entityType,
                entityKey,
                origin,
                SHOWCASE_SEED_VERSION,
                SOURCE_URL,
                SEEDED_AT,
            ],
        );
    }
};

export const seedBuyerReadyShowcase = async (
    pool: Pool,
): Promise<ShowcaseSeedResult> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtext('patchwork-showcase-seed'))`,
        );

        for (const [table, keyColumn, key, entityType] of [
            ['indexer_aid_post_projections', 'uri', REQUEST_URI, 'aid-post'],
            [
                'indexer_directory_resource_projections',
                'uri',
                DIRECTORY_URI,
                'directory-resource',
            ],
            [
                'indexer_volunteer_profile_projections',
                'uri',
                VOLUNTEER_URI,
                'volunteer-profile',
            ],
            ['request_workflows', 'post_uri', REQUEST_URI, 'request-workflow'],
            ['coordination_offers', 'offer_id', OFFER_ID, 'coordination-offer'],
            [
                'coordination_connections',
                'connection_id',
                CONNECTION_ID,
                'coordination-connection',
            ],
            [
                'coordination_outcome_feedback',
                'feedback_id',
                FEEDBACK_ID,
                'outcome',
            ],
            [
                'organizations',
                'organization_id',
                SYNTHETIC_ORG_ID,
                'organization',
            ],
            [
                'organizations',
                'organization_id',
                SOURCED_ORG_ID,
                'organization',
            ],
            [
                'notification_intents',
                'notification_id',
                NOTIFICATION_ID,
                'notification',
            ],
        ] as const) {
            await assertNoVisitorCollision(
                client,
                table,
                keyColumn,
                key,
                entityType,
            );
        }

        for (const seed of additionalAidSeeds) {
            await assertNoVisitorCollision(
                client,
                'indexer_aid_post_projections',
                'uri',
                `at://${REQUESTER_DID}/app.patchwork.aid.post/${seed.slug}`,
                'aid-post',
            );
        }
        for (const seed of additionalResourceSeeds) {
            await assertNoVisitorCollision(
                client,
                'indexer_directory_resource_projections',
                'uri',
                `at://${SYSTEM_DID}/app.patchwork.directory.resource/${seed.slug}`,
                'directory-resource',
            );
        }
        for (const seed of additionalVolunteerSeeds) {
            await assertNoVisitorCollision(
                client,
                'indexer_volunteer_profile_projections',
                'uri',
                `at://${VOLUNTEER_DID}/app.patchwork.volunteer.profile/${seed.slug}`,
                'volunteer-profile',
            );
        }

        await client.query(
            `DELETE FROM moderation_queue_items
             WHERE seed_version = $1 AND record_origin = 'synthetic'`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM notification_intents n
             USING showcase_record_metadata m
             WHERE m.entity_type = 'notification'
               AND m.entity_key = n.notification_id::text
               AND m.seed_version = $1`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM request_workflows w
             USING showcase_record_metadata m
             WHERE m.entity_type = 'request-workflow'
               AND m.entity_key = w.post_uri AND m.seed_version = $1`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM organizations o
             USING showcase_record_metadata m
             WHERE m.entity_type = 'organization'
               AND m.entity_key = o.organization_id::text
               AND m.seed_version = $1`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM indexer_aid_post_projections
             WHERE seed_version = $1 AND record_origin = 'synthetic'`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM indexer_directory_resource_projections
             WHERE seed_version = $1 AND record_origin = 'synthetic';
            `,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM indexer_volunteer_profile_projections
             WHERE seed_version = $1 AND record_origin = 'synthetic'`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM account_preferences
             WHERE did IN (
                 SELECT entity_key FROM showcase_record_metadata
                 WHERE entity_type = 'person' AND seed_version = $1
             )`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM account_policy_consents
             WHERE did IN (
                 SELECT entity_key FROM showcase_record_metadata
                 WHERE entity_type = 'person' AND seed_version = $1
             )`,
            [SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `DELETE FROM showcase_record_metadata WHERE seed_version = $1`,
            [SHOWCASE_SEED_VERSION],
        );

        await insertMetadata(client);

        for (const [did, privacy, visibility, language, noPermanentAddress] of [
            [REQUESTER_DID, 'community', 'authenticated', 'en', false],
            [HELPER_DID, 'private', 'authenticated', 'es', false],
            [VOLUNTEER_DID, 'public', 'public', 'en', true],
        ] as const) {
            await client.query(
                `INSERT INTO account_policy_consents (
                     did, policy_version, asserted_18_or_older,
                     accepted_documents, accepted_at
                 ) VALUES ($1, '2026-07-28', TRUE, $2, $3)`,
                [
                    did,
                    JSON.stringify([
                        'terms',
                        'privacy',
                        'community-guidelines',
                        'location-safety',
                        'attachment-safety',
                    ]),
                    SEEDED_AT,
                ],
            );
            await client.query(
                `INSERT INTO account_preferences (
                     did, privacy, notifications, visibility, language,
                     location, created_at, updated_at
                 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
                [
                    did,
                    privacy,
                    JSON.stringify({ inApp: true, email: false, push: false }),
                    visibility,
                    language,
                    JSON.stringify({
                        sharing: 'approximate',
                        noPermanentAddress,
                    }),
                    SEEDED_AT,
                ],
            );
        }

        await client.query(
            `INSERT INTO indexer_aid_post_projections (
                 uri, collection, cid, revision, author_did_hash, title,
                 description, category, urgency, status, searchable_text,
                 latitude, longitude, precision_km, record_created_at,
                 record_updated_at, source_cursor, source_event_id,
                 projected_at, record_origin, seed_version
             ) VALUES (
                 $1, 'app.patchwork.aid.post', 'bafyshowcaseaid', '1', $2,
                 'Grocery delivery near the West Side',
                 'A fictional neighbor requests a grocery delivery this week.',
                 'food', 'medium', 'resolved',
                 'grocery delivery west side fictional showcase',
                 41.881, -87.704, 3, $3, $3, 910001,
                 'showcase:aid:1', $3, 'synthetic', $4
             )`,
            [REQUEST_URI, didHash(REQUESTER_DID), SEEDED_AT, SHOWCASE_SEED_VERSION],
        );
        for (const [index, seed] of additionalAidSeeds.entries()) {
            await client.query(
                `INSERT INTO indexer_aid_post_projections (
                     uri, collection, cid, revision, author_did_hash, title,
                     description, category, urgency, status, searchable_text,
                     latitude, longitude, precision_km, record_created_at,
                     record_updated_at, source_cursor, source_event_id,
                     projected_at, record_origin, seed_version
                 ) VALUES (
                     $1, 'app.patchwork.aid.post', $2, '1', $3, $4, $5, $6,
                     $7, $8, $9, $10, $11, $12, $13, $13, $14, $15, $13,
                     'synthetic', $16
                 )`,
                [
                    `at://${REQUESTER_DID}/app.patchwork.aid.post/${seed.slug}`,
                    `bafydemoaid${String(index + 1).padStart(2, '0')}`,
                    didHash(REQUESTER_DID),
                    seed.title,
                    seed.description,
                    seed.category,
                    seed.urgency,
                    seed.status,
                    `${seed.title} ${seed.description} ${seed.area} fictional synthetic demo`.toLowerCase(),
                    seed.latitude,
                    seed.longitude,
                    seed.precisionKm,
                    SEEDED_AT,
                    920001 + index,
                    `showcase:aid:${index + 2}`,
                    SHOWCASE_SEED_VERSION,
                ],
            );
        }
        await client.query(
            `INSERT INTO indexer_directory_resource_projections (
                 uri, collection, cid, revision, author_did_hash, name,
                 service_area, category, verification_status, contact,
                 searchable_text, latitude, longitude, precision_km,
                 open_hours, eligibility_notes, operational_status,
                 record_created_at, record_updated_at, source_cursor,
                 source_event_id, projected_at, record_origin, seed_version
             ) VALUES (
                 $1, 'app.patchwork.directory.resource',
                 'bafyshowcasedirectory', '1', $2,
                 'Patchwork Example Community Pantry',
                 'West Side, Chicago', 'food-bank', 'unverified',
                 '{"url":"https://showcase.invalid/community-pantry"}',
                 'fictional example community pantry west side chicago',
                 41.879, -87.710, 4, 'Example hours: Tue and Thu, 10–2',
                 'Synthetic demonstration listing; confirm all real services independently.',
                 'open', $3, $3, 910002, 'showcase:directory:1', $3,
                 'synthetic', $4
             )`,
            [DIRECTORY_URI, didHash(SYSTEM_DID), SEEDED_AT, SHOWCASE_SEED_VERSION],
        );
        for (const [index, seed] of additionalResourceSeeds.entries()) {
            await client.query(
                `INSERT INTO indexer_directory_resource_projections (
                     uri, collection, cid, revision, author_did_hash, name,
                     service_area, category, verification_status, contact,
                     searchable_text, latitude, longitude, precision_km,
                     open_hours, eligibility_notes, operational_status,
                     record_created_at, record_updated_at, source_cursor,
                     source_event_id, projected_at, record_origin, seed_version
                 ) VALUES (
                     $1, 'app.patchwork.directory.resource', $2, '1', $3,
                     $4, $5, $6, 'unverified', $7, $8, $9, $10, $11, $12,
                     'Synthetic demonstration listing; confirm all real services independently.',
                     'open', $13, $13, $14, $15, $13, 'synthetic', $16
                 )`,
                [
                    `at://${SYSTEM_DID}/app.patchwork.directory.resource/${seed.slug}`,
                    `bafydemoresource${String(index + 1).padStart(2, '0')}`,
                    didHash(SYSTEM_DID),
                    seed.name,
                    seed.area,
                    seed.category,
                    JSON.stringify({ url: `https://showcase.invalid/${seed.slug}` }),
                    `${seed.name} ${seed.area} fictional synthetic demo`.toLowerCase(),
                    seed.latitude,
                    seed.longitude,
                    seed.precisionKm,
                    seed.hours,
                    SEEDED_AT,
                    921001 + index,
                    `showcase:directory:${index + 2}`,
                    SHOWCASE_SEED_VERSION,
                ],
            );
        }
        await client.query(
            `INSERT INTO indexer_volunteer_profile_projections (
                 uri, collection, cid, revision, author_did_hash,
                 display_name, bio, capabilities, availability,
                 contact_preference, skills, languages, service_area_label,
                 no_permanent_address, latitude, longitude, precision_km,
                 searchable_text, record_created_at, record_updated_at,
                 source_cursor, source_event_id, projected_at,
                 record_origin, seed_version
             ) VALUES (
                 $1, 'app.patchwork.volunteer.profile',
                 'bafyshowcasevolunteer', '1', $2, 'Jordan Example',
                 'Fictional volunteer profile for product demonstration.',
                 '["errands","delivery"]', 'within-24h', 'chat-only',
                 '["grocery-shopping","bicycle-delivery"]', '["en","es"]',
                 'Near West Side, Chicago', TRUE, 41.870, -87.660, 5,
                 'jordan example fictional volunteer errands delivery english spanish',
                 $3, $3, 910003, 'showcase:volunteer:1', $3,
                 'synthetic', $4
             )`,
            [VOLUNTEER_URI, didHash(VOLUNTEER_DID), SEEDED_AT, SHOWCASE_SEED_VERSION],
        );
        for (const [index, seed] of additionalVolunteerSeeds.entries()) {
            await client.query(
                `INSERT INTO indexer_volunteer_profile_projections (
                     uri, collection, cid, revision, author_did_hash,
                     display_name, bio, capabilities, availability,
                     contact_preference, skills, languages, service_area_label,
                     no_permanent_address, latitude, longitude, precision_km,
                     searchable_text, record_created_at, record_updated_at,
                     source_cursor, source_event_id, projected_at,
                     record_origin, seed_version
                 ) VALUES (
                     $1, 'app.patchwork.volunteer.profile', $2, '1', $3, $4,
                     $5, $6, $7, 'chat-only', $8, $9, $10, FALSE, $11, $12,
                     $13, $14, $15, $15, $16, $17, $15, 'synthetic', $18
                 )`,
                [
                    `at://${VOLUNTEER_DID}/app.patchwork.volunteer.profile/${seed.slug}`,
                    `bafydemovolunteer${String(index + 1).padStart(2, '0')}`,
                    didHash(VOLUNTEER_DID),
                    seed.name,
                    seed.bio,
                    JSON.stringify(seed.capabilities),
                    seed.availability,
                    JSON.stringify(seed.skills),
                    JSON.stringify(seed.languages),
                    seed.area,
                    seed.latitude,
                    seed.longitude,
                    seed.precisionKm,
                    `${seed.name} ${seed.bio} ${seed.area} ${seed.capabilities.join(' ')} ${seed.languages.join(' ')} fictional synthetic demo`.toLowerCase(),
                    SEEDED_AT,
                    922001 + index,
                    `showcase:volunteer:${index + 2}`,
                    SHOWCASE_SEED_VERSION,
                ],
            );
        }
        await client.query(
            `INSERT INTO indexer_projection_state (
                 singleton, latest_cursor, heartbeat_at
             ) VALUES (TRUE, 922006, $1)
             ON CONFLICT (singleton) DO UPDATE SET
                 latest_cursor = GREATEST(
                     COALESCE(indexer_projection_state.latest_cursor, 0),
                     EXCLUDED.latest_cursor
                 ),
                 heartbeat_at = GREATEST(
                     indexer_projection_state.heartbeat_at,
                     EXCLUDED.heartbeat_at
                 )`,
            [SEEDED_AT],
        );

        await client.query(
            `INSERT INTO request_workflows (
                 post_uri, requester_did, current_status, create_command_id,
                 retention_until, created_at, updated_at, assignment, handoff
             ) VALUES (
                 $1, $2, 'resolved', 'showcase-request-create', $3, $4, $4,
                 $5, $6
             )`,
            [
                REQUEST_URI,
                REQUESTER_DID,
                RETENTION_UNTIL,
                SEEDED_AT,
                JSON.stringify({
                    assigneeDid: HELPER_DID,
                    assignedAt: SEEDED_AT,
                }),
                JSON.stringify({
                    completedAt: SEEDED_AT,
                    summary: 'Synthetic grocery delivery completed.',
                }),
            ],
        );
        await client.query(
            `INSERT INTO request_handoff_events (
                 command_id, post_uri, completed_by, handoff, occurred_at,
                 created_at
             ) VALUES (
                 'showcase-handoff-completed', $1, $2, $3, $4, $4
             )`,
            [
                REQUEST_URI,
                HELPER_DID,
                JSON.stringify({ outcome: 'completed', synthetic: true }),
                SEEDED_AT,
            ],
        );
        await client.query(
            `INSERT INTO coordination_offers (
                 offer_id, request_uri, requester_did, offerer_did, note,
                 status, offered_at, expires_at, decided_at, updated_at
             ) VALUES (
                 $1, $2, $3, $4,
                 'Synthetic offer: I can deliver groceries Thursday.',
                 'accepted', $5, $6, $5, $5
             )`,
            [
                OFFER_ID,
                REQUEST_URI,
                REQUESTER_DID,
                HELPER_DID,
                SEEDED_AT,
                RETENTION_UNTIL,
            ],
        );
        await client.query(
            `INSERT INTO coordination_connections (
                 connection_id, offer_id, request_uri, requester_did,
                 helper_did, status, accepted_at, completed_at, updated_at
             ) VALUES ($1, $2, $3, $4, $5, 'completed', $6, $6, $6)`,
            [
                CONNECTION_ID,
                OFFER_ID,
                REQUEST_URI,
                REQUESTER_DID,
                HELPER_DID,
                SEEDED_AT,
            ],
        );
        await client.query(
            `INSERT INTO coordination_outcome_feedback (
                 feedback_id, connection_id, request_uri, submitter_did,
                 outcome, rating, comment, tags, submitted_at,
                 retention_until
             ) VALUES (
                 $1, $2, $3, $4, 'successful', 5,
                 'Synthetic outcome: groceries arrived as planned.',
                 '["on-time","needs-met"]', $5, $6
             )`,
            [
                FEEDBACK_ID,
                CONNECTION_ID,
                REQUEST_URI,
                REQUESTER_DID,
                SEEDED_AT,
                RETENTION_UNTIL,
            ],
        );

        await client.query(
            `INSERT INTO organizations (
                 organization_id, slug, name, description, origin,
                 source_url, source_retrieved_at, source_last_verified_at,
                 non_endorsement_label, created_by_did, created_at, updated_at
             ) VALUES
             (
                 $1, 'patchwork-example-neighbor-network',
                 'Patchwork Example Neighbor Network',
                 'A fictional organization used only for product demonstration.',
                 'synthetic', NULL, NULL, NULL,
                 'Synthetic example — not a real organization or endorsement.',
                 $3, $4, $4
             ),
             (
                 $2, 'city-of-chicago-dfss',
                 'City of Chicago Department of Family and Support Services',
                 'Public-source reference to Chicago community service-center guidance and referrals.',
                 'sourced-public', $5, $4, $4,
                 'Public-source reference only. This organization does not participate in or endorse Patchwork.',
                 $3, $4, $4
             )`,
            [
                SYNTHETIC_ORG_ID,
                SOURCED_ORG_ID,
                SYSTEM_DID,
                SEEDED_AT,
                SOURCE_URL,
            ],
        );
        await client.query(
            `INSERT INTO organization_memberships (
                 organization_id, member_did, role, status,
                 invited_by_did, joined_at, updated_at
             ) VALUES ($1, $2, 'owner', 'active', $2, $3, $3)`,
            [SYNTHETIC_ORG_ID, HELPER_DID, SEEDED_AT],
        );

        await client.query(
            `INSERT INTO moderation_queue_items (
                 subject_uri, queue_id, subject_type, reasons, latest_reason,
                 report_count, queue_status, visibility, appeal_state,
                 context, created_at, requested_at, updated_at, priority,
                 reason_codes, safe_preview, automated_decision,
                 record_origin, seed_version
             ) VALUES (
                 $1, 'showcase-moderation-case', 'aid-post',
                 '["showcase-policy-review"]', 'showcase-policy-review', 1,
                 'queued', 'suspended', 'none', '{}', $2, $2, $2, 'high',
                 '["sensitive-data-review"]',
                 '{"title":"Synthetic request held for review","category":"food"}',
                 'quarantined', 'synthetic', $3
             )`,
            [REQUEST_URI, SEEDED_AT, SHOWCASE_SEED_VERSION],
        );
        await client.query(
            `INSERT INTO notification_intents (
                 notification_id, recipient_did, notification_type,
                 template_version, title, body, priority, action_url,
                 metadata, deduplication_key, occurred_at, created_at,
                 updated_at, retention_until
             ) VALUES (
                 $1, $2, 'connection_completed', 'v1',
                 'Synthetic connection completed',
                 'The showcase grocery-delivery connection is complete.',
                 'normal', '/inbox', '{"showcase":true}',
                 'showcase:connection-completed', $3, $3, $3, $4
             )`,
            [NOTIFICATION_ID, REQUESTER_DID, SEEDED_AT, RETENTION_UNTIL],
        );

        await client.query(
            `INSERT INTO showcase_seed_runs (
                 seed_version, manifest_sha256, applied_at, record_count
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (seed_version) DO UPDATE SET
                 manifest_sha256 = EXCLUDED.manifest_sha256,
                 applied_at = EXCLUDED.applied_at,
                 record_count = EXCLUDED.record_count`,
            [
                SHOWCASE_SEED_VERSION,
                manifestSha256,
                SEEDED_AT,
                metadata.length,
            ],
        );
        await client.query('COMMIT');
        return {
            seedVersion: SHOWCASE_SEED_VERSION,
            manifestSha256,
            metadataRecords: metadata.length,
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const resolveDatabaseUrl = (): string => {
    const config = loadApiConfig();
    const databaseUrl = config.API_DATABASE_URL ?? config.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error(
            'API_DATABASE_URL (or DATABASE_URL) must be set to seed the showcase.',
        );
    }
    return databaseUrl;
};

const isExecutedDirectly =
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isExecutedDirectly) {
    const pool = createPostgresPool(resolveDatabaseUrl());
    seedBuyerReadyShowcase(pool)
        .then(result => {
            console.log(
                `[api:db:seed:showcase] version=${result.seedVersion} records=${result.metadataRecords} manifest=${result.manifestSha256}`,
            );
        })
        .catch(error => {
            console.error('[api:db:seed:showcase] failed:', error);
            process.exitCode = 1;
        })
        .finally(async () => {
            await pool.end();
        });
}
