-- A public address/schedule is not evidence of current service availability.
ALTER TABLE public.indexer_directory_resource_projections
    DROP CONSTRAINT indexer_directory_resource_projections_operational_status_check;
ALTER TABLE public.indexer_directory_resource_projections
    ADD CONSTRAINT indexer_directory_resource_projections_operational_status_check
    CHECK (operational_status IN ('open', 'limited', 'closed', 'unknown'));
ALTER TABLE jetstream_v2_shadow.indexer_directory_resource_projections
    DROP CONSTRAINT indexer_directory_resource_projections_operational_status_check;
ALTER TABLE jetstream_v2_shadow.indexer_directory_resource_projections
    ADD CONSTRAINT indexer_directory_resource_projections_operational_status_check
    CHECK (operational_status IN ('open', 'limited', 'closed', 'unknown'));
