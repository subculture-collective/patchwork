import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthenticatedRequest } from './authenticated-request.js';
import type { HandleLookup } from './identity-handle-cache.js';
import {
    PublicHttpError,
    writeJsonResponse,
    writePublicError,
} from './error-response.js';

export interface ResolvedIdentity {
    did: string;
    /** Verified handle, omitted when the two-way handle check fails. */
    handle?: string;
}

export type IdentityResolverFn = (
    identifier: string,
    signal: AbortSignal,
) => Promise<ResolvedIdentity>;

const handlePattern =
    /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;
const didPattern = /^did:(plc|web):[a-z0-9._:%-]{1,2000}$/i;
const RESOLVE_TIMEOUT_MS = 5000;
/** Largest DID batch accepted by /identity/handles. */
export const MAX_HANDLE_BATCH = 50;

/** Accepts "@alice.bsky.social", "alice.bsky.social" or a did:plc / did:web. */
export const normalizeIdentifier = (raw: string): string | undefined => {
    const value = raw.trim().replace(/^@/, '');
    if (didPattern.test(value)) return value;
    const handle = value.toLowerCase();
    return handlePattern.test(handle) ? handle : undefined;
};

export const isIdentityRoute = (
    request: IncomingMessage,
    requestUrl: URL,
): boolean =>
    (requestUrl.pathname === '/identity/resolve' ||
        requestUrl.pathname === '/identity/handles') &&
    request.method === 'GET';

interface Dependencies {
    resolve?: IdentityResolverFn;
    /** Cached batch lookup for /identity/handles. */
    lookupHandles?: HandleLookup;
    authenticate: (request: IncomingMessage) => Promise<AuthenticatedRequest>;
}

/**
 * Resolves a handle or DID for signed-in users so forms can ask for
 * "@alice.bsky.social" instead of a raw DID. Authentication keeps this from
 * being an open resolver.
 */
export const createIdentityHandler =
    (dependencies: Dependencies) =>
    (
        request: IncomingMessage,
        response: ServerResponse,
        requestUrl: URL,
    ): boolean => {
        if (!isIdentityRoute(request, requestUrl)) return false;
        void (async () => {
            try {
                response.setHeader('cache-control', 'no-store');
                await dependencies.authenticate(request);
                if (requestUrl.pathname === '/identity/handles') {
                    if (!dependencies.lookupHandles) {
                        throw new PublicHttpError(
                            503,
                            'IDENTITY_RESOLUTION_UNAVAILABLE',
                            'Account lookup is temporarily unavailable.',
                        );
                    }
                    const dids = (requestUrl.searchParams.get('dids') ?? '')
                        .split(',')
                        .map((did) => did.trim())
                        .filter(Boolean);
                    if (
                        dids.length === 0 ||
                        dids.length > MAX_HANDLE_BATCH ||
                        dids.some((did) => !didPattern.test(did))
                    ) {
                        throw new PublicHttpError(
                            400,
                            'INVALID_DID_BATCH',
                            `Send between 1 and ${MAX_HANDLE_BATCH} DIDs.`,
                        );
                    }
                    writeJsonResponse(response, 200, {
                        handles: await dependencies.lookupHandles(dids),
                    });
                    return;
                }
                if (!dependencies.resolve) {
                    throw new PublicHttpError(
                        503,
                        'IDENTITY_RESOLUTION_UNAVAILABLE',
                        'Account lookup is temporarily unavailable.',
                    );
                }
                const identifier = normalizeIdentifier(
                    requestUrl.searchParams.get('q') ?? '',
                );
                if (!identifier) {
                    throw new PublicHttpError(
                        400,
                        'INVALID_IDENTIFIER',
                        'Enter a handle such as alice.bsky.social.',
                    );
                }
                let resolved: ResolvedIdentity;
                try {
                    resolved = await dependencies.resolve(
                        identifier,
                        AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
                    );
                } catch {
                    throw new PublicHttpError(
                        404,
                        'IDENTITY_NOT_FOUND',
                        'No account was found for that handle.',
                    );
                }
                writeJsonResponse(response, 200, {
                    identity: {
                        did: resolved.did,
                        ...(resolved.handle ? { handle: resolved.handle } : {}),
                    },
                });
            } catch (error) {
                writePublicError(response, error);
            }
        })();
        return true;
    };
