import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresLifecycleRepository } from '../db/lifecycle-repository.js';
import { PostgresRoleRepository } from '../db/role-repository.js';
import { createLifecycleService } from '../lifecycle-service.js';
import { createLifecycleTransitionHandler } from './lifecycle-transition-handler.js';
import { authenticateRequest } from './authenticated-request.js';
import { AtClientError } from '@patchwork/at-client';
import { PostgresIdempotencyExecutor } from './idempotency-store.js';
import {
    idempotencyKeyFromRequest,
    withIdempotencyKey,
} from './idempotent-request.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const startServer = async (pool: Pool): Promise<{ server: Server; baseUrl: string }> => {
    const roles = new PostgresRoleRepository(pool);
    const idempotency = new PostgresIdempotencyExecutor(pool);
    const handler = createLifecycleTransitionHandler({
        service: createLifecycleService(new PostgresLifecycleRepository(pool)),
        authenticate: request =>
            authenticateRequest(request, {
                resolveSession: async token => {
                    if (token === 'bob-session') {
                        return { did: 'did:plc:bob' };
                    }
                    if (token !== 'alice-session') {
                        throw new AtClientError(
                            'SESSION_EXPIRED',
                            'The Patchwork browser session is missing or expired.',
                        );
                    }
                    return { did: 'did:plc:alice' };
                },
                resolveRole: did => roles.resolve(did),
            }),
        executeIdempotent: (request, actorDid, body, effect) => {
            const key = idempotencyKeyFromRequest(request);
            const commandBody = withIdempotencyKey(body, key);
            return idempotency.execute(
                {
                    actorDid,
                    method: request.method ?? 'POST',
                    pathname: '/aid/post/transition',
                    idempotencyKey: key,
                    body: commandBody,
                },
                () => effect(commandBody),
            );
        },
    });
    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (!handler(request, response, url)) {
            response.writeHead(404).end();
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
};

const stopServer = async (server: Server): Promise<void> => {
    server.close();
    await once(server, 'close');
};

