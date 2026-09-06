-- Bounded public discovery, with separate example/community datasets.
CREATE INDEX IF NOT EXISTS idx_aid_community_latest ON indexer_aid_post_projections (record_updated_at DESC, uri) WHERE record_origin <> 'synthetic';
CREATE INDEX IF NOT EXISTS idx_aid_demo_latest ON indexer_aid_post_projections (record_updated_at DESC, uri) WHERE record_origin = 'synthetic';
CREATE INDEX IF NOT EXISTS idx_directory_community_latest ON indexer_directory_resource_projections (record_updated_at DESC, uri) WHERE record_origin <> 'synthetic';
CREATE INDEX IF NOT EXISTS idx_aid_discovery_latitude ON indexer_aid_post_projections (latitude);
CREATE INDEX IF NOT EXISTS idx_directory_discovery_latitude ON indexer_directory_resource_projections (latitude);
