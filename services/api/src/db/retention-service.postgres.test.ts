import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRetentionService } from './retention-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('private-data retention enforcement', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const retention = new PostgresRetentionService(pool);

    beforeAll(async () => {
        for (const migration of [
            '0002_at_sessions.sql',
            '0003_core_operational_state.sql',
            '0011_http_idempotency.sql',
            '0021_maintenance_mode.sql',
        ]) {
            await pool.query(
                await readFile(
                    new URL(`./migrations/${migration}`, import.meta.url),
                    'utf8',
                ),
            );
        }
    });

    afterAll(async () => {
        await pool.query(
            `DELETE FROM operational_audit_events WHERE command_id LIKE 'retention-test-%';
             DELETE FROM abuse_reports WHERE command_id LIKE 'retention-test-%';
             DELETE FROM user_blocks WHERE command_id LIKE 'retention-test-%';
             DELETE FROM request_workflows WHERE create_command_id LIKE 'retention-test-%';
             DELETE FROM http_idempotency_commands WHERE idempotency_key LIKE 'retention-test-%';
             DELETE FROM patchwork_browser_sessions WHERE session_id_hash LIKE 'retention-test-%';
             DELETE FROM at_oauth_state WHERE state_key_hash LIKE 'retention-test-%';
             DELETE FROM at_oauth_sessions WHERE did LIKE 'did:plc:retention-%';`,
        );
        await pool.end();
    });

    it('purges expired private rows while preserving rows whose deadline has not elapsed', async () => {
        await pool.query(
            `INSERT INTO user_blocks (
                command_id, blocker_did, subject_did, reason,
                retention_until, created_at
             ) VALUES
                ('retention-test-block-expired', 'did:plc:retention-a', 'did:plc:retention-b', 'expired detail', '2026-07-10T00:00:00Z', '2026-07-01T00:00:00Z'),
                ('retention-test-block-future', 'did:plc:retention-a', 'did:plc:retention-c', 'future detail', '2026-07-20T00:00:00Z', '2026-07-01T00:00:00Z');
             INSERT INTO abuse_reports (
                command_id, reporter_did, subject_uri, subject_did, reason,
                details, retention_until, created_at
             ) VALUES
                ('retention-test-report-expired', 'did:plc:retention-a', 'at://did:plc:retention-b/app.patchwork.aid.post/expired', 'did:plc:retention-b', 'spam', 'private expired detail', '2026-07-10T00:00:00Z', '2026-07-01T00:00:00Z'),
                ('retention-test-report-future', 'did:plc:retention-a', 'at://did:plc:retention-c/app.patchwork.aid.post/future', 'did:plc:retention-c', 'spam', 'private future detail', '2026-07-20T00:00:00Z', '2026-07-01T00:00:00Z');
             INSERT INTO operational_audit_events (
                command_id, actor_did, action, subject_uri, payload,
                retention_until, occurred_at
             ) VALUES
                ('retention-test-audit-expired', 'did:plc:retention-a', 'test', NULL, '{}', '2026-07-10T00:00:00Z', '2026-07-01T00:00:00Z'),
                ('retention-test-audit-future', 'did:plc:retention-a', 'test', NULL, '{}', '2026-07-20T00:00:00Z', '2026-07-01T00:00:00Z');`,
        );

        const result = await retention.enforce(
            new Date('2026-07-11T00:00:00Z'),
        );
        expect(result.blocks).toBeGreaterThanOrEqual(1);
        expect(result.reports).toBeGreaterThanOrEqual(1);
        expect(result.auditEvents).toBeGreaterThanOrEqual(1);

        const remaining = await pool.query<{ command_id: string }>(
            `SELECT command_id FROM user_blocks WHERE command_id LIKE 'retention-test-%'
             UNION ALL
             SELECT command_id FROM abuse_reports WHERE command_id LIKE 'retention-test-%'
             UNION ALL
             SELECT command_id FROM operational_audit_events WHERE command_id LIKE 'retention-test-%'
             ORDER BY command_id`,
        );
        expect(remaining.rows.map(row => row.command_id)).toEqual([
            'retention-test-audit-future',
            'retention-test-block-future',
            'retention-test-report-future',
        ]);
    });

    it('purges expired authentication and completed replay state without removing active sessions', async () => {
        await pool.query(
            `INSERT INTO at_oauth_state (state_key_hash, encrypted_payload, expires_at) VALUES
                ('retention-test-state-expired', 'encrypted', '2026-07-10T00:00:00Z'),
                ('retention-test-state-future', 'encrypted', '2026-07-20T00:00:00Z')
             ON CONFLICT (state_key_hash) DO NOTHING;
             INSERT INTO at_oauth_sessions (did, encrypted_payload, revoked_at) VALUES
                ('did:plc:retention-expired', 'encrypted', '2026-07-01T00:00:00Z'),
                ('did:plc:retention-active', 'encrypted', NULL)
             ON CONFLICT (did) DO NOTHING;
             INSERT INTO patchwork_browser_sessions (session_id_hash, did, expires_at) VALUES
                ('retention-test-browser-expired', 'did:plc:retention-active', '2026-07-10T00:00:00Z'),
                ('retention-test-browser-future', 'did:plc:retention-active', '2026-07-20T00:00:00Z')
             ON CONFLICT (session_id_hash) DO NOTHING;
             INSERT INTO http_idempotency_commands (
                actor_did, method, pathname, idempotency_key, request_hash,
                status_code, response_body, created_at, completed_at
             ) VALUES
                ('did:plc:retention-active', 'POST', '/test', 'retention-test-replay-expired', 'hash', 200, '{}', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
                ('did:plc:retention-active', 'POST', '/test', 'retention-test-replay-future', 'hash', 200, '{}', '2026-07-10T12:00:00Z', '2026-07-10T12:00:00Z')
             ON CONFLICT DO NOTHING;`,
        );

        await expect(
            retention.enforce(new Date('2026-07-11T00:00:00Z')),
        ).resolves.toMatchObject({
            oauthStates: 1,
            browserSessions: 1,
            oauthSessions: 1,
            idempotencyCommands: 1,
        });

        const remaining = await pool.query<{ value: string }>(
            `SELECT state_key_hash AS value FROM at_oauth_state WHERE state_key_hash LIKE 'retention-test-%'
             UNION ALL SELECT session_id_hash FROM patchwork_browser_sessions WHERE session_id_hash LIKE 'retention-test-%'
             UNION ALL SELECT did FROM at_oauth_sessions WHERE did LIKE 'did:plc:retention-%'
             UNION ALL SELECT idempotency_key FROM http_idempotency_commands WHERE idempotency_key LIKE 'retention-test-%'
             ORDER BY value`,
        );
        expect(remaining.rows.map(row => row.value)).toEqual([
            'did:plc:retention-active',
            'retention-test-browser-future',
            'retention-test-replay-future',
            'retention-test-state-future',
        ]);
    });

    it('removes an expired workflow and its cascading private timeline', async () => {
        await pool.query(
            `INSERT INTO request_workflows (
                post_uri, requester_did, current_status, create_command_id,
                retention_until, created_at, updated_at
             ) VALUES
                ('at://did:plc:retention-a/app.patchwork.aid.post/expired', 'did:plc:retention-a', 'archived', 'retention-test-workflow-expired', '2026-07-10T00:00:00Z', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z'),
                ('at://did:plc:retention-a/app.patchwork.aid.post/future', 'did:plc:retention-a', 'archived', 'retention-test-workflow-future', '2026-07-20T00:00:00Z', '2026-07-01T00:00:00Z', '2026-07-01T00:00:00Z');
             INSERT INTO request_transition_events (
                command_id, post_uri, actor_did, from_status, to_status, occurred_at
             ) VALUES (
                'retention-test-transition-expired',
                'at://did:plc:retention-a/app.patchwork.aid.post/expired',
                'did:plc:retention-a', 'resolved', 'archived', '2026-07-01T00:00:00Z'
             );`,
        );

        await expect(
            retention.enforce(new Date('2026-07-11T00:00:00Z')),
        ).resolves.toMatchObject({ workflows: 1 });

        const remaining = await pool.query<{ create_command_id: string }>(
            `SELECT create_command_id FROM request_workflows
             WHERE create_command_id LIKE 'retention-test-workflow-%'`,
        );
        expect(remaining.rows).toEqual([
            { create_command_id: 'retention-test-workflow-future' },
        ]);
        const transition = await pool.query(
            `SELECT 1 FROM request_transition_events
             WHERE command_id = 'retention-test-transition-expired'`,
        );
        expect(transition.rowCount).toBe(0);
    });
});
