-- Libraries remain available by explicit opt-in while ordinary directory
-- searches focus on direct material-aid resources.
ALTER TABLE public.indexer_directory_resource_projections
    DROP CONSTRAINT indexer_directory_resource_projections_category_check;
ALTER TABLE public.indexer_directory_resource_projections
    ADD CONSTRAINT indexer_directory_resource_projections_category_check
    CHECK (category IN ('food-bank', 'shelter', 'clinic', 'legal-aid', 'hotline', 'library', 'other'));
ALTER TABLE jetstream_v2_shadow.indexer_directory_resource_projections
    DROP CONSTRAINT indexer_directory_resource_projections_category_check;
ALTER TABLE jetstream_v2_shadow.indexer_directory_resource_projections
    ADD CONSTRAINT indexer_directory_resource_projections_category_check
    CHECK (category IN ('food-bank', 'shelter', 'clinic', 'legal-aid', 'hotline', 'library', 'other'));

UPDATE indexer_directory_resource_projections p
SET category = 'library',
    record_updated_at = greatest(NOW(), p.record_updated_at + INTERVAL '1 millisecond')
FROM public_resource_listings l
WHERE l.resource_uri = p.uri
  AND l.source_snapshot->>'sourceId' = 'cpl'
  AND p.category <> 'library';

INSERT INTO public_resource_audit_events(resource_uri,actor_did,action,details)
SELECT l.resource_uri,NULL,'source-category-classified',
       jsonb_build_object('sourceId','cpl','category','library')
FROM public_resource_listings l
WHERE l.source_snapshot->>'sourceId' = 'cpl'
  AND NOT EXISTS (
      SELECT 1 FROM public_resource_audit_events e
      WHERE e.resource_uri=l.resource_uri AND e.action='source-category-classified'
  );
