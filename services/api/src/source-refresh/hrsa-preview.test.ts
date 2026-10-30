import { expect, it } from 'vitest';
import { previewHrsaFeatures } from './hrsa-preview.js';
import { normalizeHrsaFeatures } from './hrsa-adapter.js';
import { type ArcgisFeature } from './arcgis-contract.js';
const feature = (id: number): ArcgisFeature => ({ attributes: { OBJECTID: id, SITE_SOURCE_ID: `site-${id}`, SITE_NM: `Example Clinic ${id}`,
    HCC_STATUS_DESC: 'Active', HCC_LOC_DESC: 'Permanent', HCC_LOC_SETTING_DESC: 'Hospital', APPROX_VALUE_CD: 'N', LOC_NAME_DESC: 'Address Level',
    SITE_ZIP_CD: '60601', SITE_STATE_ABBR: 'IL', STATE_COUNTY_FIPS_CD: '17031', SITE_ADDRESS: '123 Example Street', SITE_CITY: 'Chicago',
    SITE_URL: 'https://clinic.example', SITE_PHONE_NUM: null }, geometry: { x: -87.62, y: 41.88 } });
it('compares stable identities and routes changes and missing records to review', () => {
    const baseline = normalizeHrsaFeatures([feature(1), feature(2), feature(3)]).resources;
    const changed = feature(2); changed.attributes.SITE_PHONE_NUM = '3125550100';
    const preview = previewHrsaFeatures([feature(1), changed, feature(4)], baseline);
    expect(preview.decisions.map(d => [d.resourceId, d.status])).toEqual([
        ['hrsa-site-site-1', 'unchanged'], ['hrsa-site-site-2', 'changed-review'], ['hrsa-site-site-3', 'missing-review'], ['hrsa-site-site-4', 'new-review']]);
    expect(preview.decisions[1]!.changedFields).toEqual(['phone']);
    expect(preview.baselineKind).toBe('checked-in-catalog');
});
it('flags Chicago overlap and co-located identities without merging or deleting them', () => {
    const f = feature(1); const baseline = normalizeHrsaFeatures([f]).resources;
    baseline[0] = { ...baseline[0]!, id: 'chicago-clinic', sourceId: 'chicago', streetAddress: '123 Example St.' };
    const preview = previewHrsaFeatures([f], baseline);
    expect(preview.decisions[0]!.status).toBe('overlap-review');
    expect(preview.decisions[0]!.relatedIds).toEqual(['chicago-clinic']);
    expect(preview.resources).toHaveLength(1); expect(baseline[0]!.id).toBe('chicago-clinic');
});
it('is deterministic across input order and treats excluded baseline records as review-only absences', () => {
    const baseline = normalizeHrsaFeatures([feature(1), feature(2)]).resources;
    const inactive = feature(2); inactive.attributes.HCC_STATUS_DESC = 'Inactive';
    const first = previewHrsaFeatures([feature(1), inactive], baseline);
    expect(previewHrsaFeatures([inactive, feature(1)], [...baseline].reverse())).toEqual(first);
    expect(first.decisions[1]!.status).toBe('missing-review'); expect(first.exclusions).toHaveLength(1);
});
