import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import type {
    NodeSavedSession,
    NodeSavedState,
} from '@atproto/oauth-client-node';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    AesGcmJsonCipher,
    PostgresBrowserSessionRepository,
    PostgresOAuthSessionStore,
    PostgresOAuthStateStore,
} from './session-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

describeWithPostgres('PostgreSQL OAuth persistence', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const key = randomBytes(32);

    beforeAll(async () => {
        await pool.query(
            'TRUNCATE patchwork_browser_sessions, at_oauth_state, at_oauth_sessions, account_deactivations',
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('restores encrypted state and session values through new store instances', async () => {
        const state = {
            iss: 'https://pds.example',
            verifier: 'postgres-verifier',
            dpopJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
            authMethod: { method: 'none' as const },
        } as unknown as NodeSavedState;
        const session = {
            dpopJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
            authMethod: { method: 'none' as const },
            tokenSet: {
                sub: 'did:plc:postgres-user',
                iss: 'https://pds.example',
                aud: 'did:web:pds.example',
                scope: 'atproto',
                token_type: 'DPoP' as const,
                access_token: 'postgres-access-secret',
                refresh_token: 'postgres-refresh-secret',
                expires_at: '2026-07-11T00:00:00.000Z',
            },
        } as unknown as NodeSavedSession;

        await new PostgresOAuthStateStore(
            pool,
            new AesGcmJsonCipher(key),
        ).set('postgres-state', state);
        await new PostgresOAuthSessionStore(
            pool,
            new AesGcmJsonCipher(key),
        ).set('did:plc:postgres-user', session);

        await expect(
            new PostgresOAuthStateStore(
                pool,
                new AesGcmJsonCipher(key),
            ).get('postgres-state'),
        ).resolves.toEqual(state);
        await expect(
            new PostgresOAuthSessionStore(
                pool,
                new AesGcmJsonCipher(key),
            ).get('did:plc:postgres-user'),
        ).resolves.toEqual(session);

        const raw = await pool.query<{
            encrypted_payload: string;
        }>('SELECT encrypted_payload FROM at_oauth_sessions');
        expect(raw.rows[0]?.encrypted_payload).not.toContain(
            'postgres-refresh-secret',
        );
    });

    it('persists and revokes opaque browser sessions', async () => {
        const repository = new PostgresBrowserSessionRepository(pool);
        const token = await repository.create(
            'did:plc:postgres-user',
            new Date(Date.now() + 60_000),
        );
        await repository.setHandle(
            'did:plc:postgres-user',
            'postgres-user.example',
        );

        await expect(
            new PostgresBrowserSessionRepository(pool).get(token),
        ).resolves.toMatchObject({
            did: 'did:plc:postgres-user',
            handle: 'postgres-user.example',
        });

        await repository.revoke(token);
        await expect(repository.get(token)).resolves.toBeUndefined();
    });

    it('prevents a deactivated account from restoring OAuth or browser sessions', async () => {
        const did = 'did:plc:deactivated-user';
        const didHash = createHash('sha256').update(did).digest('hex');
        await pool.query(
            `INSERT INTO account_deactivations (
                did_hash, command_id, result, requested_at, retention_until
             ) VALUES ($1, 'deactivated-session-test', '{"status":"deactivated"}',
                       NOW(), NOW() + INTERVAL '1 year')`,
            [didHash],
        );
        const browserSessions = new PostgresBrowserSessionRepository(pool);
        const oauthSessions = new PostgresOAuthSessionStore(
            pool,
            new AesGcmJsonCipher(key),
        );
        const session = {
            dpopJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' },
            authMethod: { method: 'none' as const },
            tokenSet: {
                sub: did,
                iss: 'https://pds.example',
                aud: 'did:web:pds.example',
                scope: 'atproto',
                token_type: 'DPoP' as const,
                access_token: 'must-not-persist',
            },
        } as unknown as NodeSavedSession;

        await expect(
            browserSessions.create(did, new Date(Date.now() + 60_000)),
        ).rejects.toThrow('Account is deactivated');
        await expect(oauthSessions.set(did, session)).rejects.toThrow(
            'Account is deactivated',
        );
        await expect(oauthSessions.get(did)).resolves.toBeUndefined();
        await expect(
            pool.query(
                'SELECT COUNT(*)::int AS count FROM at_oauth_sessions WHERE did = $1',
                [did],
            ),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    });
});
