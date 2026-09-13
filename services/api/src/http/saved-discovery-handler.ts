import { AtClientError } from '@patchwork/at-client';
import { ZodError } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthenticatedRequest } from './authenticated-request.js';
import type { SavedDiscoveryService } from '../saved-discovery-service.js';
import { readJsonBody } from './json-body.js';
import { writeJsonResponse, writePublicError } from './error-response.js';

export const createSavedDiscoveryHandler =
    (
        service: SavedDiscoveryService,
        authenticate: (
            request: IncomingMessage,
        ) => Promise<AuthenticatedRequest>,
    ) =>
    (request: IncomingMessage, response: ServerResponse, url: URL): boolean => {
        if (
            ![
                '/account/saved-discovery',
                '/account/saved-discovery/alerts',
            ].includes(url.pathname)
        )
            return false;
        if (url.pathname.endsWith('/alerts') && request.method !== 'PUT') {
            writeJsonResponse(response, 405, {
                error: { code: 'METHOD_NOT_ALLOWED', message: 'Use PUT.' },
            });
            return true;
        }
        response.setHeader('cache-control', 'no-store');
        if (!['GET', 'PUT', 'DELETE'].includes(request.method ?? '')) {
            response.setHeader('allow', 'GET, PUT, DELETE');
            writeJsonResponse(response, 405, {
                error: {
                    code: 'METHOD_NOT_ALLOWED',
                    message: 'Use GET, PUT or DELETE.',
                },
            });
            return true;
        }
        void (async () => {
            try {
                const actor = await authenticate(request);
                const did = actor.principal.did;
                const result = url.pathname.endsWith('/alerts')
                    ? await service.setAlerts(
                          did,
                          await readJsonBody(request, 1024),
                      )
                    : request.method === 'GET'
                      ? await service.list(did)
                      : request.method === 'PUT'
                        ? await service.save(
                              did,
                              await readJsonBody(request, 8192),
                          )
                        : await service.remove(
                              did,
                              await readJsonBody(request, 1024),
                          );
                writeJsonResponse(response, 200, result);
            } catch (error) {
                if (error instanceof ZodError) {
                    writeJsonResponse(response, 400, {
                        error: {
                            code: 'INVALID_SAVED_DISCOVERY',
                            message:
                                'Choose valid public filters and an approximate location.',
                        },
                    });
                } else if (error instanceof AtClientError) {
                    writeJsonResponse(
                        response,
                        error.code === 'SESSION_EXPIRED' ? 401 : 403,
                        { error: { code: error.code, message: error.message } },
                    );
                } else writePublicError(response, error);
            }
        })();
        return true;
    };
