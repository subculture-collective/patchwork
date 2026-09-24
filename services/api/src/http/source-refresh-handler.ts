import type { IncomingMessage, ServerResponse } from 'node:http';
import { AtClientError } from '@patchwork/at-client';
import { ZodError, z } from 'zod';
import { SourceRefreshError, type SourceRefreshService } from '../source-refresh/source-refresh-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { PublicHttpError, writeJsonResponse, writePublicError } from './error-response.js';
import { readJsonBody } from './json-body.js';

const routes = new Set([
    '/admin/source-refresh/candidates',
    '/admin/source-refresh/candidates/dismiss',
    '/admin/source-refresh/candidates/apply-contact',
]);

export function createSourceRefreshHandler(
    service: SourceRefreshService,
    authenticate: (request: IncomingMessage) => Promise<AuthenticatedRequest>,
) {
    return (request: IncomingMessage, response: ServerResponse, url: URL): boolean => {
        if (!routes.has(url.pathname)) return false;
        response.setHeader('cache-control', 'no-store');
        const list = url.pathname === '/admin/source-refresh/candidates';
        if ((list && request.method !== 'GET') || (!list && request.method !== 'POST')) {
            writeJsonResponse(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported source-refresh operation.' } });
            return true;
        }
        void (async () => {
            try {
                const actor = await authenticate(request);
                const result = list
                    ? await service.listCandidates(
                        actor.principal.did,
                        z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page') ?? 1),
                        z.enum(['pending', 'resolved']).parse(url.searchParams.get('status') ?? 'pending'),
                    )
                    : url.pathname.endsWith('/dismiss')
                        ? await service.dismissCandidate(actor.principal.did, await readJsonBody(request, 16384))
                        : await service.applyContactCandidate(
                            z.object({ candidateId: z.string().uuid() }).strict().parse(await readJsonBody(request, 16384)).candidateId,
                            actor.principal.did,
                        );
                writeJsonResponse(response, 200, result);
            } catch (error) {
                if (error instanceof ZodError) {
                    writePublicError(response, new PublicHttpError(400, 'INVALID_SOURCE_REFRESH_REQUEST', 'Check the source-refresh fields and try again.'));
                } else if (error instanceof SourceRefreshError) {
                    writePublicError(response, new PublicHttpError(
                        error.code.endsWith('NOT_FOUND') ? 404 : 409,
                        error.code,
                        error.message,
                    ));
                } else if (error instanceof AtClientError) {
                    writePublicError(response, new PublicHttpError(401, error.code, 'Sign in again to continue.'));
                } else writePublicError(response, error);
            }
        })();
        return true;
    };
}
