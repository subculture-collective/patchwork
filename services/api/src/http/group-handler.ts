import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DurableGroupService } from '../durable-group-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { writeJsonResponse, writePublicError } from './error-response.js';
import type { IdempotentResponse } from './idempotency-store.js';
import { IdempotencyError } from './idempotency-store.js';
import { readJsonBody } from './json-body.js';

const routes = new Map<string, readonly string[]>([
    ['/groups', ['GET', 'POST']],
    ['/groups/linkable-requests', ['GET']],
    ['/groups/invitations', ['POST']],
    ['/groups/invitation-responses', ['POST']],
    ['/groups/invitation-revocations', ['POST']],
    ['/groups/member-removals', ['POST']],
    ['/groups/role-changes', ['POST']],
    ['/groups/departures', ['POST']],
    ['/groups/ownership-transfers', ['POST']],
    ['/groups/closures', ['POST']],
    ['/groups/rooms', ['POST']],
    ['/groups/room-closures', ['POST']],
]);

export const isGroupRoute = (request: IncomingMessage, url: URL): boolean =>
    routes.get(url.pathname)?.includes(request.method ?? '') ?? false;

interface Dependencies {
    service: DurableGroupService;
    authenticate: (request: IncomingMessage) => Promise<AuthenticatedRequest>;
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

export const createGroupHandler = (dependencies: Dependencies) =>
    (request: IncomingMessage, response: ServerResponse, url: URL): boolean => {
        if (!isGroupRoute(request, url)) return false;
        void (async () => {
            try {
                response.setHeader('cache-control', 'no-store');
                const actorDid = (await dependencies.authenticate(request)).principal.did;
                if (request.method === 'GET') {
                    writeJsonResponse(response, 200, url.pathname === '/groups/linkable-requests'
                        ? await dependencies.service.listLinkableRequests(actorDid)
                        : await dependencies.service.list(actorDid));
                    return;
                }
                const body = await readJsonBody(request);
                const result = await dependencies.executeIdempotent(
                    request, actorDid, body, async (commandBody) => {
                        const operation = url.pathname === '/groups' ? dependencies.service.create(actorDid, commandBody) :
                            url.pathname === '/groups/invitations' ? dependencies.service.invite(actorDid, commandBody) :
                            url.pathname === '/groups/invitation-responses' ? dependencies.service.respondToInvitation(actorDid, commandBody) :
                            url.pathname === '/groups/invitation-revocations' ? dependencies.service.revokeInvitation(actorDid, commandBody) :
                            url.pathname === '/groups/member-removals' ? dependencies.service.removeMember(actorDid, commandBody) :
                            url.pathname === '/groups/role-changes' ? dependencies.service.changeRole(actorDid, commandBody) :
                            url.pathname === '/groups/departures' ? dependencies.service.leave(actorDid, commandBody) :
                            url.pathname === '/groups/ownership-transfers' ? dependencies.service.transferOwnership(actorDid, commandBody) :
                            url.pathname === '/groups/closures' ? dependencies.service.close(actorDid, commandBody) :
                            url.pathname === '/groups/rooms' ? dependencies.service.createRoom(actorDid, commandBody) :
                            dependencies.service.closeRoom(actorDid, commandBody);
                        return {
                            statusCode: url.pathname === '/groups' || url.pathname === '/groups/invitations' || url.pathname === '/groups/rooms' ? 201 : 200,
                            body: await operation,
                        };
                    },
                );
                writeJsonResponse(response, result.statusCode, result.body);
            } catch (error) {
                if (error instanceof IdempotencyError) {
                    writeJsonResponse(response, 409, {
                        error: {
                            code: error.code,
                            message: 'The idempotency key was already used for another command.',
                        },
                    });
                    return;
                }
                writePublicError(response, error);
            }
        })();
        return true;
    };
