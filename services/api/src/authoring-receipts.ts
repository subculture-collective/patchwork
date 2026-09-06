import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';
import type { IdempotentCommand, IdempotentResponse } from './http/idempotency-store.js';

const sourceResult = z.object({
    uri: z.string(), cid: z.string().min(1),
    record: z.object({ title: z.string().min(1).max(140), status: z.enum(['open', 'in-progress', 'resolved', 'closed']) }),
});
const sourcePaths = new Set(['/at/aid-posts', '/at/aid-posts/close', '/at/aid-posts/status/reconcile']);

/** Called inside the command transaction: a successful response and its receipt commit together. */
export async function recordAuthoringReceipt(client: PoolClient, command: IdempotentCommand, response: IdempotentResponse) {
    if (!sourcePaths.has(command.pathname) || response.statusCode < 200 || response.statusCode >= 300) return;
    if (command.method === 'DELETE') {
        const body = z.object({ uri: z.string() }).parse(command.body);
        await client.query('UPDATE aid_authoring_receipts SET deleted_at = NOW() WHERE post_uri = $1 AND owner_did = $2', [body.uri, command.actorDid]);
        return;
    }
    if (command.method !== 'POST' && command.method !== 'PUT') return;
    const result = sourceResult.parse(response.body);
    if (!result.uri.startsWith(`at://${command.actorDid}/app.patchwork.aid.post/`)) throw new Error('Authoring receipt owner mismatch');
    if (command.method === 'POST' && command.pathname === '/at/aid-posts') {
        const privateStatus = { open: 'open', 'in-progress': 'in_progress', resolved: 'resolved', closed: 'archived' }[result.record.status];
        await client.query(`INSERT INTO request_workflows (post_uri, requester_did, current_status,
            create_command_id, retention_until, created_at, updated_at,
            public_status, public_cid, public_synced_at, public_sync_state)
            VALUES ($1, $2, $3, $4, NOW() + INTERVAL '365 days', NOW(), NOW(), $5, $6, NOW(), 'synced')
            ON CONFLICT (post_uri) DO NOTHING`,
            [result.uri, command.actorDid, privateStatus, `authoring:${result.uri}`, result.record.status, result.cid]);
    }
    await client.query(`INSERT INTO aid_authoring_receipts (post_uri, owner_did, title, source_cid, public_status)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (post_uri) DO UPDATE SET
        title = EXCLUDED.title, source_cid = EXCLUDED.source_cid, public_status = EXCLUDED.public_status,
        source_written_at = NOW(), deleted_at = NULL, retention_until = NOW() + INTERVAL '365 days'`,
        [result.uri, command.actorDid, result.record.title, result.cid, result.record.status]);
}

export class AuthoringReceiptService {
    constructor(private readonly pool: Pool) {}

    async list(ownerDid: string, params: URLSearchParams) {
        const page = Number(params.get('page') ?? 1);
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new PublicHttpError(400, 'INVALID_QUERY', 'Invalid request page.');
        const uri = params.get('uri');
        const result = await this.pool.query<{
            total: string; uri: string | null; title: string | null; status: string | null;
            source_cid: string | null; projected_cid: string | null; source_written_at: Date | null;
        }>(`WITH owned AS (
            SELECT r.post_uri AS uri, r.title, COALESCE(w.current_status, r.public_status) AS status,
                r.source_cid, CASE WHEN w.public_sync_state IN ('pending', 'failed') THEN NULL ELSE p.cid END AS projected_cid, r.source_written_at
            FROM aid_authoring_receipts r
            LEFT JOIN request_workflows w ON w.post_uri = r.post_uri
            LEFT JOIN indexer_aid_post_projections p ON p.uri = r.post_uri
            WHERE r.owner_did = $1 AND r.deleted_at IS NULL AND r.retention_until > NOW()
            UNION ALL
            SELECT p.uri, p.title, COALESCE(w.current_status, p.status), p.cid, p.cid, p.record_updated_at
            FROM indexer_aid_post_projections p LEFT JOIN request_workflows w ON w.post_uri = p.uri
            WHERE split_part(p.uri, '/', 3) = $1
                AND NOT EXISTS (SELECT 1 FROM aid_authoring_receipts r WHERE r.post_uri = p.uri)
            UNION ALL
            SELECT w.post_uri, 'Request', w.current_status, w.public_cid, NULL, w.updated_at
            FROM request_workflows w
            WHERE w.requester_did = $1 AND (w.retention_until IS NULL OR w.retention_until > NOW())
                AND NOT EXISTS (SELECT 1 FROM aid_authoring_receipts r WHERE r.post_uri = w.post_uri)
                AND NOT EXISTS (SELECT 1 FROM indexer_aid_post_projections p WHERE p.uri = w.post_uri)
        ), filtered AS (SELECT * FROM owned WHERE ($2::text IS NULL OR uri = $2)),
        page AS (SELECT * FROM filtered ORDER BY source_written_at DESC, uri LIMIT 20 OFFSET $3)
        SELECT totals.total, page.* FROM (SELECT COUNT(*) AS total FROM filtered) totals LEFT JOIN page ON TRUE`,
        [ownerDid, uri, (page - 1) * 20]);
        const total = Number(result.rows[0]?.total ?? 0);
        return { page, pageSize: 20, total, hasNextPage: page * 20 < total,
            requests: result.rows.filter(row => row.uri).map(row => ({
                uri: row.uri!, title: row.title!, status: row.status!, sourceCid: row.source_cid,
                sourceWrittenAt: row.source_written_at?.toISOString(),
                publication: row.source_cid && row.source_cid === row.projected_cid ? 'projected' as const : 'pending' as const,
            })),
        };
    }

    async projection(postUri: string, sourceCid?: string) {
        const result = await this.pool.query<{ expected_cid: string | null; cid: string | null; projected_at: Date | null }>(
            `SELECT expected.expected_cid, p.cid, p.projected_at FROM
                (SELECT COALESCE((SELECT source_cid FROM aid_authoring_receipts WHERE post_uri = $1 AND deleted_at IS NULL), $2) AS expected_cid) expected
                LEFT JOIN indexer_aid_post_projections p ON p.uri = $1 AND p.cid = expected.expected_cid`, [postUri, sourceCid ?? null]);
        const row = result.rows[0];
        return { sourceUri: postUri, ...(row?.expected_cid ? { sourceCid: row.expected_cid } : {}),
            ...(row?.cid && row.projected_at ? { state: 'projected' as const, projectedAt: row.projected_at.toISOString() }
                : { state: 'pending' as const, retryAfterSeconds: 5 }),
        };
    }
}
