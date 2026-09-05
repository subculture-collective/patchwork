CREATE TABLE signup_invite_links (
    invite_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_sha256 TEXT NOT NULL UNIQUE CHECK (char_length(token_sha256) = 64),
    created_by_did TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by_did TEXT,
    successful_use_count BIGINT NOT NULL DEFAULT 0 CHECK (successful_use_count >= 0),
    last_used_at TIMESTAMPTZ,
    CHECK (expires_at > created_at),
    CHECK (
        (revoked_at IS NULL AND revoked_by_did IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by_did IS NOT NULL)
    )
);

CREATE INDEX idx_signup_invite_links_created
    ON signup_invite_links (created_at DESC, invite_id);
CREATE INDEX idx_signup_invite_links_active
    ON signup_invite_links (expires_at, invite_id)
    WHERE revoked_at IS NULL;
