import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { AuthorizationError, requireCapability } from '../authorization-guard.js';
import type { SignupInviteService } from '../signup-invite-service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { PublicHttpError, writeJsonResponse, writePublicError } from './error-response.js';
import { readJsonBody } from './json-body.js';

const routes = new Map<string, readonly string[]>([
    ['/admin/signup-invitations', ['GET', 'POST']],
    ['/admin/signup-invitations/revoke', ['POST']],
]);

export const isSignupInviteRoute = (request: IncomingMessage, url: URL): boolean =>
    routes.get(url.pathname)?.includes(request.method ?? '') ?? false;

export const createSignupInviteHandler =
    (dependencies: {
        service: SignupInviteService;
        authenticate(request: IncomingMessage): Promise<AuthenticatedRequest>;
        publicOrigin: string;
    }) =>
    (request: IncomingMessage, response: ServerResponse, url: URL): boolean => {
        if (!isSignupInviteRoute(request, url)) return false;
        void (async () => {
            try {
                response.setHeader('cache-control', 'no-store');
                const authenticated = await dependencies.authenticate(request);
                requireCapability(authenticated.principal.authorization, 'admin:system_config');

                if (request.method === 'GET') {
                    writeJsonResponse(response, 200, {
                        invitations: await dependencies.service.list(),
                    });
                    return;
                }

                const body = await readJsonBody(request);
                if (url.pathname.endsWith('/revoke')) {
                    writeJsonResponse(response, 200, {
                        invitation: await dependencies.service.revoke(authenticated.principal.did, body),
                    });
                    return;
                }

                const created = await dependencies.service.create(authenticated.principal.did, body);
                writeJsonResponse(response, 201, {
                    invitation: created.invitation,
                    url: `${dependencies.publicOrigin.replace(/\/$/, '')}/signup?invite=${encodeURIComponent(created.token)}`,
                });
            } catch (error) {
                if (error instanceof ZodError) {
                    writePublicError(
                        response,
                        new PublicHttpError(
                            400,
                            'SIGNUP_INVITATION_COMMAND_INVALID',
                            'Choose a validity period between 1 hour and 30 days.',
                        ),
                    );
                    return;
                }
                if (error instanceof AuthorizationError) {
                    writePublicError(
                        response,
                        new PublicHttpError(error.statusCode, error.code, 'Administrator access is required.'),
                    );
                    return;
                }
                writePublicError(response, error);
            }
        })();
        return true;
    };
