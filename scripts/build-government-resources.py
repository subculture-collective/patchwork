#!/usr/bin/env python3
"""Build public government offices from official snapshots and matched Census geocodes.

Usage: python3 -B scripts/build-government-resources.py SSA.csv GEOCODES --retrieved-at YYYY-MM-DD --ssa-published-at YYYY-MM-DD [--va VA.json] [--pha PHA.json --pha-published-at YYYY-MM-DD]
This command writes a normalized catalog, never the database.
"""
import argparse
from collections import Counter
import csv
from datetime import date
import hashlib
import importlib.util
import json
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location('community_resources', Path(__file__).with_name('build-community-resources.py'))
community = importlib.util.module_from_spec(spec)
spec.loader.exec_module(community)
ROOT, DATA = community.ROOT, community.DATA
clean = community.clean
SSA_PAGE = 'https://www.ssa.gov/data/FO-RS-Address-Open-Close-Time-App-Devs.html'
SSA_CSV = 'https://www.ssa.gov/data/FO-Address-Open-Close-Times.csv'


def build(ssa_path, geocodes, retrieved, ssa_published, va_path=None, pha_path=None, pha_published=None):
    postal = json.loads((ROOT/'packages/at-lexicons/src/postal-index.json').read_text())
    shapes = {f['properties']['id']: f['geometry']
              for file in (ROOT/'apps/web/public/geography/census2020').glob('*-zip.json')
              for f in json.loads(file.read_text())['features']}
    existing = [r for file in ['chicago-metro-public-resources.json', 'national-public-resources.json', 'national-community-resources.json']
                for r in json.loads((DATA/file).read_text())['resources']]
    seen = {community.key(r) for r in existing}
    resources, skipped = [], Counter()
    sources = {'ssa-field-offices': dict(name='Social Security Administration — field-office directory', url=SSA_PAGE,
        apiUrl=SSA_CSV, retrievedAt=retrieved, publishedAt=ssa_published, sha256=hashlib.sha256(ssa_path.read_bytes()).hexdigest())}
    def accept(resource):
        if resource['postalCode'] not in postal or resource['state'] not in community.national.STATES:
            skipped['unsupported_geography'] += 1
            return
        geometry = shapes.get(resource['postalCode'])
        if not geometry or not community.within_postal_boundary(resource['latitude'], resource['longitude'], geometry):
            skipped['ZIP_boundary_conflict'] += 1
            return
        if community.key(resource) in seen:
            skipped['duplicate'] += 1
            return
        seen.add(community.key(resource))
        resources.append(resource)
    with ssa_path.open(newline='') as source:
        for raw in csv.DictReader(source):
            row = {k: clean(v) for k, v in raw.items()}
            zip_code = row['ZIP CODE'][:5]
            if zip_code not in postal:
                skipped['unsupported_zip'] += 1
                continue
            geo = geocodes/(row['OFFICE CODE']+'.json')
            matches = json.loads(geo.read_text()).get('result', {}).get('addressMatches', []) if geo.exists() else []
            if len(matches) != 1 or matches[0]['addressComponents']['zip'] != zip_code or matches[0]['addressComponents']['state'] != row['STATE']:
                skipped['unmatched_address'] += 1
                continue
            street = row['ADDRESS LINE 3']
            if not re.search(r'\d', street) or re.search(r'\bP\.?\s*O\.?\s*BOX\b', street, re.I):
                skipped['non_street_address'] += 1
                continue
            address = street + (' '+row['ADDRESS LINE 2'] if row['ADDRESS LINE 2'] else '')
            days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']
            times = [(row[day+' OPEN TIME'], row[day+' CLOSE TIME']) for day in days]
            if all(t == times[0] for t in times) and all(times[0]):
                hours = 'Monday–Friday '+times[0][0]+'–'+times[0][1]+'. Confirm appointments and holiday closures with SSA.'
            else:
                hours = 'Contact SSA or use the office locator to confirm current office hours and appointments.'
            point = matches[0]['coordinates']
            accept(dict(id='ssa-office-'+row['OFFICE CODE'].lower(), sourceId='ssa-field-offices',
                name='Social Security — '+re.sub(r' '+re.escape(row['STATE'])+r'$', '', row['OFFICE NAME']).title()+', '+row['STATE'], category='other', services=['benefits', 'disability'],
                streetAddress=address, city=row['CITY'].title(), state=row['STATE'], postalCode=zip_code,
                countyId=postal[zip_code][2], latitude=point['y'], longitude=point['x'], coordinateBasis='census-address-range',
                website='https://www.ssa.gov/locator/', phone=row['PHONE'], usualHours=hours, claimStatus='unclaimed',
                publicAccess='Government Social Security Administration (SSA) field office. Help with Supplemental Security Income (SSI), Social Security Disability Insurance (SSDI), retirement and survivor benefits, Medicare enrollment, and Social Security records. Arrange an appointment and confirm the office handles your task before visiting; some card services use separate centers.'))
    if va_path:
        va_rows = json.loads(va_path.read_text())
        sources['va-public-offices'] = dict(name='Department of Veterans Affairs — public facility locator',
            url='https://www.va.gov/find-locations/', apiUrl='https://api.va.gov/facilities_api/v2/va',
            retrievedAt=retrieved, sha256=hashlib.sha256(json.dumps(va_rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
        allowed = {'Regional Benefit Office', 'Satellite Office', 'Veteran Readiness and Employment Office'}
        descriptions = {'ApplyingForBenefits':'benefits applications', 'DisabilityClaimAssistance':'disability claims',
            'EducationAndCareerCounseling':'education and career counseling', 'VocationalRehabilitationAndEmploymentAssistance':'Veteran Readiness and Employment',
            'HomelessAssistance':'help for homeless veterans', 'VAHomeLoanAssistance':'VA home loan assistance', 'Pensions':'pensions'}
        for raw in va_rows:
            row = raw['attributes']
            center = row['facilityType'] == 'vet_center'
            if (not center and row.get('classification') not in allowed) or row.get('mobile') or row.get('operatingStatus', {}).get('code') != 'NORMAL':
                skipped['va_restricted_mobile_or_not_normal'] += 1
                continue
            if re.search(r'\b(military base|army|naval|air force|marine corps|fort)\b', row['name'], re.I):
                skipped['va_restricted_setting'] += 1
                continue
            address = row.get('address', {}).get('physical', {})
            street = clean(address.get('address1'))
            zip_code = clean(address.get('zip'))[:5]
            if not re.search(r'\d', street) or re.search(r'\bP\.?\s*O\.?\s*BOX\b', street, re.I) or zip_code not in postal:
                skipped['va_missing_street_or_zip'] += 1
                continue
            lat, lng = row.get('lat'), row.get('long')
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or (round(lat,3)==lat and round(lng,3)==lng):
                skipped['va_coarse_coordinates'] += 1
                continue
            service_data = row.get('services', {})
            codes = {item['name'] for item in service_data.get('benefits', [])} if isinstance(service_data, dict) else set()
            services = ['health'] if center else ['benefits']
            if 'DisabilityClaimAssistance' in codes: services.append('disability')
            if codes & {'EducationAndCareerCounseling', 'VocationalRehabilitationAndEmploymentAssistance'}: services.append('employment')
            if codes & {'HomelessAssistance', 'VAHomeLoanAssistance'}: services.append('housing')
            detail = '; '.join(text for code, text in descriptions.items() if code in codes)
            access = ('Government VA Vet Center. Counseling and readjustment support for eligible veterans, service members and families.' if center
                else 'Government VA benefits office for veterans and eligible family members. '+('Services listed by VA: '+detail+'.' if detail else 'Contact the office about available benefits assistance.'))
            access += ' Contact the office to confirm eligibility, appointments, hours and building access before visiting.'
            resource = dict(id='va-office-'+raw['id'].lower(), sourceId='va-public-offices', name='VA — '+clean(row['name']),
                category='other', services=services, streetAddress=street+(' '+clean(address.get('address2')) if clean(address.get('address2')) else ''),
                city=clean(address.get('city')), state=clean(address.get('state')), postalCode=zip_code, countyId=postal[zip_code][2],
                latitude=lat, longitude=lng, coordinateBasis='publisher-address',
                website=community.link(row.get('website'), 'https://www.va.gov/find-locations/facility/'+raw['id']),
                usualHours='Check the official VA location page or call for current hours and appointments.', claimStatus='unclaimed', publicAccess=access)
            phone = clean(row.get('phone', {}).get('main'))
            if len(re.sub(r'\D', '', phone)) >= 10: resource['phone'] = phone
            accept(resource)
    if pha_path:
        if not pha_published:
            raise ValueError('PHA publication date is required separately from retrieval')
        pha_rows = json.loads(pha_path.read_text())
        pha_page = 'https://www.hud.gov/contactus/public-housing-contacts'
        sources['hud-public-housing-authorities'] = dict(name='HUD — Public Housing Authority offices',
            url=pha_page, apiUrl='https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Public_Housing_Authorities/FeatureServer/0',
            retrievedAt=retrieved, publishedAt=pha_published, sha256=hashlib.sha256(pha_path.read_bytes()).hexdigest())
        # Different program names at the same provider desk should not create duplicate pins.
        def desk_key(resource):
            phone = re.sub(r'\D', '', resource.get('phone', ''))[-10:]
            street = re.sub(r'[^a-z0-9]', '', resource['streetAddress'].lower())
            return (phone, resource['postalCode'], street) if len(phone) == 10 else None
        desks = {desk_key(r) for r in existing + resources} - {None}
        programs = {'Low-Rent': 'public housing', 'Section 8': 'Section 8 Housing Choice Voucher rental assistance',
                    'Combined': 'public housing and Section 8 Housing Choice Voucher rental assistance'}
        for raw in pha_rows:
            row = raw['attributes']
            # ZIP+4 and larger centroids are unsuitable for an exact-address resource pin.
            if row.get('LVL2KX') != 'R':
                skipped['pha_non_rooftop_coordinates'] += 1
                continue
            street, zip_code = clean(row.get('STD_ADDR')), clean(row.get('STD_ZIP5'))
            state, city = clean(row.get('STD_ST')), clean(row.get('STD_CITY'))
            if not re.search(r'\d', street) or re.search(r'\bP\.?\s*O\.?\s*BOX\b', street, re.I):
                skipped['pha_non_street_address'] += 1
                continue
            if zip_code not in postal or state not in community.national.STATES:
                skipped['pha_unsupported_geography'] += 1
                continue
            program = programs.get(row.get('HA_PROGRAM_TYPE'))
            if not program:
                skipped['pha_unknown_program'] += 1
                continue
            lat, lng = row.get('LAT'), row.get('LON')
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
                skipped['pha_missing_coordinates'] += 1
                continue
            name = clean(row.get('FORMAL_PARTICIPANT_NAME'))
            if name.isupper(): name = name.title()
            code = clean(row.get('PARTICIPANT_CODE')).lower()
            if not code or not name or not city:
                skipped['pha_missing_identity'] += 1
                continue
            resource = dict(id='hud-pha-'+code, sourceId='hud-public-housing-authorities', name=name,
                category='other', services=['housing', 'benefits'], streetAddress=street, city=city, state=state,
                postalCode=zip_code, countyId=postal[zip_code][2], latitude=lat, longitude=lng,
                coordinateBasis='publisher-address', website=pha_page, claimStatus='unclaimed',
                usualHours='Call the housing agency for current office hours and appointment requirements.',
                publicAccess='Public Housing Agency (PHA) office listed by HUD for '+program+'. Contact the agency about applications, eligibility, service area, waiting lists and appointments before visiting. A listing does not mean applications are open or housing is currently available.')
            phone = clean(row.get('HA_PHN_NUM'))
            if len(re.sub(r'\D', '', phone)) >= 10: resource['phone'] = phone
            desk = desk_key(resource)
            if desk and desk in desks:
                skipped['pha_duplicate_provider_desk'] += 1
                continue
            before = len(resources)
            accept(resource)
            if len(resources) > before and desk: desks.add(desk)
    resources.sort(key=lambda r:r['id'])
    return dict(scope=dict(name='United States — public government service offices', countyIds=sorted({r['countyId'] for r in resources}), sourceUrl=SSA_PAGE), sources=sources, resources=resources), skipped


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ssa', type=Path)
    parser.add_argument('geocodes', type=Path)
    parser.add_argument('--retrieved-at', type=date.fromisoformat, required=True)
    parser.add_argument('--ssa-published-at', type=date.fromisoformat, required=True)
    parser.add_argument('--va', type=Path)
    parser.add_argument('--pha', type=Path)
    parser.add_argument('--pha-published-at', type=date.fromisoformat)
    args = parser.parse_args()
    catalog, skipped = build(args.ssa, args.geocodes, args.retrieved_at.isoformat(), args.ssa_published_at.isoformat(), args.va, args.pha, args.pha_published_at.isoformat() if args.pha_published_at else None)
    (DATA/'national-government-resources.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(dict(resources=len(catalog['resources']), sources=dict(Counter(r['sourceId'] for r in catalog['resources'])), states=len({r['state'] for r in catalog['resources']}), skipped=dict(skipped)), indent=2))
