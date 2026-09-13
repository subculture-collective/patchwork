CREATE TABLE resource_corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_uri TEXT NOT NULL REFERENCES public_resource_listings(resource_uri),
    reporter_did TEXT,
    receipt_hash TEXT NOT NULL UNIQUE,
    submission_hash TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('contact','hours','access','closure','other')),
    explanation TEXT NOT NULL,
    source_url TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','needs-information','applied','denied','duplicate')),
    revision INTEGER NOT NULL DEFAULT 1,
    response TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retention_until TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '2 years'
);
CREATE INDEX resource_corrections_review ON resource_corrections(status,submitted_at,id);
CREATE INDEX resource_corrections_retention ON resource_corrections(retention_until);
CREATE INDEX resource_corrections_reporter ON resource_corrections(reporter_did,submitted_at);
CREATE TABLE resource_correction_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    correction_id UUID NOT NULL REFERENCES resource_corrections(id) ON DELETE CASCADE,
    actor_did TEXT,
    revision INTEGER NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(correction_id,revision)
);
