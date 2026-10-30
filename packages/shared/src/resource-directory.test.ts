import { describe, expect, it } from 'vitest';
import { currentDirectoryAssertion, directoryAssertionsFor, resourceDirectorySchema } from './resource-directory.js';
import { directoryFromLegacyProfile } from './resource-directory-legacy.js';

const evidence = { sourceId: 'publisher-one', sourceName: 'Official publisher', sourceUrl: 'https://example.org/service',
    observedAt: '2026-09-20T00:00:00Z', confirmedAt: '2026-09-01T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z',
    reviewState: 'reviewed' as const, conflictState: 'none' as const, rawSha256: null };
const now = new Date('2026-09-20T00:00:00Z');
const hours = { timezone: 'America/Chicago', weekly: [{ day: 1, start: 540, end: 1020 }], exceptions: [] };
const graph = () => resourceDirectorySchema.parse({ version: 1,
    organizations: [{ id: 'org', name: 'Community aid' }],
    places: [{ id: 'site-a', name: 'Site A', visibility: 'public' }, { id: 'site-b', name: 'Site B', visibility: 'public' }],
    services: [{ id: 'food', name: 'Food support', organizationId: 'org', delivery: 'in-person' },
        { id: 'advice', name: 'Advice', organizationId: 'org', delivery: 'hybrid' }],
    serviceLocations: [{ id: 'food-a', serviceId: 'food', placeId: 'site-a' },
        { id: 'food-b', serviceId: 'food', placeId: 'site-b' }, { id: 'advice-a', serviceId: 'advice', placeId: 'site-a' }],
    assertions: [{ id: 'building-hours', subjectType: 'place', subjectId: 'site-a', field: 'hours', value: hours, evidence }],
});

describe('organization/place/service evidence graph', () => {
    it('supports multiple services per site and sites per service without inheriting building hours', () => {
        const value = graph();
        expect(value.services).toHaveLength(2);
        expect(value.serviceLocations).toHaveLength(3);
        expect(directoryAssertionsFor(value, 'place', 'site-a', 'hours', now)).toHaveLength(1);
        expect(directoryAssertionsFor(value, 'service', 'food', 'hours', now)).toEqual([]);
        expect(directoryAssertionsFor(value, 'service-location', 'food-a', 'hours', now)).toEqual([]);
    });
    it('rejects dangling references and duplicate relationships', () => {
        const value = graph();
        expect(() => resourceDirectorySchema.parse({ ...value, organizations: [] })).toThrow('organization');
        expect(() => resourceDirectorySchema.parse({ ...value, places: [] })).toThrow('endpoint');
        expect(() => resourceDirectorySchema.parse({ ...value, serviceLocations: [...value.serviceLocations,
            { ...value.serviceLocations[0], id: 'another-id' }] })).toThrow('Duplicate');
        expect(() => resourceDirectorySchema.parse({ ...value, assertions: [{ ...value.assertions[0], subjectId: 'missing' }] })).toThrow('subject');
    });
    it('supports remote and confidential services without exposing an address or public listing link', () => {
        expect(resourceDirectorySchema.parse({ version: 1, organizations: [],
            places: [{ id: 'shelter', name: 'Confidential shelter', visibility: 'confidential' }],
            services: [{ id: 'phone', name: 'Telephone support', delivery: 'remote' }],
            serviceLocations: [], assertions: [] }).services[0]!.delivery).toBe('remote');
        const value = graph();
        expect(() => resourceDirectorySchema.parse({ ...value, services: value.services.map(item => ({ ...item, delivery: 'remote' })) })).toThrow('Remote');
        expect(() => resourceDirectorySchema.parse({ ...value, places: [{ ...value.places[0], visibility: 'confidential',
            legacyResourceUri: 'at://public/resource/site' }] })).toThrow('Confidential');
        expect(() => resourceDirectorySchema.parse({ ...value, places: [{ ...value.places[0], streetAddress: 'Private location' }] })).toThrow();
    });
    it('keeps competing assertions and fails closed on open conflicts, expiry, pending review and future confirmation', () => {
        const value = graph();
        const first = value.assertions[0]!;
        value.assertions.push({ ...first, id: 'other-hours', evidence: { ...evidence, sourceId: 'publisher-two' } });
        expect(directoryAssertionsFor(value, 'place', 'site-a', 'hours', now)).toHaveLength(2);
        for (const change of [{ conflictState: 'open' as const }, { reviewState: 'pending' as const },
            { expiresAt: now.toISOString() }, { confirmedAt: '2026-09-21T00:00:00Z' }]) {
            expect(currentDirectoryAssertion({ ...first, evidence: { ...evidence, ...change } }, now)).toBe(false);
        }
        expect(() => resourceDirectorySchema.parse({ ...value, assertions: [{ ...first,
            evidence: { ...evidence, confirmedAt: null } }] })).toThrow('confirmation');
    });
    it('never treats a later observation as renewed confirmation', () => {
        const assertion = graph().assertions[0]!;
        assertion.evidence.observedAt = '2026-11-01T00:00:00Z';
        expect(currentDirectoryAssertion(assertion, new Date('2026-11-01T00:00:00Z'))).toBe(false);
    });
});

describe('legacy profile compatibility view', () => {
    const oldEvidence = { sourceUrl: evidence.sourceUrl, sourceName: evidence.sourceName,
        confirmedAt: evidence.confirmedAt, expiresAt: evidence.expiresAt, reviewStatus: 'reviewed' };
    const options = () => ({ resourceUri: 'at://did:example:publisher/app.patchwork.directory.resource/site',
        resourceName: 'Community center', observedAt: '2026-11-01T00:00:00Z',
        sourceIdsByUrl: new Map([[evidence.sourceUrl, evidence.sourceId]]),
        profile: { version: 1, organizationName: 'Community aid', services: [
            { id: 'food', name: 'Meals', hours: { value: hours, evidence: oldEvidence } },
            { id: 'phone', name: 'Telephone advice', delivery: { value: 'remote', evidence: oldEvidence } },
        ] },
    });
    it('preserves evidence dates, leaves legacy inputs intact, and does not invent a hash or remote location', () => {
        const input = options();
        const before = JSON.stringify(input.profile);
        const value = directoryFromLegacyProfile(input);
        expect(JSON.stringify(input.profile)).toBe(before);
        expect(value.serviceLocations).toHaveLength(1);
        expect(value.assertions[0]!.evidence).toMatchObject({ confirmedAt: oldEvidence.confirmedAt,
            expiresAt: oldEvidence.expiresAt, rawSha256: null });
        expect(currentDirectoryAssertion(value.assertions[0]!, new Date(input.observedAt))).toBe(false);
        expect(directoryFromLegacyProfile(input)).toEqual(value);
    });
    it('requires explicit source identity and keeps similarly named legacy organizations separate', () => {
        const input = options();
        expect(() => directoryFromLegacyProfile({ ...input, sourceIdsByUrl: new Map() })).toThrow('source identity');
        const first = directoryFromLegacyProfile(input);
        const second = directoryFromLegacyProfile({ ...input, resourceUri: `${input.resourceUri}-other` });
        expect(first.organizations[0]!.id).not.toBe(second.organizations[0]!.id);
    });
});
