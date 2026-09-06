CREATE TABLE IF NOT EXISTS aid_authoring_receipts (
    post_uri TEXT PRIMARY KEY,
    owner_did TEXT NOT NULL,
    title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
    source_cid TEXT NOT NULL,
    public_status TEXT NOT NULL CHECK (public_status IN ('open', 'in-progress', 'resolved', 'closed')),
    source_written_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    retention_until TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '365 days',
    CHECK (post_uri LIKE ('at://' || owner_did || '/app.patchwork.aid.post/%'))
);
CREATE INDEX IF NOT EXISTS aid_authoring_receipts_owner_recent
    ON aid_authoring_receipts (owner_did, source_written_at DESC, post_uri)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS aid_authoring_receipts_retention ON aid_authoring_receipts (retention_until);

-- Recover recent acknowledged writes made before this receipt store existed.
-- Keep only the minimal authoring metadata, never the command body or attachments.
INSERT INTO aid_authoring_receipts (post_uri, owner_did, title, source_cid, public_status, source_written_at)
SELECT DISTINCT ON (response_body->>'uri') response_body->>'uri', actor_did,
    response_body->'record'->>'title', response_body->>'cid', response_body->'record'->>'status', created_at
FROM http_idempotency_commands source
WHERE pathname IN ('/at/aid-posts', '/at/aid-posts/close', '/at/aid-posts/status/reconcile')
    AND method IN ('POST', 'PUT') AND status_code BETWEEN 200 AND 299
    -- Deletion responses carry no URI and the replay ledger retains only a body hash.
    -- If an actor subsequently deleted anything, leave older receipts unrecovered.
    AND NOT EXISTS (
        SELECT 1 FROM http_idempotency_commands deletion
        WHERE deletion.actor_did = source.actor_did AND deletion.pathname = '/at/aid-posts'
            AND deletion.method = 'DELETE' AND deletion.status_code BETWEEN 200 AND 299
            AND deletion.created_at >= source.created_at
    )
    AND split_part(response_body->>'uri', '/', 1) = 'at:'
    AND split_part(response_body->>'uri', '/', 3) = actor_did
    AND split_part(response_body->>'uri', '/', 4) = 'app.patchwork.aid.post'
    AND char_length(response_body->'record'->>'title') BETWEEN 1 AND 140
    AND char_length(response_body->>'cid') > 0
    AND response_body->'record'->>'status' IN ('open', 'in-progress', 'resolved', 'closed')
ORDER BY response_body->>'uri', created_at DESC, idempotency_key
ON CONFLICT (post_uri) DO NOTHING;

INSERT INTO request_workflows (post_uri, requester_did, current_status, create_command_id,
    retention_until, created_at, updated_at, public_status, public_cid, public_synced_at, public_sync_state)
SELECT post_uri, owner_did,
    CASE public_status WHEN 'in-progress' THEN 'in_progress' WHEN 'closed' THEN 'archived' ELSE public_status END,
    'authoring:' || post_uri, retention_until, source_written_at, source_written_at,
    public_status, source_cid, source_written_at, 'synced'
FROM aid_authoring_receipts WHERE deleted_at IS NULL
ON CONFLICT (post_uri) DO NOTHING;
