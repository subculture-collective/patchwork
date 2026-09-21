# Intake evidence storage

The shared evidence store retains exact publisher bytes as gzip blobs addressed by the raw SHA-256. References include both raw and stored hashes and byte lengths. Restores validate the reference, enforce a decompression budget, and verify both hashes. Source budgets must be explicit; the primitive has an absolute 64 MiB ceiling. Larger sources must use bounded pages rather than one unbounded object.

Writes sync directory entries through the filesystem root (including when a concurrent writer created a directory), then use a private temporary file, file sync, atomic no-replace hard link, and directory sync. Existing objects must match exactly. Full disks, unavailable mounts, hash conflicts, and unsupported filesystem operations fail the intake; no evidence reference should be persisted after such a failure. Use a trusted operator-owned root on a filesystem supporting hard links and directory fsync, with read/traverse permission on its ancestors. Leaf symlinks are rejected; hostile modification of parent directories is outside this storage contract.

No deletion or automatic retention is implemented. Keep evidence referenced by any published assertion, review candidate, run, or legal hold. Compression does not authorize deleting legacy raw evidence. Independent backup and database-reference restore qualification, measured national-source budgets, storage capacity alerts, and retention reference indexing remain acceptance work under #27.

The blob primitive alone does not activate sources or change publication policy.

## CPL compatibility integration

New CPL runs retain gzip blobs and a `.storage.json` sidecar carrying adapter/schema version and blob references. Existing manifest and raw JSON paths remain unchanged. Before writing, retention verifies the raw hash, normalized hash, counts, source identity and deterministic normalization. The manifest is published last; incomplete runs can leave unreferenced blobs, which are retained for investigation rather than deleted. Disk failures prevent candidate persistence. Existing manifests without sidecars remain readable by existing tooling; replay may add a matching sidecar without changing retrieval times.

## Verify a restored CPL run

Run `npm run resources:evidence:verify-cpl -w @patchwork/api -- /operator/restored/evidence 2026-09-19T180000Z-<12-character-raw-hash>.manifest.json`, substituting a real manifest basename from the restored `runs` directory. The command is read-only and exits nonzero on missing, corrupt, mismatched, oversized, or unsupported artifacts. It verifies raw bytes, deterministic normalization, and compressed references when present; old runs report `legacy-only`. The original retrieval time is returned unchanged.

A successful audit proves one copied artifact set can be read back. It does not prove an independent backup exists, that database references are complete, or that all retained runs were audited. Keep those separate in the recovery ledger. The unit fixture exercises a disposable copy and source isolation, not production disaster recovery.
