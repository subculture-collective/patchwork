# Rollback Policy -- Immutable Versioning & Safe Rollback (#109)

## Immutable image digests

Tags are human-readable build references only. Deployment authority is the
registry digest recorded in `artifact-digests.json`, for example
`ghcr.io/example/patchwork-api@sha256:<64 hex characters>`.

### Tag Rules

1. **Never deploy a tag.** Host scripts reject any image without `@sha256:`.
2. **Build once.** The deployment job consumes the digest of the scanned and
   signed image; it never rebuilds source.
3. **OCI labels** are embedded in every image for traceability:
   - `org.opencontainers.image.revision` -- git SHA
   - `org.opencontainers.image.version` -- semver
   - `org.opencontainers.image.ref.name` -- branch name
   - `com.patchwork.ci.run-id` -- CI run ID
   - `com.patchwork.service` -- service name

4. **Promote as a set.** API, indexer, moderation, and web digests share one
   manifest and roll forward or backward together.

## One-command staging rollback

```bash
./scripts/rollback-staging-digests.sh /etc/patchwork/staging.env docker-compose.staging.yml
```

This command:
1. Reads `/var/lib/patchwork/releases/previous-artifact-digests.json`.
2. Rejects mutable references and pulls the four exact digests.
3. Restarts runtime services with `--no-build --no-deps`.
4. Requires deep readiness before updating the current manifest pointer.

Keep current and previous verified manifests on the host. Rollback requires
compatibility with the current database schema and successful readiness checks.
The active deployment workflow and operator policy determine when rollback runs.

## Database Migration Rollback

Migrations are classified into three rollback strategies based on their
characteristics:

### 1. Backward-Compatible (Preferred)

**When:** Migration is additive only -- new columns, new tables, no drops.

**Rollback procedure:**
- Roll back the application to the previous version.
- The previous app version can run against the new schema.
- No schema rollback needed.

**Example:** Adding a new nullable column, creating a new index.

### 2. Expand/contract migration

Breaking schema contraction must occur only after the rollback window closes
and all retained application digests are known compatible. Patchwork currently
has no automated down-migration command; documentation must not imply one.

### 3. Manual DBA (Emergency Only)

**When:** Migration involves destructive schema changes (DROP, irreversible renames).

**Rollback procedure:**
1. **ALWAYS** take a database snapshot before applying.
2. If rollback is needed, restore from the pre-migration snapshot.
3. Roll back the application.
4. DBA must verify data consistency.

**Example:** Dropping a table, removing a column with data.

Review the actual SQL for compatibility; Patchwork does not infer a safe rollback
from filenames or provide automated down migrations.

## Release Notes Template

Every release should include artifact and version references:

```markdown
## Release v0.9.0

### Artifacts
- API: `ghcr.io/example/patchwork-api@sha256:<digest>`
- Indexer: `ghcr.io/example/patchwork-indexer@sha256:<digest>`
- Moderation: `ghcr.io/example/patchwork-moderation@sha256:<digest>`
- Web: `ghcr.io/example/patchwork-web@sha256:<digest>`

### Git
- Commit: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
- Branch: main
- CI Run: https://github.com/org/repo/actions/runs/12345

### Migrations
- `001_add_verification_table.sql` (backward-compatible, safe rollback)

### Rollback
To roll back all services:
\`\`\`bash
./scripts/rollback-staging-digests.sh /etc/patchwork/staging.env docker-compose.staging.yml
\`\`\`
```

---

The release record must attach the exact `artifact-digests.json` used by the
host and the result of readiness/browser verification.
