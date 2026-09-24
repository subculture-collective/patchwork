import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { ZodError } from 'zod';
import { readProjectionPage } from '../projected-discovery.js';
import { writeJsonResponse, writePublicError } from './error-response.js';
export const createResourceMapHandler =
    (pool: Pool) =>
    (request: IncomingMessage, response: ServerResponse, url: URL): boolean => {
        if (url.pathname !== '/query/resource-map') return false;
        if (request.method !== 'GET') {
            writeJsonResponse(response, 405, {
                error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' },
            });
            return true;
        }
        response.setHeader('cache-control', 'no-store');
        void (async () => {
            try {
                if (!url.searchParams.has('mapZoom')) {
                    writeJsonResponse(response, 400, {
                        error: {
                            code: 'VIEWPORT_REQUIRED',
                            message: 'Choose a map area.',
                        },
                    });
                    return;
                }
                const params = new URLSearchParams(url.searchParams);
                params.set('page', '1');
                params.set('pageSize', '1');
                const result = await readProjectionPage(
                    pool,
                    params,
                    'directory',
                );
                writeJsonResponse(response, 200, result.resourceMap);
            } catch (error) {
                if (error instanceof ZodError)
                    writeJsonResponse(response, 400, {
                        error: {
                            code: 'INVALID_QUERY',
                            message: 'Invalid map area or filters.',
                        },
                    });
                else writePublicError(response, error);
            }
        })();
        return true;
    };
