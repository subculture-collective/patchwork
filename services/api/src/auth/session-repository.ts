import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
} from 'node:crypto';
import type {
    NodeSavedSession,
    NodeSavedSessionStore,
    NodeSavedState,
    NodeSavedStateStore,
} from '@atproto/oauth-client-node';
import type { Pool, PoolClient } from 'pg';

const STATE_TTL_MILLISECONDS = 60 * 60 * 1000;

interface EncryptedEnvelope {
    version: 1;
    iv: string;
    tag: string;
    ciphertext: string;
}

export class AesGcmJsonCipher {
    constructor(private readonly key: Buffer) {
        if (key.byteLength !== 32) {
            throw new Error('OAuth storage requires a 32-byte encryption key.');
        }
    }

    encrypt(value: unknown): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        const ciphertext = Buffer.concat([
            cipher.update(JSON.stringify(value), 'utf8'),
            cipher.final(),
        ]);
        const envelope: EncryptedEnvelope = {
            version: 1,
            iv: iv.toString('base64url'),
            tag: cipher.getAuthTag().toString('base64url'),
            ciphertext: ciphertext.toString('base64url'),
        };
        return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
    }

    decrypt<T>(encrypted: string): T {
        const envelope = JSON.parse(
            Buffer.from(encrypted, 'base64url').toString('utf8'),
        ) as EncryptedEnvelope;
        if (envelope.version !== 1) {
            throw new Error('Unsupported OAuth encryption envelope version.');
        }

        const decipher = createDecipheriv(
            'aes-256-gcm',
            this.key,
            Buffer.from(envelope.iv, 'base64url'),
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
            decipher.final(),
        ]);
        return JSON.parse(plaintext.toString('utf8')) as T;
    }
}

const hashLookupKey = (value: string): string =>
    createHash('sha256').update(value, 'utf8').digest('hex');

export class AccountDeactivatedError extends Error {
    readonly code = 'ACCOUNT_DEACTIVATED';

    constructor() {
        super('Account is deactivated.');
        this.name = 'AccountDeactivatedError';
    }
}

