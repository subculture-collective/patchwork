import index from './postal-index.json' with { type: 'json' };
import counties from './county-index.json' with { type: 'json' };
import names from './geography-names.json' with { type: 'json' };
import { z } from 'zod';

/** Advisory privacy warning only; land area is not an anonymity guarantee. */
export const SMALL_POSTAL_AREA_SQUARE_METRES = 1_000_000;

export const POSTAL_GEOGRAPHY_VERSION = 'census2020' as const;

export interface PostalArea {
    landAreaSquareMetres: number;
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
    const [latitude, longitude, countyId, stateId, landAreaSquareMetres] = value as [number, number, string, string, number];
    return {
        landAreaSquareMetres, postalCode, countryCode: 'US', latitude, longitude, countyId, stateId,
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

export function isSmallPostalArea(postalCode: string): boolean {
    const area = lookupPostalArea(postalCode);
    return area !== undefined && area.landAreaSquareMetres < SMALL_POSTAL_AREA_SQUARE_METRES;
}

export function lookupCountyArea(countyId: string) {
    const value = (counties as Record<string, (string | number)[]>)[countyId];
    if (!value || !/^\d{5}$/.test(countyId)) return undefined;
    const [latitude, longitude, stateId, landAreaSquareMetres] = value as [number, number, string, number];
    const countyName = (names as Record<string,string>)[countyId];
    const stateName = (names as Record<string,string>)[stateId];
    return {countryCode:'US' as const, countyId, countyName, stateId, stateName, latitude, longitude,
        landAreaSquareMetres, areaLabel:`${countyName}, ${stateName}`,
        precisionKm:Math.max(1, Math.sqrt(landAreaSquareMetres / Math.PI) / 1000), geographyVersion:POSTAL_GEOGRAPHY_VERSION};
}

/** The public county wire record contains no ZIP or coordinates. */
export const countyLocationSchema = z.object({
    countryCode:z.literal('US'),
    countyId:z.string().regex(/^\d{5}$/).refine(id=>lookupCountyArea(id)!==undefined,'Choose a supported county.'),
}).strict();
