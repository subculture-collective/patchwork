import { z } from 'zod';
export const resourceMapViewportSchema = z
    .object({
        west: z.number().min(-180).max(180),
        east: z.number().min(-180).max(180),
        south: z.number().min(-90).max(90),
        north: z.number().min(-90).max(90),
        zoom: z.number().int().min(0).max(20),
    })
    .strict()
    .refine((v) => v.south < v.north);
export const resourceMapCellSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    count: z.number().int().positive(),
    members: z.array(z.object({ uri: z.string(), name: z.string() })).max(20),
    resourceUri: z.string().nullable(),
    west: z.number(),
    east: z.number(),
    south: z.number(),
    north: z.number(),
});
export const resourceMapResponseSchema = z.object({
    total: z.number().int().nonnegative(),
    mapped: z.number().int().nonnegative(),
    cells: z.array(resourceMapCellSchema),
});
export type ResourceMapCell = z.infer<typeof resourceMapCellSchema>;
export type ResourceMapViewport = z.infer<typeof resourceMapViewportSchema>;
