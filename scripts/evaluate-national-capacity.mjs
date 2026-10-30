import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const budgets = {
    health: [30, 80], 'map-demo-10k': [400, 1000], 'feed-demo-10k': [300, 800],
    'directory-chicago': [350, 900], 'directory-ny-food': [350, 900],
    'directory-la-health': [350, 900], 'directory-national-search': [350, 900],
    'resource-map-national': [500, 1200],
};
export function evaluateNationalCapacity(evidence, browser) {
    const failures = [];
    const check = (ok, message) => { if (!ok) failures.push(message); };
    check(evidence?.kind === 'isolated-national-directory-capacity', 'wrong evidence kind');
    check(evidence?.durationSeconds >= 300, 'require a five-minute workload');
    check(evidence?.catalogCount >= 29000, 'require the national catalog');
    check(Number.isFinite(evidence?.targetRpsPerRoute) && evidence.targetRpsPerRoute >= 1, 'require a named paced rate');
    check(evidence?.errors?.length === 0, 'background work must have no errors');
    for (const [name, [p95, p99]] of Object.entries(budgets)) {
        const rows = evidence?.results?.filter(r => r.name === name) ?? [];
        const row = rows[0];
        check(rows.length === 1, `${name}: require exactly one result`);
        check(row?.errorCount === 0 && row?.successCount === row?.totalRequests, `${name}: require zero errors`);
        check(row?.actualRps >= evidence?.targetRpsPerRoute * .95, `${name}: missed configured throughput`);
        check(Number.isFinite(row?.latency?.p95) && row.latency.p95 >= 0
            && Number.isFinite(row?.latency?.p99) && row.latency.p99 >= row.latency.p95
            && row.latency.p95 <= p95 && row.latency.p99 <= p99, `${name}: latency budget exceeded`);
        check(row?.totalRequests >= evidence?.durationSeconds * evidence?.targetRpsPerRoute * .95, `${name}: incomplete sample`);
        const preflight = evidence?.preflight?.find(r => r.name === name);
        check(preflight?.status === 200 && (name === 'health' || preflight?.total > 0), `${name}: empty/failed preflight`);
    }
    check(evidence?.samples?.length >= 30, 'require host/database/container samples');
    check(evidence?.samples?.every(s => s.hostMemAvailableKiB / s.hostMemTotalKiB >= .2
        && s.database?.connections <= 80 && s.database?.lock_waiters === 0), 'resource headroom or lock budget exceeded');
    check(evidence?.refresh?.length >= 5 && evidence.refresh.every(r => r.replayed === true), 'require concurrent refresh and immutable replay');
    check(evidence?.travel?.length >= 20 && evidence.travel.every(r => r.status === 200 && r.itineraryCount > 0), 'require bounded successful real itineraries');
    check(evidence?.recovery?.httpStatus === 200 && evidence?.recovery?.health?.status === 'ok', 'require post-load health');
    check(browser?.kind === 'national-directory-browser-profile' && browser?.samples?.length === 6, 'require six browser samples');
    for (const mobile of [false, true]) {
        const samples = browser?.samples?.filter(s => s.mobile === mobile) ?? [];
        check(samples.length === 3 && samples.every(s => s.coldCache && s.cardCount === 20
            && s.encodedBytes > 0 && s.encodedBytes <= 1.5 * 1024 * 1024
            && s.timeToCardsMs <= (mobile ? 4000 : 2000)), `${mobile ? 'mobile' : 'desktop'} loading budget exceeded`);
    }
    return {
        engineeringProfilePassed: failures.length === 0, failures,
        modeledThroughputTargetsMet: evidence?.results?.length === Object.keys(budgets).length
            && [['/health', 50], ['/query/map', 60], ['/query/feed', 80], ['/query/directory', 40]]
                .every(([path, target]) => evidence.results.filter(r => r.path === path)
                    .reduce((total, r) => total + r.actualRps, 0) >= target),
        // The dedicated home-staging evaluator has additional release/provider,
        // lifecycle/moderation, storage and operational requirements.
        homeStagingQualified: false,
    };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/evaluate-national-capacity.mjs CAPACITY.json BROWSER.json');
    const result = evaluateNationalCapacity(...await Promise.all(process.argv.slice(2).map(async p => JSON.parse(await readFile(p, 'utf8')))));
    console.log(JSON.stringify(result, null, 2));
    if (!result.engineeringProfilePassed) process.exitCode = 1;
}
