import type { Pool } from 'pg';
import { sourceKeySchema, type SourceDefinition } from './source-registry.js';
import { PublisherValidationError } from './publisher-validation-error.js';
import { activeSourceQuarantine, quarantineSource } from './source-quarantine.js';

const retryable = (error: unknown) => !(error instanceof PublisherValidationError) && ((error instanceof TypeError && /fetch|network|socket|connect/i.test(error.message))
    || (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
    || (error instanceof Error && /HTTP (429|5\d\d)\b/.test(error.message)));

export async function withBoundedPublisherRetry<T>(
    operation: () => Promise<T>,
    delay: (milliseconds: number) => Promise<void>,
    policy: { maxAttempts: number; retryBaseMs: number } = { maxAttempts: 3, retryBaseMs: 1_000 },
): Promise<T> {
    if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 3
        || !Number.isInteger(policy.retryBaseMs) || policy.retryBaseMs < 1 || policy.retryBaseMs > 10_000) {
        throw new Error('Invalid bounded retry policy.');
    }
    for (let attempt = 1; ; attempt++) {
        try { return await operation(); }
        catch (error) {
            if (attempt >= policy.maxAttempts || !retryable(error)) throw error;
            await delay(attempt * policy.retryBaseMs);
        }
    }
}

export async function recordRegisteredSourceAttempt(
    pool: Pick<Pool, 'query'>, sourceId: string, succeeded: boolean,
    completedRefresh: boolean, attemptedAt = new Date(),
) {
    sourceKeySchema.parse(sourceId);
    if (!Number.isFinite(attemptedAt.getTime()) || (completedRefresh && !succeeded)) {
        throw new Error('Invalid source refresh operational outcome.');
    }
    await pool.query(`INSERT INTO source_refresh_operational_status
        (source_id,last_attempt_at,last_attempt_succeeded,last_success_at,updated_at)
        VALUES ($4,$1::timestamptz,$2,CASE WHEN $3 THEN $1::timestamptz ELSE NULL END,$1::timestamptz)
        ON CONFLICT (source_id) DO UPDATE SET
            last_attempt_at=EXCLUDED.last_attempt_at,
            last_attempt_succeeded=EXCLUDED.last_attempt_succeeded,
            last_success_at=CASE WHEN $3 THEN EXCLUDED.last_attempt_at ELSE source_refresh_operational_status.last_success_at END,
            updated_at=EXCLUDED.updated_at
        WHERE EXCLUDED.updated_at >= source_refresh_operational_status.updated_at`,
    [attemptedAt, succeeded, completedRefresh, sourceId]);
}

/** Publisher adapters validate/retain evidence; jobs never apply public listing changes. */
export async function runSourceJob<E, P, R>(options: {
    pool: Pool;
    source: SourceDefinition;
    paused?: ReadonlySet<string>;
    mode: 'preview' | 'persist';
    fetchEvidence: () => Promise<E>;
    preview: (evidence: E) => Promise<P>;
    persist: (evidence: E, preview: P) => Promise<R>;
    delay?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
}) {
    const { source, pool } = options;
    sourceKeySchema.parse(source.id);
    if (!source.enabled || options.paused?.has(source.id)) return { status: 'skipped-disabled' as const };
    const client = await pool.connect();
    const lock = `source-refresh:${source.id}`;
    let acquired = false;
    let discard = false;
    try {
        const result = await client.query<{ acquired: boolean }>(
            'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [lock],
        );
        acquired = result.rows[0]?.acquired === true;
        if (!acquired) return { status: 'skipped-concurrent' as const };
        const quarantine = await activeSourceQuarantine(client, source.id);
        if (quarantine && options.mode === 'persist') return {
            status: 'skipped-quarantined' as const, quarantineId: quarantine.quarantine_id,
            reasonCode: quarantine.reason_code,
        };
        let stage: 'fetch' | 'preview' | 'persist' = 'fetch';
        try {
            const evidence = await withBoundedPublisherRetry(options.fetchEvidence,
                options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), source);
            stage = 'preview';
            const preview = await options.preview(evidence);
            if (options.mode === 'preview') return { status: 'previewed' as const, evidence, preview };
            // Never retry persistence or preview as if they were publisher-network failures.
            stage = 'persist';
            const persisted = await options.persist(evidence, preview);
            await recordRegisteredSourceAttempt(client, source.id, true, true, options.now?.());
            return { status: 'persisted' as const, evidence, persisted };
        } catch (error) {
            if (options.mode === 'persist') {
                try { await recordRegisteredSourceAttempt(client, source.id, false, false, options.now?.()); }
                catch { /* Preserve the original error; monitoring also detects stale success. */ }
                if (stage !== 'persist' && error instanceof PublisherValidationError) {
                    try { await quarantineSource(client, source.id, source.adapterVersion); }
                    catch (quarantineError) {
                        throw new AggregateError([error, quarantineError], 'Publisher validation failed and quarantine could not be retained.');
                    }
                }
            }
            throw error;
        }
    } finally {
        try {
            if (acquired) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lock]);
        } catch (error) {
            discard = true;
            throw error;
        } finally {
            // Destroy the connection if unlock fails; a session lock must never return to the pool.
            client.release(discard);
        }
    }
}
