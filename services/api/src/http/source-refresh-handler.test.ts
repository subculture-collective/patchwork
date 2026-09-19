import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SourceRefreshService } from '../source-refresh/source-refresh-service.js';
import { createSourceRefreshHandler } from './source-refresh-handler.js';

describe('source-refresh reviewer HTTP boundary', () => {
    let origin: string;
    let server: ReturnType<typeof createServer>;
    const listCandidates = vi.fn().mockResolvedValue({ items: [], page: 1, hasNextPage: false });
    const dismissCandidate = vi.fn().mockResolvedValue({ updated: true });
    const applyContactCandidate = vi.fn().mockResolvedValue({ applied: true });
    const reviewerDid = 'did:plc:source-refresh-reviewer';
    const handler = createSourceRefreshHandler(
        { listCandidates, dismissCandidate, applyContactCandidate } as unknown as SourceRefreshService,
        async () => ({
            sessionToken: 'opaque',
            session: { did: reviewerDid, expiresAt: '2099-01-01T00:00:00.000Z', authenticatedAt: new Date().toISOString() },
            principal: { did: reviewerDid, role: 'moderator', authorization: { actorDid: reviewerDid, role: 'moderator', capabilities: [] } },
        }),
    );

    beforeAll(async () => {
        server = createServer((request, response) => {
            if (!handler(request, response, new URL(request.url ?? '/', 'http://localhost'))) response.writeHead(404).end();
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('no address');
        origin = `http://127.0.0.1:${address.port}`;
    });
    afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

    it('lists the selected reviewer queue with the authenticated actor', async () => {
        const response = await fetch(`${origin}/admin/source-refresh/candidates?status=resolved&page=2`);
        expect(response.status).toBe(200);
        expect(listCandidates).toHaveBeenCalledWith(reviewerDid, 2, 'resolved');
    });

    it('derives the reviewer identity for decisions and rejects malformed input', async () => {
        const candidateId = '00000000-0000-4000-8000-000000000001';
        const applied = await fetch(`${origin}/admin/source-refresh/candidates/apply-contact`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId }),
        });
        expect(applied.status).toBe(200);
        expect(applyContactCandidate).toHaveBeenCalledWith(candidateId, reviewerDid);

        const invalid = await fetch(`${origin}/admin/source-refresh/candidates/dismiss`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId: 'bad' }),
        });
        expect(invalid.status).toBe(200);
        expect(dismissCandidate).toHaveBeenCalledWith(reviewerDid, { candidateId: 'bad' });
    });

    it('rejects unsupported methods without invoking the service', async () => {
        const response = await fetch(`${origin}/admin/source-refresh/candidates`, { method: 'POST' });
        expect(response.status).toBe(405);
    });
});
