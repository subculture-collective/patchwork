import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CPL_API_URL, fetchCplPublisherEvidence, normalizeCplPublisherBytes } from './chicago-public-library.js';

const workspaces: string[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const workspace = async () => {
    const path = await mkdtemp(join(tmpdir(), 'patchwork-cpl-source-'));
    workspaces.push(path);
    return path;
};
const rows = (count = 82) => Array.from({ length: count }, (_, index) => ({
    name_: `Branch ${index + 1}`,
    address: `${index + 1} W. Test Street`, city: 'Chicago', state: 'IL',
    zip: index % 2 ? 60601 : '60602-1234', phone: '(312) 555-0100',
    website: index === 0 ? { url: `http://chipublib.org/locations/${index + 1}/`, description: 'Branch' }
        : `https://www.chipublib.org/locations/${index + 1}/`,
    hours_of_operation: 'Mon. & Wed., Noon-8; Tue. & Thu., 10-6',
    location: index === 0 ? { latitude: '41.88', longitude: '-87.63' }
        : { type: 'Point', coordinates: [-87.63, 41.88] },
    ignored_publisher_column: 'retained only in raw evidence',
}));
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const baselines = (count = 82) => new Set(Array.from({ length: count }, (_, index) => `cpl-${index + 1}`));
const now = new Date('2026-09-19T18:00:00.000Z');

describe('Chicago Public Library publisher adapter', () => {
    it('normalizes a complete feed while preserving publisher hours as catalog text', () => {
        const raw = encode(rows());
        const catalog = normalizeCplPublisherBytes(raw, now, baselines());
        expect(catalog.resources).toHaveLength(82);
        expect(catalog.sources.cpl).toMatchObject({
            apiUrl: CPL_API_URL, retrievedAt: '2026-09-19',
            sha256: createHash('sha256').update(raw).digest('hex'),
        });
        expect(catalog.resources[0]).toMatchObject({
            category: 'library',
            id: 'cpl-1', name: 'Branch 1 — Chicago Public Library', postalCode: '60602',
            website: 'https://www.chipublib.org/locations/1/', usualHours: 'Mon. & Wed., Noon-8; Tue. & Thu., 10-6',
            countyId: '17031', coordinateBasis: 'publisher-address',
        });
        expect(catalog.resources[0]).not.toHaveProperty('eligibility');
    });

    it('fetches the pinned endpoint and retains exact raw bytes plus derived evidence', async () => {
        const outputDir = await workspace();
        const raw = encode(rows());
        const fetcher = vi.fn<typeof fetch>(async () => new Response(raw, { status: 200, headers: {
            'content-type': 'application/json; charset=utf-8', etag: '"publisher-version"',
            'last-modified': 'Sat, 19 Sep 2026 17:00:00 GMT',
        } }));
        const result = await fetchCplPublisherEvidence({ outputDir, baselineIds: baselines(), fetch: fetcher, now: () => now });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(fetcher.mock.calls[0]![0]).toBe(CPL_API_URL);
        expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { accept: 'application/json' } });
        expect(new Uint8Array(await readFile(result.paths.rawPath))).toEqual(raw);
        expect(JSON.parse(await readFile(result.paths.manifestPath, 'utf8'))).toEqual(result.manifest);
        expect(JSON.parse(await readFile(result.paths.catalogPath, 'utf8'))).toEqual(result.catalog);
        expect(result.manifest).toMatchObject({ rowCount: 82, rawBytes: raw.byteLength,
            etag: '"publisher-version"', lastModified: 'Sat, 19 Sep 2026 17:00:00 GMT' });
        expect(result.manifest.rawSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.manifest.normalizedSha256).toMatch(/^[a-f0-9]{64}$/);
        await expect(fetchCplPublisherEvidence({ outputDir, baselineIds: baselines(), fetch: fetcher, now: () => now })).resolves.toMatchObject({ manifest: result.manifest });
    });

    it('does not retain evidence until the complete response validates', async () => {
        const outputDir = await workspace();
        const fetcher = vi.fn<typeof fetch>(async () => new Response(encode(rows(10)), { status: 200,
            headers: { 'content-type': 'application/json' } }));
        await expect(fetchCplPublisherEvidence({ outputDir, baselineIds: baselines(), fetch: fetcher, now: () => now }))
            .rejects.toThrow('complete-feed');
        expect(await readdir(outputDir)).toEqual([]);
    });

    it.each([
        ['official website', (input: ReturnType<typeof rows>) => { input[0]!.website = 'https://example.org/locations/1/'; }, 'official'],
        ['stable branch ID', (input: ReturnType<typeof rows>) => { input[0]!.website = 'https://chipublib.org/branches/beverly/'; }, 'stable'],
        ['Chicago locality', (input: ReturnType<typeof rows>) => { input[0]!.city = 'Evanston'; }, 'outside Chicago'],
        ['Chicago coordinates', (input: ReturnType<typeof rows>) => { input[0]!.location = { latitude: '40', longitude: '-87.63' }; }, 'coordinates'],
        ['public phone', (input: ReturnType<typeof rows>) => { input[0]!.phone = '311'; }, 'phone'],
        ['catalog hours limit', (input: ReturnType<typeof rows>) => { input[0]!.hours_of_operation = 'x'.repeat(201); }, 'hours'],
    ])('rejects invalid normalized %s', (_label, mutate, message) => {
        const input = rows(); mutate(input);
        expect(() => normalizeCplPublisherBytes(encode(input), now, baselines())).toThrow(message);
    });

    it('rejects duplicates, malformed bytes, oversized bytes and excessive baseline loss', () => {
        const duplicate = rows(); duplicate[1]!.website = duplicate[0]!.website;
        expect(() => normalizeCplPublisherBytes(encode(duplicate), now, baselines())).toThrow('duplicate');
        expect(() => normalizeCplPublisherBytes(new TextEncoder().encode('{'), now, baselines())).toThrow('UTF-8 JSON');
        expect(() => normalizeCplPublisherBytes(new Uint8Array(1_000_001), now, baselines())).toThrow('size');
        expect(() => normalizeCplPublisherBytes(encode(rows(75)), now, baselines(100))).toThrow('baseline');
    });

    it.each([
        [503, 'application/json', 'HTTP 503'],
        [200, 'text/html', 'application/json'],
    ])('rejects HTTP/content failures (%s, %s)', async (status, contentType, message) => {
        const outputDir = await workspace();
        const fetcher = vi.fn<typeof fetch>(async () => new Response(encode(rows()), { status, headers: { 'content-type': contentType } }));
        await expect(fetchCplPublisherEvidence({ outputDir, baselineIds: baselines(), fetch: fetcher, now: () => now }))
            .rejects.toThrow(message);
        expect(await readdir(outputDir)).toEqual([]);
    });

    it.each([
        ['declared', new Response(encode(rows()), { status: 200, headers: {
            'content-type': 'application/json', 'content-length': '1000001',
        } })],
        ['streamed', new Response(new Uint8Array(1_000_001), { status: 200,
            headers: { 'content-type': 'application/json' } })],
    ])('enforces the %s response size boundary before retaining evidence', async (_kind, response) => {
        const outputDir = await workspace();
        const fetcher = vi.fn<typeof fetch>(async () => response);
        await expect(fetchCplPublisherEvidence({ outputDir, baselineIds: baselines(), fetch: fetcher, now: () => now }))
            .rejects.toThrow('size');
        expect(await readdir(outputDir)).toEqual([]);
    });
});
