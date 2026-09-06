import type { IncomingMessage, ServerResponse } from 'node:http';
import { AtClientError } from '@patchwork/at-client';
import type { ApiRouteResult } from '../query-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { writeJsonResponse, writePublicError } from './error-response.js';

interface DiscoveryQueryService {
    queryAidPost?(params: URLSearchParams, viewerDid?: string): ApiRouteResult | Promise<ApiRouteResult>;
    queryMap(
        params: URLSearchParams,
        viewerDid?: string,
    ): ApiRouteResult | Promise<ApiRouteResult>;
    queryFeed(
        params: URLSearchParams,
        viewerDid?: string,
    ): ApiRouteResult | Promise<ApiRouteResult>;
    queryDirectory(
        params: URLSearchParams,
    ): ApiRouteResult | Promise<ApiRouteResult>;
    queryVolunteers(
        params: URLSearchParams,
        viewerDid?: string,
    ): ApiRouteResult | Promise<ApiRouteResult>;
}

export interface DiscoveryHandlerDependencies {
    service: DiscoveryQueryService;
    authenticateOptional(
        request: IncomingMessage,
    ): Promise<AuthenticatedRequest | undefined>;
}

const discoveryPaths = new Set([
    '/query/aid-post',
    '/query/map',
    '/query/feed',
    '/query/directory',
    '/query/volunteers',
]);

export const createDiscoveryHandler = (
    dependencies: DiscoveryHandlerDependencies,
) => {
    return (
        request: IncomingMessage,
        response: ServerResponse,
        requestUrl: URL,
    ): boolean => {
        if (
            request.method !== 'GET' ||
            !discoveryPaths.has(requestUrl.pathname)
        ) {
            return false;
        }
        void (async () => {
            try {
                const authenticated =
                    await dependencies.authenticateOptional(request);
                const result =
                    requestUrl.pathname === '/query/aid-post' ?
                        await dependencies.service.queryAidPost?.(requestUrl.searchParams, authenticated?.principal.did)
                        ?? { statusCode: 404, body: { error: { code: 'NOT_FOUND', message: 'This request is unavailable.' } } }
                    : requestUrl.pathname === '/query/map' ?
                        await dependencies.service.queryMap(
                            requestUrl.searchParams,
                            authenticated?.principal.did,
                        )
                    : requestUrl.pathname === '/query/feed' ?
                        await dependencies.service.queryFeed(
                            requestUrl.searchParams,
                            authenticated?.principal.did,
                        )
                    : requestUrl.pathname === '/query/volunteers' ?
                        await dependencies.service.queryVolunteers(
                            requestUrl.searchParams,
                            authenticated?.principal.did,
                        )
                    :   await dependencies.service.queryDirectory(
                            requestUrl.searchParams,
                        );
                writeJsonResponse(response, result.statusCode, result.body);
            } catch (error) {
                if (error instanceof AtClientError) {
                    const statusCode =
                        error.code === 'SESSION_EXPIRED' ? 401
                        : error.code === 'PDS_UNAVAILABLE' ? 503
                        :   403;
                    writeJsonResponse(response, statusCode, {
                        error: {
                            code: error.code,
                            message: error.message,
                            retryable: error.retryable,
                        },
                    });
                    return;
                }
                writePublicError(response, error);
            }
        })();
        return true;
    };
};
