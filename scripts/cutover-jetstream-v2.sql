\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.indexer_checkpoints
        WHERE id = 'jetstream-v2-seq'
          AND cursor_source = 'jetstream-v2-seq'
    ) THEN
        RAISE EXCEPTION 'Jetstream v2 checkpoint is missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = 'jetstream_v1_rollback'
    ) THEN
        RAISE EXCEPTION 'jetstream_v1_rollback already exists';
    END IF;
END $$;

CREATE SCHEMA jetstream_v1_rollback;

CREATE TABLE jetstream_v1_rollback.indexer_projection_events
    (LIKE public.indexer_projection_events INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_projection_tombstones
    (LIKE public.indexer_projection_tombstones INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_projection_state
    (LIKE public.indexer_projection_state INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_aid_post_projections
    (LIKE public.indexer_aid_post_projections INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_directory_resource_projections
    (LIKE public.indexer_directory_resource_projections INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_volunteer_profile_projections
    (LIKE public.indexer_volunteer_profile_projections INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_dead_letters
    (LIKE public.indexer_dead_letters INCLUDING ALL);
CREATE TABLE jetstream_v1_rollback.indexer_network_accounts
    (LIKE public.indexer_network_accounts INCLUDING ALL);

INSERT INTO jetstream_v1_rollback.indexer_projection_events
    SELECT * FROM public.indexer_projection_events;
INSERT INTO jetstream_v1_rollback.indexer_projection_tombstones
    SELECT * FROM public.indexer_projection_tombstones;
INSERT INTO jetstream_v1_rollback.indexer_projection_state
    SELECT * FROM public.indexer_projection_state;
INSERT INTO jetstream_v1_rollback.indexer_aid_post_projections
    SELECT * FROM public.indexer_aid_post_projections;
INSERT INTO jetstream_v1_rollback.indexer_directory_resource_projections
    SELECT * FROM public.indexer_directory_resource_projections;
INSERT INTO jetstream_v1_rollback.indexer_volunteer_profile_projections
    SELECT * FROM public.indexer_volunteer_profile_projections;
INSERT INTO jetstream_v1_rollback.indexer_dead_letters
    SELECT * FROM public.indexer_dead_letters;
INSERT INTO jetstream_v1_rollback.indexer_network_accounts
    SELECT * FROM public.indexer_network_accounts;

TRUNCATE TABLE
    public.indexer_projection_events,
    public.indexer_projection_tombstones,
    public.indexer_projection_state,
    public.indexer_aid_post_projections,
    public.indexer_directory_resource_projections,
    public.indexer_volunteer_profile_projections,
    public.indexer_dead_letters,
    public.indexer_identity_cache,
    public.indexer_network_accounts,
    public.indexer_repo_reconciliation_queue
RESTART IDENTITY;

INSERT INTO public.indexer_projection_events
    SELECT * FROM jetstream_v2_shadow.indexer_projection_events;
INSERT INTO public.indexer_projection_tombstones
    SELECT * FROM jetstream_v2_shadow.indexer_projection_tombstones;
INSERT INTO public.indexer_projection_state
    SELECT * FROM jetstream_v2_shadow.indexer_projection_state;
INSERT INTO public.indexer_aid_post_projections
    SELECT * FROM jetstream_v2_shadow.indexer_aid_post_projections;
INSERT INTO public.indexer_directory_resource_projections
    SELECT * FROM jetstream_v2_shadow.indexer_directory_resource_projections;
INSERT INTO public.indexer_volunteer_profile_projections
    SELECT * FROM jetstream_v2_shadow.indexer_volunteer_profile_projections;
INSERT INTO public.indexer_dead_letters
    SELECT * FROM jetstream_v2_shadow.indexer_dead_letters;
INSERT INTO public.indexer_identity_cache
    SELECT * FROM jetstream_v2_shadow.indexer_identity_cache;
INSERT INTO public.indexer_network_accounts
    SELECT * FROM jetstream_v2_shadow.indexer_network_accounts;
INSERT INTO public.indexer_repo_reconciliation_queue
    SELECT * FROM jetstream_v2_shadow.indexer_repo_reconciliation_queue;

COMMIT;
