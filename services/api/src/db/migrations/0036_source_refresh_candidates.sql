-- Append-only publisher evidence and review/apply state. Initial import snapshots
-- remain immutable in public_resource_listings.source_snapshot.
CREATE TABLE source_refresh_runs (
    run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id TEXT NOT NULL CHECK (source_id ~ '^[a-z0-9-]{1,80}$'),
    raw_sha256 TEXT NOT NULL CHECK (raw_sha256 ~ '^[a-f0-9]{64}$'),
    normalized_sha256 TEXT NOT NULL CHECK (normalized_sha256 ~ '^[a-f0-9]{64}$'),
    catalog_sha256 TEXT NOT NULL CHECK (catalog_sha256 ~ '^[a-f0-9]{64}$'),
    retrieved_at TIMESTAMPTZ NOT NULL,
    evidence JSONB NOT NULL CHECK (jsonb_typeof(evidence)='object'),
    preview JSONB NOT NULL CHECK (jsonb_typeof(preview)='object'),
    candidate_count INTEGER NOT NULL CHECK (candidate_count>=0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_id,raw_sha256)
);

CREATE TABLE source_refresh_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES source_refresh_runs(run_id),
    resource_uri TEXT NOT NULL,
    disposition TEXT NOT NULL CHECK(disposition IN
        ('unchanged','contact-automation-candidate','review','new-listing-review','missing-review')),
    changed_fields TEXT[] NOT NULL DEFAULT '{}',
    reasons TEXT[] NOT NULL DEFAULT '{}',
    before_value JSONB,
    after_value JSONB,
    evidence JSONB,
    base_revision JSONB,
    candidate_sha256 TEXT NOT NULL CHECK(candidate_sha256 ~ '^[a-f0-9]{64}$'),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','dismissed','superseded')),
    decision_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ,
    UNIQUE(run_id,resource_uri)
);
CREATE INDEX source_refresh_candidate_queue ON source_refresh_candidates(status,disposition,created_at,candidate_id);
CREATE INDEX source_refresh_candidate_resource ON source_refresh_candidates(resource_uri,status,created_at DESC);
