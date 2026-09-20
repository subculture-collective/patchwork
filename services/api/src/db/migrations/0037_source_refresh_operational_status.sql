CREATE TABLE IF NOT EXISTS source_refresh_operational_status (
    source_id TEXT PRIMARY KEY,
    last_attempt_at TIMESTAMPTZ NOT NULL,
    last_attempt_succeeded BOOLEAN NOT NULL,
    last_success_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT source_refresh_operational_source_id CHECK (source_id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    CONSTRAINT source_refresh_success_order CHECK (last_success_at IS NULL OR last_success_at <= updated_at)
);

COMMENT ON TABLE source_refresh_operational_status IS
    'Mutable operational heartbeat for unattended source refreshes; publisher evidence remains in append-only run tables and immutable files.';