describe('lifecycle HTTP boundary with PostgreSQL', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeAll(async () => {
        const migration = await readFile(
            new URL('../db/migrations/0003_core_operational_state.sql', import.meta.url),
            'utf8',
        );
        await pool.query(migration);
        await pool.query(
            await readFile(
                new URL('../db/migrations/0004_lifecycle_timeline.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0005_lifecycle_assignments.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0006_assignment_responses.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0007_lifecycle_handoffs.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0008_platform_roles.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0009_public_status_sync.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0010_public_sync_state.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            await readFile(
                new URL('../db/migrations/0011_http_idempotency.sql', import.meta.url),
                'utf8',
            ),
        );
        await pool.query(
            'TRUNCATE http_idempotency_commands, platform_roles, operational_audit_events, request_transition_events, request_workflows RESTART IDENTITY CASCADE',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('persists an authenticated transition across HTTP server restart', async () => {
        const request = {
            commandId: 'http-transition-1',
            postUri: 'at://did:plc:alice/app.patchwork.aid.post/http-1',
            targetStatus: 'resolved',
            actorDid: 'did:plc:mallory',
            actorRole: 'admin',
            now: '2026-07-10T23:30:00.000Z',
        };
        const first = await startServer(pool);
        const firstResponse = await fetch(`${first.baseUrl}/aid/post/transition`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: 'patchwork_session=alice-session',
                'idempotency-key': request.commandId,
            },
            body: JSON.stringify(request),
        });
        expect(firstResponse.status).toBe(200);
        await stopServer(first.server);

        const restarted = await startServer(pool);
        const retryResponse = await fetch(
            `${restarted.baseUrl}/aid/post/transition`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: 'patchwork_session=alice-session',
                    'idempotency-key': request.commandId,
                },
                body: JSON.stringify(request),
            },
        );
        expect(retryResponse.status).toBe(200);
        await stopServer(restarted.server);

        const durable = await pool.query<{
            actor_did: string;
            current_status: string;
            transitions: string;
            audits: string;
        }>(
            `SELECT w.requester_did AS actor_did, w.current_status,
                    (SELECT COUNT(*)::text FROM request_transition_events) AS transitions,
                    (SELECT COUNT(*)::text FROM operational_audit_events) AS audits
             FROM request_workflows w WHERE w.post_uri = $1`,
            [request.postUri],
        );
        expect(durable.rows[0]).toEqual({
            actor_did: 'did:plc:alice',
            current_status: 'resolved',
            transitions: '1',
            audits: '1',
        });
    });

    it('rejects an unauthenticated HTTP transition', async () => {
        const running = await startServer(pool);
        const response = await fetch(`${running.baseUrl}/aid/post/transition`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                commandId: 'http-transition-unauthenticated',
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/http-2',
                targetStatus: 'resolved',
            }),
        });
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'AUTHENTICATION_REQUIRED' },
        });
        await stopServer(running.server);
    });

    it('returns private lifecycle state only through the authenticated owner boundary', async () => {
        const postUri =
            'at://did:plc:alice/app.patchwork.aid.post/http-private-query';
        await new PostgresLifecycleRepository(pool).register({
            commandId: 'http-private-query-register',
            postUri,
            requesterDid: 'did:plc:alice',
            createdAt: '2026-07-11T12:00:00.000Z',
        });
        const running = await startServer(pool);
        const response = await fetch(
            `${running.baseUrl}/aid/post/lifecycle?postUri=${encodeURIComponent(postUri)}&actorRole=admin`,
            { headers: { cookie: 'patchwork_session=alice-session' } },
        );

        expect(response.status).toBe(200);
        const body = (await response.json()) as {
            postUri: string;
            currentStatus: string;
            validTransitions: string[];
        };
        expect(body).toMatchObject({
            postUri,
            currentStatus: 'open',
            validTransitions: expect.arrayContaining(['resolved']),
        });
        expect(body.validTransitions).not.toContain('archived');
        await stopServer(running.server);
    });

    it('rejects lifecycle reads from another ordinary account', async () => {
        const postUri =
            'at://did:plc:alice/app.patchwork.aid.post/http-private-query';
        const running = await startServer(pool);
        const response = await fetch(
            `${running.baseUrl}/aid/post/lifecycle?postUri=${encodeURIComponent(postUri)}`,
            { headers: { cookie: 'patchwork_session=bob-session' } },
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'FORBIDDEN' },
        });
        await stopServer(running.server);
    });

    it('rejects an expired HTTP session', async () => {
        const running = await startServer(pool);
        const response = await fetch(`${running.baseUrl}/aid/post/transition`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: 'patchwork_session=expired-session',
            },
            body: JSON.stringify({
                commandId: 'http-transition-expired',
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/http-expired',
                targetStatus: 'resolved',
            }),
        });
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            error: { code: 'SESSION_EXPIRED' },
        });
        await stopServer(running.server);
    });

    it('rejects lifecycle registration for another repository owner', async () => {
        const running = await startServer(pool);
        const response = await fetch(`${running.baseUrl}/aid/post/transition`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: 'patchwork_session=alice-session',
                'idempotency-key': 'http-transition-forbidden',
            },
            body: JSON.stringify({
                commandId: 'http-transition-forbidden',
                postUri: 'at://did:plc:bob/app.patchwork.aid.post/http-3',
                targetStatus: 'resolved',
                actorDid: 'did:plc:mallory',
                actorRole: 'admin',
            }),
        });
        expect(response.status).toBe(403);
        await stopServer(running.server);
    });

    it('authorizes moderation using the provisioned database role', async () => {
        await new PostgresRoleRepository(pool).set({
            did: 'did:plc:alice',
            role: 'moderator',
            updatedBy: 'did:plc:operator',
            updatedAt: '2026-07-10T23:40:00.000Z',
        });
        const running = await startServer(pool);
        const response = await fetch(`${running.baseUrl}/aid/post/transition`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: 'patchwork_session=alice-session',
                'idempotency-key': 'http-transition-moderator',
            },
            body: JSON.stringify({
                commandId: 'http-transition-moderator',
                postUri: 'at://did:plc:alice/app.patchwork.aid.post/http-moderated',
                targetStatus: 'archived',
                actorDid: 'did:plc:mallory',
                actorRole: 'requester',
                now: '2026-07-10T23:41:00.000Z',
            }),
        });

        expect(response.status).toBe(200);
        await stopServer(running.server);
        await expect(
            new PostgresLifecycleRepository(pool).get(
                'at://did:plc:alice/app.patchwork.aid.post/http-moderated',
            ),
        ).resolves.toMatchObject({ currentStatus: 'archived' });
    });
});
