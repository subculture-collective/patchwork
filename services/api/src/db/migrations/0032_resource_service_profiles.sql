CREATE TABLE resource_service_profiles (
    resource_uri TEXT PRIMARY KEY REFERENCES public_resource_listings(resource_uri),
    profile JSONB NOT NULL CHECK (profile->>'version'='1' AND jsonb_typeof(profile->'services')='array'),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
