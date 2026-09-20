import { z } from 'zod';

export const sourceKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const definitionSchema = z.object({
    id: sourceKeySchema,
    adapter: z.string().min(1).max(80),
    adapterVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    owner: z.string().min(1).max(200),
    enabled: z.boolean(),
    cadence: z.string().min(1).max(200),
    geography: z.string().min(1).max(200),
    publication: z.literal('review-only'),
    maxAttempts: z.number().int().min(1).max(3),
    retryBaseMs: z.number().int().min(1).max(10_000),
    minRows: z.number().int().positive(),
    maxRows: z.number().int().positive(),
    maxBytes: z.number().int().positive().max(1_000_000),
}).strict().refine(value => value.minRows <= value.maxRows, 'Invalid complete-feed row bounds.');

export type SourceDefinition = Readonly<z.infer<typeof definitionSchema>>;

/** Only qualified adapters belong here. Inventory entries are not fetch authority. */
export function createSourceRegistry(values: unknown): ReadonlyMap<string, SourceDefinition> {
    const entries = z.array(definitionSchema).parse(values);
    const registry = new Map<string, SourceDefinition>();
    for (const entry of entries) {
        if (registry.has(entry.id)) throw new Error('Duplicate registered source.');
        registry.set(entry.id, Object.freeze(entry));
    }
    return registry;
}

export const sourceRegistry = createSourceRegistry([{
    id: 'cpl', adapter: 'chicago-public-library', adapterVersion: '1.0.0',
    owner: 'Patrick Fanella', enabled: true,
    cadence: 'Daily 03:15 America/Chicago with up to 30 minutes of jitter',
    geography: 'Chicago, Illinois; Cook County 17031', publication: 'review-only',
    maxAttempts: 3, retryBaseMs: 1_000, minRows: 75, maxRows: 100, maxBytes: 1_000_000,
}]);

export function resolveSource(id: string, registry = sourceRegistry): SourceDefinition {
    const source = registry.get(sourceKeySchema.parse(id));
    if (!source) throw new Error('Source is not registered with a qualified adapter.');
    return source;
}

/** A pause can only disable registered jobs; it can never enable an adapter. */
export function parsePausedSources(value = '', registry = sourceRegistry): ReadonlySet<string> {
    const paused = new Set<string>();
    for (const id of value.split(',').map(item => item.trim()).filter(Boolean)) {
        resolveSource(id, registry);
        paused.add(id);
    }
    return paused;
}