const withAccountLock = async <T>(
    pool: Pool,
    did: string,
    operation: (client: PoolClient, didHash: string) => Promise<T>,
): Promise<T> => {
    const client = await pool.connect();
    const didHash = hashLookupKey(did);
    try {
        await client.query('BEGIN');
        await client.query(
            `SELECT pg_advisory_xact_lock(hashtext('account:' || $1))`,
            [didHash],
        );
        const deactivated = await client.query(
            'SELECT 1 FROM account_deactivations WHERE did_hash = $1',
            [didHash],
        );
        if (deactivated.rowCount) throw new AccountDeactivatedError();
        const result = await operation(client, didHash);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export interface BrowserSession {
    did: string;
    handle?: string;
    expiresAt: Date;
    /** Browser-session creation follows a successful AT OAuth callback. */
    authenticatedAt: Date;
}

export interface BrowserSessionRepository {
    create(did: string, expiresAt: Date): Promise<string>;
    get(sessionToken: string): Promise<BrowserSession | undefined>;
    touch(sessionToken: string): Promise<void>;
    revoke(sessionToken: string): Promise<void>;
    setHandle(did: string, handle: string): Promise<void>;
}

interface BrowserSessionRow {
    did: string;
    handle?: string | null;
    expires_at: Date | string;
    created_at: Date | string;
}

export class PostgresBrowserSessionRepository
    implements BrowserSessionRepository
{
    constructor(private readonly pool: Pool) {}

    async create(did: string, expiresAt: Date): Promise<string> {
        const token = randomBytes(32).toString('base64url');
        await withAccountLock(this.pool, did, client =>
            client.query(
                `INSERT INTO patchwork_browser_sessions (
                    session_id_hash, did, expires_at
                 ) VALUES ($1, $2, $3)`,
                [hashLookupKey(token), did, expiresAt],
            ),
        );
        return token;
    }

    async get(sessionToken: string): Promise<BrowserSession | undefined> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const lookupKey = hashLookupKey(sessionToken);
            const candidate = await client.query<BrowserSessionRow>(
                `SELECT did, expires_at, created_at FROM patchwork_browser_sessions
                 WHERE session_id_hash = $1`,
                [lookupKey],
            );
            const candidateRow = candidate.rows[0];
            if (!candidateRow) {
                await client.query('COMMIT');
                return undefined;
            }
            const didHash = hashLookupKey(candidateRow.did);
            await client.query(
                `SELECT pg_advisory_xact_lock_shared(hashtext('account:' || $1))`,
                [didHash],
            );
            const result = await client.query<BrowserSessionRow>(
                `SELECT browser.did, browser.expires_at, browser.created_at,
                        oauth.handle
                 FROM patchwork_browser_sessions AS browser
                 LEFT JOIN at_oauth_sessions AS oauth
                   ON oauth.did = browser.did AND oauth.revoked_at IS NULL
                 WHERE browser.session_id_hash = $1
                   AND browser.revoked_at IS NULL
                   AND browser.expires_at > NOW()
                   AND NOT EXISTS (
                       SELECT 1 FROM account_deactivations
                       WHERE did_hash = $2
                   )`,
                [lookupKey, didHash],
            );
            await client.query('COMMIT');
            const row = result.rows[0];
            return row ?
                    {
                        did: row.did,
                        ...(row.handle ? { handle: row.handle } : {}),
                        expiresAt: new Date(row.expires_at),
                        authenticatedAt: new Date(row.created_at),
                    }
                :   undefined;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async touch(sessionToken: string): Promise<void> {
        await this.pool.query(
            `
            UPDATE patchwork_browser_sessions
            SET last_seen_at = NOW()
            WHERE session_id_hash = $1
              AND revoked_at IS NULL
              AND expires_at > NOW()
            `,
            [hashLookupKey(sessionToken)],
        );
    }

    async revoke(sessionToken: string): Promise<void> {
        await this.pool.query(
            `
            UPDATE patchwork_browser_sessions
            SET revoked_at = NOW()
            WHERE session_id_hash = $1 AND revoked_at IS NULL
            `,
            [hashLookupKey(sessionToken)],
        );
    }

    async setHandle(did: string, handle: string): Promise<void> {
        await this.pool.query(
            `
            UPDATE at_oauth_sessions
            SET handle = $2, updated_at = NOW()
            WHERE did = $1 AND revoked_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM account_deactivations
                  WHERE did_hash = $3
              )
            `,
            [did, handle, hashLookupKey(did)],
        );
    }
}

interface EncryptedPayloadRow {
    encrypted_payload: string;
}

export class PostgresOAuthStateStore implements NodeSavedStateStore {
    constructor(
        private readonly pool: Pool,
        private readonly cipher: AesGcmJsonCipher,
    ) {}

    async set(key: string, value: NodeSavedState): Promise<void> {
        await this.pool.query(
            `
            INSERT INTO at_oauth_state (
                state_key_hash, encrypted_payload, expires_at
            ) VALUES ($1, $2, $3)
            ON CONFLICT (state_key_hash) DO UPDATE SET
                encrypted_payload = EXCLUDED.encrypted_payload,
                expires_at = EXCLUDED.expires_at,
                updated_at = NOW()
            `,
            [
                hashLookupKey(key),
                this.cipher.encrypt(value),
                new Date(Date.now() + STATE_TTL_MILLISECONDS),
            ],
        );
    }

    async get(key: string): Promise<NodeSavedState | undefined> {
        const result = await this.pool.query<EncryptedPayloadRow>(
            `
            SELECT encrypted_payload
            FROM at_oauth_state
            WHERE state_key_hash = $1 AND expires_at > NOW()
            `,
            [hashLookupKey(key)],
        );
        const row = result.rows[0];
        return row ? this.cipher.decrypt<NodeSavedState>(row.encrypted_payload) : undefined;
    }

    async del(key: string): Promise<void> {
        await this.pool.query(
            'DELETE FROM at_oauth_state WHERE state_key_hash = $1',
            [hashLookupKey(key)],
        );
    }
}

const tokenExpiry = (value: NodeSavedSession): Date | null => {
    const expiresAt = (value.tokenSet as { expires_at?: unknown }).expires_at;
    if (typeof expiresAt !== 'string') {
        return null;
    }
    const parsed = new Date(expiresAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export class PostgresOAuthSessionStore implements NodeSavedSessionStore {
    constructor(
        private readonly pool: Pool,
        private readonly cipher: AesGcmJsonCipher,
    ) {}

    async set(did: string, value: NodeSavedSession): Promise<void> {
        await withAccountLock(this.pool, did, client =>
            client.query(
                `INSERT INTO at_oauth_sessions (
                    did, encrypted_payload, token_expires_at, revoked_at
                 ) VALUES ($1, $2, $3, NULL)
                 ON CONFLICT (did) DO UPDATE SET
                    encrypted_payload = EXCLUDED.encrypted_payload,
                    token_expires_at = EXCLUDED.token_expires_at,
                    revoked_at = NULL,
                    updated_at = NOW()`,
                [did, this.cipher.encrypt(value), tokenExpiry(value)],
            ),
        );
    }

    async get(did: string): Promise<NodeSavedSession | undefined> {
        const result = await this.pool.query<EncryptedPayloadRow>(
            `
            SELECT encrypted_payload
            FROM at_oauth_sessions
            WHERE did = $1 AND revoked_at IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM account_deactivations
                  WHERE did_hash = $2
              )
            `,
            [did, hashLookupKey(did)],
        );
        const row = result.rows[0];
        return row ? this.cipher.decrypt<NodeSavedSession>(row.encrypted_payload) : undefined;
    }

    async del(did: string): Promise<void> {
        await this.pool.query(
            `
            UPDATE at_oauth_sessions
            SET revoked_at = NOW(), updated_at = NOW()
            WHERE did = $1 AND revoked_at IS NULL
            `,
            [did],
        );
    }
}

export const parseOAuthEncryptionKey = (encoded: string): Buffer => {
    const key = Buffer.from(encoded, 'base64');
    if (key.byteLength !== 32) {
        throw new Error(
            'ATPROTO_SESSION_ENCRYPTION_KEY must be base64 for exactly 32 bytes.',
        );
    }
    return key;
};
