import { publicResourceSchema } from '../db/public-resource-catalog.js';
import { type ArcgisFeature } from './arcgis-contract.js';
import { type ArcgisCollectionPolicy } from './arcgis-collection.js';

export const HRSA_SOURCE_KEY = 'hrsa-national-v1';
export const HRSA_LOCATOR = 'https://findahealthcenter.hrsa.gov/';
export const HRSA_QUERY_URL = 'https://gisportal.hrsa.gov/server/rest/services/HealthCareFacilities/PrimaryHealthCareFacilities_FS/MapServer/0/query';
const names = ['HCC_STATUS_DESC', 'HCC_LOC_DESC', 'HCC_LOC_SETTING_DESC', 'SITE_NM', 'APPROX_VALUE_CD', 'LOC_NAME_DESC',
    'SITE_ZIP_CD', 'SITE_STATE_ABBR', 'STATE_COUNTY_FIPS_CD', 'SITE_ADDRESS', 'SITE_SOURCE_ID', 'SITE_CITY', 'SITE_URL', 'SITE_PHONE_NUM'];
export const HRSA_COLLECTION_POLICY: ArcgisCollectionPolicy = {
    queryUrl: HRSA_QUERY_URL, pageSize: 500, maxPages: 50, maxTotalBytes: 32 * 1024 * 1024, timeoutMs: 300_000,
    contract: { idField: 'OBJECTID', fields: { OBJECTID: 'esriFieldTypeOID', ...Object.fromEntries(names.map(name => [name, 'esriFieldTypeString' as const])) },
        minRecords: 10_000, maxRecords: 25_000, maxPageBytes: 1_000_000 },
};
function website(raw: string) {
    try {
        if (!raw || /\s/.test(raw)) return HRSA_LOCATOR;
        const value = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && url.hostname.includes('.') && !url.username && !url.password ? value : HRSA_LOCATOR;
    } catch { return HRSA_LOCATOR; }
}

/** Matches existing HRSA IDs and exclusions; creates no hours or eligibility assertions. */
export function normalizeHrsaFeatures(features: readonly ArcgisFeature[]) {
    const resources: ReturnType<typeof publicResourceSchema.parse>[] = [];
    const exclusions: { objectId: number; reason: string }[] = [];
    const ids = new Set<string>(); const objectIds = new Set<number>();
    for (const feature of features) {
        const objectId = feature.attributes.OBJECTID;
        if (typeof objectId !== 'number' || !Number.isSafeInteger(objectId) || objectId < 0 || objectIds.has(objectId)) throw new Error('Invalid HRSA object identity.');
        objectIds.add(objectId);
        const text = (name: string) => {
            const value = feature.attributes[name];
            if (value !== null && typeof value !== 'string') throw new Error('HRSA attribute schema changed.');
            return value?.trim() ?? '';
        };
        const exclude = (reason: string) => { exclusions.push({ objectId, reason }); };
        if (text('HCC_STATUS_DESC') !== 'Active' || text('HCC_LOC_DESC') !== 'Permanent') { exclude('inactive-or-nonpermanent'); continue; }
        if (!['All Other Clinic Types', 'Hospital'].includes(text('HCC_LOC_SETTING_DESC'))
            || /\b(jail|prison|correctional|detention|school)\b/i.test(text('SITE_NM'))) { exclude('restricted-setting'); continue; }
        if (text('APPROX_VALUE_CD') !== 'N' || !text('LOC_NAME_DESC').toLowerCase().includes('address level') || !feature.geometry) {
            exclude('coordinates-not-address-level'); continue;
        }
        const address = text('SITE_ADDRESS');
        if (!address || /\bP\.?\s*O\.?\s*BOX\b/i.test(address)
            || /^(?:confidential|suppressed|undisclosed|not available|n\/a|do not publish)$/i.test(address)) {
            exclude('missing-public-street-address'); continue;
        }
        const id = text('SITE_SOURCE_ID').toLowerCase();
        if (!/^[a-z0-9-]{1,100}$/.test(id) || ids.has(id)) throw new Error('Missing or duplicate HRSA service identity.');
        ids.add(id);
        const zip = text('SITE_ZIP_CD');
        if (!/^\d{5}(?:-?\d{4})?$/.test(zip)) { exclude('unsupported-geography'); continue; }
        const phone = text('SITE_PHONE_NUM');
        const result = publicResourceSchema.safeParse({ id: `hrsa-site-${id}`, sourceId: 'hrsa-national', name: text('SITE_NM'),
            category: 'clinic', services: ['health'], streetAddress: address, city: text('SITE_CITY'), state: text('SITE_STATE_ABBR'),
            postalCode: zip.slice(0, 5), countyId: text('STATE_COUNTY_FIPS_CD'), latitude: feature.geometry.y, longitude: feature.geometry.x,
            coordinateBasis: 'publisher-address', website: website(text('SITE_URL')),
            ...(phone.replace(/\D/g, '').length >= 10 ? { phone } : {}),
            usualHours: 'Contact the health center for current hours and appointments.', claimStatus: 'unclaimed',
            publicAccess: 'HRSA-listed health center. Contact the center about services, appointments, fees and eligibility before visiting.' });
        if (!result.success) { exclude('invalid-resource-fields'); continue; }
        resources.push(result.data);
    }
    if (!resources.length) throw new Error('No eligible HRSA locations.');
    resources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    exclusions.sort((a, b) => a.objectId - b.objectId);
    // Co-located services remain distinct. Matching/publication policy is a separate review step.
    return { adapterVersion: '1.0.0' as const, resources, exclusions, inputCount: features.length };
}
