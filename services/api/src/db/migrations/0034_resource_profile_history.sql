CREATE TABLE resource_service_profile_history (
    resource_uri TEXT NOT NULL REFERENCES public_resource_listings(resource_uri),
    revision INTEGER NOT NULL,
    profile JSONB NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(resource_uri,revision)
);
INSERT INTO resource_service_profile_history(resource_uri,revision,profile,recorded_at)
SELECT resource_uri,revision,profile,updated_at FROM resource_service_profiles;
CREATE FUNCTION retain_resource_service_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO resource_service_profile_history(resource_uri,revision,profile,recorded_at)
    VALUES(OLD.resource_uri,OLD.revision,OLD.profile,OLD.updated_at)
    ON CONFLICT(resource_uri,revision) DO NOTHING;
    RETURN NEW;
END;
$$;
CREATE TRIGGER resource_service_profile_history_before_update
BEFORE UPDATE ON resource_service_profiles FOR EACH ROW EXECUTE FUNCTION retain_resource_service_profile();
