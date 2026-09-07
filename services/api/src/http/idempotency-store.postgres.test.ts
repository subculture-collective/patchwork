import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresIdempotencyExecutor } from './idempotency-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('PostgreSQL HTTP idempotency executor', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const executor = new PostgresIdempotencyExecutor(pool);

    beforeAll(async () => {
        await pool.query(
            await readFile(
                new URL('../db/migrations/0011_http_idempotency.sql', import.meta.url),
                'utf8',
            ),
        );
    });

    beforeEach(async () => {
        await pool.query(
            'TRUNCATE http_idempotency_commands, account_deactivations',
        );
    });

    afterAll(async () => pool.end());

    it('executes concurrent delivery once and replays the durable response', async () => {
        const effect = vi.fn(async () => ({
            statusCode: 201,
            body: { created: true },
        }));
        const command = {
            actorDid: 'did:example:alice',
            method: 'POST',
            pathname: '/reports',
            idempotencyKey: 'report-command-1',
            body: { reason: 'spam', subjectUri: 'at://did:example:bob/x/y' },
        };

        const [first, duplicate] = await Promise.all([
            executor.execute(command, effect),
            executor.execute(command, effect),
        ]);
        expect(first).toEqual(duplicate);
        expect(effect).toHaveBeenCalledOnce();

        const restarted = new PostgresIdempotencyExecutor(pool);
        await expect(restarted.execute(command, effect)).resolves.toEqual(first);
        expect(effect).toHaveBeenCalledOnce();
        await expect(
            restarted.execute({ ...command, body: { reason: 'fraud' } }, effect),
        ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it('rejects new mutations for a deactivated actor', async () => {
        const actorDid = 'did:example:deactivated';
        const didHash = createHash('sha256').update(actorDid).digest('hex');
        await pool.query(
            `INSERT INTO account_deactivations (
                did_hash, command_id, result, requested_at, retention_until
             ) VALUES ($1, 'deactivated-command-test',
                       '{"status":"deactivated"}', NOW(),
                       NOW() + INTERVAL '1 year')`,
            [didHash],
        );
        const effect = vi.fn(async () => ({ statusCode: 200, body: {} }));

        await expect(
            executor.execute(
                {
                    actorDid,
                    method: 'POST',
                    pathname: '/reports',
                    idempotencyKey: 'post-deactivation-command',
                    body: {},
                },
                effect,
            ),
        ).rejects.toMatchObject({
            statusCode: 403,
            code: 'ACCOUNT_DEACTIVATED',
        });
        expect(effect).not.toHaveBeenCalled();
    });
});
