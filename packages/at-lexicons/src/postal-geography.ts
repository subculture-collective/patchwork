import index from './postal-index.json' with { type: 'json' };
import names from './geography-names.json' with { type: 'json' };
import { z } from 'zod';

export const POSTAL_GEOGRAPHY_VERSION = 'census2020' as const;

export interface PostalArea {
    postalCode: string;
    countryCode: 'US';
    latitude: number;
    longitude: number;
    countyId: string;
    countyName: string;
    stateId: string;
    stateName: string;
    geographyVersion: typeof POSTAL_GEOGRAPHY_VERSION;
}

/** Public ZCTA representative points, never a person's coordinates. */
export function lookupPostalArea(postalCode: string): PostalArea | undefined {
    if (!/^\d{5}$/.test(postalCode)) return undefined;
    const value = (index as Record<string, (string | number)[]>)[postalCode];
    if (!value) return undefined;
    const [latitude, longitude, countyId, stateId] = value as [number, number, string, string];
    return {
        postalCode, countryCode: 'US', latitude, longitude, countyId, stateId,
        countyName: (names as Record<string, string>)[countyId],
        stateName: (names as Record<string, string>)[stateId],
        geographyVersion: POSTAL_GEOGRAPHY_VERSION,
    };
}

export const postalLocationSchema = z.object({
    countryCode: z.literal('US'),
    postalCode: z.string().regex(/^\d{5}$/, 'Enter a five-digit ZIP code.')
        .refine(code => lookupPostalArea(code) !== undefined,
            'This ZIP does not have a supported geographic area. Choose the ZIP where help is needed.'),
}).strict();

export type PostalLocation = z.infer<typeof postalLocationSchema>;
