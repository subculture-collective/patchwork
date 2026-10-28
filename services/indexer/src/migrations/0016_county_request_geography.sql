ALTER TABLE indexer_aid_post_projections ADD COLUMN county_id TEXT
    CHECK (county_id IS NULL OR county_id ~ '^[0-9]{5}$');
ALTER TABLE indexer_aid_post_projections ADD CONSTRAINT aid_location_one_area
    CHECK (county_id IS NULL OR postal_code IS NULL);
CREATE INDEX idx_aid_projection_county ON indexer_aid_post_projections (county_id) WHERE county_id IS NOT NULL;
ALTER TABLE jetstream_v2_shadow.indexer_aid_post_projections ADD COLUMN county_id TEXT
    CHECK (county_id IS NULL OR county_id ~ '^[0-9]{5}$');
ALTER TABLE jetstream_v2_shadow.indexer_aid_post_projections ADD CONSTRAINT aid_location_one_area
    CHECK (county_id IS NULL OR postal_code IS NULL);
