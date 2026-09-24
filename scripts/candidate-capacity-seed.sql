-- Run only against the separate patchwork-candidate database. Synthetic projections never publish to AT.
BEGIN;
INSERT INTO indexer_aid_post_projections
(uri, collection, author_did_hash, title, description, category, urgency, status, searchable_text,
 latitude, longitude, precision_km, record_created_at, record_updated_at, source_cursor, source_event_id, record_origin, seed_version)
SELECT 'at://did:plc:candidate-capacity/app.patchwork.aid.post/' || n, 'app.patchwork.aid.post', repeat('a',64),
 'Testing request ' || n, 'Synthetic capacity qualification record; not a real request.',
 (ARRAY['food','shelter','medical','transport','childcare','other'])[1 + n % 6],
 (ARRAY['low','medium','high','critical'])[1 + n % 4], 'open', 'testing request synthetic capacity qualification',
 41.70 + (n % 60) * .005, -87.95 + (n % 80) * .005, 3,
 NOW() - (n % 168) * INTERVAL '1 hour', NOW() - (n % 48) * INTERVAL '1 hour', 0, 'candidate-capacity-' || n,
 'synthetic', 'candidate-capacity-20260906'
FROM generate_series(1,10000) n ON CONFLICT (uri) DO NOTHING;
INSERT INTO indexer_directory_resource_projections
(uri, collection, author_did_hash, name, service_area, category, verification_status, contact, searchable_text,
 latitude, longitude, precision_km, operational_status, record_created_at, record_updated_at, source_cursor, source_event_id, record_origin, seed_version)
SELECT 'at://did:plc:candidate-capacity/app.patchwork.directory.resource/' || n, 'app.patchwork.directory.resource', repeat('b',64),
 'Testing resource ' || n, 'Cook County testing area', 'food-bank', 'unverified', '{"url":"https://example.invalid"}'::jsonb,
 'testing resource synthetic capacity qualification', 41.70 + (n % 60) * .005, -87.95 + (n % 80) * .005, 3, 'open',
 NOW(), NOW(), 0, 'candidate-resource-capacity-' || n, 'synthetic', 'candidate-capacity-20260906'
FROM generate_series(1,1000) n ON CONFLICT (uri) DO NOTHING;
COMMIT;
ANALYZE indexer_aid_post_projections;
ANALYZE indexer_directory_resource_projections;
