ALTER TABLE indexer_directory_resource_projections
    DROP CONSTRAINT indexer_directory_seed_origin_consistency;
ALTER TABLE indexer_directory_resource_projections
    ADD CONSTRAINT indexer_directory_seed_origin_consistency CHECK (
        (record_origin IN ('synthetic','sourced-public') AND seed_version IS NOT NULL)
        OR (record_origin <> 'synthetic' AND seed_version IS NULL)
    );
