import { z } from 'zod';
import { resourceServices } from '../../../../packages/shared/src/resource-services.js';
import { directoryResourceSchema } from '@patchwork/at-lexicons';
import snapshot from './seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { postalLocationSchema } from '../../../../packages/at-lexicons/src/postal-geography.js';

const publicResourceSchema = z.object({
    id: z.string().min(1),
    services: z.array(z.enum(resourceServices)).min(1).optional(),
    name: z.string().min(1).max(120),
    category: directoryResourceSchema.shape.category,
    sourceId: z.string().min(1),
    countyId: z.string().regex(/^\d{5}$/),
    coordinateBasis: z.enum(['publisher-address', 'census-address-range']),
    streetAddress: z.string().min(1).max(300),
    city: z.string().min(1),
    state: z.enum(['IL', 'IN', 'WI']),
    postalCode: postalLocationSchema.shape.postalCode,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    phone: z.string().min(7).optional(),
    website: z.string().url().refine(url => ['https:', 'http:'].includes(new URL(url).protocol)),
    usualHours: z.string().min(1).max(200),
    claimStatus: z.literal('unclaimed'),
    publicAccess: z.string().min(1).max(500),
}).strict();

const sourceSchema = z.object({
    name: z.string().min(1),
    url: z.string().url(),
    apiUrl: z.string().url(),
    retrievedAt: z.string().date(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

/** Import provenance establishes a public location, never ownership or endorsement. */
export function parsePublicResourceCatalog(input: unknown) {
    const catalog = z.object({
        scope: z.object({ name: z.string(), countyIds: z.array(z.string().regex(/^\d{5}$/)).min(1), sourceUrl: z.string().url() }).strict(),
        sources: z.record(sourceSchema),
        resources: z.array(publicResourceSchema).min(1),
    }).strict().parse(input);
    if (new Set(catalog.resources.map(resource => resource.id)).size !== catalog.resources.length) {
        throw new Error('Duplicate public resource source identifier.');
    }
    const locations = new Set<string>();
    for (const resource of catalog.resources) {
        const key = [resource.name.trim().toLowerCase(), resource.streetAddress.trim().toLowerCase(), resource.postalCode].join('|');
        if (locations.has(key)) throw new Error('Duplicate public resource location.');
        locations.add(key);
        if (!catalog.sources[resource.sourceId]) throw new Error('Missing resource provenance.');
        if (!catalog.scope.countyIds.includes(resource.countyId)) throw new Error('Resource outside catalog scope.');
    }
    return {
        ...catalog,
        resources: catalog.resources.map(resource => ({
            ...resource,
            source: catalog.sources[resource.sourceId]!,
            // Source schedules are not a real-time open-now assertion.
            operationalStatus: /closed until further notice/i.test(resource.usualHours)
                ? 'closed' as const : 'unknown' as const,
        })),
    };
}

export const publicResourceCatalog = parsePublicResourceCatalog(snapshot);
export const publicResourceSeed = publicResourceCatalog.resources.filter(
    resource => resource.operationalStatus !== 'closed',
);
