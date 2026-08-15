-- Control-event state moves into public with the v2 projection at cutover.
CREATE TABLE IF NOT EXISTS public.indexer_identity_cache (
    did TEXT PRIMARY KEY,
    handle TEXT,
    source_cursor BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.indexer_repo_reconciliation_queue (
    did TEXT PRIMARY KEY,
    revision TEXT NOT NULL,
    source_cursor BIGINT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'processing', 'complete', 'failed')
    ),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
