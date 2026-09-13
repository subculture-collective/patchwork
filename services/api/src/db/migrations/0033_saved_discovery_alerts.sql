ALTER TABLE saved_discovery ADD COLUMN alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE saved_discovery ADD COLUMN next_check_at TIMESTAMPTZ;
ALTER TABLE saved_discovery ADD COLUMN alert_baseline JSONB;
CREATE INDEX saved_discovery_due ON saved_discovery(next_check_at) WHERE alerts_enabled;
ALTER TABLE notification_intents DROP CONSTRAINT notification_intents_notification_type_check;
ALTER TABLE notification_intents ADD CONSTRAINT notification_intents_notification_type_check CHECK(notification_type IN (
'offer_received','offer_accepted','offer_declined','offer_expired','connection_started','connection_completed','connection_cancelled','lifecycle_changed','verification_submitted','verification_decided','appeal_submitted','appeal_decided','account_expiry','moderation_action','attachment_action','organization_action','system_announcement','schedule_proposed','schedule_changed','schedule_confirmed','schedule_declined','schedule_cancelled','schedule_reminder','schedule_expired','group_invited','group_joined','group_removed','group_role_changed','group_closed','message_received','saved_discovery_changed'));
