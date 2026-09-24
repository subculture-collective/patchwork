#!/usr/bin/env python3
"""Build a reviewed national food/HUD catalog from public source snapshots; never writes to the DB.
Usage: python3 scripts/build-community-resources.py FOOD.json HUD.json GEOCODE_DIR --retrieved-at YYYY-MM-DD
"""
import argparse
from collections import Counter
from datetime import date
import hashlib
import html
import json
import math
from pathlib import Path
import re
from importlib.util import module_from_spec, spec_from_file_location
spec = spec_from_file_location('national_resources', Path(__file__).with_name('build-national-resources.py'))
national = module_from_spec(spec)
spec.loader.exec_module(national)
ROOT, DATA, key, website = national.ROOT, national.DATA, national.key, national.website


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', str(value or '').replace('\x00','')))).strip()


def link(raw, fallback):
    result = website(clean(raw))
    return fallback if result == 'https://findahealthcenter.hrsa.gov/' else result


def within_postal_boundary(latitude, longitude, geometry):
    """Allow 250 m for simplified Census boundaries; never move the publisher pin."""
    polygons = [geometry['coordinates']] if geometry['type'] == 'Polygon' else geometry['coordinates']
    x_scale = 111320 * math.cos(math.radians(latitude))
    def inside(ring):
        result = False
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            if (y1 > latitude) != (y2 > latitude) and longitude < (x2-x1)*(latitude-y1)/(y2-y1)+x1:
                result = not result
        return result
    def near(ring):
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            ax, ay = (x1-longitude)*x_scale, (y1-latitude)*111320
            bx, by = (x2-longitude)*x_scale, (y2-latitude)*111320
            dx, dy = bx-ax, by-ay
            length = dx*dx+dy*dy
            t = max(0, min(1, -(ax*dx+ay*dy)/length)) if length else 0
            if (ax+t*dx)**2+(ay+t*dy)**2 <= 250**2:
                return True
        return False
    for rings in polygons:
        if inside(rings[0]) and not any(inside(hole) for hole in rings[1:]):
            return True
        if any(near(ring) for ring in rings):
            return True
    return False


