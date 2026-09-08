#!/usr/bin/env python3
"""Build a reviewable HRSA national catalog from a complete downloaded FeatureServer snapshot.

Usage: python3 scripts/build-national-resources.py INPUT.json --retrieved-at YYYY-MM-DD
Input must contain the complete `features` array. This command never writes to a database.
"""
import argparse
from collections import Counter
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'services/api/src/db/seed-data'
STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split()
LOCATOR = 'https://findahealthcenter.hrsa.gov/'
API = 'https://gisportal.hrsa.gov/server/rest/services/HealthCareFacilities/PrimaryHealthCareFacilities_FS/MapServer/0/query'


def website(raw):
    value = str(raw or '').strip()
    if not value.startswith(('http://', 'https://')):
        value = 'https://' + value
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or '.' not in parsed.hostname or re.search(r'\s', value) or parsed.username:
        return LOCATOR
    return value


def key(resource):
    # Ignore punctuation and standard street suffix spelling for cross-source duplicates.
    address = re.sub(r'\b(street|avenue|road|drive|boulevard)\b', lambda m: {'street':'st','avenue':'ave','road':'rd','drive':'dr','boulevard':'blvd'}[m[0]], resource['streetAddress'].lower())
    return (re.sub(r'\W', '', resource['name'].lower()), re.sub(r'\W', '', address), resource['postalCode'])


def build(raw, retrieved_at):
    original = json.loads((DATA / 'chicago-metro-public-resources.json').read_text())
    postal = json.loads((ROOT / 'packages/at-lexicons/src/postal-index.json').read_text())
    seen = {key(r) for r in original['resources']}
    identifiers = set()
    resources = []
    skipped = Counter()
    for feature in raw['features']:
        a = feature['attributes']
        if a['HCC_STATUS_DESC'] != 'Active' or a['HCC_LOC_DESC'] != 'Permanent':
            skipped['inactive_or_nonpermanent'] += 1; continue
        if a['HCC_LOC_SETTING_DESC'] not in ('All Other Clinic Types', 'Hospital') or re.search(r'\b(jail|prison|correctional|detention|school)\b', a['SITE_NM'], re.I):
            skipped['restricted_setting'] += 1; continue
        if a['APPROX_VALUE_CD'] != 'N' or 'address level' not in a['LOC_NAME_DESC'].lower():
            skipped['coordinates_not_address_level'] += 1; continue
        zip_code = str(a['SITE_ZIP_CD'] or '')[:5]
        if zip_code not in postal or a['SITE_STATE_ABBR'] not in STATES or not re.fullmatch(r'\d{5}', str(a['STATE_COUNTY_FIPS_CD'] or '')):
            skipped['unsupported_geography'] += 1; continue
        address = str(a['SITE_ADDRESS'] or '').strip()
        if not address or re.search(r'\bP\.?\s*O\.?\s*BOX\b', address, re.I):
            skipped['missing_public_street_address'] += 1; continue
        source_id = str(a['SITE_SOURCE_ID'] or '').lower()
        if not re.fullmatch(r'[a-z0-9-]+', source_id):
            raise ValueError('Missing stable source identifier')
        resource = dict(id='hrsa-site-'+source_id, sourceId='hrsa-national', name=a['SITE_NM'].strip(),
            category='clinic', services=['health'], streetAddress=address, city=a['SITE_CITY'].strip(),
            state=a['SITE_STATE_ABBR'], postalCode=zip_code, countyId=a['STATE_COUNTY_FIPS_CD'],
            latitude=feature['geometry']['y'], longitude=feature['geometry']['x'], coordinateBasis='publisher-address',
            website=website(a['SITE_URL']), usualHours='Contact the health center for current hours and appointments.',
            claimStatus='unclaimed', publicAccess='HRSA-listed health center. Contact the center about services, appointments, fees and eligibility before visiting.')
        if len(resource['name']) > 120:
            skipped['name_exceeds_record_limit'] += 1; continue
        phone = str(a['SITE_PHONE_NUM'] or '').strip()
        if len(re.sub(r'\D', '', phone)) >= 10: resource['phone'] = phone
        if key(resource) in seen:
            skipped['existing_or_duplicate_location'] += 1; continue
        if resource['id'] in identifiers: raise ValueError('Duplicate source identifier')
        seen.add(key(resource)); identifiers.add(resource['id']); resources.append(resource)
    resources.sort(key=lambda r:r['id'])
    if not resources: raise ValueError('No eligible resources')
    return dict(scope=dict(name='United States — national health-center coverage',countyIds=sorted({r['countyId'] for r in resources}),sourceUrl=LOCATOR),
        sources={'hrsa-national':dict(name='HRSA — national health-center service delivery sites',url='https://data.hrsa.gov/topics/health-centers/',apiUrl=API,retrievedAt=retrieved_at,sha256=hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest())},resources=resources), skipped


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--retrieved-at', type=date.fromisoformat, required=True)
    args = parser.parse_args()
    catalog, skipped = build(json.loads(args.input.read_text()), args.retrieved_at.isoformat())
    (DATA / 'national-public-resources.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(added=len(catalog['resources']),states=dict(sorted(Counter(r['state'] for r in catalog['resources']).items())),skipped=dict(skipped)),indent=2))
