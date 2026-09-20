# Intake evidence storage

The shared evidence store retains exact publisher bytes as gzip blobs addressed by the raw SHA-256. References include both raw and stored hashes and byte lengths. Restores validate the reference, enforce a decompression budget, and verify both hashes. Source budgets must be explicit; the primitive has an absolute 64 MiB ceiling. Larger sources must use bounded pages rather than one unbounded object.

Writes use a private temporary file, file sync, atomic no-replace hard link, and directory sync. Existing objects must match exactly. Full disks, unavailable mounts, hash conflicts, and unsupported filesystem operations fail the intake; no evidence reference should be persisted after such a failure. Use a trusted operator-owned root on a filesystem supporting hard links and directory fsync. Leaf symlinks are rejected; hostile modification of parent directories is outside this storage contract.

No deletion or automatic retention is implemented. Keep evidence referenced by any published assertion, review candidate, run, or legal hold. Compression does not authorize deleting legacy raw evidence. Independent backup and database-reference restore qualification, measured national-source budgets, storage capacity alerts, and retention reference indexing remain acceptance work under #27.

The blob primitive alone does not activate sources or change publication policy.
