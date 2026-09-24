import { recordAuthoringReceipt } from '../authoring-receipts.js';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PublicHttpError } from './error-response.js';

export interface IdempotentCommand {
    actorDid: string;
    method: string;
    pathname: string;
    idempotencyKey: string;
    body: unknown;
}

export interface IdempotentResponse {
    statusCode: number;
    body: unknown;
}

interface CommandRow {
    request_hash: string;
    status_code: number | null;
    response_body: unknown;
}

export class IdempotencyError extends Error {
    readonly code = 'IDEMPOTENCY_KEY_REUSED';
}

const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, canonicalize(entry)]),
    );
};

const requestHash = (body: unknown): string =>
    createHash('sha256')
        .update(JSON.stringify(canonicalize(body)))
        .digest('hex');

const withTransaction = async <T>(
    pool: Pool,
    operation: (client: PoolClient) => Promise<T>,
): Promise<T> => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export class PostgresIdempotencyExecutor {
    constructor(private readonly pool: Pool) {}

    execute(
        command: IdempotentCommand,
        effect: () => Promise<IdempotentResponse>,
    ): Promise<IdempotentResponse> {
        const hash = requestHash(command.body);
        return withTransaction(this.pool, async client => {
            if (command.pathname !== '/account/deactivate') {
                const actorDidHash = createHash('sha256')
                    .update(command.actorDid)
                    .digest('hex');
                await client.query(
                    `SELECT pg_advisory_xact_lock(hashtext('account:' || $1))`,
                    [actorDidHash],
                );
                const deactivated = await client.query(
                    `SELECT 1 FROM account_deactivations WHERE did_hash = $1`,
                    [actorDidHash],
                );
                if (deactivated.rowCount) {
                    throw new PublicHttpError(
                        403,
                        'ACCOUNT_DEACTIVATED',
                        'This Patchwork account is deactivated.',
                    );
                }
            }
            await client.query(
                `INSERT INTO http_idempotency_commands (
                    actor_did, method, pathname, idempotency_key, request_hash
                 ) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT DO NOTHING`,
                [
                    command.actorDid,
                    command.method,
                    command.pathname,
                    command.idempotencyKey,
                    hash,
                ],
            );
            const locked = await client.query<CommandRow>(
                `SELECT request_hash, status_code, response_body
                 FROM http_idempotency_commands
                 WHERE actor_did = $1 AND method = $2 AND pathname = $3
                   AND idempotency_key = $4
                 FOR UPDATE`,
                [
                    command.actorDid,
                    command.method,
                    command.pathname,
                    command.idempotencyKey,
                ],
            );
            const row = locked.rows[0]!;
            if (row.request_hash !== hash) throw new IdempotencyError();
            if (row.status_code !== null) {
                return { statusCode: row.status_code, body: row.response_body };
            }

            const response = await effect();
            await recordAuthoringReceipt(client, command, response);
            await client.query(
                `UPDATE http_idempotency_commands
                 SET status_code = $5, response_body = $6::jsonb,
                     completed_at = NOW()
                 WHERE actor_did = $1 AND method = $2 AND pathname = $3
                   AND idempotency_key = $4`,
                [
                    command.actorDid,
                    command.method,
                    command.pathname,
                    command.idempotencyKey,
                    response.statusCode,
                    JSON.stringify(response.body ?? null),
                ],
            );
            return response;
        });
    }
}
