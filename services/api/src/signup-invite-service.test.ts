import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SignupInviteService } from './signup-invite-service.js';

const row = (patch: Record<string, unknown> = {}) => ({
    invite_id: 'd15e9179-31f8-46f7-85ec-cfc74bde71c6',
    created_by_did: 'did:plc:admin',
    created_at: '2026-09-03T12:00:00.000Z',
    expires_at: '2026-09-04T12:00:00.000Z',
    revoked_at: null,
    successful_use_count: '0',
    last_used_at: null,
    ...patch,
});

describe('SignupInviteService', () => {
    it('stores only a SHA-256 token hash and applies the requested validity period', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [row()] });
        const service = new SignupInviteService({ query } as never);

        const result = await service.create(
            'did:plc:admin',
            { validForHours: 24 },
            new Date('2026-09-03T12:00:00.000Z'),
        );

        expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const parameters = query.mock.calls[0]![1] as unknown[];
        expect(parameters[0]).toBe(
            createHash('sha256').update(result.token).digest('hex'),
        );
        expect(parameters).not.toContain(result.token);
        expect((parameters[3] as Date).toISOString()).toBe(
            '2026-09-04T12:00:00.000Z',
        );
    });

    it('accepts the same valid link repeatedly and rejects malformed or inactive links', async () => {
        const query = vi.fn().mockResolvedValue({
            rows: [{ invite_id: 'd15e9179-31f8-46f7-85ec-cfc74bde71c6' }],
        });
        const service = new SignupInviteService({ query } as never);
        const token = 'a'.repeat(43);

        await expect(service.requireUsable(token)).resolves.toBe(
            'd15e9179-31f8-46f7-85ec-cfc74bde71c6',
        );
        await expect(service.requireUsable(token)).resolves.toBe(
            'd15e9179-31f8-46f7-85ec-cfc74bde71c6',
        );
        expect(query).toHaveBeenCalledTimes(2);

        await expect(service.requireUsable('not-a-token')).rejects.toMatchObject({
            code: 'INVALID_SIGNUP_INVITATION',
        });
        query.mockResolvedValueOnce({ rows: [] });
        await expect(service.requireUsable('b'.repeat(43))).rejects.toMatchObject({
            code: 'INVALID_SIGNUP_INVITATION',
        });
    });

    it('reports active, expired, and revoked state without returning token hashes', async () => {
        const query = vi.fn().mockResolvedValue({
            rows: [
                row(),
                row({ invite_id: '97f6582c-b932-4386-a52d-7082b23a39c0', expires_at: '2026-09-03T11:59:00.000Z' }),
                row({ invite_id: '8fc6cbd7-0387-4ecf-8267-fe5b4d66978b', revoked_at: '2026-09-03T11:00:00.000Z' }),
            ],
        });
        const service = new SignupInviteService({ query } as never);
        const result = await service.list(new Date('2026-09-03T12:00:00.000Z'));

        expect(result.map(invitation => invitation.status)).toEqual([
            'active',
            'expired',
            'revoked',
        ]);
        expect(JSON.stringify(result)).not.toContain('sha256');
    });
});
