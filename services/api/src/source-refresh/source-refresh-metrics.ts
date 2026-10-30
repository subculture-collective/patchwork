import type { Pool } from 'pg';
import { sourceKeySchema } from './source-registry.js';

export async function renderRegisteredSourceMetrics(pool: Pick<Pool, 'query'>): Promise<string> {
    const result = await pool.query<{
        source_id: string; quarantined: boolean; last_attempt_succeeded: boolean | null;
        last_attempt_timestamp: string | null; last_success_timestamp: string | null;
    }>(`SELECT source_id,s.last_attempt_succeeded,
        EXTRACT(EPOCH FROM s.last_attempt_at)::text AS last_attempt_timestamp,
        EXTRACT(EPOCH FROM s.last_success_at)::text AS last_success_timestamp,
        q.quarantine_id IS NOT NULL AS quarantined
        FROM source_refresh_operational_status s FULL JOIN
        (SELECT source_id,quarantine_id FROM source_refresh_quarantines WHERE cleared_at IS NULL) q
        USING(source_id) ORDER BY source_id`);
    const lines = [
        '# HELP patchwork_source_refresh_last_attempt_success Whether the latest scheduled source refresh completed without error.',
        '# TYPE patchwork_source_refresh_last_attempt_success gauge',
        '# HELP patchwork_source_refresh_last_attempt_timestamp_seconds Unix timestamp of the latest scheduled source refresh attempt.',
        '# TYPE patchwork_source_refresh_last_attempt_timestamp_seconds gauge',
        '# HELP patchwork_source_refresh_last_success_timestamp_seconds Unix timestamp of the latest completed source refresh.',
        '# TYPE patchwork_source_refresh_last_success_timestamp_seconds gauge',
        '# HELP patchwork_source_refresh_quarantined Whether publisher validation requires review before scheduled refresh can resume.',
        '# TYPE patchwork_source_refresh_quarantined gauge',
    ];
    for (const row of result.rows) {
        const source = sourceKeySchema.parse(row.source_id);
        const labels = `{project="patchwork",service="api",source="${source}"}`;
        lines.push(`patchwork_source_refresh_quarantined${labels} ${row.quarantined ? 1 : 0}`);
        if (row.last_attempt_succeeded !== null) lines.push(`patchwork_source_refresh_last_attempt_success${labels} ${row.last_attempt_succeeded ? 1 : 0}`);
        if (row.last_attempt_timestamp !== null) lines.push(`patchwork_source_refresh_last_attempt_timestamp_seconds${labels} ${Number(row.last_attempt_timestamp)}`);
        if (row.last_success_timestamp !== null) lines.push(`patchwork_source_refresh_last_success_timestamp_seconds${labels} ${Number(row.last_success_timestamp)}`);
    }
    return lines.join('\n');
}
