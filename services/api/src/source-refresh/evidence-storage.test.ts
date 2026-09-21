import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { evidenceHash, retainEvidenceBlob, restoreEvidenceBlob, writeImmutableEvidence } from './evidence-storage.js';
const roots: string[] = [];
const root = async () => { const value = await mkdtemp(join(tmpdir(), 'patchwork-evidence-')); roots.push(value); return value; };
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
it('deduplicates concurrent exact-byte writes and restores compressed evidence', async () => {
    const dir = await root(); const raw = Buffer.from('publisher bytes\n'.repeat(100));
    const [a, b] = await Promise.all([retainEvidenceBlob(dir, raw, 10_000), retainEvidenceBlob(dir, raw, 10_000)]);
    expect(a).toEqual(b); expect(a.storedBytes).toBeLessThan(a.rawBytes);
    expect(await restoreEvidenceBlob(dir, a, 10_000)).toEqual(raw);
    expect(await readdir(join(dir, 'blobs/sha256', a.rawSha256.slice(0, 2)))).toEqual([a.rawSha256 + '.gz']);
});
it('refuses immutable collisions without overwriting or leaving temporary files', async () => {
    const dir = await root(); const path = join(dir, 'object');
    await writeImmutableEvidence(path, Buffer.from('first'));
    await expect(writeImmutableEvidence(path, Buffer.from('other'))).rejects.toThrow('conflicts');
    expect(await readFile(path, 'utf8')).toBe('first'); expect(await readdir(dir)).toEqual(['object']);
});
it('rejects corrupt bytes, unsafe keys, mismatched identities and oversized restores', async () => {
    const dir = await root(); const blob = await retainEvidenceBlob(dir, Buffer.from('test'), 10);
    await expect(restoreEvidenceBlob(dir, { ...blob, key: '../outside' }, 10)).rejects.toThrow('reference');
    await expect(restoreEvidenceBlob(dir, blob, 3)).rejects.toThrow('reference');
    await expect(restoreEvidenceBlob(dir, { ...blob, rawBytes: 3 }, 10)).rejects.toThrow('Restored');
    await writeFile(join(dir, blob.key), Buffer.alloc(blob.storedBytes));
    await expect(restoreEvidenceBlob(dir, blob, 10)).rejects.toThrow('Stored');
});
it('refuses symlink destinations and source-budget violations', async () => {
    const dir = await root(); await writeFile(join(dir, 'target'), 'data'); await symlink(join(dir, 'target'), join(dir, 'link'));
    await expect(writeImmutableEvidence(join(dir, 'link'), Buffer.from('data'))).rejects.toThrow();
    await expect(retainEvidenceBlob(dir, Buffer.from('too much'), 2)).rejects.toThrow('budget');
    await expect(retainEvidenceBlob(dir, Buffer.from('x'), Infinity)).rejects.toThrow('limit');
});

it('reuses an existing valid gzip encoding without changing its stored reference', async () => {
    const dir = await root(); const raw = Buffer.from('publisher bytes\n'.repeat(100));
    const rawSha256 = evidenceHash(raw); const key = `blobs/sha256/${rawSha256.slice(0, 2)}/${rawSha256}.gz`;
    const originalEncoding = gzipSync(raw, { level: 0 });
    await writeImmutableEvidence(join(dir, key), originalEncoding);
    const blob = await retainEvidenceBlob(dir, raw, 10_000);
    expect(blob.storedSha256).toBe(evidenceHash(originalEncoding));
    expect(await readFile(join(dir, key))).toEqual(originalEncoding);
    expect(await restoreEvidenceBlob(dir, blob, 10_000)).toEqual(raw);
});
it('does not accept valid gzip containing different raw bytes at the claimed identity', async () => {
    const dir = await root(); const raw = Buffer.from('expected'); const digest = evidenceHash(raw);
    const path = join(dir, `blobs/sha256/${digest.slice(0, 2)}/${digest}.gz`);
    const wrong = gzipSync(Buffer.from('different'));
    await writeImmutableEvidence(path, wrong);
    await expect(retainEvidenceBlob(dir, raw, 100)).rejects.toThrow('raw identity');
    expect(await readFile(path)).toEqual(wrong);
});
