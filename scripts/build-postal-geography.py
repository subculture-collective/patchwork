#!/usr/bin/env python3
"""Build versioned Census ZCTA, county and state geometry. Requires pyshp/shapely.
Inputs: Census GENZ2020 cb_2020_us_{zcta520,county,state}_500k shapefiles.
Run: python scripts/build-postal-geography.py /path/to/extracted-inputs
Each input is in a zcta/, county/, or state/ subdirectory.
"""
import sys,json,hashlib
from pathlib import Path
import shapefile
from shapely.geometry import shape,mapping
from shapely.strtree import STRtree
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]); output=root/'apps/web/public/geography/census2020';output.mkdir(parents=True,exist_ok=True)
def read(kind):
    reader=shapefile.Reader(str(next((source/kind).glob('*.shp'))))
    return [(r.record.as_dict(),shape(r.shape.__geo_interface__).buffer(0)) for r in reader.iterShapeRecords()]
def rounded(value):
    if isinstance(value,float):return round(value,5)
    if isinstance(value,(tuple,list)):return [rounded(x) for x in value]
    if isinstance(value,dict):return {k:rounded(v) for k,v in value.items()}
    return value
def feature(geom,props,tolerance=.001):
    return {'type':'Feature','properties':props,'geometry':rounded(mapping(geom.simplify(tolerance,preserve_topology=True)))}
def write(path,data):path.write_text(json.dumps(data,separators=(',',':'))+'\n')
def collection(fs):return {'type':'FeatureCollection','features':fs}
counties=read('county');tree=STRtree([g for _,g in counties]); county_bundles={}; zip_bundles={};index={}; names={}
for rec,geom in counties:
    state=rec['STATEFP'];names[rec['GEOID']]=rec['NAMELSAD']
    county_bundles.setdefault(state,[]).append(feature(geom,{'id':rec['GEOID'],'name':rec['NAMELSAD']+', '+rec['STUSPS'],'state':state},.003))
states=[]
for rec,geom in read('state'):
    names[rec['GEOID']]=rec['NAME']
    states.append(feature(geom,{'id':rec['GEOID'],'name':rec['NAME'],'abbreviation':rec['STUSPS']},.01))
for rec,geom in read('zcta'):
    point=geom.representative_point()
    candidates=tree.query(point,predicate='covered_by')
    idx=int(candidates[0]) if len(candidates) else int(tree.nearest(point))
    county=counties[idx][0]; state=county['STATEFP']; code=rec['ZCTA5CE20']
    index[code]=[round(point.y,5),round(point.x,5),county['GEOID'],state]
    zip_bundles.setdefault(state,[]).append(feature(geom,{'id':code,'name':'ZIP '+code,'county':county['GEOID'],'state':state}))
for state,fs in county_bundles.items():write(output/(state+'-county.json'),collection(fs))
for state,fs in zip_bundles.items():write(output/(state+'-zip.json'),collection(fs))
write(output/'states.json',collection(states))
write(root/'packages/at-lexicons/src/postal-index.json',dict(sorted(index.items())))
write(root/'packages/at-lexicons/src/geography-names.json',names)
manifest={'source':'US Census Bureau GENZ2020 1:500,000','vintage':'2020','generatedFrom':{},'zipCount':len(index),'parentRule':'county covering ZCTA representative point; nearest county for coastline gaps','artifacts':{}}
for archive in sorted(source.glob('*.zip')):manifest['generatedFrom'][archive.name]=hashlib.sha256(archive.read_bytes()).hexdigest()
for path in sorted(output.glob('*.json')):
    if path.name != 'manifest.json':manifest['artifacts'][path.name]=hashlib.sha256(path.read_bytes()).hexdigest()
manifest['lookupArtifacts']={name:hashlib.sha256((root/'packages/at-lexicons/src'/name).read_bytes()).hexdigest() for name in ['postal-index.json','geography-names.json']}
write(output/'manifest.json',manifest)
print('ZIPs',len(index),'counties',len(counties),'states',len(states),'geometry bytes',sum(p.stat().st_size for p in output.glob('*.json')))
