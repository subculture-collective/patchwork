import { AtClientError } from '@patchwork/at-client';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthoringReceiptService } from '../authoring-receipts.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { writeJsonResponse, writePublicError } from './error-response.js';

export const createAccountRequestsHandler = (service: AuthoringReceiptService,
    authenticate: (request: IncomingMessage) => Promise<AuthenticatedRequest>) =>
    (request: IncomingMessage, response: ServerResponse, url: URL): boolean => {
        if (url.pathname !== '/account/requests') return false;
        response.setHeader('cache-control', 'no-store');
        if (request.method !== 'GET') {
            response.setHeader('allow', 'GET');
            writeJsonResponse(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET.' } });
            return true;
        }
        void (async () => {
            try {
                const actor = await authenticate(request);
                writeJsonResponse(response, 200, await service.list(actor.principal.did, url.searchParams));
            } catch (error) {
                if (error instanceof AtClientError) {
                    writeJsonResponse(response, error.code === 'SESSION_EXPIRED' ? 401 : error.code === 'PDS_UNAVAILABLE' ? 503 : 403,
                        { error: { code: error.code, message: error.message, retryable: error.retryable } });
                    return;
                }
                writePublicError(response, error);
            }
        })();
        return true;
    };
