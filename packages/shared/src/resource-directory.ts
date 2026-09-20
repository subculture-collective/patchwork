import { z } from 'zod';
import { eligibilityRuleSchema, serviceHoursSchema } from './resource-profile.js';

const id = z.string().trim().min(1).max(800);
const name = z.string().trim().min(1).max(200);
const text = z.string().trim().min(1).max(2000);
const url = z.string().url().refine(value => /^https?:\/\//.test(value));
const subjectTypes = ['organization', 'place', 'service', 'service-location'] as const;

/** Publisher organization identity is not a verified Patchwork organization claim. */
const organization = z.object({ id, name }).strict();
// Confidential places carry no address or coordinates in this exchange contract.
// Public coordinates continue to use the existing reviewed address boundary.
const place = z.object({
    id, name, visibility: z.enum(['public', 'confidential']),
    legacyResourceUri: z.string().max(500).optional(),
}).strict().refine(value => value.visibility === 'public' || !value.legacyResourceUri,
    'Confidential places cannot expose a public listing reference.');
const service = z.object({
    id, name, organizationId: id.optional(),
    delivery: z.enum(['in-person', 'remote', 'hybrid', 'unknown']),
}).strict();
const serviceLocation = z.object({ id, serviceId: id, placeId: id }).strict();

export const directoryEvidenceSchema = z.object({
    sourceId: z.string().min(1).max(200), sourceName: name, sourceUrl: url,
    observedAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    reviewState: z.enum(['pending', 'reviewed', 'rejected']),
    conflictState: z.enum(['none', 'open', 'resolved']),
    // Old profiles have provenance but no raw-byte hash; never invent one.
    rawSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).strict().superRefine((value, ctx) => {
    if (value.reviewState === 'reviewed' && (!value.confirmedAt || !value.expiresAt)) {
        ctx.addIssue({ code: 'custom', message: 'Reviewed assertions need confirmation and expiry.' });
    }
    if (value.expiresAt && (!value.confirmedAt || Date.parse(value.expiresAt) <= Date.parse(value.confirmedAt))) {
        ctx.addIssue({ code: 'custom', message: 'Expiry must follow confirmation.' });
    }
});

const base = { id, subjectType: z.enum(subjectTypes), subjectId: id, evidence: directoryEvidenceSchema };
const field = <K extends string, T extends z.ZodType>(key: K, value: T) =>
    z.object({ ...base, field: z.literal(key), value }).strict();
export const directoryAssertionSchema = z.discriminatedUnion('field', [
    field('name', name), field('hours', serviceHoursSchema),
    field('eligibility', z.array(eligibilityRuleSchema).max(30)),
    field('cost', text), field('serviceArea', text),
    field('languages', z.array(name).max(30)),
    field('accessibility', z.array(name).max(30)),
    field('documents', z.array(name).max(30)),
    field('appointment', z.enum(['required', 'recommended', 'walk-in'])),
    field('applicationUrl', url),
    field('delivery', z.enum(['in-person', 'remote', 'hybrid'])),
]);
export type DirectoryAssertion = z.infer<typeof directoryAssertionSchema>;

/** Graph edges establish identity relationships only; they never inherit assertions. */
export const resourceDirectorySchema = z.object({
    version: z.literal(1),
    organizations: z.array(organization).max(1000),
    places: z.array(place).max(1000),
    services: z.array(service).max(5000),
    serviceLocations: z.array(serviceLocation).max(10000),
    assertions: z.array(directoryAssertionSchema).max(50000),
}).strict().superRefine((graph, ctx) => {
    const groups = { organization: graph.organizations, place: graph.places,
        service: graph.services, 'service-location': graph.serviceLocations };
    const sets = Object.fromEntries(Object.entries(groups).map(([kind, entries]) => [kind, new Set(entries.map(entry => entry.id))]));
    for (const [kind, entries] of Object.entries(groups)) {
        if (sets[kind]!.size !== entries.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${kind} identity.` });
    }
    for (const item of graph.services) {
        if (item.organizationId && !sets.organization!.has(item.organizationId))
            ctx.addIssue({ code: 'custom', message: 'Service organization does not exist.' });
    }
    const pairs = new Set<string>();
    const servicesById = new Map(graph.services.map(item => [item.id, item]));
    for (const link of graph.serviceLocations) {
        const target = servicesById.get(link.serviceId);
        if (!target || !sets.place!.has(link.placeId))
            ctx.addIssue({ code: 'custom', message: 'Service-location endpoint does not exist.' });
        if (target?.delivery === 'remote') ctx.addIssue({ code: 'custom', message: 'Remote-only service cannot require a physical place.' });
        const pair = JSON.stringify([link.serviceId, link.placeId]);
        if (pairs.has(pair)) ctx.addIssue({ code: 'custom', message: 'Duplicate service-location relationship.' });
        pairs.add(pair);
    }
    if (new Set(graph.assertions.map(item => item.id)).size !== graph.assertions.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate assertion identity.' });
    for (const assertion of graph.assertions) {
        if (!sets[assertion.subjectType]!.has(assertion.subjectId))
            ctx.addIssue({ code: 'custom', message: 'Assertion subject does not exist.' });
        if (assertion.field === 'eligibility' && !['service', 'service-location'].includes(assertion.subjectType))
            ctx.addIssue({ code: 'custom', message: 'Eligibility belongs to a service or its location-specific delivery.' });
    }
});
export type ResourceDirectory = z.infer<typeof resourceDirectorySchema>;

export function currentDirectoryAssertion(assertion: DirectoryAssertion, now: Date): boolean {
    const evidence = assertion.evidence;
    return evidence.reviewState === 'reviewed' && evidence.conflictState !== 'open'
        && evidence.confirmedAt !== null && evidence.expiresAt !== null
        && Date.parse(evidence.confirmedAt) <= now.getTime() && Date.parse(evidence.expiresAt) > now.getTime();
}

/** Multiple current claims remain visible as alternatives; no newest-source winner. */
export function directoryAssertionsFor(graph: ResourceDirectory, subjectType: DirectoryAssertion['subjectType'],
    subjectId: string, fieldName: DirectoryAssertion['field'], now: Date) {
    return graph.assertions.filter(assertion => assertion.subjectType === subjectType
        && assertion.subjectId === subjectId && assertion.field === fieldName
        && currentDirectoryAssertion(assertion, now));
}
