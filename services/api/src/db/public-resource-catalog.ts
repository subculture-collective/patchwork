import { z } from 'zod';
import snapshot from './seed-data/chicago-public-libraries.json' with { type: 'json' };
import { postalLocationSchema } from '../../../../packages/at-lexicons/src/postal-geography.js';

const publicResourceSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    category: z.literal('other'),
    streetAddress: z.string().min(1).max(300),
    city: z.literal('Chicago'),
    state: z.literal('IL'),
    postalCode: postalLocationSchema.shape.postalCode,
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    phone: z.string().min(7).optional(),
    website: z.string().url().refine(url => new URL(url).hostname === 'www.chipublib.org'),
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
        source: sourceSchema,
        resources: z.array(publicResourceSchema).min(1),
    }).strict().parse(input);
    if (new Set(catalog.resources.map(resource => resource.id)).size !== catalog.resources.length) {
        throw new Error('Duplicate public resource source identifier.');
    }
    return {
        ...catalog,
        resources: catalog.resources.map(resource => ({
            ...resource,
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
