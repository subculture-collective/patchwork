import type { IncomingMessage, ServerResponse } from 'node:http';
import { AtClientError } from '@patchwork/at-client';
import { z, ZodError } from 'zod';
import type { AuthenticatedRequest } from './authenticated-request.js';
import type { ResourceCorrectionService } from '../resource-correction-service.js';
import { readJsonBody } from './json-body.js';
import {
    PublicHttpError,
    writeJsonResponse,
    writePublicError,
} from './error-response.js';
export function createResourceCorrectionHandler(
    service: ResourceCorrectionService,
    authenticate: (request: IncomingMessage) => Promise<AuthenticatedRequest>,
) {
    return (
        request: IncomingMessage,
        response: ServerResponse,
        url: URL,
    ): boolean => {
        if (
            ![
                '/resource-corrections',
                '/resource-corrections/status',
                '/resource-corrections/respond',
                '/resource-corrections/review',
            ].includes(url.pathname)
        )
            return false;
        response.setHeader('cache-control', 'no-store');
        response.setHeader('referrer-policy', 'no-referrer');
        const reviewing = url.pathname.endsWith('/review');
        const allowed =
            url.pathname === '/resource-corrections' || reviewing
                ? ['GET', 'POST']
                : ['POST'];
        if (!allowed.includes(request.method ?? '')) {
            writeJsonResponse(response, 405, {
                error: {
                    code: 'METHOD_NOT_ALLOWED',
                    message: 'Unsupported correction operation.',
                },
            });
            return true;
        }
        void (async () => {
            try {
                const signed = Boolean(
                    request.headers.authorization ||
                    request.headers.cookie
                        ?.split(';')
                        .some((cookie) =>
                            cookie.trim().startsWith('patchwork_session='),
                        ),
                );
                const actor =
                    signed || request.method === 'GET' || reviewing
                        ? await authenticate(request)
                        : undefined;
                const did = actor?.principal.did;
                const body =
                    request.method === 'POST'
                        ? await readJsonBody(request, 16384)
                        : undefined;
                const result =
                    request.method === 'GET'
                        ? await service.list(
                              did!,
                              reviewing,
                              z.coerce
                                  .number()
                                  .int()
                                  .min(1)
                                  .max(10000)
                                  .parse(url.searchParams.get('page') ?? 1),
                          )
                        : reviewing
                          ? await service.decide(did!, body)
                          : url.pathname.endsWith('/status')
                            ? await service.status(body)
                            : url.pathname.endsWith('/respond')
                              ? await service.respond(body, did)
                              : await service.submit(body, did);
                writeJsonResponse(response, 200, result);
            } catch (error) {
                if (error instanceof ZodError)
                    writePublicError(
                        response,
                        new PublicHttpError(
                            400,
                            'INVALID_CORRECTION',
                            'Check the correction fields and try again.',
                        ),
                    );
                else if (error instanceof AtClientError)
                    writePublicError(
                        response,
                        new PublicHttpError(
                            401,
                            error.code,
                            'Sign in again to continue.',
                        ),
                    );
                else writePublicError(response, error);
            }
        })();
        return true;
    };
}
