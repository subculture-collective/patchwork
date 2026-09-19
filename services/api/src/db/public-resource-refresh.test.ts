import { describe, expect, it } from 'vitest';
import snapshot from './seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { parsePublicResourceCatalog } from './public-resource-catalog.js';
import { planPublicResourceRefresh, type RefreshListing } from './public-resource-refresh.js';

const now = new Date('2026-09-19T12:00:00Z');
const original = parsePublicResourceCatalog(snapshot).resources[0]!;
const candidate = (): Omit<typeof snapshot, 'sources'> & { sources: Record<string, typeof original.source> } => ({ ...structuredClone(snapshot),
    sources: Object.fromEntries(Object.entries(snapshot.sources).map(([id, source]) => [id, { ...source, retrievedAt: '2026-09-19' }])),
    resources: [{ ...snapshot.resources[0]!, phone: '312-555-0199' }],
});
const listing = (): RefreshListing => ({
    resourceUri: `at://did:plc:patchwork-public-catalog/app.patchwork.directory.resource/${original.id}`,
    sourceSnapshot: structuredClone(original), sourceUrl: original.source.url,
    sourceRetrievedAt: original.source.retrievedAt, recordOrigin: 'sourced-public',
    contact: { url: original.website, ...(original.phone ? { phone: original.phone } : {}) },
    claimed: false, listed: true, profileRevision: null, pendingCorrection: false,
    recordUpdatedAt: '2026-09-08T00:00:00Z', listingUpdatedAt: '2026-09-08T00:00:00Z',
});
const plan = (input = candidate(), live = listing()) => planPublicResourceRefresh(input, [live], now).candidates[0]!;

describe('source-refresh preview policy', () => {
    it('identifies a contact candidate with evidence and revision guards without mutating inputs', () => {
        const input = candidate(), live = listing();
        const before = structuredClone({ input, live });
        const result = plan(input, live);
        expect(result.disposition).toBe('contact-automation-candidate');
        expect(result.fields).toEqual(['phone']);
        expect(result.reasons).toEqual([]);
        expect(result.base).toMatchObject({ recordUpdatedAt: live.recordUpdatedAt, listingUpdatedAt: live.listingUpdatedAt });
        expect(result.base?.snapshotSha256).toMatch(/^[a-f0-9]{64}$/);
        expect({ input, live }).toEqual(before);
    });
    it('keeps an unchanged retrieval from becoming evidence renewal', () => {
        const input = candidate();
        input.resources = [structuredClone(snapshot.resources[0]!)];
        expect(plan(input).disposition).toBe('unchanged');
        expect(plan(input).fields).toEqual([]);
    });
    it.each([
        ['claimed', true, 'provider-or-reviewed-profile'],
        ['profileRevision', 2, 'provider-or-reviewed-profile'],
        ['pendingCorrection', true, 'pending-correction'],
        ['listed', false, 'listing-withdrawn'],
        ['recordOrigin', 'user', 'record-origin-conflict'],
        ['sourceSnapshot', {}, 'invalid-imported-snapshot'],
        ['contact', { url: 'https://provider.example' }, 'contact-diverged-from-import'],
        ['sourceUrl', 'https://other.example', 'source-url-changed'],
        ['sourceRetrievedAt', '2026-09-20', 'source-date-regressed'],
    ])('requires review for protected live state %s', (key, value, reason) => {
        const result = plan(candidate(), { ...listing(), [key]: value });
        expect(result.disposition).toBe('review');
        expect(result.reasons).toContain(reason);
    });
    it.each(['usualHours', 'publicAccess', 'streetAddress', 'name'] as const)('requires review for changed %s', key => {
        const input = candidate();
        input.resources[0]![key] = 'Changed source information';
        expect(plan(input).reasons).toContain('non-contact-change');
        expect(plan(input).disposition).toBe('review');
    });
    it.each(['https://different.example', 'http://different.example', 'https://user:pass@different.example'])('requires review for website %s', website => {
        const input = candidate(); input.resources[0]!.website = website;
        expect(plan(input).reasons).toContain('website-requires-review');
    });
    it('allows only a same-host HTTPS website change to be a contact candidate', () => {
        const input = candidate();
        input.resources[0]!.website = `https://${new URL(original.website).hostname}/new-contact`;
        expect(plan(input).disposition).toBe('contact-automation-candidate');
    });
    it('requires review for contact removal and source-identity changes', () => {
        const input = candidate(); delete input.resources[0]!.phone;
        expect(plan(input).reasons).toContain('contact-removed');
        const live = listing(); live.sourceSnapshot = { ...original, sourceId: 'different-source' };
        expect(plan(candidate(), live).reasons).toContain('source-identity-conflict');
    });
    it.each(['-------', 'call the desk', '+1 (312) 555-0199 ext 2'])('requires phone review for %s', phone => {
        const input = candidate(); input.resources[0]!.phone = phone;
        expect(plan(input).reasons).toContain('phone-requires-review');
    });
    it.each(['2026-09-20', '2026-01-01'])('rejects future or expired source evidence %s', retrievedAt => {
        const input = candidate(); input.sources[original.sourceId]!.retrievedAt = retrievedAt;
        expect(plan(input).reasons).toContain('source-date-outside-valid-window');
    });
    it('requires newer evidence for changed content', () => {
        const input = candidate(); input.sources[original.sourceId]!.retrievedAt = original.source.retrievedAt;
        expect(plan(input).reasons).toContain('changed-source-not-newer');
    });
    it('classifies additions and absences as review, never automatic imports or closures', () => {
        const input = candidate(); input.resources[0]!.id = 'new-source-record';
        const result = planPublicResourceRefresh(input, [listing()], now);
        expect(result.counts).toEqual({ 'new-listing-review': 1, 'missing-review': 1 });
        expect(result.missing[0]!.reasons).toEqual(['absent-from-candidate-feed']);
    });
    it('does not treat an omitted source as a missing listing', () => {
        const input = candidate(); const source = input.sources[original.sourceId]!;
        input.sources = { 'another-source': source }; input.resources[0]!.sourceId = 'another-source';
        input.resources[0]!.id = 'another-record';
        expect(planPublicResourceRefresh(input, [listing()], now).missing).toEqual([]);
    });
    it('rejects malformed catalogs and duplicate live identities', () => {
        expect(() => planPublicResourceRefresh({}, [listing()], now)).toThrow();
        expect(() => planPublicResourceRefresh(candidate(), [listing(), listing()], now)).toThrow('Duplicate live');
    });
});
