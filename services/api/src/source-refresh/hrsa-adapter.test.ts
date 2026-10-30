import { expect, it } from 'vitest';
import { normalizeHrsaFeatures, HRSA_COLLECTION_POLICY, HRSA_LOCATOR } from './hrsa-adapter.js';
import { type ArcgisFeature } from './arcgis-contract.js';
const feature = (id = 1): ArcgisFeature => ({ attributes: { OBJECTID: id, SITE_SOURCE_ID: `SITE-${id}`, SITE_NM: 'Clínica Community Health',
    HCC_STATUS_DESC: 'Active', HCC_LOC_DESC: 'Permanent', HCC_LOC_SETTING_DESC: 'All Other Clinic Types', APPROX_VALUE_CD: 'N', LOC_NAME_DESC: 'Address Level',
    SITE_ZIP_CD: '60601-1234', SITE_STATE_ABBR: 'IL', STATE_COUNTY_FIPS_CD: '17031', SITE_ADDRESS: '123 Example St', SITE_CITY: 'Chicago',
    SITE_URL: 'clinic.example', SITE_PHONE_NUM: '(312) 555-0100' }, geometry: { x: -87.62, y: 41.88 } });
it('preserves existing ID convention, public geography and bilingual names without qualified hours', () => {
    const result = normalizeHrsaFeatures([feature()]); const resource = result.resources[0]!;
    expect(resource.id).toBe('hrsa-site-site-1'); expect(resource.postalCode).toBe('60601');
    expect(resource.name).toBe('Clínica Community Health'); expect(resource.website).toBe('https://clinic.example');
    expect(resource.usualHours).toContain('Contact'); expect(resource).not.toHaveProperty('eligibility');
    expect(HRSA_COLLECTION_POLICY.contract.fields).not.toHaveProperty('ADMIN_PHONE_NUM');
});
it.each([
    ['HCC_STATUS_DESC', 'Inactive', 'inactive-or-nonpermanent'], ['HCC_LOC_DESC', 'Mobile', 'inactive-or-nonpermanent'],
    ['SITE_NM', 'County Jail Clinic', 'restricted-setting'], ['HCC_LOC_SETTING_DESC', 'School', 'restricted-setting'],
    ['APPROX_VALUE_CD', 'Y', 'coordinates-not-address-level'], ['LOC_NAME_DESC', 'ZIP centroid', 'coordinates-not-address-level'],
    ['SITE_ADDRESS', 'P.O. Box 12', 'missing-public-street-address'], ['SITE_ADDRESS', 'Suppressed', 'missing-public-street-address'],
    ['SITE_ZIP_CD', '60601garbage', 'unsupported-geography'], ['SITE_STATE_ABBR', 'ZZ', 'invalid-resource-fields'],
])('records exclusion for %s=%s', (field, value, reason) => {
    const excluded = feature(2); excluded.attributes[field] = value;
    const result = normalizeHrsaFeatures([feature(), excluded]);
    expect(result.resources).toHaveLength(1); expect(result.exclusions).toEqual([{ objectId: 2, reason }]);
});
it('keeps distinct co-located service identities, but rejects duplicate service IDs', () => {
    expect(normalizeHrsaFeatures([feature(2), feature(1)]).resources.map(r => r.id)).toEqual(['hrsa-site-site-1', 'hrsa-site-site-2']);
    const duplicate = feature(2); duplicate.attributes.SITE_SOURCE_ID = 'SITE-1';
    expect(() => normalizeHrsaFeatures([feature(), duplicate])).toThrow('service identity');
});
it('uses the official locator for unsafe URLs and rejects absent usable locations', () => {
    for (const url of ['https://user:secret@clinic.example', 'javascript:alert(1)', '', 'bad url']) {
        const f = feature(); f.attributes.SITE_URL = url;
        expect(normalizeHrsaFeatures([f]).resources[0]!.website).toBe(HRSA_LOCATOR);
    }
    const f = feature(); f.geometry = null;
    expect(() => normalizeHrsaFeatures([f])).toThrow('No eligible');
});
