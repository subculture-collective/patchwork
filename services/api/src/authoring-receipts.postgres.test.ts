import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthoringReceiptService } from './authoring-receipts.js';
import { PostgresIdempotencyExecutor } from './http/idempotency-store.js';
import { createAccountRequestsHandler } from './http/account-requests-handler.js';
import { authenticateRequest } from './http/authenticated-request.js';
import { PublicHttpError } from './http/error-response.js';
import { PostgresRetentionService } from './db/retention-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('durable authoring receipts', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const service = new AuthoringReceiptService(pool);
    const executor = new PostgresIdempotencyExecutor(pool);
    const owner = 'did:plc:receiptowner';
    const other = 'did:plc:receiptother';
    const uri = `at://${owner}/app.patchwork.aid.post/request`;
    const command = { actorDid: owner, method: 'POST', pathname: '/at/aid-posts', idempotencyKey: 'receipt-create', body: {} };
    const response = { statusCode: 201, body: { uri, cid: 'cid-new', record: { title: 'Groceries tomorrow', status: 'open', description: 'Public description' } } };
    beforeEach(async () => {
        await pool.query('TRUNCATE aid_authoring_receipts, http_idempotency_commands, request_workflows, indexer_aid_post_projections, account_deactivations CASCADE');
    });
    afterAll(async () => pool.end());
    const create = () => executor.execute(command, async () => response);
    const project = async (cid: string) => {
        await pool.query(`INSERT INTO indexer_aid_post_projections (
            uri, collection, cid, revision, author_did_hash, title, description, category, urgency, status,
            searchable_text, latitude, longitude, precision_km, record_created_at, record_updated_at, source_cursor, source_event_id, projected_at)
            VALUES ($1, 'app.patchwork.aid.post', $2, 'rev', repeat('a',64), 'Groceries tomorrow', 'Description', 'food', 'low', 'open',
            'groceries', 41.88, -87.63, 3, NOW(), NOW(), 1, 'receipt-event', NOW())
            ON CONFLICT (uri) DO UPDATE SET cid = EXCLUDED.cid`, [uri, cid]);
    };
    it('persists a minimal receipt and private workflow before projection, replaying without duplicates', async () => {
        await create();
        await executor.execute(command, async () => { throw new Error('must replay'); });
        expect((await service.list(owner, new URLSearchParams())).requests).toEqual([
            expect.objectContaining({ uri, title: 'Groceries tomorrow', publication: 'pending', status: 'open' }),
        ]);
        expect((await pool.query('SELECT requester_did, public_cid FROM request_workflows WHERE post_uri=$1', [uri])).rows)
            .toEqual([{ requester_did: owner, public_cid: 'cid-new' }]);
        expect((await service.list(other, new URLSearchParams({ uri }))).requests).toEqual([]);
        const receipt = (await pool.query('SELECT * FROM aid_authoring_receipts')).rows[0];
        expect(receipt).not.toHaveProperty('description');
        expect(receipt).not.toHaveProperty('latitude');
        // The account view outlives the short command replay window.
        await pool.query('DELETE FROM http_idempotency_commands');
        expect((await service.list(owner, new URLSearchParams())).total).toBe(1);
    });
    it('requires the current source version in the indexer before acknowledging publication', async () => {
        await create();
        await project('cid-old');
        expect((await service.projection(uri, 'cid-new')).state).toBe('pending');
        expect((await service.list(owner, new URLSearchParams())).requests[0]?.publication).toBe('pending');
        await project('cid-new');
        expect((await service.projection(uri, 'cid-new')).state).toBe('projected');
        expect((await service.list(owner, new URLSearchParams())).requests[0]?.publication).toBe('projected');
    });
    it('does not persist malformed or failed source acknowledgments', async () => {
        await expect(executor.execute(command, async () => ({ statusCode: 201, body: { ...response.body, uri: `at://${other}/app.patchwork.aid.post/request` } }))).rejects.toThrow('owner mismatch');
        expect((await pool.query('SELECT COUNT(*) FROM http_idempotency_commands')).rows[0].count).toBe('0');
        await executor.execute(command, async () => ({ statusCode: 503, body: { error: 'unavailable' } }));
        expect((await service.list(owner, new URLSearchParams())).total).toBe(0);
    });
    it('keeps deleted receipts out of account results even when a stale projection remains', async () => {
        await create(); await project('cid-new');
        await executor.execute({ ...command, method: 'DELETE', idempotencyKey: 'receipt-delete', body: { uri } }, async () => ({ statusCode: 200, body: { deleted: true } }));
        expect((await service.list(owner, new URLSearchParams())).total).toBe(0);
    });
    it('pages owned requests stably and includes legacy projected and unprojected workflows', async () => {
        await project('cid-old');
        await pool.query(`INSERT INTO aid_authoring_receipts (post_uri, owner_did, title, source_cid, public_status)
            SELECT 'at://' || $1 || '/app.patchwork.aid.post/' || n, $1, 'Request ' || n, 'cid', 'open' FROM generate_series(1, 21) n`, [owner]);
        await pool.query(`INSERT INTO request_workflows(post_uri, requester_did, current_status, create_command_id, created_at, updated_at)
            VALUES ($1, $2, 'open', 'receipt-legacy', NOW(), NOW())`, [uri + '-legacy', owner]);
        const first = await service.list(owner, new URLSearchParams());
        const second = await service.list(owner, new URLSearchParams({ page: '2' }));
        expect(first).toMatchObject({ total: 23, hasNextPage: true });
        expect(first.requests).toHaveLength(20);
        expect(second.requests).toHaveLength(3);
        expect(new Set([...first.requests, ...second.requests].map(row => row.uri)).size).toBe(23);
        expect((await service.list(owner, new URLSearchParams({ page: '3' }))).total).toBe(23);
        await expect(service.list(owner, new URLSearchParams({ page: '-1' }))).rejects.toMatchObject({ statusCode: 400 });
    });
    it('recovers recent pre-migration acknowledgments, but does not resurrect writes after an ambiguous deletion', async () => {
        await create();
        await pool.query('TRUNCATE aid_authoring_receipts, request_workflows CASCADE');
        const migration = await readFile(new URL('./db/migrations/0027_aid_authoring_receipts.sql', import.meta.url), 'utf8');
        await pool.query(migration);
        expect((await service.list(owner, new URLSearchParams())).total).toBe(1);
        await executor.execute({ ...command, method: 'DELETE', idempotencyKey: 'legacy-delete', body: { uri } }, async () => ({ statusCode: 204, body: null }));
        await pool.query('TRUNCATE aid_authoring_receipts, request_workflows CASCADE');
        await pool.query(migration);
        expect((await service.list(owner, new URLSearchParams())).total).toBe(0);
    });
    it('uses a newer authoring receipt instead of a stale workflow version and keeps pending status sync unconfirmed', async () => {
        await create(); await project('cid-new');
        await executor.execute({ ...command, method: 'PUT', idempotencyKey: 'edit-request' }, async () => ({
            ...response, statusCode: 200, body: { ...response.body, cid: 'cid-edited' },
        }));
        expect(await service.projection(uri, 'cid-new')).toMatchObject({ sourceCid: 'cid-edited', state: 'pending' });
        await project('cid-edited');
        await pool.query("UPDATE request_workflows SET public_sync_state = 'failed' WHERE post_uri=$1", [uri]);
        expect((await service.list(owner, new URLSearchParams())).requests[0]?.publication).toBe('pending');
    });

    it('enforces receipt retention', async () => {
        await create();
        await pool.query("UPDATE aid_authoring_receipts SET retention_until = NOW() - INTERVAL '1 day'");
        expect((await new PostgresRetentionService(pool).enforce(new Date())).authoringReceipts).toBe(1);
        expect((await pool.query('SELECT COUNT(*) FROM aid_authoring_receipts')).rows[0].count).toBe('0');
    });
    it('authenticates HTTP reads and ignores an attacker-supplied owner', async () => {
        await create();
        const handler = createAccountRequestsHandler(service, request => authenticateRequest(request, {
            resolveSession: async token => { if (token !== 'other') throw new PublicHttpError(401, 'SESSION_EXPIRED', 'Sign in again.'); return { did: other }; },
            resolveRole: async () => 'user',
        }));
        const server = createServer((req, res) => { if (!handler(req, res, new URL(req.url!, 'http://localhost'))) res.writeHead(404).end(); });
        server.listen(0, '127.0.0.1'); await once(server, 'listening');
        const address = server.address(); if (!address || typeof address === 'string') throw new Error('No address');
        const url = `http://127.0.0.1:${address.port}/account/requests?ownerDid=${owner}`;
        try {
            expect((await fetch(url)).status).toBe(401);
            const result = await fetch(url, { headers: { authorization: 'Bearer other' } });
            expect(result.headers.get('cache-control')).toBe('no-store');
            expect(await result.json()).toMatchObject({ requests: [], total: 0 });
            expect((await fetch(url, { method: 'POST' })).status).toBe(405);
        } finally { server.close(); await once(server, 'close'); }
    });
});
