import { describe, expect, it } from 'vitest';
import { lookupPostalArea, postalLocationSchema, lookupCountyArea, countyLocationSchema, isSmallPostalArea } from './postal-geography.js';
import { aidPostSchema, decodeAidPostFromAt, encodeAidPostForAt } from './validators.js';

describe('public ZIP locations', () => {
    const record = {
        $type: 'app.patchwork.aid.post', version: '2.0.0',
        title: 'Grocery pickup', description: 'Help with a grocery pickup.',
        category: 'food', urgency: 'medium', status: 'open',
        location: { countryCode: 'US', postalCode: '00601' },
        createdAt: '2026-09-06T12:00:00.000Z',
    };

    it('warns for small land areas and publishes only the selected county', () => {
        expect(isSmallPostalArea('10006')).toBe(true);
        expect(isSmallPostalArea('60625')).toBe(false);
        expect(isSmallPostalArea('00000')).toBe(false);
        const county=lookupCountyArea('36061')!;
        const parsed=aidPostSchema.parse({...record,version:'3.0.0',location:{countryCode:'US',countyId:'36061'}});
        expect(parsed.location).toMatchObject({countyId:'36061',latitude:county.latitude,longitude:county.longitude});
        expect(parsed.location.postalCode).toBeUndefined();
        const encoded=encodeAidPostForAt(parsed);
        expect(encoded.location).toEqual({countryCode:'US',countyId:'36061'});
        expect(encodeAidPostForAt(decodeAidPostFromAt(encoded))).toEqual(encoded);
        expect(countyLocationSchema.safeParse({...encoded.location,postalCode:'10006'}).success).toBe(false);
        expect(countyLocationSchema.safeParse({...encoded.location,latitude:40,longitude:-74}).success).toBe(false);
        expect(aidPostSchema.safeParse({...record,version:'3.0.0',location:{countryCode:'US',countyId:'00000'}}).success).toBe(false);
        expect(aidPostSchema.safeParse({...record,location:{countryCode:'US',countyId:'36061'}}).success).toBe(false);
    });

    it('publishes only ZIP and country, including after a decode/re-encode', () => {
        const parsed = aidPostSchema.parse(record);
        const encoded = encodeAidPostForAt(parsed);
        expect(encoded.location).toEqual({ countryCode: 'US', postalCode: '00601' });
        expect(encodeAidPostForAt(decodeAidPostFromAt(encoded))).toEqual(encoded);
        const overwritten = aidPostSchema.parse({ ...parsed, location: { ...parsed.location, latitude: 0, longitude: 0 } });
        expect(overwritten.location.latitude).toBe(parsed.location.latitude);
        expect(overwritten.location.longitude).toBe(parsed.location.longitude);
    });

    it('enforces ZIP for the new version while preserving legacy readers', () => {
        const location = { latitude: 41.9, longitude: -87.7, precisionKm: 5 };
        expect(aidPostSchema.safeParse({ ...record, location }).success).toBe(false);
        expect(aidPostSchema.safeParse({ ...record, version: '1.0.0' }).success).toBe(false);
        const legacy = aidPostSchema.parse({ ...record, version: '1.0.0', location });
        expect(decodeAidPostFromAt(encodeAidPostForAt(legacy))).toEqual(legacy);
    });
    it('preserves leading zeros and resolves a public geographic area', () => {
        expect(postalLocationSchema.parse({ countryCode: 'US', postalCode: '00601' }).postalCode).toBe('00601');
        expect(lookupPostalArea('00601')).toMatchObject({ postalCode: '00601', stateId: '72' });
        expect(lookupPostalArea('60625')).toMatchObject({ countyId: '17031', stateId: '17' });
    });

    it.each(['60625-1234', '6062', '00000', ' 60625', '60625 ', 'abcde'])(
        'rejects unsupported or more detailed ZIP input %s', postalCode => {
            expect(postalLocationSchema.safeParse({ countryCode: 'US', postalCode }).success).toBe(false);
        },
    );

    it('rejects street addresses and individual coordinates', () => {
        expect(postalLocationSchema.safeParse({ countryCode: 'US', postalCode: '60625', latitude: 41.97, longitude: -87.71 }).success).toBe(false);
        expect(postalLocationSchema.safeParse({ countryCode: 'US', postalCode: '60625', streetAddress: '123 Example Street' }).success).toBe(false);
        expect(postalLocationSchema.safeParse({ countryCode: 'CA', postalCode: '60625' }).success).toBe(false);
    });
});
