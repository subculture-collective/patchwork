-- Legacy/unlocated imports may appear in Latest, but never acquire a fake map point.
ALTER TABLE indexer_aid_post_projections ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE indexer_aid_post_projections ALTER COLUMN longitude DROP NOT NULL;
ALTER TABLE indexer_aid_post_projections ALTER COLUMN precision_km DROP NOT NULL;
ALTER TABLE indexer_aid_post_projections ADD CONSTRAINT aid_projection_complete_location CHECK (
    (latitude IS NULL AND longitude IS NULL AND precision_km IS NULL) OR
    (latitude IS NOT NULL AND longitude IS NOT NULL AND precision_km IS NOT NULL)
);
