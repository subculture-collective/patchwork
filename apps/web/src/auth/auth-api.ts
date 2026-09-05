const DEFAULT_API_BASE_URL = '/api';

const apiBaseUrl = (): string =>
    import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;

const requestCsrfHeaders = (): Record<string, string> => {
    if (typeof document === 'undefined') return {};
    for (const cookie of document.cookie.split(';')) {
        const [name, ...parts] = cookie.trim().split('=');
        if (name === 'patchwork_csrf') {
            try {
                return { 'x-csrf-token': decodeURIComponent(parts.join('=')) };
            } catch {
                return {};
            }
        }
    }
    return {};
};

const sensitiveDestinationKeys = new Set([
    'access_token',
    'refresh_token',
    'id_token',
    'token',
    'code',
    'state',
    'session',
]);

export const sanitizeReturnTo = (value: string): string => {
    if (!value.startsWith('/') || value.startsWith('//')) return '/';
    const url = new URL(value, 'https://patchwork.invalid');
    for (const key of [...url.searchParams.keys()]) {
        if (sensitiveDestinationKeys.has(key.toLowerCase())) {
            url.searchParams.delete(key);
        }
    }
    return `${url.pathname}${url.search}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const cookieCsrfHeaders = (): Record<string, string> => {
    if (typeof document === 'undefined') return {};
    for (const cookie of document.cookie.split(';')) {
        const [name, ...parts] = cookie.trim().split('=');
        if (name === 'patchwork_csrf') {
            try {
                return { 'x-csrf-token': decodeURIComponent(parts.join('=')) };
            } catch {
                return {};
            }
        }
    }
    return {};
};

const readSession = (payload: unknown): AuthSessionSummary | null => {
    const session =
        isRecord(payload) && isRecord(payload.session) ? payload.session : null;
    return (
        session &&
        typeof session.did === 'string' &&
        typeof session.expiresAt === 'string'
    ) ?
            {
                did: session.did,
                ...(typeof session.handle === 'string' && session.handle.trim()
                    ? { handle: session.handle.trim() }
                    : {}),
                expiresAt: session.expiresAt,
                ...(typeof session.role === 'string' ? { role: session.role } : {}),
                ...(typeof session.canManageSignupInvitations === 'boolean' ?
                    { canManageSignupInvitations: session.canManageSignupInvitations }
                :   {}),
            }
        :   null;
};

export class AuthApiError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly retryable = false,
    ) {
        super(message);
        this.name = 'AuthApiError';
    }
}

const errorForResponse = (
    payload: unknown,
    fallback: string,
): AuthApiError => {
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    return new AuthApiError(
        error && typeof error.code === 'string' ? error.code : 'AUTH_ERROR',
        error && typeof error.message === 'string' ? error.message : fallback,
        error?.retryable === true,
    );
};

export interface LoginStartResult {
    authorizationUrl: string;
}

export interface AuthSessionSummary {
    did: string;
    handle?: string;
    expiresAt: string;
    role?: string;
    canManageSignupInvitations?: boolean;
}

export const beginLogin = async (
    handle: string,
    returnTo: string,
): Promise<LoginStartResult> => {
    const response = await fetch(`${apiBaseUrl()}/oauth/login`, {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...requestCsrfHeaders(),
        },
        body: JSON.stringify({
            handle: handle.trim(),
            returnTo: sanitizeReturnTo(returnTo),
        }),
    });
    const payload: unknown = await response.json();
    const authorizationUrl =
        isRecord(payload) && typeof payload.authorizationUrl === 'string' ?
            payload.authorizationUrl
        :   undefined;
    if (!response.ok) {
        throw errorForResponse(payload, 'Unable to begin AT Protocol login.');
    }
    if (!authorizationUrl) {
        throw new AuthApiError(
            'INVALID_AUTH_RESPONSE',
            'The login response did not contain an authorization URL.',
        );
    }
    return { authorizationUrl };
};

export const getCurrentSession = async (): Promise<AuthSessionSummary | null> => {
    const response = await fetch(`${apiBaseUrl()}/auth/session`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
    });
    const payload: unknown = await response.json();
    if (
        response.status === 401 &&
        isRecord(payload) &&
        isRecord(payload.error) &&
        payload.error.code === 'AUTHENTICATION_REQUIRED'
    ) {
        return null;
    }
    const session = readSession(payload);
    if (!response.ok) {
        throw errorForResponse(payload, 'Unable to restore the AT Protocol session.');
    }
    if (!session) {
        throw new AuthApiError(
            'INVALID_AUTH_RESPONSE',
            'The session response was invalid.',
        );
    }
    return session;
};

export const refreshSession = async (): Promise<AuthSessionSummary> => {
    const response = await fetch(`${apiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            accept: 'application/json',
            ...cookieCsrfHeaders(),
        },
    });
    const payload: unknown = await response.json();
    const session = readSession(payload);
    if (!response.ok) {
        throw errorForResponse(payload, 'Unable to refresh the AT Protocol session.');
    }
    if (!session) {
        throw new AuthApiError(
            'INVALID_AUTH_RESPONSE',
            'The refresh response was invalid.',
        );
    }
    return session;
};

