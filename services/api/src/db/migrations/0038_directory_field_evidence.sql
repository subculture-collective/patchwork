-- Additive directory model. No public discovery or ownership views change.

CREATE TABLE directory_organizations (
    id TEXT PRIMARY KEY CHECK(char_length(id) BETWEEN 1 AND 800),
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE directory_places (
    id TEXT PRIMARY KEY CHECK(char_length(id) BETWEEN 1 AND 800),
    visibility TEXT NOT NULL CHECK(visibility IN ('public','confidential')),
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE directory_services (
    id TEXT PRIMARY KEY CHECK(char_length(id) BETWEEN 1 AND 800),
    organization_id TEXT REFERENCES directory_organizations(id),
    delivery TEXT NOT NULL CHECK(delivery IN ('in-person','remote','hybrid','unknown')),
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE directory_service_locations (
    id TEXT PRIMARY KEY CHECK(char_length(id) BETWEEN 1 AND 800),
    service_id TEXT NOT NULL REFERENCES directory_services(id),
    place_id TEXT NOT NULL REFERENCES directory_places(id),
    UNIQUE(service_id,place_id),
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE directory_assertions (
    id TEXT PRIMARY KEY CHECK(char_length(id) BETWEEN 1 AND 800),
    organization_id TEXT REFERENCES directory_organizations(id),
    place_id TEXT REFERENCES directory_places(id),
    service_id TEXT REFERENCES directory_services(id),
    service_location_id TEXT REFERENCES directory_service_locations(id),
    CHECK(num_nonnulls(organization_id,place_id,service_id,service_location_id)=1),
    field TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT NOT NULL CHECK(source_url ~ '^https?://'),
    raw_sha256 TEXT CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'),
    observed_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    review_state TEXT NOT NULL CHECK(review_state IN ('pending','reviewed','rejected')),
    conflict_state TEXT NOT NULL CHECK(conflict_state IN ('none','open','resolved')),
    CHECK(review_state <> 'reviewed' OR (confirmed_at IS NOT NULL AND expires_at IS NOT NULL)),
    CHECK(expires_at IS NULL OR (confirmed_at IS NOT NULL AND expires_at > confirmed_at)),
    payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
    content_sha256 TEXT NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX directory_assertion_service ON directory_assertions(service_id,field);
CREATE INDEX directory_assertion_place ON directory_assertions(place_id,field);
CREATE INDEX directory_assertion_delivery ON directory_assertions(service_location_id,field);
CREATE INDEX directory_assertion_organization ON directory_assertions(organization_id,field);
CREATE INDEX directory_assertion_source ON directory_assertions(source_id,raw_sha256);
