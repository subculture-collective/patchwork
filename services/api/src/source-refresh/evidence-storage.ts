import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
export const evidenceHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;
export function evidenceByteLimit(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_EVIDENCE_BYTES) {
        throw new Error('Evidence byte limit must be between 1 and 64 MiB.');
    }
    return value;
}
async function syncDirectory(path: string) {
    const directory = await open(path, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
}

/** Sync ancestor entries even when another concurrent writer created them first. */
export async function prepareEvidenceDirectory(path: string) {
    let current = resolve(path);
    await mkdir(current, { recursive: true, mode: 0o700 });
    while (true) {
        await syncDirectory(current);
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
}

class EvidenceConflictError extends Error {}

const exists = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EEXIST';

/** Bounded reads reject symlinks and non-files. The root must be operator-owned. */
export async function readEvidenceFile(path: string, maxBytes: number): Promise<Buffer> {
    evidenceByteLimit(maxBytes);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxBytes) throw new Error('Evidence file exceeds its permitted size or is not a regular file.');
        const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (bytesRead === 0) break;
            length += bytesRead;
        }
        if (length !== stat.size) throw new Error('Evidence file changed during read.');
        return buffer.subarray(0, length);
    } finally { await handle.close(); }
}

/** Publish complete bytes with a no-replace hard link; a crash cannot expose a partial object. */
export async function writeImmutableEvidence(path: string, bytes: Uint8Array): Promise<void> {
    evidenceByteLimit(bytes.byteLength);
    const dir = dirname(path);
    await prepareEvidenceDirectory(dir);
    const temporary = join(dir, `.pending-${randomUUID()}`);
    try {
        const file = await open(temporary, 'wx', 0o600);
        try {
            await file.writeFile(bytes);
            await file.sync();
        } finally { await file.close(); }
        try { await link(temporary, path); }
        catch (error) {
            if (!exists(error)) throw error;
            const retained = await readEvidenceFile(path, MAX_EVIDENCE_BYTES);
            if (!retained.equals(Buffer.from(bytes))) throw new EvidenceConflictError('Immutable evidence conflicts with retained bytes.');
        }
        await syncDirectory(dir);
    } finally { await unlink(temporary).catch(error => {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }); }
}

export interface EvidenceBlob {
    version: 1;
    encoding: 'gzip';
    rawSha256: string;
    rawBytes: number;
    storedSha256: string;
    storedBytes: number;
    key: string;
}
function blobKey(rawSha256: string) {
    if (!/^[a-f0-9]{64}$/.test(rawSha256)) throw new Error('Invalid evidence hash.');
    return `blobs/sha256/${rawSha256.slice(0, 2)}/${rawSha256}.gz`;
}

/** Identity is the exact publisher bytes, independent of gzip or normalization. */
export async function retainEvidenceBlob(root: string, raw: Uint8Array, maxBytes: number): Promise<EvidenceBlob> {
    evidenceByteLimit(maxBytes);
    if (raw.byteLength < 1 || raw.byteLength > maxBytes) throw new Error('Raw evidence exceeds its source budget.');
    const rawSha256 = evidenceHash(raw);
    let compressed = await compress(raw, { level: 6 });
    const key = blobKey(rawSha256);
    const path = join(root, key);
    try { await writeImmutableEvidence(path, compressed); }
    catch (error) {
        if (!(error instanceof EvidenceConflictError)) throw error;
        // Gzip versions or compression levels may differ while raw identity is unchanged.
        // Preserve the original encoding and reference; never overwrite a valid object.
        const existing = await readEvidenceFile(path, MAX_EVIDENCE_BYTES);
        const restored = await decompress(existing, { maxOutputLength: maxBytes });
        if (!restored.equals(Buffer.from(raw))) throw new Error('Retained evidence does not match raw identity.');
        await syncDirectory(dirname(path));
        compressed = existing;
    }
    return { version: 1, encoding: 'gzip', rawSha256, rawBytes: raw.byteLength,
        storedSha256: evidenceHash(compressed), storedBytes: compressed.byteLength, key };
}

export async function restoreEvidenceBlob(root: string, blob: EvidenceBlob, maxBytes: number): Promise<Buffer> {
    evidenceByteLimit(maxBytes);
    if (blob.version !== 1 || blob.encoding !== 'gzip' || blob.key !== blobKey(blob.rawSha256)
        || !Number.isSafeInteger(blob.rawBytes) || blob.rawBytes < 1 || blob.rawBytes > maxBytes
        || !/^[a-f0-9]{64}$/.test(blob.storedSha256)) throw new Error('Invalid evidence blob reference.');
    evidenceByteLimit(blob.storedBytes);
    const compressed = await readEvidenceFile(join(root, blob.key), blob.storedBytes);
    if (compressed.byteLength !== blob.storedBytes || evidenceHash(compressed) !== blob.storedSha256) {
        throw new Error('Stored evidence hash or length mismatch.');
    }
    const raw = await decompress(compressed, { maxOutputLength: maxBytes });
    if (raw.byteLength !== blob.rawBytes || evidenceHash(raw) !== blob.rawSha256) {
        throw new Error('Restored evidence hash or length mismatch.');
    }
    return raw;
}
