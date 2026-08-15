import { createHash } from 'node:crypto';
import type { Account, Identity, Sync } from '@bsky/jetstream';
import type { Pool } from 'pg';

const hash = (value: string): string =>
    createHash('sha256').update(value).digest('hex');

const observedAt = (value: string | undefined): string =>
    value?.trim() || new Date().toISOString();

export class PostgresJetstreamControlStore {
    constructor(private readonly pool: Pool) {}

    async identity(seq: number, did: string, event: Identity): Promise<void> {
        await this.pool.query(
            `INSERT INTO indexer_identity_cache (
                did, handle, source_cursor, observed_at
             ) VALUES ($1, $2, $3, $4)
             ON CONFLICT (did) DO UPDATE SET
                handle = EXCLUDED.handle,
                source_cursor = EXCLUDED.source_cursor,
                observed_at = EXCLUDED.observed_at,
                updated_at = NOW()
             WHERE indexer_identity_cache.source_cursor < EXCLUDED.source_cursor`,
            [did, event.handle ?? null, seq, observedAt(event.time)],
        );
    }

    async account(seq: number, did: string, event: Account): Promise<void> {
        const client = await this.pool.connect();
        const didHash = hash(did);
        try {
            await client.query('BEGIN');
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext('account:' || $1))`,
                [didHash],
            );
            const accepted = await client.query(
                `INSERT INTO indexer_network_accounts (
                    did_hash, active, status, source_cursor, observed_at
                 ) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (did_hash) DO UPDATE SET
                    active = EXCLUDED.active,
                    status = EXCLUDED.status,
                    source_cursor = EXCLUDED.source_cursor,
                    observed_at = EXCLUDED.observed_at,
                    updated_at = NOW()
                 WHERE indexer_network_accounts.source_cursor
                    < EXCLUDED.source_cursor
                 RETURNING source_cursor`,
                [
                    didHash,
                    event.active,
                    event.status ?? null,
                    seq,
                    observedAt(event.time),
                ],
            );
            if (accepted.rowCount && !event.active) {
                await client.query(
                    `DELETE FROM indexer_aid_post_projections
                     WHERE author_did_hash = $1`,
                    [didHash],
                );
                await client.query(
                    `DELETE FROM indexer_directory_resource_projections
                     WHERE author_did_hash = $1`,
                    [didHash],
                );
                await client.query(
                    `DELETE FROM indexer_volunteer_profile_projections
                     WHERE author_did_hash = $1`,
                    [didHash],
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async sync(seq: number, did: string, event: Sync): Promise<void> {
        await this.pool.query(
            `INSERT INTO indexer_repo_reconciliation_queue (
                did, revision, source_cursor, observed_at, status
             ) VALUES ($1, $2, $3, $4, 'pending')
             ON CONFLICT (did) DO UPDATE SET
                revision = EXCLUDED.revision,
                source_cursor = EXCLUDED.source_cursor,
                observed_at = EXCLUDED.observed_at,
                status = 'pending',
                updated_at = NOW()
             WHERE indexer_repo_reconciliation_queue.source_cursor
                < EXCLUDED.source_cursor`,
            [did, event.rev, seq, observedAt(event.time)],
        );
    }
}
