import { resourceProfileSchema, type ResourceEvidence } from './resource-profile.js';
import { resourceDirectorySchema, type DirectoryAssertion, type ResourceDirectory } from './resource-directory.js';

/** Additive compatibility view. Never mutates profiles, renews review, or guesses shared ownership. */
export function directoryFromLegacyProfile(options: {
    resourceUri: string; resourceName: string; profile: unknown; observedAt: string;
    sourceIdsByUrl: ReadonlyMap<string, string>;
}): ResourceDirectory {
    const profile = resourceProfileSchema.parse(options.profile);
    const prefix = `legacy:${options.resourceUri}`;
    const placeId = `${prefix}:place`;
    const organizationId = profile.organizationName ? `${prefix}:organization` : undefined;
    const assertions: DirectoryAssertion[] = [];
    function add(subjectId: string, suffix: string, field: DirectoryAssertion['field'], value: unknown, old: ResourceEvidence) {
        const sourceId = options.sourceIdsByUrl.get(old.sourceUrl);
        if (!sourceId) throw new Error('Legacy evidence URL needs an explicit source identity.');
        assertions.push({ id: `${subjectId}:${suffix}`, subjectType: 'service', subjectId, field, value,
            evidence: { sourceId, sourceName: old.sourceName, sourceUrl: old.sourceUrl,
                observedAt: options.observedAt, confirmedAt: old.confirmedAt, expiresAt: old.expiresAt,
                reviewState: old.reviewStatus === 'reviewed' ? 'reviewed' : 'pending',
                conflictState: old.reviewStatus === 'conflicting' ? 'open' : 'none', rawSha256: null },
        } as DirectoryAssertion);
    }
    const services = profile.services.map(item => {
        const serviceId = `${prefix}:service:${item.id}`;
        for (const key of ['delivery', 'serviceArea', 'cost', 'languages', 'accessibility', 'documents', 'appointment', 'applicationUrl', 'hours'] as const) {
            const assertion = item[key];
            if (assertion) add(serviceId, key, key, assertion.value, assertion.evidence);
        }
        item.eligibility.forEach((rule, index) => add(serviceId, `eligibility:${index}`, 'eligibility', [rule], rule.evidence));
        return { id: serviceId, name: item.name, ...(organizationId ? { organizationId } : {}),
            delivery: item.delivery?.value ?? 'unknown' as const };
    });
    return resourceDirectorySchema.parse({
        version: 1,
        organizations: organizationId ? [{ id: organizationId, name: profile.organizationName }] : [],
        places: [{ id: placeId, name: options.resourceName, visibility: 'public', legacyResourceUri: options.resourceUri }],
        services,
        serviceLocations: services.filter(item => item.delivery !== 'remote').map(item => ({
            id: `${item.id}:location`, serviceId: item.id, placeId,
        })),
        assertions,
    });
}
