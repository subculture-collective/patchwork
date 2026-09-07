# AT Protocol artifacts

These documents describe versioned identity, record, and deletion contracts.

Alpha data placement and ingestion are governed by
`docs/architecture/adr/0003-at-alpha-data-boundaries.md`. Aid posts, directory resources, and volunteer profiles are public write
collections. Jetstream is the initial filtered live source, backed
by repository reconciliation; it is not treated as record authority or a
complete historical source.

Phase 2 artifacts and guarantees:

- `lexicon-versioning.md` — schema set, field constraints, semver policy.
- `identity-session.md` — DID auth/session lifecycle and error model.
- `tombstone-contract.md` — delete/tombstone lifecycle and downstream guarantees.
