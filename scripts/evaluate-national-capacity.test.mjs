import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNationalCapacity } from './evaluate-national-capacity.mjs';

test('missing or short evidence cannot pass or qualify staging', () => {
    for (const evidence of [undefined, {}, { durationSeconds: 299 }]) {
        const result = evaluateNationalCapacity(evidence, {});
        assert.equal(result.engineeringProfilePassed, false);
        assert.equal(result.homeStagingQualified, false);
        assert.ok(result.failures.includes('require a five-minute workload'));
    }
});

test('HTTP 200 alone cannot hide an incomplete or empty directory sample', () => {
    const result = evaluateNationalCapacity({ results: [{ name: 'directory-chicago',
        errorCount: 0, successCount: 1, totalRequests: 1, actualRps: 1, latency: { p95: 1, p99: 1 } }],
        durationSeconds: 300, targetRpsPerRoute: 1, preflight: [{ name: 'directory-chicago', status: 200, total: 0 }] }, {});
    assert.ok(result.failures.includes('directory-chicago: incomplete sample'));
    assert.ok(result.failures.includes('directory-chicago: empty/failed preflight'));
});

test('a fast desktop does not replace mobile or allow an oversized transfer', () => {
    const samples = Array.from({ length: 6 }, () => ({ mobile: false, coldCache: true,
        cardCount: 20, timeToCardsMs: 10, encodedBytes: 2 * 1024 * 1024 }));
    const result = evaluateNationalCapacity({}, { kind: 'national-directory-browser-profile', samples });
    assert.ok(result.failures.includes('desktop loading budget exceeded'));
    assert.ok(result.failures.includes('mobile loading budget exceeded'));
});