export const logoutSession = async (): Promise<void> => {
    const response = await fetch(`${apiBaseUrl()}/auth/session`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
            accept: 'application/json',
            ...cookieCsrfHeaders(),
        },
    });
    if (!response.ok) {
        const payload: unknown = await response.json().catch(() => undefined);
        throw errorForResponse(
            payload,
            'Unable to log out of the AT Protocol session.',
        );
    }
};

export interface SignupCredentials {
    handle: string;
    email: string;
    password: string;
    inviteCode?: string;
    inviteToken?: string;
    policyVersion: string;
    asserted18OrOlder: true;
    acceptedDocuments: string[];
}

export interface SignupResult {
    did: string;
    handle: string;
}

export const signup = async (credentials: SignupCredentials): Promise<SignupResult> => {
    const response = await fetch(`${apiBaseUrl()}/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        redirect: 'error',
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...cookieCsrfHeaders(),
        },
        body: JSON.stringify({
            handle: credentials.handle.trim(),
            email: credentials.email.trim(),
            password: credentials.password,
            ...(credentials.inviteToken ?
                { inviteToken: credentials.inviteToken }
            :   { inviteCode: credentials.inviteCode?.trim() ?? '' }),
            policyVersion: credentials.policyVersion,
            asserted18OrOlder: credentials.asserted18OrOlder,
            acceptedDocuments: credentials.acceptedDocuments,
        }),
    });
    const payload: unknown = await response.json();

    if (!response.ok) {
        throw errorForResponse(payload, 'Unable to create account.');
    }

    // Helper returns only did/handle and drops any other fields
    if (
        isRecord(payload) &&
        typeof payload.did === 'string' &&
        typeof payload.handle === 'string'
    ) {
        return { did: payload.did, handle: payload.handle };
    }

    throw new AuthApiError(
        'INVALID_SIGNUP_RESPONSE',
        'The signup response was invalid.',
    );
};

export interface SignupInvitationSummary {
    inviteId: string;
    createdByDid: string;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    successfulUseCount: number;
    lastUsedAt: string | null;
    status: 'active' | 'expired' | 'revoked';
}

const invitationRequest = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
): Promise<unknown> => {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
        method,
        credentials: 'include',
        headers: {
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...cookieCsrfHeaders(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
        throw errorForResponse(payload, 'Unable to manage signup invitations.');
    }
    return payload;
};

export const listSignupInvitations = async (): Promise<SignupInvitationSummary[]> => {
    const payload = await invitationRequest('GET', '/admin/signup-invitations');
    if (isRecord(payload) && Array.isArray(payload.invitations)) {
        return payload.invitations as SignupInvitationSummary[];
    }
    throw new AuthApiError('INVALID_INVITATION_RESPONSE', 'The invitation response was invalid.');
};

export const createSignupInvitation = async (validForHours: number): Promise<{
    invitation: SignupInvitationSummary;
    url: string;
}> => {
    const payload = await invitationRequest('POST', '/admin/signup-invitations', { validForHours });
    if (isRecord(payload) && isRecord(payload.invitation) && typeof payload.url === 'string') {
        return {
            invitation: payload.invitation as unknown as SignupInvitationSummary,
            url: payload.url,
        };
    }
    throw new AuthApiError('INVALID_INVITATION_RESPONSE', 'The invitation response was invalid.');
};

export const revokeSignupInvitation = async (inviteId: string): Promise<SignupInvitationSummary> => {
    const payload = await invitationRequest('POST', '/admin/signup-invitations/revoke', { inviteId });
    if (isRecord(payload) && isRecord(payload.invitation)) {
        return payload.invitation as unknown as SignupInvitationSummary;
    }
    throw new AuthApiError('INVALID_INVITATION_RESPONSE', 'The invitation response was invalid.');
};
