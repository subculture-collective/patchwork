-- Existing requests keep the legacy single-helper lifecycle until opted in.
ALTER TABLE request_workflows
    ADD COLUMN helper_capacity INTEGER NOT NULL DEFAULT 1
        CHECK (helper_capacity BETWEEN 1 AND 20),
    ADD COLUMN pickup_configured BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_coordination_connections_request_status
    ON coordination_connections (request_uri, status);

-- Serialize admission on the request even when a caller bypasses the service.
CREATE FUNCTION patchwork_check_pickup_place() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capacity INTEGER; configured BOOLEAN; occupied INTEGER;
BEGIN
    SELECT helper_capacity, pickup_configured INTO capacity, configured
    FROM request_workflows WHERE post_uri = NEW.request_uri FOR UPDATE;
    IF configured AND NEW.status IN ('active', 'completed') THEN
        SELECT count(*) INTO occupied FROM coordination_connections
        WHERE request_uri = NEW.request_uri AND status IN ('active', 'completed')
            AND connection_id <> NEW.connection_id;
        IF occupied >= capacity THEN
            RAISE EXCEPTION 'Pickup helper capacity exceeded' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM coordination_connections
            WHERE request_uri = NEW.request_uri AND helper_did = NEW.helper_did
                AND status IN ('active', 'completed') AND connection_id <> NEW.connection_id) THEN
            RAISE EXCEPTION 'Helper already committed to pickup' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER coordination_pickup_place BEFORE INSERT OR UPDATE
    ON coordination_connections FOR EACH ROW EXECUTE FUNCTION patchwork_check_pickup_place();

CREATE FUNCTION patchwork_check_pickup_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.pickup_configured AND NOT NEW.pickup_configured THEN
        RAISE EXCEPTION 'Pickup mode cannot be disabled' USING ERRCODE = '23514';
    END IF;
    IF NEW.pickup_configured THEN
        IF NEW.helper_capacity < (SELECT count(*) FROM coordination_connections
            WHERE request_uri = NEW.post_uri AND status IN ('active', 'completed')) THEN
            RAISE EXCEPTION 'Capacity below committed places' USING ERRCODE = '23514';
        END IF;
        IF NEW.current_status IN ('resolved', 'archived') AND EXISTS
            (SELECT 1 FROM coordination_connections WHERE request_uri = NEW.post_uri AND status = 'active') THEN
            RAISE EXCEPTION 'Pickup still has active arrangements' USING ERRCODE = '23514';
        END IF;
        IF (NEW.assignment IS DISTINCT FROM OLD.assignment AND NEW.assignment IS NOT NULL)
            OR (NEW.handoff IS DISTINCT FROM OLD.handoff AND NEW.handoff IS NOT NULL) THEN
            RAISE EXCEPTION 'Pickup arrangements require per-helper commands' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER request_pickup_workflow BEFORE UPDATE ON request_workflows
    FOR EACH ROW EXECUTE FUNCTION patchwork_check_pickup_workflow();
