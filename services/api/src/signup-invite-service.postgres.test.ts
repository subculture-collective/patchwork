import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignupInviteService } from './signup-invite-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('SignupInviteService PostgreSQL state', () => {
    const schema = `signup_invites_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
    });
    const service = new SignupInviteService(pool);

    beforeAll(async () => {
        await adminPool.query(`CREATE SCHEMA ${schema}`);
        await pool.query(await readFile(
            new URL('./db/migrations/0026_signup_invite_links.sql', import.meta.url),
            'utf8',
        ));
    });

    afterAll(async () => {
        await pool.end();
        await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
        await adminPool.end();
    });

    it('supports repeated use until revocation while persisting only the token hash', async () => {
        const now = new Date('2026-09-03T12:00:00.000Z');
        const created = await service.create(
            'did:plc:admin',
            { validForHours: 24 },
            now,
        );
        const stored = await pool.query<{
            token_sha256: string;
            successful_use_count: string;
        }>(
            'SELECT token_sha256, successful_use_count FROM signup_invite_links WHERE invite_id = $1',
            [created.invitation.inviteId],
        );
        expect(stored.rows[0]?.token_sha256).toBe(
            createHash('sha256').update(created.token).digest('hex'),
        );
        expect(stored.rows[0]?.token_sha256).not.toBe(created.token);

        await expect(service.requireUsable(created.token, now)).resolves.toBe(
            created.invitation.inviteId,
        );
        await expect(service.requireUsable(created.token, now)).resolves.toBe(
            created.invitation.inviteId,
        );
        await service.recordSuccessfulUse(created.invitation.inviteId, now);
        await service.recordSuccessfulUse(created.invitation.inviteId, now);
        expect((await service.list(now))[0]?.successfulUseCount).toBe(2);

        await service.revoke(
            'did:plc:admin',
            { inviteId: created.invitation.inviteId },
            now,
        );
        await expect(service.requireUsable(created.token, now)).rejects.toMatchObject({
            code: 'INVALID_SIGNUP_INVITATION',
        });
    });

    it('rejects an invitation after its validity period ends', async () => {
        const created = await service.create(
            'did:plc:admin',
            { validForHours: 1 },
            new Date('2026-09-03T12:00:00.000Z'),
        );
        await expect(
            service.requireUsable(
                created.token,
                new Date('2026-09-03T13:00:00.000Z'),
            ),
        ).rejects.toMatchObject({ code: 'INVALID_SIGNUP_INVITATION' });
    });
});
