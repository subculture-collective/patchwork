#!/usr/bin/env python3
"""Five-minute distributed-client read probe; run from the trusted Almaz edge to the isolated candidate only."""
import concurrent.futures, json, time, urllib.request, urllib.error, threading
BASE = 'http://10.0.0.56:3052'
QUERY = '?dataset=demo&latitude=41.88&longitude=-87.63&radiusKm=50&pageSize=20'
ROUTES = ['/query/map', '/query/feed', '/query/directory', '/query/feed']
def request(index):
    route = ROUTES[index % len(ROUTES)]
    start = time.monotonic()
    req = urllib.request.Request(BASE + route + QUERY, headers={'X-Forwarded-For': '198.51.100.' + str(1 + index % 100)})
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            body = json.load(response)
            return route, response.status, (time.monotonic()-start)*1000, body.get('projectionFreshness',{}).get('lagSeconds')
    except urllib.error.HTTPError as error: return route, error.code, (time.monotonic()-start)*1000, None
    except Exception: return route, 0, (time.monotonic()-start)*1000, None
for route, minimum in [('/query/map',10000),('/query/directory',1000)]:
    with urllib.request.urlopen(BASE+route+QUERY,timeout=5) as response: assert json.load(response)['total'] >= minimum
start = time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=64) as pool:
    futures=[]; missed=0; permits=threading.BoundedSemaphore(64)
    for index in range(12000):
        time.sleep(max(0,start+index/40-time.monotonic()))
        if not permits.acquire(blocking=False):
            missed += 1
            continue
        future=pool.submit(request,index)
        future.add_done_callback(lambda _: permits.release())
        futures.append(future)
    rows=[future.result() for future in futures]
result={'kind':'isolated-candidate-distributed-client-read-probe','target':BASE,'requestedRps':40,'durationSeconds':time.monotonic()-start,'requestCount':len(rows),'missedScheduledRequests':missed,'forwardedClientCount':100,'publicEdgeIncluded':False,'routes':{}}
for route in sorted(set(ROUTES)):
    selected=[row for row in rows if row[0]==route];latencies=sorted(row[2] for row in selected);statuses={str(code):sum(row[1]==code for row in selected) for code in set(row[1] for row in selected)}
    result['routes'][route]={'count':len(selected),'p95Ms':latencies[int(len(latencies)*.95)-1],'maxMs':max(latencies),'statusCounts':statuses}
result['maxObservedProjectionHeartbeatLagSeconds']=max((row[3] for row in rows if row[3] is not None),default=None)
result['passed']=missed==0 and all(row[1]==200 for row in rows) and all(route['p95Ms']<=500 for route in result['routes'].values())
print(json.dumps(result,indent=2))
raise SystemExit(0 if result['passed'] else 1)
