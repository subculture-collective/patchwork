import { z } from 'zod';
import { didSchema } from '@patchwork/shared';
import { PublicHttpError } from '../http/error-response.js';

const HANDLE_SUFFIX = '.subcult.tv';
const RESERVED_LABELS = new Set([
    'admin',
    'abuse',
    'api',
    'auth',
    'edda',
    'contact',
    'git',
    'grafana',
    'help',
    'mail',
    'legal',
    'login',
    'oauth',
    'privacy',
    'patchwork',
    'pds',
    'security',
    'service',
    'signup',
    'staging',
    'status',
    'terms',
    'support',
    'www',
]);
const MAX_HANDLE_LENGTH = 63;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;
const MAX_INVITE_CODE_LENGTH = 128;

const accountInputSchema = z.object({
    handle: z.string().trim().min(1).max(MAX_HANDLE_LENGTH),
    email: z.string().trim().email().max(MAX_EMAIL_LENGTH),
    password: z.string().min(8).max(MAX_PASSWORD_LENGTH),
}).strict();

const signupInputSchema = accountInputSchema.extend({
    inviteCode: z.string().trim().min(1).max(MAX_INVITE_CODE_LENGTH),
}).strict();

export interface PdsSignupInput {
    handle: string;
    email: string;
    password: string;
    inviteCode: string;
}

export interface PdsSignupResult {
    did: string;
    handle: string;
}

