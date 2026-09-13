import { resourcePrograms, resourceServices } from './resource-services.js';
import { z } from 'zod';

const approximate = z
    .number()
    .finite()
    .refine(
        (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
        'Saved locations must be approximate.',
    );
export const savedSearchSchema = z
    .object({
        nearbyIntent: z.enum(['resources', 'requests']).default('resources'),
        postalCode: z
            .string()
            .regex(/^\d{5}$/)
            .optional(),
        center: z
            .object({
                lat: approximate.pipe(z.number().min(-90).max(90)),
                lng: approximate.pipe(z.number().min(-180).max(180)),
            })
            .strict()
            .optional(),
        radiusMeters: z.number().int().min(1000).max(250000).optional(),
        category: z
            .enum([
                'food',
                'shelter',
                'medical',
                'transport',
                'childcare',
                'other',
            ])
            .optional(),
        status: z
            .enum(['open', 'in-progress', 'resolved', 'closed'])
            .optional(),
        minUrgency: z.number().int().min(1).max(5).optional(),
        feedTab: z.enum(['latest', 'nearby']).optional(),
        text: z.string().trim().max(200).optional(),
        resourceCategory: z
            .enum([
                'food-bank',
                'shelter',
                'clinic',
                'legal-aid',
                'hotline',
                'other',
            ])
            .optional(),
        resourceService: z.enum(resourceServices).optional(),
        resourceProgram: z.enum(resourcePrograms).optional(),
    })
    .strict();
export const savedDiscoveryInputSchema = z.discriminatedUnion('kind', [
    z
        .object({
            kind: z.literal('resource'),
            resourceUri: z
                .string()
                .regex(
                    /^at:\/\/did:[^\s/]+\/app\.patchwork\.directory\.resource\/[^\s/]+$/,
                )
                .max(500),
        })
        .strict(),
    z.object({ kind: z.literal('search'), search: savedSearchSchema }).strict(),
]);
export type SavedSearch = z.infer<typeof savedSearchSchema>;
export type SavedDiscoveryInput = z.infer<typeof savedDiscoveryInputSchema>;
export interface SavedDiscoveryItem {
    id: string;
    kind: 'resource' | 'search';
    resourceUri?: string;
    name?: string;
    search?: SavedSearch;
    createdAt: string;
    alertsEnabled?: boolean;
}
