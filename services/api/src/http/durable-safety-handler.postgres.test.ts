import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BlockService } from '../block-service.js';
import { PostgresBlockRepository } from '../db/block-repository.js';
import { PostgresReportRepository } from '../db/report-repository.js';
import { ReportService } from '../report-service.js';
import { authenticateRequest } from './authenticated-request.js';
import { createDurableSafetyHandler } from './durable-safety-handler.js';
import {
    idempotencyKeyFromRequest,
    withIdempotencyKey,
} from './idempotent-request.js';
import { PostgresIdempotencyExecutor } from './idempotency-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const startServer = async (pool: Pool) => {
    const idempotency = new PostgresIdempotencyExecutor(pool);
    const handler = createDurableSafetyHandler({
        blockService: new BlockService(new PostgresBlockRepository(pool)),
        reportService: new ReportService(new PostgresReportRepository(pool)),
        authenticate: request =>
            authenticateRequest(request, {
                resolveSession: async token => {
                    if (token !== 'viewer-session') {
                        throw new Error('Unexpected test session.');
                    }
                    return { did: 'did:plc:viewer' };
                },
                resolveRole: async () => 'user',
            }),
        executeIdempotent: (request, actorDid, body, effect) => {
            const key = idempotencyKeyFromRequest(request);
            const commandBody = withIdempotencyKey(body, key);
            const pathname = new URL(
                request.url ?? '/',
                'http://localhost',
            ).pathname;
            return idempotency.execute(
                {
                    actorDid,
                    method: request.method ?? 'POST',
                    pathname,
                    idempotencyKey: key,
                    body: commandBody,
                },
                () => effect(commandBody),
            );
        },
    });
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!handler(request, response, url)) response.writeHead(404).end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    return { server, origin: `http://127.0.0.1:${address.port}` };
};

const stopServer = async (server: Server) => {
    server.close();
    await once(server, 'close');
};

describe('durable safety HTTP boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeAll(async () => {
        for (const migrationName of [
            '0003_core_operational_state.sql',
            '0011_http_idempotency.sql',
        ]) {
            await pool.query(
                await readFile(
                    new URL(`../db/migrations/${migrationName}`, import.meta.url),
                    'utf8',
                ),
            );
        }
        await pool.query(
            'TRUNCATE http_idempotency_commands, user_blocks, abuse_reports RESTART IDENTITY CASCADE',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('persists session-derived report and block actors across authenticated HTTP', async () => {
        const running = await startServer(pool);
        const headers = {
            'content-type': 'application/json',
            cookie: 'patchwork_session=viewer-session',
        };
        const subjectUri =
            'at://did:plc:subject/app.patchwork.aid.post/http-safety-1';

        const report = await fetch(`${running.origin}/reports`, {
            method: 'POST',
            headers: { ...headers, 'idempotency-key': 'http-report-1' },
            body: JSON.stringify({
                reporterDid: 'did:plc:hostile-browser',
                subjectUri,
                reason: 'fraud',
                details: 'Private operator context.',
            }),
        });
        expect(report.status).toBe(201);

        const block = await fetch(`${running.origin}/blocks`, {
            method: 'POST',
            headers: { ...headers, 'idempotency-key': 'http-block-1' },
            body: JSON.stringify({
                blockerDid: 'did:plc:hostile-browser',
                subjectDid: 'did:plc:subject',
                reason: 'Unsafe contact.',
            }),
        });
        expect(block.status).toBe(201);
        await stopServer(running.server);

        const durableReport = await pool.query(
            'SELECT reporter_did, subject_uri, details FROM abuse_reports',
        );
        expect(durableReport.rows).toEqual([
            {
                reporter_did: 'did:plc:viewer',
                subject_uri: subjectUri,
                details: 'Private operator context.',
            },
        ]);
        const durableBlock = await pool.query(
            'SELECT blocker_did, subject_did, reason FROM user_blocks',
        );
        expect(durableBlock.rows).toEqual([
            {
                blocker_did: 'did:plc:viewer',
                subject_did: 'did:plc:subject',
                reason: 'Unsafe contact.',
            },
        ]);
    });
});
