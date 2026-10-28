import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CoordinationService } from '../coordination-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import type { IdempotentResponse } from './idempotency-store.js';
import { IdempotencyError } from './idempotency-store.js';
import { readJsonBody } from './json-body.js';
import { writeJsonResponse, writePublicError } from './error-response.js';

const routes = new Map<string, readonly string[]>([
    ['/coordination/mine', ['GET']],
    ['/coordination/pickups', ['POST']],
    ['/coordination/offers', ['POST']],
    ['/coordination/offer-decisions', ['POST']],
    ['/coordination/connections', ['POST']],
    ['/coordination/matches', ['POST']],
    ['/inbox', ['GET']],
    ['/inbox/read', ['POST']],
    ['/outcomes', ['POST']],
    ['/outcomes/mine', ['GET']],
]);

export const isCoordinationRoute = (
    request: IncomingMessage,
    requestUrl: URL,
): boolean =>
    routes.get(requestUrl.pathname)?.includes(request.method ?? '') ?? false;

interface Dependencies {
    service: CoordinationService;
    authenticate: (
        request: IncomingMessage,
    ) => Promise<AuthenticatedRequest>;
    executeIdempotent: (
        request: IncomingMessage,
        actorDid: string,
        body: unknown,
        effect: (
            body: Record<string, unknown>,
            key: string,
        ) => Promise<IdempotentResponse>,
    ) => Promise<IdempotentResponse>;
}

export const createCoordinationHandler = (
    dependencies: Dependencies,
) => (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!isCoordinationRoute(request, requestUrl)) return false;
    void (async () => {
        try {
            response.setHeader('cache-control', 'no-store');
            const authenticated = await dependencies.authenticate(request);
            const actorDid = authenticated.principal.did;
            if (request.method === 'GET') {
                const body =
                    requestUrl.pathname === '/coordination/mine' ?
                        await dependencies.service.listMine(actorDid)
                    : requestUrl.pathname === '/inbox' ?
                        await dependencies.service.listInbox(
                            actorDid,
                            requestUrl.searchParams.get('unread') === 'true',
                        )
                    :   await dependencies.service.listFeedback(actorDid);
                writeJsonResponse(response, 200, body);
                return;
            }
            const body = await readJsonBody(request);
            const result = await dependencies.executeIdempotent(
                request,
                actorDid,
                body,
                async commandBody => {
                    const output =
                        requestUrl.pathname === '/coordination/pickups' ?
                            await dependencies.service.updatePickup(actorDid, commandBody)
                        : requestUrl.pathname === '/coordination/offers' ?
                            await dependencies.service.createOffer(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                          '/coordination/offer-decisions' ?
                            await dependencies.service.decideOffer(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                          '/coordination/connections' ?
                            await dependencies.service.transitionConnection(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname === '/coordination/matches' ?
                            await dependencies.service.matchRequest(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname === '/inbox/read' ?
                            await dependencies.service.markInboxRead(
                                actorDid,
                                typeof commandBody['itemId'] === 'string' ?
                                    commandBody['itemId']
                                :   '',
                            )
                        :   await dependencies.service.submitFeedback(
                                actorDid,
                                commandBody,
                            );
                    return {
                        statusCode:
                            requestUrl.pathname === '/coordination/offers' ||
                            requestUrl.pathname === '/outcomes' ?
                                201
                            :   200,
                        body: output,
                    };
                },
            );
            writeJsonResponse(response, result.statusCode, result.body);
        } catch (error) {
            if (error instanceof IdempotencyError) {
                writeJsonResponse(response, 409, {
                    error: {
                        code: error.code,
                        message:
                            'The idempotency key was already used for another command.',
                    },
                });
                return;
            }
            writePublicError(response, error);
        }
    })();
    return true;
};
