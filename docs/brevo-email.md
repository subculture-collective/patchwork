# Brevo notification delivery

Configure the API deployment with:

```dotenv
NOTIFICATION_EMAIL_PROVIDER_KIND=brevo
NOTIFICATION_EMAIL_PROVIDER_URL=https://api.brevo.com/v3/smtp/email
NOTIFICATION_EMAIL_FROM=patchwork@subcult.tv
NOTIFICATION_EMAIL_REPLY_TO=patchwork@subcult.tv
```

Supply the Brevo API key as `NOTIFICATION_EMAIL_PROVIDER_TOKEN` through the
deployment's private environment file. Supply a separate random
`NOTIFICATION_PROVIDER_WEBHOOK_TOKEN` for feedback. Staging uses the corresponding
`STAGING_` variables and separate credentials; never reuse a production key there.
The default `http` provider remains available for existing installations.

Configure a non-batched transactional Brevo webhook to the API's
`/internal/notifications/provider-feedback` endpoint over HTTPS. Use bearer
authentication with `NOTIFICATION_PROVIDER_WEBHOOK_TOKEN`. Subscribe to delivered,
hard bounce, invalid, blocked, spam, and unsubscribed events. The handler maps
message IDs to stored deliveries and uses the stored endpoint for disabling;
webhook-supplied recipient addresses do not choose which endpoint is disabled.
Unknown message IDs return 429 so an early receipt can be retried after acceptance
is stored. Transient soft bounces do not disable recipients. Brevo's
[retry contract](https://developers.brevo.com/docs/retry-mechanism) discards other
4xx and 5xx responses.

The adapter uses Brevo's native API-key authentication and request format.
Provider acceptance is recorded separately from delivery feedback. Batch requests
with one recipient carry a stable idempotency key. Brevo retains these keys for
30 minutes; retries stop after a conservative 29-minute window measured from the
delivery's creation. After that window, uncertain attempts go to the dead-letter
queue instead of risking a duplicate. Initial sends remain allowed for older
queued notifications. Provider configuration errors do not invalidate recipients.

No credentials or provider webhooks are installed by this source change. Enable
delivery only after configuring the deployed adapter and checking acceptance and
inbox delivery separately.

Before switching from an existing email provider, pause delivery and inspect the durable queue. Resolve or hold all pending, retrying, and locked email deliveries under their original provider before selecting Brevo. A provider change does not transfer the old provider's idempotency records. Keep existing destination preferences and suppression state.

Brevo transactional webhooks receive events for the whole shared account. The Patchwork endpoint acknowledges events tagged for another project without storing them or asking Brevo to retry. Patchwork sends carry the `patchwork` tag; early receipts for its own messages still request retry.
