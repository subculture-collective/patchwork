import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OrganizationService } from '../organization-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import type { IdempotentResponse } from './idempotency-store.js';
import { IdempotencyError } from './idempotency-store.js';
import { readJsonBody } from './json-body.js';
import { writeJsonResponse, writePublicError } from './error-response.js';

const routes = new Map<string, readonly string[]>([
    ['/organizations/resource-claims', ['GET', 'POST']],
    ['/organizations/resource-claims/decision', ['PUT']],
    ['/organizations/public-resource', ['PUT']],
    ['/organizations', ['GET', 'POST']],
    ['/organizations/profile', ['GET']],
    ['/organizations/mine', ['GET']],
    ['/organization-invitations', ['GET']],
    ['/organization-invitations/accept', ['POST']],
    ['/organizations/invitations', ['POST']],
    ['/organizations/members', ['GET', 'DELETE']],
    ['/organizations/members/role', ['PUT']],
    ['/organizations/stewardships', ['GET', 'POST']],
    ['/organizations/stewardships/reconfirm', ['POST']],
    ['/organizations/audit', ['GET']],
]);

export const isOrganizationRoute = (
    request: IncomingMessage,
    requestUrl: URL,
): boolean =>
    routes.get(requestUrl.pathname)?.includes(request.method ?? '') ?? false;

interface Dependencies {
    service: OrganizationService;
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

const organizationId = (url: URL): string =>
    url.searchParams.get('organizationId') ?? '';

export const createOrganizationHandler = (
    dependencies: Dependencies,
) => (
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL,
): boolean => {
    if (!isOrganizationRoute(request, requestUrl)) return false;
    void (async () => {
        try {
            response.setHeader('cache-control', 'no-store');
            if (
                request.method === 'GET' &&
                requestUrl.pathname === '/organizations'
            ) {
                writeJsonResponse(
                    response,
                    200,
                    await dependencies.service.listPublic(
                        requestUrl.searchParams.get('searchText') ?? undefined,
                    ),
                );
                return;
            }
            if (
                request.method === 'GET' &&
                requestUrl.pathname === '/organizations/profile'
            ) {
                writeJsonResponse(
                    response,
                    200,
                    await dependencies.service.getPublic(
                        requestUrl.searchParams.get('id') ?? '',
                    ),
                );
                return;
            }

            const authenticated =
                await dependencies.authenticate(request);
            const actorDid = authenticated.principal.did;
            if (request.method === 'GET') {
                const body =
                    requestUrl.pathname === '/organizations/resource-claims' ?
                        await dependencies.service.listResourceClaims(actorDid)
                    : requestUrl.pathname === '/organizations/mine' ?
                        await dependencies.service.listMine(actorDid)
                    : requestUrl.pathname === '/organization-invitations' ?
                        await dependencies.service.listInvitations(actorDid)
                    : requestUrl.pathname === '/organizations/members' ?
                        await dependencies.service.listMembers(
                            actorDid,
                            organizationId(requestUrl),
                        )
                    : requestUrl.pathname ===
                      '/organizations/stewardships' ?
                        await dependencies.service.listStewardships(
                            actorDid,
                            organizationId(requestUrl),
                        )
                    :   await dependencies.service.getAudit(
                            actorDid,
                            organizationId(requestUrl),
                        );
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
                        requestUrl.pathname === '/organizations/resource-claims' ? await dependencies.service.submitResourceClaim(actorDid,commandBody)
                        : requestUrl.pathname === '/organizations/resource-claims/decision' ? await dependencies.service.decideResourceClaim(actorDid,commandBody)
                        : requestUrl.pathname === '/organizations/public-resource' ? await dependencies.service.editPublicResource(actorDid,commandBody)
                        : requestUrl.pathname === '/organizations' ?
                            await dependencies.service.create(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                          '/organization-invitations/accept' ?
                            await dependencies.service.acceptInvitation(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                          '/organizations/invitations' ?
                            await dependencies.service.invite(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                          '/organizations/members/role' ?
                            await dependencies.service.updateRole(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                              '/organizations/members' &&
                          request.method === 'DELETE' ?
                            await dependencies.service.removeMember(
                                actorDid,
                                commandBody,
                            )
                        : requestUrl.pathname ===
                          '/organizations/stewardships/reconfirm' ?
                            await dependencies.service.reconfirmStewardship(
                                actorDid,
                                commandBody,
                            )
                        :   await dependencies.service.assignStewardship(
                                actorDid,
                                commandBody,
                            );
                    return {
                        statusCode:
                            requestUrl.pathname === '/organizations' ? 201 : 200,
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
