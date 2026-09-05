import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const createSchema = z
    .object({
        validForHours: z
            .number()
            .int()
            .min(1)
            .max(24 * 30),
    })
    .strict();

const revokeSchema = z
    .object({
        inviteId: z.string().uuid(),
    })
    .strict();

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface InviteRow {
    invite_id: string;
    created_by_did: string;
    created_at: Date | string;
    expires_at: Date | string;
    revoked_at: Date | string | null;
    successful_use_count: string | number;
    last_used_at: Date | string | null;
}

export interface SignupInviteSummary {
    inviteId: string;
    createdByDid: string;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    successfulUseCount: number;
    lastUsedAt: string | null;
    status: 'active' | 'expired' | 'revoked';
}

const tokenHash = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

const render = (row: InviteRow, now = new Date()): SignupInviteSummary => ({
    inviteId: row.invite_id,
    createdByDid: row.created_by_did,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    successfulUseCount: Number(row.successful_use_count),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    status: row.revoked_at ? 'revoked' : new Date(row.expires_at).getTime() <= now.getTime() ? 'expired' : 'active',
});

const invalidInvite = () =>
    new PublicHttpError(400, 'INVALID_SIGNUP_INVITATION', 'This invitation is invalid, expired, or has been revoked.');

export class SignupInviteService {
    constructor(private readonly pool: Pool) {}

    async create(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<{
        token: string;
        invitation: SignupInviteSummary;
    }> {
        const command = createSchema.parse(input);
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(now.getTime() + command.validForHours * 60 * 60 * 1_000);
        const result = await this.pool.query<InviteRow>(
            `INSERT INTO signup_invite_links (
                token_sha256, created_by_did, created_at, expires_at
             ) VALUES ($1, $2, $3, $4)
             RETURNING invite_id, created_by_did, created_at, expires_at,
                       revoked_at, successful_use_count, last_used_at`,
            [tokenHash(token), actorDid, now, expiresAt],
        );
        return { token, invitation: render(result.rows[0]!, now) };
    }

    async list(now = new Date()): Promise<SignupInviteSummary[]> {
        const result = await this.pool.query<InviteRow>(
            `SELECT invite_id, created_by_did, created_at, expires_at,
                    revoked_at, successful_use_count, last_used_at
               FROM signup_invite_links
              ORDER BY created_at DESC, invite_id DESC
              LIMIT 100`,
        );
        return result.rows.map((row) => render(row, now));
    }

    async requireUsable(token: string, now = new Date()): Promise<string> {
        if (!TOKEN_PATTERN.test(token)) throw invalidInvite();
        const result = await this.pool.query<{ invite_id: string }>(
            `SELECT invite_id
               FROM signup_invite_links
              WHERE token_sha256 = $1
                AND revoked_at IS NULL
                AND expires_at > $2`,
            [tokenHash(token), now],
        );
        if (!result.rows[0]) throw invalidInvite();
        return result.rows[0].invite_id;
    }

    async recordSuccessfulUse(inviteId: string, now = new Date()): Promise<void> {
        await this.pool.query(
            `UPDATE signup_invite_links
                SET successful_use_count = successful_use_count + 1,
                    last_used_at = $2
              WHERE invite_id = $1`,
            [inviteId, now],
        );
    }

    async revoke(actorDid: string, input: unknown, now = new Date()): Promise<SignupInviteSummary> {
        const command = revokeSchema.parse(input);
        const result = await this.pool.query<InviteRow>(
            `UPDATE signup_invite_links
                SET revoked_at = COALESCE(revoked_at, $2),
                    revoked_by_did = COALESCE(revoked_by_did, $3)
              WHERE invite_id = $1
              RETURNING invite_id, created_by_did, created_at, expires_at,
                        revoked_at, successful_use_count, last_used_at`,
            [command.inviteId, now, actorDid],
        );
        if (!result.rows[0]) {
            throw new PublicHttpError(404, 'SIGNUP_INVITATION_NOT_FOUND', 'The invitation was not found.');
        }
        return render(result.rows[0], now);
    }
}
