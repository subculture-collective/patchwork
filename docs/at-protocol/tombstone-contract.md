# Record deletion and projection reconciliation

The user's AT repository is authoritative. A local request to delete a record
is not proof that the repository deleted it. API command services reconcile
local state only after the PDS confirms deletion; a failed compare-and-swap
write must preserve local state.

The indexer normalizes observed repository deletion events and applies them
transactionally in `services/indexer/src/db/projection-store.ts`. It removes
the public projection and records the deletion cursor in its internal
projection tombstone table. Event identity and cursor ordering make replay
idempotent and prevent an older event from restoring stale state. These are
internal projection tombstones, not records published to the user's PDS.

Lifecycle reconciliation removes the relevant private workflow and fulfillment
state while retaining the bounded audit marker required by policy. Retrying
reconciliation must not duplicate effects. Account deactivation and retention
have their own data-removal boundaries.

Regression coverage lives in the API record-command tests, core operational
PostgreSQL tests, and indexer projection/lifecycle PostgreSQL tests. Keep legacy
record decoding and applied migrations: deletion must work for existing
federated records as well as newly published ZIP-based requests.
