#!/usr/bin/env python3
"""Build Illinois benefits and WIC listings from official IDHS locator HTML snapshots.

Usage: python3 -B scripts/build-state-benefits.py SNAPSHOT_DIR --retrieved-at YYYY-MM-DD
Input files: idhs-5.html, idhs-11.html, idhs-30.html, fetched from
https://www.dhs.state.il.us/page.aspx?module=12&officetype=TYPE&county=
Writes the normalized catalog only; never changes the database.
"""
import argparse
from collections import Counter
from datetime import date
import hashlib
import importlib.util
import json
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('community_resources', Path(__file__).with_name('build-community-resources.py'))
community = importlib.util.module_from_spec(spec)
spec.loader.exec_module(community)
ROOT, DATA, clean = community.ROOT, community.DATA, community.clean
BASE = 'https://www.dhs.state.il.us/page.aspx?module=12'
TYPES = {
    5: ('idhs-benefits', 'Family Community Resource Centers', ['benefits', 'food', 'health', 'employment'],
        'Illinois IDHS public benefits office. Help with SNAP food assistance, cash assistance including TANF, medical assistance including Medicaid, and employment services.'),
    11: ('idhs-wic', 'Women, Infants and Children (WIC)', ['food', 'health', 'benefits', 'youth'],
        'WIC nutrition program for eligible pregnant and postpartum people, infants and children under 5. Offers nutrition benefits, education, breastfeeding support and referrals.'),
    30: ('idhs-snap-outreach', 'SNAP Connect outreach', ['benefits', 'food'],
        'IDHS-listed SNAP Connect outreach provider. Helps check SNAP eligibility, complete applications, resolve case questions and connect with other resources.'),
}


def build(folder, retrieved):
    postal = json.loads((ROOT/'packages/at-lexicons/src/postal-index.json').read_text())
    shapes = {f['properties']['id']: f['geometry'] for file in (ROOT/'apps/web/public/geography/census2020').glob('*-zip.json')
              for f in json.loads(file.read_text())['features']}
    prior = [r for file in ['chicago-metro-public-resources.json', 'national-public-resources.json',
                           'national-community-resources.json', 'national-government-resources.json']
             for r in json.loads((DATA/file).read_text())['resources']]
    seen = {community.key(r) for r in prior}
    resources, sources, skipped = [], {}, Counter()
    for type_id, (source_id, label, services, description) in TYPES.items():
        path = folder/f'idhs-{type_id}.html'
        html = path.read_text()
        match = re.search(r'var officeLocations = (\[.*?\]);', html, re.S)
        if not match: raise ValueError(f'Missing official officeLocations array in {path}')
        rows = json.loads(match.group(1))
        notes = {}
        for block in re.findall(r'<li>.*?</li>', html, re.S):
            identity = re.search(r'class="OfficeID" value="(\d+)"', block)
            note = re.search(r'<p class="OfficeNote">(.*?)</p>', block, re.S)
            if identity: notes[int(identity.group(1))] = clean(note.group(1)) if note else ''
        sources[source_id] = dict(name='Illinois Department of Human Services — '+label, url=BASE+f'&officetype={type_id}&county=',
            apiUrl=BASE+f'&officetype={type_id}&county=', retrievedAt=retrieved,
            sha256=hashlib.sha256(path.read_bytes()).hexdigest())
        for row in rows:
            if row['id'] not in notes: raise ValueError('Map record missing matching visible office listing')
            name, street, note = clean(row['name']), clean(row['address1']), notes[row['id']]
            if re.fullmatch(r'(test|demo|dummy|sample|example)([ -]*[0-9]+)?', name, re.I):
                skipped['placeholder_entry'] += 1
                continue
            if re.search(r'temporarily (remote|closed)|permanently closed|no direct services|medical field operations|long term care resource', ' '.join([name,street,note]), re.I):
                skipped['remote_closed_or_specialized_office'] += 1
                continue
            zip_code = clean(row['zip'])[:5]
            if zip_code not in postal or row['state'] != 'IL':
                skipped['unsupported_geography'] += 1
                continue
            if not re.search(r'\d',street) or re.search(r'\bP\.?\s*O\.?\s*BOX\b',street,re.I):
                skipped['non_street_address'] += 1
                continue
            lat, lng = row.get('lat'), row.get('lng')
            if not isinstance(lat,(float,int)) or not isinstance(lng,(float,int)) or (round(lat,3)==lat and round(lng,3)==lng):
                skipped['missing_or_coarse_coordinates'] += 1
                continue
            if zip_code not in shapes or not community.within_postal_boundary(lat,lng,shapes[zip_code]):
                skipped['zip_boundary_conflict'] += 1
                continue
            resource = dict(id=f'idhs-office-{row["id"]}', sourceId=source_id, name=name, streetAddress=street,
                city=clean(row['city']), state='IL', postalCode=zip_code, countyId=postal[zip_code][2],
                latitude=lat, longitude=lng, coordinateBasis='publisher-address', category='clinic' if type_id==11 else 'other',
                services=services, website=sources[source_id]['url'], claimStatus='unclaimed',
                usualHours='Call the provider or check the IDHS office locator for current program hours and appointments.',
                publicAccess=description+' Confirm eligibility, service area, appointments and required documents with the provider before visiting.')
            key = community.key(resource)
            if key in seen:
                skipped['already_listed_provider'] += 1
                continue
            seen.add(key)
            if type_id == 11 and 'wic' not in name.lower(): resource['name'] = name+' — WIC'
            if len(resource['name']) > 120: raise ValueError('Office name exceeds catalog limit')
            phone = re.sub(r'\D','',clean(row.get('phone')))
            if len(phone)==10: resource['phone']=f'({phone[:3]}) {phone[3:6]}-{phone[6:]}'
            resources.append(resource)
    resources.sort(key=lambda r:r['id'])
    return dict(scope=dict(name='Illinois public benefits and WIC offices', countyIds=sorted({r['countyId'] for r in resources}), sourceUrl=BASE),
                sources=sources,resources=resources),skipped


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshots',type=Path)
    parser.add_argument('--retrieved-at',type=date.fromisoformat,required=True)
    args=parser.parse_args()
    catalog,skipped=build(args.snapshots,args.retrieved_at.isoformat())
    (DATA/'state-benefit-resources.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(resources=len(catalog['resources']),sources=dict(Counter(r['sourceId'] for r in catalog['resources'])),skipped=dict(skipped)),indent=2))
