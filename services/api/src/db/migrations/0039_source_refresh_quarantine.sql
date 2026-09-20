CREATE TABLE source_refresh_quarantines (
    quarantine_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL CHECK(source_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    adapter_version TEXT NOT NULL,
    reason_code TEXT NOT NULL CHECK(reason_code='publisher-contract'),
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cleared_at TIMESTAMPTZ,
    clearance_reason TEXT,
    CHECK((cleared_at IS NULL AND clearance_reason IS NULL)
        OR (cleared_at IS NOT NULL AND clearance_reason IS NOT NULL
            AND char_length(clearance_reason) BETWEEN 20 AND 1000))
);
CREATE UNIQUE INDEX source_refresh_active_quarantine ON source_refresh_quarantines(source_id)
    WHERE cleared_at IS NULL;
