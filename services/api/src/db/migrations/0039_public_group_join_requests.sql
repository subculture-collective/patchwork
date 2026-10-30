CREATE TABLE group_join_requests (
    request_id UUID PRIMARY KEY,
    group_id UUID NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
    requester_did TEXT NOT NULL,
    introduction TEXT CHECK (introduction IS NULL OR (
        char_length(introduction) BETWEEN 1 AND 1000 AND introduction !~ '[[:cntrl:]]')),
    status TEXT NOT NULL CHECK (status IN ('pending','approved','declined','withdrawn','expired')),
    decided_by_did TEXT,
    decided_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX idx_group_join_pending ON group_join_requests(group_id,requester_did)
    WHERE status='pending';
CREATE INDEX idx_group_join_actor ON group_join_requests(requester_did,created_at DESC);
CREATE INDEX idx_group_join_expiry ON group_join_requests(expires_at) WHERE status='pending';
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON group_join_requests FROM PUBLIC;

ALTER TABLE chat_conversations ADD COLUMN join_request_id UUID UNIQUE
    REFERENCES group_join_requests(request_id) ON DELETE CASCADE;
ALTER TABLE chat_conversations DROP CONSTRAINT chat_conversations_kind_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_kind_check
    CHECK (kind IN ('direct','group','join-request'));
ALTER TABLE chat_conversations DROP CONSTRAINT chat_conversations_check;
ALTER TABLE chat_conversations ADD CONSTRAINT chat_conversations_check CHECK (
    (kind='direct' AND connection_id IS NOT NULL AND room_id IS NULL AND join_request_id IS NULL)
    OR (kind='group' AND room_id IS NOT NULL AND connection_id IS NULL AND join_request_id IS NULL)
    OR (kind='join-request' AND join_request_id IS NOT NULL AND connection_id IS NULL AND room_id IS NULL)
);
ALTER TABLE group_audit_events DROP CONSTRAINT group_audit_events_action_check;
ALTER TABLE group_audit_events ADD CONSTRAINT group_audit_events_action_check CHECK (
    action IN ('created','invited','invitation-accepted','invitation-rejected',
    'invitation-revoked','member-removed','member-left','role-changed','ownership-transferred',
    'room-created','room-closed','group-closed','join-requested','join-approved','join-declined',
    'join-withdrawn','join-expired')
);
-- Extend the existing notification check without duplicating its growing list.
DO $$
DECLARE previous TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO previous FROM pg_constraint
        WHERE conrelid='notification_intents'::regclass
          AND conname='notification_intents_notification_type_check';
    ALTER TABLE notification_intents DROP CONSTRAINT notification_intents_notification_type_check;
    EXECUTE 'ALTER TABLE notification_intents ADD CONSTRAINT notification_intents_notification_type_check CHECK ('
        || substring(previous FROM 8 FOR char_length(previous)-8)
        || ' OR notification_type IN (''group_join_requested'',''group_join_decided''))';
END $$;
