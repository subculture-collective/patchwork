-- ZIPs remain text to preserve leading zeros. Legacy projections stay readable.
ALTER TABLE indexer_aid_post_projections
    ADD COLUMN IF NOT EXISTS postal_code TEXT
    CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{5}$');
CREATE INDEX IF NOT EXISTS idx_aid_post_postal_code
    ON indexer_aid_post_projections (postal_code, status, record_updated_at DESC);