def build(food, hud, geocodes, retrieved):
    existing = [r for file in ['chicago-metro-public-resources.json','national-public-resources.json'] for r in json.loads((DATA/file).read_text())['resources']]
    ids = {r['id'] for r in existing}; seen = {key(r) for r in existing}
    postal = json.loads((ROOT/'packages/at-lexicons/src/postal-index.json').read_text())
    shapes = {feature['properties']['id']:feature['geometry']
        for file in (ROOT/'apps/web/public/geography/census2020').glob('*-zip.json')
        for feature in json.loads(file.read_text())['features']}
    sources = {}; resources = []; skipped = Counter()
    food_sha = hashlib.sha256(json.dumps(food,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    hud_sha = hashlib.sha256(json.dumps(hud,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    def accept(r):
        if r['id'] in ids or key(r) in seen: skipped['duplicate']+=1; return
        if len(r['name'])>120 or not r['name']: skipped['unsupported_name']+=1; return
        if r['state'] not in national.STATES or not r['city']: skipped['incomplete_location']+=1; return
        if r['postalCode'] not in postal: skipped['unsupported_zip']+=1; return
        if r['latitude'] is None or r['longitude'] is None: skipped['missing_coordinates']+=1; return
        ids.add(r['id']);seen.add(key(r));resources.append(r)
    for a in food:
        programs = clean(a.get('foodPrograms')); name = clean(a.get('locationName'))
        notes = clean(a.get('notes')); extras = clean(a.get('servicePrograms'))
        if re.search(r'\b(mobile|pop.up|school|student|residential|domestic violence|shelter|jail|prison|detention)\b',name+' '+programs,re.I): skipped['mobile_or_restricted']+=1; continue
        if re.search(r'(permanently closed|temporarily closed|closed until|no longer|not open to the public)',name+' '+notes+' '+clean(a.get('aboutUs')),re.I): skipped['closure_or_access_notice']+=1; continue
        if not re.search(r'(pantry|food|grocery|meal)',programs,re.I): skipped['unconfirmed_food_program']+=1; continue
        address = clean(a.get('address1')); zip_code=clean(a.get('zipCode'))[:5]
        if not address or not re.search(r'\d',address) or re.search(r'\bP\.?\s*O\.?\s*BOX\b',address,re.I): skipped['no_street_address']+=1;continue
        lat,lng=a.get('latitude'),a.get('longitude')
        if not isinstance(lat,(float,int)) or not isinstance(lng,(float,int)) or lat==0 or lng==0 or (round(lat,3)==lat and round(lng,3)==lng): skipped['coarse_coordinates']+=1; continue
        if zip_code not in postal: skipped['unsupported_zip']+=1;continue
        if zip_code not in shapes or not within_postal_boundary(lat, lng, shapes[zip_code]):
            skipped['coordinate_zip_conflict']+=1;continue
        network=next((n for n in a.get('networkAffiliationsList',[]) if n.get('regionId')==a.get('regionId')),None)
        if not network: skipped['missing_network_provenance']+=1;continue
        source_id='vivery-network-'+str(a['regionId']);fallback='https://www.feedingillinois.org/food-resources-illinois'
        source_url = link(network.get('website'), fallback)
        if not source_url.startswith('https://'): source_url = fallback
        sources[source_id]=dict(name=clean(network.get('regionName'))+' — public Vivery directory',url=source_url,apiUrl='https://api.accessfood.org/api/MapInformation/LocationSearch',retrievedAt=retrieved,sha256=food_sha)
        services=['food']
        for pattern,service in [(r'clothing|housewares|diaper','clothing'),(r'SNAP|benefit|utility|financial assistance','benefits'),(r'workforce|job training|employment','employment'),(r'legal','legal'),(r'transport','transport'),(r'mental health','health'),(r'shower|laundry','hygiene'),(r'disability','disability')]:
            if re.search(pattern,extras,re.I):services.append(service)
        detail='; '.join(filter(None,[programs,extras,clean(a.get('foodServiceTypes'))]))
        access=('Public food-assistance listing. '+detail+'. '+('Service area: '+clean(a.get('serviceArea'))+'. ' if a.get('serviceArea') else '')+'Contact the provider for current distribution times, eligibility and appointment requirements before visiting.')
        if len(access)>500:access='Public food-assistance listing. '+detail[:280]+'. Contact the provider for current distribution times, eligibility and appointment requirements before visiting.'
        r=dict(id='food-'+str(a['locationId']),sourceId=source_id,name=name,category='food-bank',services=services,streetAddress=address,city=clean(a['city']),state=clean(a['state']).upper(),postalCode=zip_code,countyId=postal[zip_code][2],latitude=lat,longitude=lng,coordinateBasis='publisher-address',website=link(a.get('website'),sources[source_id]['url']),usualHours='Contact the provider for current distribution hours; schedules vary by program.',claimStatus='unclaimed',publicAccess=access)
        phone=clean(a.get('phone') or a.get('contactPhone'))
        if len(re.sub(r'\D','',phone))>=10:r['phone']=phone
        accept(r)
    for a in hud:
        if a['agc_STATUS']!='A' or 'Face to Face Counseling' not in (a['counslg_METHOD'] or ''):skipped['hud_not_approved_in_person']+=1;continue
        geo=geocodes/(a['agcid']+'.json');zip_code=clean(a['zipcd'])[:5]
        if not geo.exists() or zip_code not in postal:skipped['hud_missing_supported_geocode']+=1;continue
        matches=json.loads(geo.read_text()).get('result',{}).get('addressMatches',[])
        if len(matches)!=1 or matches[0]['addressComponents']['zip']!=zip_code:skipped['hud_unmatched_address']+=1;continue
        m=matches[0];services=['housing'];codes=set((a.get('services') or '').split(','))
        detail='Housing counseling'
        if 'RHC' in codes:detail+='; rental housing counseling'
        if 'DFC' in codes:detail+='; mortgage delinquency and foreclosure counseling'
        if 'PPC' in codes:detail+='; homebuyer counseling'
        r=dict(id='hud-agency-'+a['agcid'],sourceId='hud-current',name=clean(a['nme']),category='other',services=services,streetAddress=clean(a['adr1'])+(' '+clean(a['adr2']) if clean(a['adr2']) else ''),city=clean(a['city']),state=clean(a['statecd']),postalCode=zip_code,countyId=postal[zip_code][2],latitude=m['coordinates']['y'],longitude=m['coordinates']['x'],coordinateBasis='census-address-range',website=link(a['weburl'],'https://data.hud.gov/housing_counseling.html'),usualHours='Contact the agency to arrange counseling and confirm current office hours.',claimStatus='unclaimed',publicAccess=detail+'. HUD lists in-person counseling at this agency. Contact it about appointments, fees and eligibility; this listing does not imply available shelter beds or rental funding.')
        phone=clean(a['phone1'])
        if len(re.sub(r'\D','',phone))>=10:r['phone']=phone
        accept(r)
    sources['hud-current']=dict(name='HUD — current housing-counselor directory',url='https://data.hud.gov/housing_counseling.html',apiUrl='https://data.hud.gov/Housing_Counselor/search?AgencyName=&City=&State=',retrievedAt=retrieved,sha256=hud_sha)
    sources={key:value for key,value in sources.items() if key in {r['sourceId'] for r in resources}}
    resources.sort(key=lambda r:r['id'])
    return dict(scope=dict(name='United States — public food and housing support',countyIds=sorted({r['countyId'] for r in resources}),sourceUrl='https://data.hud.gov/housing_counseling.html'),sources=sources,resources=resources), skipped

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('food',type=Path);parser.add_argument('hud',type=Path);parser.add_argument('geocodes',type=Path);parser.add_argument('--retrieved-at',type=date.fromisoformat,required=True);a=parser.parse_args()
    catalog,skipped=build(json.loads(a.food.read_text()),json.loads(a.hud.read_text()),a.geocodes,a.retrieved_at.isoformat())
    (DATA/'national-community-resources.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(resources=len(catalog['resources']),categories=dict(Counter(r['category'] for r in catalog['resources'])),states=len({r['state'] for r in catalog['resources']}),services=dict(Counter(s for r in catalog['resources'] for s in r['services'])),skipped=dict(skipped)),indent=2))
