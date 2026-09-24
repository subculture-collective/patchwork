CREATE TABLE saved_discovery (
    id UUID PRIMARY KEY,
    owner_did TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('resource','search')),
    identity_hash TEXT NOT NULL,
    resource_uri TEXT,
    search JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((kind='resource' AND resource_uri IS NOT NULL AND search IS NULL)
        OR (kind='search' AND resource_uri IS NULL AND jsonb_typeof(search)='object')),
    UNIQUE(owner_did,identity_hash)
);
CREATE INDEX saved_discovery_owner_order ON saved_discovery(owner_did,created_at,id);
