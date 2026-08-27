-- Keep v1 time_us and v2 network seq checkpoints in disjoint namespaces.
ALTER TABLE public.indexer_checkpoints
    ADD COLUMN IF NOT EXISTS cursor_source TEXT;
UPDATE public.indexer_checkpoints
SET cursor_source = 'jetstream-v1-time-us'
WHERE cursor_source IS NULL;
ALTER TABLE public.indexer_checkpoints
    ALTER COLUMN cursor_source SET NOT NULL;
INSERT INTO public.indexer_checkpoints (
    id, cursor, cursor_source, saved_at, sequence
)
SELECT 'jetstream-v1-time-us', cursor, cursor_source, saved_at, sequence
FROM public.indexer_checkpoints
WHERE id = 'default'
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'indexer_checkpoints_cursor_source_check'
          AND conrelid = 'public.indexer_checkpoints'::regclass
    ) THEN
        ALTER TABLE public.indexer_checkpoints
            ADD CONSTRAINT indexer_checkpoints_cursor_source_check CHECK (
                cursor_source IN (
                    'jetstream-v1-time-us', 'jetstream-v2-seq'
                )
            );
    END IF;
END $$;

-- The v2 rebuild writes only here. The public projection remains the rollback target.
CREATE SCHEMA IF NOT EXISTS jetstream_v2_shadow;
CREATE TABLE IF NOT EXISTS public.indexer_network_accounts (
    did_hash TEXT PRIMARY KEY CHECK (did_hash ~ '^[a-f0-9]{64}$'),
    active BOOLEAN NOT NULL,
    status TEXT,
    source_cursor BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_projection_events
    (LIKE public.indexer_projection_events INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_projection_tombstones
    (LIKE public.indexer_projection_tombstones INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_projection_state
    (LIKE public.indexer_projection_state INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_aid_post_projections
    (LIKE public.indexer_aid_post_projections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_directory_resource_projections
    (LIKE public.indexer_directory_resource_projections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_volunteer_profile_projections
    (LIKE public.indexer_volunteer_profile_projections INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_dead_letters
    (LIKE public.indexer_dead_letters INCLUDING ALL);

CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_identity_cache (
    did TEXT PRIMARY KEY,
    handle TEXT,
    source_cursor BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_network_accounts
    (LIKE public.indexer_network_accounts INCLUDING ALL);
CREATE TABLE IF NOT EXISTS jetstream_v2_shadow.indexer_repo_reconciliation_queue (
    did TEXT PRIMARY KEY,
    revision TEXT NOT NULL,
    source_cursor BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'processing', 'complete', 'failed')
    ),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
