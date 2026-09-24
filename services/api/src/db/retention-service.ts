import type { Pool, PoolClient } from 'pg';

export interface RetentionResult {
    blocks: number;
    reports: number;
    auditEvents: number;
    oauthStates: number;
    browserSessions: number;
    oauthSessions: number;
    idempotencyCommands: number;
    workflows: number;
    authoringReceipts: number;
    maintenanceAudit: number;
    coordinationWindows: number;
    groups: number;
    chatMessages: number;
    chatConversations: number;
}

const REPLAY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const deleteExpired = async (
    client: PoolClient,
    table: 'user_blocks' | 'abuse_reports' | 'operational_audit_events',
    now: Date,
): Promise<number> => {
    const result = await client.query(
        `DELETE FROM ${table} WHERE retention_until IS NOT NULL AND retention_until <= $1`,
        [now.toISOString()],
    );
    return result.rowCount ?? 0;
};

export class PostgresRetentionService {
    constructor(private readonly pool: Pool) {}

    async enforce(now = new Date()): Promise<RetentionResult> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const cutoff = new Date(now.getTime() - REPLAY_RETENTION_MS);
            const oauthStates = await client.query(
                'DELETE FROM at_oauth_state WHERE expires_at <= $1',
                [now.toISOString()],
            );
            const browserSessions = await client.query(
                `DELETE FROM patchwork_browser_sessions
                 WHERE expires_at <= $1 OR (revoked_at IS NOT NULL AND revoked_at <= $1)`,
                [now.toISOString()],
            );
            const oauthSessions = await client.query(
                `DELETE FROM at_oauth_sessions
                 WHERE revoked_at IS NOT NULL AND revoked_at <= $1`,
                [cutoff.toISOString()],
            );
            const idempotencyCommands = await client.query(
                `DELETE FROM http_idempotency_commands
                 WHERE completed_at IS NOT NULL AND completed_at <= $1`,
                [cutoff.toISOString()],
            );
            const authoringReceipts = await client.query('DELETE FROM aid_authoring_receipts WHERE retention_until <= $1', [now.toISOString()]);
            const workflows = await client.query(
                `DELETE FROM request_workflows
                 WHERE retention_until IS NOT NULL AND retention_until <= $1`,
                [now.toISOString()],
            );
            const maintenanceAudit = await client.query(
                `DELETE FROM platform_maintenance_audit
                 WHERE retention_until <= $1`,
                [now.toISOString()],
            );
            const coordinationWindows = await client.query(
                `DELETE FROM coordination_windows
                 WHERE retention_until <= $1`,
                [now.toISOString()],
            );
            const groups = await client.query(
                `DELETE FROM groups WHERE retention_until <= $1`,
                [now.toISOString()],
            );
            const chatMessages = await client.query(
                `DELETE FROM chat_messages WHERE retention_until <= $1`,
                [now.toISOString()],
            );
            const chatConversations = await client.query(
                `DELETE FROM chat_conversations WHERE retention_until <= $1`,
                [now.toISOString()],
            );
            const blocks = await deleteExpired(client, 'user_blocks', now);
            const reports = await deleteExpired(client, 'abuse_reports', now);
            const auditEvents = await deleteExpired(
                client,
                'operational_audit_events',
                now,
            );
            await client.query('COMMIT');
            return {
                blocks,
                reports,
                auditEvents,
                oauthStates: oauthStates.rowCount ?? 0,
                browserSessions: browserSessions.rowCount ?? 0,
                oauthSessions: oauthSessions.rowCount ?? 0,
                idempotencyCommands: idempotencyCommands.rowCount ?? 0,
                workflows: workflows.rowCount ?? 0,
                authoringReceipts: authoringReceipts.rowCount ?? 0,
                maintenanceAudit: maintenanceAudit.rowCount ?? 0,
                coordinationWindows: coordinationWindows.rowCount ?? 0,
                groups: groups.rowCount ?? 0,
                chatMessages: chatMessages.rowCount ?? 0,
                chatConversations: chatConversations.rowCount ?? 0,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
