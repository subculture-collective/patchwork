#!/usr/bin/env node
// Run with node --import tsx. This mutates only the explicitly named disposable DB.
import { Pool } from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runHttpLoadProbe } from '../packages/shared/src/http-load-probe.ts';
import { computeLatencyHistogram } from '../packages/shared/src/load-testing.ts';
import { previewPublicResourceRefresh } from '../services/api/src/db/public-resource-refresh-preview.ts';
import { SourceRefreshService } from '../services/api/src/source-refresh/source-refresh-service.ts';

const exec = promisify(execFile);
const baseUrl = process.env.PATCHWORK_CAPACITY_BASE_URL;
const databaseUrl = process.env.API_DATABASE_URL;
const output = process.env.PATCHWORK_CAPACITY_OUTPUT;
if (!baseUrl || !databaseUrl || !output) {
    throw new Error('PATCHWORK_CAPACITY_BASE_URL, API_DATABASE_URL and PATCHWORK_CAPACITY_OUTPUT are required.');
}
const seconds = Number(process.env.PATCHWORK_CAPACITY_DURATION_SECONDS ?? 300);
const rate = Number(process.env.PATCHWORK_CAPACITY_TARGET_RPS_PER_ROUTE ?? 10);
const target = new URL(baseUrl);
const database = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.username || target.password
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || database.pathname !== '/patchwork_capacity_20' || !output
    || !Number.isInteger(seconds) || seconds < 10 || seconds > 600
    || !Number.isInteger(rate) || rate < 1 || rate > 20) {
    throw new Error('Use a loopback API, disposable patchwork_capacity_20 DB, output path, 10–600 seconds and 1–20 RPS per route.');
}
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const hash = value => createHash('sha256').update(value).digest('hex');
const scenarios = [
    { name: 'health', path: '/health', originalRps: 50, budgetMs: 30, params: {} },
    { name: 'map-demo-10k', path: '/query/map', originalRps: 60, budgetMs: 400,
        params: { dataset: 'demo', latitude: '41.88', longitude: '-87.63', radiusKm: '50', pageSize: '20' } },
    { name: 'feed-demo-10k', path: '/query/feed', originalRps: 80, budgetMs: 300,
        params: { dataset: 'demo', pageSize: '20' } },
    { name: 'directory-chicago', path: '/query/directory', originalRps: 40, budgetMs: 350,
        params: { latitude: '41.88', longitude: '-87.63', radiusKm: '50', pageSize: '20' } },
    { name: 'directory-ny-food', path: '/query/directory', originalRps: 40, budgetMs: 350,
        params: { latitude: '40.71', longitude: '-74.01', radiusKm: '50', service: 'food', pageSize: '20' } },
    { name: 'directory-la-health', path: '/query/directory', originalRps: 40, budgetMs: 350,
        params: { latitude: '34.05', longitude: '-118.24', radiusKm: '50', service: 'health', pageSize: '20' } },
    { name: 'directory-national-search', path: '/query/directory', originalRps: 40, budgetMs: 350,
        params: { searchText: 'housing', pageSize: '20', page: '2' } },
    { name: 'resource-map-national', path: '/query/resource-map', originalRps: null, budgetMs: 500,
        params: { mapZoom: '4', west: '-125', east: '-66', south: '24', north: '50' } },
];
const evidence = {
    kind: 'isolated-national-directory-capacity', measuredAt: new Date().toISOString(),
    revision: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(),
    runtimeImageId: (await exec('docker', ['inspect', '--format', '{{.Image}}', 'patchwork-capacity-20-api'])).stdout.trim(),
    projectedDiscoverySha256: hash(await readFile(new URL('../services/api/src/projected-discovery.ts', import.meta.url))),
    durationSeconds: seconds, targetRpsPerRoute: rate,
    limits: { apiCpu: 2, apiMemoryMiB: 1024, postgresCpu: 2, postgresMemoryMiB: 1024, postgresTmpfsMiB: 768 },
    boundary: 'Real PostgreSQL and exact-main API image in test configuration; synthetic requests/refresh evidence, no PDS writes. Travel is capped at one request per 10 seconds through the existing NUC router; not router saturation or production qualification.',
    preflight: [], samples: [], refresh: [], travel: [], errors: [],
};
let running = true;
const sourceService = new SourceRefreshService(pool);
const reviewer = 'did:plc:capacity-reviewer';
const rawCatalog = JSON.parse(await readFile(new URL('../services/api/src/db/seed-data/chicago-metro-public-resources.json', import.meta.url)));
const catalog = { ...rawCatalog, sources: { cpl: rawCatalog.sources.cpl }, resources: rawCatalog.resources.filter(r => r.sourceId === 'cpl') };
const destination = (await pool.query("SELECT resource_uri FROM public_resource_listings WHERE source_snapshot->>'sourceId'='cpl' ORDER BY power(latitude-41.88,2)+power(longitude+87.63,2),resource_uri LIMIT 1")).rows[0]?.resource_uri;
const background = async (name, interval, operation) => {
    while (running) {
        const start = performance.now();
        try {
            const result = await operation();
            evidence[name].push({ durationMs: performance.now() - start, ...result });
        }
        catch (error) { evidence.errors.push({ worker: name, message: error.message }); }
        if (running) await delay(interval);
    }
};
try {
    const count = Number((await pool.query('SELECT count(*) FROM public_resource_listings')).rows[0].count);
    if (count < 29000 || !destination) throw new Error('Seed the national catalog before running.');
    evidence.catalogCount = count;
    await pool.query("INSERT INTO platform_roles(did,role,updated_by,updated_at) VALUES($1,'moderator',$1,NOW()) ON CONFLICT DO NOTHING", [reviewer]);
    await pool.query('UPDATE indexer_projection_state SET heartbeat_at=NOW()');
    // Container restart acknowledgement precedes listener readiness. Do not
    // start timing until the real HTTP health check succeeds.
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            const response = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(2000) });
            if (response.ok && (await response.json()).status === 'ok') { ready = true; break; }
        } catch { /* The isolated listener can still be starting. */ }
        await delay(200);
    }
    if (!ready) throw new Error('The isolated API did not become healthy before measurement.');
    for (const scenario of scenarios) {
        const response = await fetch(new URL(`${scenario.path}?${new URLSearchParams(scenario.params)}`, baseUrl));
        const data = await response.json();
        const total = data.total ?? data.mapped;
        if (!response.ok || (scenario.name !== 'health' && !(total > 0))) throw new Error(`Empty or failed preflight: ${scenario.name}`);
        evidence.preflight.push({ name: scenario.name, status: response.status, total });
    }
    const workers = [
        background('samples', 5000, async () => {
            // This heartbeat belongs only to the synthetic isolated projection; no live freshness claim.
            await pool.query('UPDATE indexer_projection_state SET heartbeat_at=NOW()');
            const db = (await pool.query("SELECT count(*)::int AS connections, count(*) FILTER(WHERE wait_event_type='Lock')::int AS lock_waiters, pg_database_size(current_database())::float8 AS bytes FROM pg_stat_activity WHERE datname=current_database()")).rows[0];
            const stats = await exec('docker', ['stats', '--no-stream', '--format', '{{json .}}', 'patchwork-capacity-20-api', 'patchwork-capacity-20-db']);
            const mem = await readFile('/proc/meminfo', 'utf8');
            return { at: new Date().toISOString(), database: db, containers: stats.stdout.trim().split('\n').map(JSON.parse), hostMemAvailableKiB: Number(mem.match(/MemAvailable:\s+(\d+)/)[1]), hostMemTotalKiB: Number(mem.match(/MemTotal:\s+(\d+)/)[1]), hostLoad: (await readFile('/proc/loadavg', 'utf8')).trim(), hostCpu: (await readFile('/proc/stat', 'utf8')).split('\n')[0], disk: (await exec('df', ['-B1', '/', '/dev/shm'])).stdout };
        }),
        background('refresh', 30000, async () => {
            const start = performance.now();
            const raw = JSON.stringify({ fixture: 'capacity-only', sequence: evidence.refresh.length, resources: catalog.resources });
            const sha = hash(raw);
            const retrievedAt = new Date().toISOString();
            const current = { ...catalog, sources: { cpl: { ...catalog.sources.cpl, retrievedAt: retrievedAt.slice(0, 10), sha256: sha } } };
            const preview = await previewPublicResourceRefresh(pool, current);
            const manifest = { version: 1, publisher: 'Capacity fixture; not a publisher fetch', datasetId: 'capacity-fixture', requestUrl: 'https://example.invalid/capacity', responseUrl: 'https://example.invalid/capacity', retrievedAt, contentType: 'application/json', etag: null, lastModified: null, rawSha256: sha, rawBytes: Buffer.byteLength(raw), rowCount: current.resources.length, normalizedSha256: hash(JSON.stringify(current)) };
            const persisted = await sourceService.persistPreview('cpl', manifest, preview);
            const replay = await sourceService.persistPreview('cpl', manifest, preview);
            if (!replay.replayed) throw new Error('Expected immutable replay');
            const queue = await sourceService.listCandidates(reviewer, 1);
            return { durationMs: performance.now() - start, candidates: persisted.candidates, replayed: replay.replayed, queuePageCount: queue.candidates?.length ?? queue.items?.length ?? 0 };
        }),
        background('travel', 10000, async () => {
            const start = performance.now();
            const response = await fetch(new URL('/travel/plan', baseUrl), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:45441' }, body: JSON.stringify({ resourceUri: destination, origin: { latitude: 41.88, longitude: -87.63 }, dateTime: new Date().toISOString(), mode: 'walk', arriveBy: evidence.travel.length % 2 === 1 }), signal: AbortSignal.timeout(12000) });
            const body = await response.json();
            if (!response.ok || !body.itineraries?.length) throw new Error(`Travel failed: ${response.status} ${body.error?.code ?? 'empty'}`);
            return { durationMs: performance.now() - start, status: response.status, itineraryCount: body.itineraries.length };
        }),
    ];
    evidence.results = await Promise.all(scenarios.map(async s => {
        const result = await runHttpLoadProbe({ baseUrl, path: s.path, searchParams: s.params, durationMs: seconds * 1000, concurrency: 4, requestTimeoutMs: 5000, targetRps: rate, forwardedForPoolSize: 254 });
        return { name: s.name, originalTargetRps: s.originalRps, p95BudgetMs: s.budgetMs, ...result, configuredRatePassed: result.errorCount === 0 && result.actualRps >= rate * .95 && result.latency.p95 <= s.budgetMs };
    }));
    running = false;
    await Promise.all(workers);
    const start = performance.now();
    const response = await fetch(new URL('/health', baseUrl));
    const health = await response.json();
    evidence.recovery = { requestMs: performance.now() - start, httpStatus: response.status, health };
    evidence.travelLatency = computeLatencyHistogram(evidence.travel.map(r => r.durationMs));
    evidence.configuredEnvelopePassed = evidence.errors.length === 0 && evidence.results.every(r => r.configuredRatePassed) && health.status === 'ok';
} finally {
    running = false;
    await pool.end();
    await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ output, passed: evidence.configuredEnvelopePassed, errors: evidence.errors, results: evidence.results?.map(r => ({ name: r.name, rps: r.actualRps, p95: r.latency.p95, errors: r.errorCount })) }, null, 2));
if (!evidence.configuredEnvelopePassed) process.exitCode = 1;
