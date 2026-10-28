#!/usr/bin/env python3
"""Verify pinned generated artifacts and every ZIP/county parent assignment."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parents[1]
geometry = root / 'apps/web/public/geography/census2020'
lookups = root / 'packages/at-lexicons/src'
manifest = json.loads((geometry / 'manifest.json').read_text())
for directory, artifacts in [(geometry, manifest['artifacts']), (lookups, manifest['lookupArtifacts'])]:
    for name, expected in artifacts.items():
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == expected, name
postal = json.loads((lookups / 'postal-index.json').read_text())
counties = json.loads((lookups / 'county-index.json').read_text())
assert len(postal) == manifest['zipCount'] == 33791
seen = set()
county_ids = set()
for path in geometry.glob('*-county.json'):
    for feature in json.loads(path.read_text())['features']:
        area = feature['properties']
        assert area['id'] in counties
        assert counties[area['id']][2] == area['state']
        county_ids.add(area['id'])
assert county_ids == set(counties)
for path in geometry.glob('*-zip.json'):
    for feature in json.loads(path.read_text())['features']:
        area = feature['properties']
        code = area['id']
        assert code not in seen
        seen.add(code)
        lat, lng, county, state, land = postal[code]
        assert county == area['county'] and state == area['state']
        assert counties[county][2] == state
        assert isinstance(land, int) and land >= 0
        assert -90 <= lat <= 90 and -180 <= lng <= 180
assert seen == set(postal)
print(f"Verified {len(manifest['artifacts'])} boundary artifacts, {len(postal)} ZIP land areas/parents and {len(counties)} counties.")
