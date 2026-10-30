import { afterEach, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ mkdir: vi.fn(), open: vi.fn() }));
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), ...io }));
import { prepareEvidenceDirectory } from './evidence-storage.js';
afterEach(() => vi.resetAllMocks());
it('syncs every ancestor entry before publishing an object', async () => {
    io.mkdir.mockResolvedValue('/evidence/blobs');
    const calls: string[] = [];
    io.open.mockImplementation(async path => ({ sync: async () => { calls.push(path); }, close: async () => {} }));
    await prepareEvidenceDirectory('/evidence/blobs/sha256/ab');
    expect(calls).toEqual(['/evidence/blobs/sha256/ab', '/evidence/blobs/sha256', '/evidence/blobs', '/evidence', '/']);
});
it('propagates directory durability failure and closes its handle', async () => {
    io.mkdir.mockResolvedValue('/evidence/blobs'); const close = vi.fn();
    io.open.mockResolvedValue({ sync: async () => { throw new Error('storage unavailable'); }, close });
    await expect(prepareEvidenceDirectory('/evidence/blobs')).rejects.toThrow('storage unavailable');
    expect(close).toHaveBeenCalledOnce();
});
it('syncs existing ancestors too because another writer may just have created them', async () => {
    io.mkdir.mockResolvedValue(undefined);
    const calls: string[] = [];
    io.open.mockImplementation(async path => ({ sync: async () => { calls.push(path); }, close: async () => {} }));
    await prepareEvidenceDirectory('/evidence/blobs');
    expect(calls).toEqual(['/evidence/blobs', '/evidence', '/']);
});