export interface PdsSignupServiceOptions {
    pdsUrl: string;
    adminPassword?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

const isValidHandleLabel = (label: string): boolean => /^[a-z0-9](?:[a-z0-9-]{1,16}[a-z0-9])?$/.test(label);

const buildPublicError = (code: string, message: string, statusCode = 400): PublicHttpError =>
    new PublicHttpError(statusCode, code, message);

const invalidSignupInput = () => buildPublicError('INVALID_SIGNUP_INPUT', 'The signup input is invalid.');

const mapUpstreamError = (statusCode: number, errorCode?: string): PublicHttpError => {
    if (statusCode === 408) return buildPublicError('PDS_UNAVAILABLE', 'The account service timed out.', 503);
    if (statusCode === 429) {
        return buildPublicError(
            'PDS_RATE_LIMITED',
            'The account service is busy.',
            503,
        );
    }
    if (statusCode >= 500) return buildPublicError('PDS_UNAVAILABLE', 'The account service is unavailable.', 503);

    switch (errorCode) {
        case 'AccountAlreadyExists':
        case 'HandleTaken':
        case 'HandleNotAvailable':
            return buildPublicError('HANDLE_ALREADY_EXISTS', 'That handle is already taken.');
        case 'InvalidHandle':
            return buildPublicError('INVALID_HANDLE', 'The handle is invalid.');
        case 'InvalidPassword':
            return buildPublicError('INVALID_PASSWORD', 'The password is invalid.');
        case 'InvalidInviteCode':
        case 'InviteCodeNotFound':
            return buildPublicError('INVALID_INVITE_CODE', 'The invite code is invalid.');
        case 'RateLimitExceeded':
            return buildPublicError('PDS_RATE_LIMITED', 'The account service is busy.', 503);
        default:
            return buildPublicError('PDS_SIGNUP_FAILED', 'Account creation failed.', 400);
    }
};

export const createPdsSignupService = ({
    pdsUrl,
    adminPassword,
    fetchImpl = fetch,
    timeoutMs = 10_000,
}: PdsSignupServiceOptions) => {
    const validateAccountInput = (input: Omit<PdsSignupInput, 'inviteCode'>) => {
        const parsed = accountInputSchema.safeParse(input);
        if (!parsed.success) throw invalidSignupInput();
        const handle = parsed.data.handle;
        if (!handle.endsWith(HANDLE_SUFFIX)) {
            throw buildPublicError('INVALID_HANDLE', `Handle must end with ${HANDLE_SUFFIX}.`);
        }
        const label = handle.slice(0, -HANDLE_SUFFIX.length);
        if (label.length < 3 || label.length > 18 || !isValidHandleLabel(label)) {
            throw buildPublicError('INVALID_HANDLE', 'Handle must be a 3-18 character lowercase service label plus .subcult.tv.');
        }
        if (RESERVED_LABELS.has(label)) {
            throw buildPublicError('RESERVED_HANDLE', 'That handle label is reserved.');
        }
        return parsed.data;
    };

    const createInviteCode = async (): Promise<string> => {
        if (!adminPassword) {
            throw buildPublicError(
                'PDS_INVITE_ISSUANCE_UNAVAILABLE',
                'Invitation-based signup is temporarily unavailable.',
                503,
            );
        }
        const controller = new AbortController();
        const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const authorization = Buffer.from(
                `admin:${adminPassword}`,
                'utf8',
            ).toString('base64');
            const response = await fetchImpl(
                `${pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.server.createInviteCode`,
                {
                    method: 'POST',
                    redirect: 'error',
                    headers: {
                        authorization: `Basic ${authorization}`,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({ useCount: 1 }),
                    signal: controller.signal,
                },
            );
            if (!response.ok) {
                throw buildPublicError(
                    'PDS_INVITE_ISSUANCE_UNAVAILABLE',
                    'Invitation-based signup is temporarily unavailable.',
                    503,
                );
            }
            const body = await response.json() as { code?: unknown };
            if (
                typeof body.code !== 'string' ||
                body.code.length < 1 ||
                body.code.length > MAX_INVITE_CODE_LENGTH
            ) {
                throw buildPublicError(
                    'PDS_INVITE_ISSUANCE_UNAVAILABLE',
                    'Invitation-based signup is temporarily unavailable.',
                    503,
                );
            }
            return body.code;
        } catch (error) {
            if (error instanceof PublicHttpError) throw error;
            throw buildPublicError(
                'PDS_INVITE_ISSUANCE_UNAVAILABLE',
                'Invitation-based signup is temporarily unavailable.',
                503,
            );
        } finally {
            globalThis.clearTimeout(timeout);
        }
    };

    const createAccount = async (input: PdsSignupInput): Promise<PdsSignupResult> => {
        const parsed = signupInputSchema.safeParse(input);
        if (!parsed.success) throw invalidSignupInput();
        const { handle } = validateAccountInput({
            handle: parsed.data.handle,
            email: parsed.data.email,
            password: parsed.data.password,
        });

        const controller = new AbortController();
        const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(`${pdsUrl.replace(/\/$/, '')}/xrpc/com.atproto.server.createAccount`, {
                method: 'POST',
                redirect: 'error',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    handle,
                    email: parsed.data.email,
                    password: parsed.data.password,
                    inviteCode: parsed.data.inviteCode,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                let errorCode: string | undefined;
                try {
                    const body = await response.json() as { error?: string };
                    errorCode = typeof body.error === 'string' ? body.error : undefined;
                } catch {
                    // ignore parse failures
                }
                throw mapUpstreamError(response.status, errorCode);
            }

            const body = await response.json() as { did?: unknown; handle?: unknown };
            if (
                typeof body.did !== 'string' ||
                !didSchema.safeParse(body.did).success ||
                typeof body.handle !== 'string'
            ) {
                throw buildPublicError('PDS_SIGNUP_FAILED', 'Account creation failed.');
            }
            if (body.handle !== handle) {
                throw buildPublicError('PDS_SIGNUP_FAILED', 'Account creation failed.');
            }
            return { did: body.did, handle: body.handle };
        } catch (error) {
            if (error instanceof PublicHttpError) throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw buildPublicError('PDS_UNAVAILABLE', 'The account service timed out.', 503);
            }
            throw buildPublicError('PDS_UNAVAILABLE', 'The account service is unavailable.', 503);
        } finally {
            globalThis.clearTimeout(timeout);
        }
    };

    return { createAccount, createInviteCode, validateAccountInput };
};
