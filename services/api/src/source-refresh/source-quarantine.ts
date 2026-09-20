import type { Pool } from 'pg';
import { z } from 'zod';
import { sourceKeySchema } from './source-registry.js';

export async function activeSourceQuarantine(pool: Pick<Pool, 'query'>, sourceId: string) {
    sourceKeySchema.parse(sourceId);
    return (await pool.query<{ quarantine_id: string; adapter_version: string; reason_code: string; quarantined_at: Date }>(
        `SELECT quarantine_id,adapter_version,reason_code,quarantined_at FROM source_refresh_quarantines
         WHERE source_id=$1 AND cleared_at IS NULL`, [sourceId])).rows[0];
}

export async function quarantineSource(pool: Pick<Pool, 'query'>, sourceId: string, adapterVersion: string) {
    sourceKeySchema.parse(sourceId);
    z.string().regex(/^\d+\.\d+\.\d+$/).parse(adapterVersion);
    await pool.query(`INSERT INTO source_refresh_quarantines(source_id,adapter_version,reason_code)
        VALUES($1,$2,'publisher-contract') ON CONFLICT(source_id) WHERE cleared_at IS NULL DO NOTHING`, [sourceId, adapterVersion]);
}

/** Compare-and-clear the reviewed incident only, serialized with source jobs. */
export async function clearSourceQuarantine(pool: Pool, sourceId: string, quarantineId: string, reason: string) {
    sourceKeySchema.parse(sourceId);
    z.string().uuid().parse(quarantineId);
    const reviewedReason = z.string().trim().min(20).max(1000).parse(reason);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const lock = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', [`source-refresh:${sourceId}`]);
        if (!lock.rows[0]?.acquired) throw new Error('Source job is running; quarantine was not cleared.');
        const result = await client.query(`UPDATE source_refresh_quarantines SET cleared_at=NOW(),clearance_reason=$3
            WHERE source_id=$1 AND quarantine_id=$2 AND cleared_at IS NULL`, [sourceId, quarantineId, reviewedReason]);
        if (result.rowCount !== 1) throw new Error('Active quarantine changed or was already cleared.');
        await client.query('COMMIT');
        return { cleared: true as const, sourceId, quarantineId };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}
