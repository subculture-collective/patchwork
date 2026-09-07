-- Shadow tables were copied before ZIP-only requests and sourced listings.
-- Keep the replay target compatible without changing applied migration history.
ALTER TABLE jetstream_v2_shadow.indexer_aid_post_projections
    ADD COLUMN IF NOT EXISTS postal_code TEXT
    CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$');
ALTER TABLE jetstream_v2_shadow.indexer_aid_post_projections
    ALTER COLUMN latitude DROP NOT NULL,
    ALTER COLUMN longitude DROP NOT NULL,
    ALTER COLUMN precision_km DROP NOT NULL;
ALTER TABLE jetstream_v2_shadow.indexer_aid_post_projections
    ADD CONSTRAINT aid_projection_complete_location CHECK (
        (latitude IS NULL AND longitude IS NULL AND precision_km IS NULL) OR
        (latitude IS NOT NULL AND longitude IS NOT NULL AND precision_km IS NOT NULL)
    );
CREATE INDEX IF NOT EXISTS idx_shadow_aid_post_postal_code
    ON jetstream_v2_shadow.indexer_aid_post_projections
    (postal_code, status, record_updated_at DESC);

ALTER TABLE jetstream_v2_shadow.indexer_directory_resource_projections
    DROP CONSTRAINT indexer_directory_seed_origin_consistency;
ALTER TABLE jetstream_v2_shadow.indexer_directory_resource_projections
    ADD CONSTRAINT indexer_directory_seed_origin_consistency CHECK (
        (record_origin IN ('synthetic', 'sourced-public') AND seed_version IS NOT NULL)
        OR (record_origin <> 'synthetic' AND seed_version IS NULL)
    );
