import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveSource } from './source-registry.js';
import { recordRegisteredSourceAttempt, runSourceJob } from './source-runner.js';
import { activeSourceQuarantine, clearSourceQuarantine, quarantineSource } from './source-quarantine.js';
import { PublisherValidationError } from './publisher-validation-error.js';
import { renderRegisteredSourceMetrics } from './source-refresh-metrics.js';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const ids: string[] = [];
const source = () => {
    const id = `runner-test-${randomUUID()}`;
    ids.push(id);
    return { ...resolveSource('cpl'), id };
};
afterAll(async () => {
    await pool.query('DELETE FROM source_refresh_quarantines WHERE source_id=ANY($1::text[])', [ids]);
    await pool.query('DELETE FROM source_refresh_operational_status WHERE source_id=ANY($1::text[])', [ids]);
    await pool.end();
});
const status = async (id: string) => (await pool.query(
    'SELECT last_attempt_succeeded,last_success_at,last_attempt_at FROM source_refresh_operational_status WHERE source_id=$1', [id],
)).rows[0];

describe('registered source operational isolation', () => {
    it('quarantines only a malformed publisher, allows diagnostic previews, and requires explicit incident clearance', async () => {
        const definition = source();
        const persist = vi.fn(async () => ({}));
        const fetchEvidence = vi.fn(async () => { throw new PublisherValidationError('Incomplete publisher feed'); });
        const options = { pool, source: definition, mode: 'persist' as const, fetchEvidence, preview: async () => ({}), persist };
        await expect(runSourceJob(options)).rejects.toThrow('Incomplete');
        const incident = (await activeSourceQuarantine(pool, definition.id))!;
        expect(incident.reason_code).toBe('publisher-contract');
        expect(await runSourceJob(options)).toMatchObject({ status: 'skipped-quarantined', quarantineId: incident.quarantine_id });
        expect(fetchEvidence).toHaveBeenCalledOnce();
        expect(persist).not.toHaveBeenCalled();
        const fixed = { ...options, fetchEvidence: async () => ({}) };
        expect(await runSourceJob({ ...fixed, mode: 'preview' })).toMatchObject({ status: 'previewed' });
        expect((await activeSourceQuarantine(pool, definition.id))!.quarantine_id).toBe(incident.quarantine_id);
        expect(await runSourceJob({ ...fixed, source: source() })).toMatchObject({ status: 'persisted' });
        expect(await renderRegisteredSourceMetrics(pool)).toContain(`source="${definition.id}"} 1`);
        await clearSourceQuarantine(pool, definition.id, incident.quarantine_id, 'Reviewed complete bounded publisher preview.');
        expect(await runSourceJob(fixed)).toMatchObject({ status: 'persisted' });
        expect(await activeSourceQuarantine(pool, definition.id)).toBeUndefined();
        await quarantineSource(pool, definition.id, definition.adapterVersion);
        await expect(clearSourceQuarantine(pool, definition.id, incident.quarantine_id, 'Stale incident cannot clear the newer quarantine.')).rejects.toThrow('changed');
        expect((await pool.query('SELECT COUNT(*)::int AS count FROM source_refresh_quarantines WHERE source_id=$1', [definition.id])).rows[0].count).toBe(2);
    });

    it('does not quarantine previews or exhausted transient failures, and serializes clearance with source jobs', async () => {
        const definition = source();
        const options = { pool, source: definition, preview: async () => ({}), persist: async () => ({}) };
        await expect(runSourceJob({ ...options, mode: 'preview', fetchEvidence: async () => { throw new PublisherValidationError('Invalid schema'); } })).rejects.toThrow('schema');
        expect(await activeSourceQuarantine(pool, definition.id)).toBeUndefined();
        const fetchEvidence = vi.fn(async () => { throw new Error('HTTP 429'); });
        await expect(runSourceJob({ ...options, mode: 'persist', fetchEvidence, delay: async () => {} })).rejects.toThrow('429');
        expect(fetchEvidence).toHaveBeenCalledTimes(3);
        expect(await activeSourceQuarantine(pool, definition.id)).toBeUndefined();
        await quarantineSource(pool, definition.id, definition.adapterVersion);
        const incident = (await activeSourceQuarantine(pool, definition.id))!;
        const blocker = await pool.connect();
        try {
            await blocker.query('SELECT pg_advisory_lock(hashtext($1))', [`source-refresh:${definition.id}`]);
            await expect(clearSourceQuarantine(pool, definition.id, incident.quarantine_id, 'Reviewed but concurrent job still owns the source.')).rejects.toThrow('running');
        } finally {
            await blocker.query('SELECT pg_advisory_unlock(hashtext($1))', [`source-refresh:${definition.id}`]);
            blocker.release();
        }
        expect(await activeSourceQuarantine(pool, definition.id)).toBeDefined();
    });
    it('skips a locked source but lets another source complete and records only actual work', async () => {
        const first = source();
        const second = source();
        const blocker = await pool.connect();
        const fetchEvidence = vi.fn(async () => ({ raw: 'retained fixture' }));
        const options = { pool, mode: 'persist' as const, fetchEvidence,
            preview: async () => ({ changes: 1 }), persist: async () => ({ candidates: 1 }) };
        try {
            await blocker.query('SELECT pg_advisory_lock(hashtext($1))', [`source-refresh:${first.id}`]);
            expect(await runSourceJob({ ...options, source: first })).toEqual({ status: 'skipped-concurrent' });
            expect(fetchEvidence).not.toHaveBeenCalled();
            expect(await status(first.id)).toBeUndefined();
            expect(await runSourceJob({ ...options, source: second })).toMatchObject({ status: 'persisted' });
            expect(await status(second.id)).toMatchObject({ last_attempt_succeeded: true });
        } finally {
            await blocker.query('SELECT pg_advisory_unlock(hashtext($1))', [`source-refresh:${first.id}`]);
            blocker.release();
        }
    });

    it('does not persist candidates or operational success for a preview or paused source', async () => {
        const definition = source();
        const persist = vi.fn(async () => ({ candidates: 1 }));
        const fetchEvidence = vi.fn(async () => ({ raw: 'fixture' }));
        const options = { pool, source: definition, fetchEvidence, preview: async () => ({ changes: 1 }), persist };
        expect(await runSourceJob({ ...options, mode: 'preview' })).toMatchObject({ status: 'previewed' });
        expect(persist).not.toHaveBeenCalled();
        expect(await status(definition.id)).toBeUndefined();
        fetchEvidence.mockClear();
        expect(await runSourceJob({ ...options, mode: 'persist', paused: new Set([definition.id]) }))
            .toEqual({ status: 'skipped-disabled' });
        expect(fetchEvidence).not.toHaveBeenCalled();
    });

    it('retains last good success after validation failure and releases the lock for recovery', async () => {
        const definition = source();
        const good = new Date('2030-01-01T00:00:00Z');
        await recordRegisteredSourceAttempt(pool, definition.id, true, true, good);
        const fetchEvidence = vi.fn(async () => { throw new Error('Incomplete publisher feed'); });
        const persist = vi.fn(async () => ({}));
        await expect(runSourceJob({ pool, source: definition, mode: 'persist', fetchEvidence,
            preview: async () => ({}), persist, now: () => new Date('2030-01-01T01:00:00Z') }))
            .rejects.toThrow('Incomplete');
        expect(fetchEvidence).toHaveBeenCalledOnce();
        expect(persist).not.toHaveBeenCalled();
        expect(await status(definition.id)).toMatchObject({ last_attempt_succeeded: false, last_success_at: good });
        expect(await runSourceJob({ pool, source: definition, mode: 'persist',
            fetchEvidence: async () => ({}), preview: async () => ({}), persist,
            now: () => new Date('2030-01-01T02:00:00Z') })).toMatchObject({ status: 'persisted' });
        expect(await status(definition.id)).toMatchObject({ last_attempt_succeeded: true });
    });

    it('does not retry persistence failures as publisher requests or accept a stale heartbeat', async () => {
        const definition = source();
        const fetchEvidence = vi.fn(async () => ({}));
        const persist = vi.fn(async () => { throw new TypeError('network unavailable during persistence'); });
        const at = new Date('2030-01-02T00:00:00Z');
        await expect(runSourceJob({ pool, source: definition, mode: 'persist', fetchEvidence,
            preview: async () => ({}), persist, now: () => at })).rejects.toThrow('persistence');
        expect(fetchEvidence).toHaveBeenCalledOnce();
        expect(persist).toHaveBeenCalledOnce();
        await recordRegisteredSourceAttempt(pool, definition.id, true, true, new Date('2029-01-01T00:00:00Z'));
        expect(await status(definition.id)).toMatchObject({ last_attempt_succeeded: false, last_success_at: null, last_attempt_at: at });
    });
});
