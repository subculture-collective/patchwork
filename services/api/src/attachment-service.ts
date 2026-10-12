import {
    createHash,
    createHmac,
    randomBytes,
    randomUUID,
    timingSafeEqual,
} from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { PDFDocument } from 'pdf-lib';
import type { Pool, PoolClient } from 'pg';
import sharp from 'sharp';
import { z } from 'zod';
import {
    ATTACHMENT_ALLOWED_MIME_TYPES,
    ATTACHMENT_MAX_SIZE_BYTES,
} from '@patchwork/shared';
import type { MalwareScanner } from './clamd-scanner.js';
import { PublicHttpError } from './http/error-response.js';
import type { PrivateObjectStore } from './private-object-store.js';

const allowedMimeSchema = z.enum(ATTACHMENT_ALLOWED_MIME_TYPES);
const purposeSchema = z.enum([
    'verification-evidence',
    'aid-post',
    'moderation-evidence',
]);
const authorizeSchema = z
    .object({
        filename: z
            .string()
            .trim()
            .min(1)
            .max(255)
            .refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
        declaredMime: allowedMimeSchema,
        byteSize: z.number().int().min(1).max(ATTACHMENT_MAX_SIZE_BYTES),
        purpose: purposeSchema,
        subjectRef: z.string().trim().min(1).max(2_000).nullable(),
    })
    .strict();
const completeSchema = z
    .object({
        attachmentId: z.string().uuid(),
        uploadToken: z.string().min(32).max(256),
    })
    .strict();
const attachmentIdSchema = z
    .object({ attachmentId: z.string().uuid() })
    .strict();
const reviewSchema = z
    .object({
        attachmentId: z.string().uuid(),
        action: z.enum(['quarantine', 'release-for-rescan', 'delete']),
        reason: z.string().trim().min(1).max(2_000),
    })
    .strict();

const MAX_ATTACHMENTS_PER_OWNER = 25;
const MAX_BYTES_PER_OWNER = 50 * 1024 * 1024;
const UPLOAD_LIFETIME_MS = 10 * 60 * 1_000;
const ACCESS_LIFETIME_SECONDS = 60;
const MAX_SCAN_ATTEMPTS = 3;
const ORPHAN_GRACE_MS = 60 * 60 * 1_000;

interface AttachmentRow {
    attachment_id: string;
    owner_did: string;
    purpose:
        | 'verification-evidence'
        | 'aid-post'
        | 'moderation-evidence';
    subject_ref: string | null;
    filename: string;
    object_key: string;
    derivative_object_key: string | null;
    declared_mime: string;
    detected_mime: string | null;
    byte_size: string | number;
    status: string;
    upload_token_hash: string | null;
    upload_expires_at: Date;
    scan_attempt_count: number;
    retention_expires_at: Date;
    created_at: Date;
    updated_at: Date;
}

const parse = <T>(
    schema: z.ZodType<T>,
    input: unknown,
    code: string,
    message: string,
): T => {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new PublicHttpError(400, code, message);
    }
    return result.data;
};

const hash = (value: string | Buffer): string =>
    createHash('sha256').update(value).digest('hex');

const publicAttachment = (row: AttachmentRow) => ({
    id: row.attachment_id,
    purpose: row.purpose,
    subjectRef: row.subject_ref,
    filename: row.filename,
    declaredMime: row.declared_mime,
    detectedMime: row.detected_mime,
    byteSize: Number(row.byte_size),
    status: row.status,
    uploadExpiresAt: row.upload_expires_at.toISOString(),
    retentionExpiresAt: row.retention_expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
});

const errorCode = (error: unknown): string =>
    error instanceof Error && error.message ?
        error.message.replaceAll(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)
    :   'ATTACHMENT_OPERATION_FAILED';

export class AttachmentService {
    constructor(
        private readonly pool: Pool,
        private readonly objects: PrivateObjectStore,
        private readonly scanner: MalwareScanner,
        private readonly signingKey: string,
        private readonly publicOrigin: string,
    ) {}

    async ensureReady(): Promise<void> {
        await this.objects.ensureReady();
    }

    async authorizeUpload(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const command = parse(
            authorizeSchema,
            input,
            'INVALID_ATTACHMENT_UPLOAD',
            'The attachment upload request is invalid.',
        );
        await this.assertPurpose(actorDid, command.purpose, command.subjectRef);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `SELECT pg_advisory_xact_lock(hashtext($1))`,
                [actorDid],
            );
            const quota = await client.query<{
                count: string;
                bytes: string;
            }>(
                `SELECT COUNT(*)::TEXT AS count,
                        COALESCE(SUM(byte_size), 0)::TEXT AS bytes
                 FROM private_attachments
                 WHERE owner_did = $1
                   AND status NOT IN ('deleted', 'deletion-pending')`,
                [actorDid],
            );
            if (
                Number(quota.rows[0]?.count ?? 0) >=
                    MAX_ATTACHMENTS_PER_OWNER ||
                Number(quota.rows[0]?.bytes ?? 0) + command.byteSize >
                    MAX_BYTES_PER_OWNER
            ) {
                throw new PublicHttpError(
                    429,
                    'ATTACHMENT_QUOTA_EXCEEDED',
                    'The private attachment quota has been reached.',
                );
            }
            const attachmentId = randomUUID();
            const uploadToken = randomBytes(32).toString('base64url');
            const objectKey =
                `private/original/${now.getUTCFullYear()}/` +
                `${String(now.getUTCMonth() + 1).padStart(2, '0')}/` +
                `${randomUUID()}`;
            const expiresAt = new Date(now.getTime() + UPLOAD_LIFETIME_MS);
            const retentionExpiresAt = new Date(
                now.getTime() + 365 * 24 * 60 * 60 * 1_000,
            );
            const result = await client.query<AttachmentRow>(
                `INSERT INTO private_attachments (
                    attachment_id, owner_did, purpose, subject_ref,
                    filename, object_key, declared_mime, detected_mime,
                    byte_size, status, upload_token_hash, upload_expires_at,
                    retention_expires_at, created_at, updated_at
                 ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, NULL,
                    $8, 'authorized', $9, $10, $11, $12, $12
                 )
                 RETURNING *`,
                [
                    attachmentId,
                    actorDid,
                    command.purpose,
                    command.subjectRef,
                    command.filename,
                    objectKey,
                    command.declaredMime,
                    command.byteSize,
                    hash(uploadToken),
                    expiresAt,
                    retentionExpiresAt,
                    now,
                ],
            );
            await client.query('COMMIT');
            return {
                attachment: publicAttachment(result.rows[0]!),
                upload: {
                    token: uploadToken,
                    expiresAt: expiresAt.toISOString(),
                    maximumBytes: ATTACHMENT_MAX_SIZE_BYTES,
                },
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async completeUpload(
        actorDid: string,
        input: unknown,
        body: Buffer,
        contentType: string | undefined,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const command = parse(
            completeSchema,
            input,
            'INVALID_ATTACHMENT_UPLOAD',
            'The attachment upload request is invalid.',
        );
        const detected = await fileTypeFromBuffer(body);
        if (!detected) {
            throw new PublicHttpError(
                400,
                'ATTACHMENT_CONTENT_MISMATCH',
                'The uploaded attachment content type is not allowed.',
            );
        }
        const client = await this.pool.connect();
        let storedKey: string | null = null;
        try {
            await client.query('BEGIN');
            const row = await this.loadForUpdate(
                client,
                command.attachmentId,
            );
            this.assertOwner(actorDid, row);
            if (
                row.status !== 'authorized' ||
                row.upload_expires_at <= now ||
                !row.upload_token_hash ||
                !timingSafeEqual(
                    Buffer.from(row.upload_token_hash),
                    Buffer.from(hash(command.uploadToken)),
                )
            ) {
                throw new PublicHttpError(
                    409,
                    'ATTACHMENT_UPLOAD_EXPIRED',
                    'The attachment upload authorization is unavailable.',
                );
            }
            if (
                body.length < 1 ||
                body.length > ATTACHMENT_MAX_SIZE_BYTES ||
                body.length !== Number(row.byte_size) ||
                contentType?.split(';')[0]?.trim() !== row.declared_mime ||
                detected.mime !== row.declared_mime
            ) {
                throw new PublicHttpError(
                    400,
                    'ATTACHMENT_CONTENT_MISMATCH',
                    'The uploaded attachment does not match its authorization.',
                );
            }
            await this.objects.put(row.object_key, body, detected.mime);
            storedKey = row.object_key;
            const updated = await client.query<AttachmentRow>(
                `UPDATE private_attachments
                 SET detected_mime = $2, content_sha256 = $3,
                     status = 'uploaded', upload_token_hash = NULL,
                     next_scan_at = $4, updated_at = $4
                 WHERE attachment_id = $1
                 RETURNING *`,
                [row.attachment_id, detected.mime, hash(body), now],
            );
            await client.query('COMMIT');
            return { attachment: publicAttachment(updated.rows[0]!) };
        } catch (error) {
            await client.query('ROLLBACK');
            if (storedKey) {
                try {
                    await this.objects.delete(storedKey);
                } catch {
                    // Orphan reconciliation provides the durable cleanup path.
                }
            }
            throw error;
        } finally {
            client.release();
        }
    }

    async listMine(actorDid: string): Promise<Record<string, unknown>> {
        const result = await this.pool.query<AttachmentRow>(
            `SELECT * FROM private_attachments
             WHERE owner_did = $1
               AND status NOT IN ('deleted', 'deletion-pending')
             ORDER BY created_at DESC, attachment_id`,
            [actorDid],
        );
        return {
            attachments: result.rows.map(publicAttachment),
        };
    }

    async issueAccess(
        actorDid: string,
        input: unknown,
        canReview: boolean,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const command = parse(
            attachmentIdSchema,
            input,
            'INVALID_ATTACHMENT_ACCESS',
            'The attachment access request is invalid.',
        );
        const row = await this.load(command.attachmentId);
        this.assertAccess(actorDid, row, canReview);
        const expires = Math.floor(now.getTime() / 1_000) +
            ACCESS_LIFETIME_SECONDS;
        const signature = this.sign(row.attachment_id, actorDid, expires);
        return {
            attachment: publicAttachment(row),
            access: {
                url:
                    `${this.publicOrigin}/attachments/content/` +
                    `${row.attachment_id}?expires=${expires}` +
                    `&signature=${signature}`,
                expiresAt: new Date(expires * 1_000).toISOString(),
            },
        };
    }

    async readSigned(
        actorDid: string,
        attachmentId: string,
        expiresRaw: string,
        signature: string,
        canReview: boolean,
        now = new Date(),
    ): Promise<{
        body: Buffer;
        contentType: string;
        filename: string;
    }> {
        const expires = Number(expiresRaw);
        if (
            !Number.isInteger(expires) ||
            expires < Math.floor(now.getTime() / 1_000) ||
            expires > Math.floor(now.getTime() / 1_000) +
                ACCESS_LIFETIME_SECONDS
        ) {
            throw new PublicHttpError(
                403,
                'ATTACHMENT_ACCESS_EXPIRED',
                'The attachment access grant has expired.',
            );
        }
        const expected = this.sign(attachmentId, actorDid, expires);
        if (
            signature.length !== expected.length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
            throw new PublicHttpError(
                403,
                'ATTACHMENT_ACCESS_FORBIDDEN',
                'The attachment access grant is invalid.',
            );
        }
        const row = await this.load(attachmentId);
        this.assertAccess(actorDid, row, canReview);
        return {
            body: await this.objects.get(row.derivative_object_key!),
            contentType: row.detected_mime!,
            filename: row.filename,
        };
    }

    async deleteOwn(
        actorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const command = parse(
            attachmentIdSchema,
            input,
            'INVALID_ATTACHMENT_DELETE',
            'The attachment deletion request is invalid.',
        );
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const row = await this.loadForUpdate(
                client,
                command.attachmentId,
            );
            this.assertOwner(actorDid, row);
            await client.query(
                `UPDATE private_attachments
                 SET deleted_reason = 'owner-deleted', updated_at = $2
                 WHERE attachment_id = $1`,
                [row.attachment_id, now],
            );
            await client.query(
                `DELETE FROM private_attachments WHERE attachment_id = $1`,
                [row.attachment_id],
            );
            await client.query('COMMIT');
            return {
                attachmentId: row.attachment_id,
                status: 'deletion-pending',
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async deleteForSubject(
        actorDid: string,
        subjectRef: string,
        now = new Date(),
    ): Promise<{ removed: number }> {
        if (
            subjectRef.length < 1 ||
            subjectRef.length > 2_000 ||
            !subjectRef.startsWith(`at://${actorDid}/`)
        ) {
            throw new PublicHttpError(
                400,
                'INVALID_ATTACHMENT_SUBJECT',
                'The attachment subject is invalid.',
            );
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const marked = await client.query<{ attachment_id: string }>(
                `UPDATE private_attachments
                 SET deleted_reason = 'subject-deleted', updated_at = $3
                 WHERE owner_did = $1
                   AND purpose = 'aid-post'
                   AND subject_ref = $2
                 RETURNING attachment_id`,
                [actorDid, subjectRef, now],
            );
            if (marked.rows.length > 0) {
                await client.query(
                    `DELETE FROM private_attachments
                     WHERE attachment_id = ANY($1::uuid[])`,
                    [marked.rows.map(row => row.attachment_id)],
                );
            }
            await client.query('COMMIT');
            return { removed: marked.rows.length };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async review(
        moderatorDid: string,
        input: unknown,
        now = new Date(),
    ): Promise<Record<string, unknown>> {
        const command = parse(
            reviewSchema,
            input,
            'INVALID_ATTACHMENT_REVIEW',
            'The attachment review command is invalid.',
        );
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const row = await this.loadForUpdate(
                client,
                command.attachmentId,
            );
            await client.query(
                `INSERT INTO attachment_moderator_actions (
                    action_id, attachment_id, moderator_did,
                    action, reason, acted_at
                 ) VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    randomUUID(),
                    row.attachment_id,
                    moderatorDid,
                    command.action,
                    command.reason,
                    now,
                ],
            );
            if (command.action === 'delete') {
                await client.query(
                    `UPDATE private_attachments
                     SET deleted_reason = 'moderator-deleted',
                         updated_at = $2
                     WHERE attachment_id = $1`,
                    [row.attachment_id, now],
                );
                await client.query(
                    `DELETE FROM private_attachments
                     WHERE attachment_id = $1`,
                    [row.attachment_id],
                );
            } else {
                await client.query(
                    `UPDATE private_attachments
                     SET status = $2,
                         quarantine_reason_code =
                             CASE WHEN $2 = 'quarantined'
                                  THEN 'moderator-quarantine'
                                  ELSE NULL END,
                         next_scan_at =
                             CASE WHEN $2 = 'retry'
                                  THEN $3::timestamptz ELSE NULL END,
                         last_scan_error_code = NULL,
                         updated_at = $3
                     WHERE attachment_id = $1`,
                    [
                        row.attachment_id,
                        command.action === 'quarantine' ?
                            'quarantined'
                        :   'retry',
                        now,
                    ],
                );
            }
            await client.query('COMMIT');
            return {
                attachmentId: row.attachment_id,
                status:
                    command.action === 'delete' ?
                        'deletion-pending'
                    : command.action === 'quarantine' ?
                        'quarantined'
                    :   'retry',
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async runScanSweep(
        now = new Date(),
        maximum = 10,
    ): Promise<{
        clean: number;
        quarantined: number;
        retry: number;
    }> {
        const candidates = await this.pool.query<{ attachment_id: string }>(
            `SELECT attachment_id
             FROM private_attachments
             WHERE status IN ('uploaded', 'retry')
               AND next_scan_at <= $1
             ORDER BY next_scan_at, created_at
             LIMIT $2`,
            [now, maximum],
        );
        const result = { clean: 0, quarantined: 0, retry: 0 };
        for (const candidate of candidates.rows) {
            const verdict = await this.scanOne(
                candidate.attachment_id,
                now,
            );
            result[verdict] += 1;
        }
        return result;
    }

    async runDeletionSweep(
        now?: Date,
        maximum = 100,
    ): Promise<{
        deleted: number;
        failed: number;
        failedPending: number;
    }> {
        // Trigger-created jobs and default sweeps must share the database clock.
        const jobs = await this.pool.query<{
            job_id: string;
            object_key: string;
            attempt_count: number;
            sweep_time: Date;
        }>(
            `SELECT job_id, object_key, attempt_count,
                    COALESCE($1::timestamptz, NOW()) AS sweep_time
             FROM attachment_deletion_jobs
             WHERE deleted_at IS NULL
               AND next_attempt_at <= COALESCE($1::timestamptz, NOW())
             ORDER BY next_attempt_at, created_at
             LIMIT $2`,
            [now ?? null, maximum],
        );
        let deleted = 0;
        let failed = 0;
        for (const job of jobs.rows) {
            const sweepTime = job.sweep_time;
            try {
                await this.objects.delete(job.object_key);
                await this.pool.query(
                    `UPDATE attachment_deletion_jobs
                     SET deleted_at = $2, last_error_code = NULL
                     WHERE job_id = $1`,
                    [job.job_id, sweepTime],
                );
                deleted += 1;
            } catch (error) {
                const nextAttempt = new Date(
                    sweepTime.getTime() +
                        Math.min(60, 2 ** job.attempt_count) * 60_000,
                );
                await this.pool.query(
                    `UPDATE attachment_deletion_jobs
                     SET attempt_count = attempt_count + 1,
                         next_attempt_at = $2, last_error_code = $3
                     WHERE job_id = $1`,
                    [job.job_id, nextAttempt, errorCode(error)],
                );
                failed += 1;
            }
        }
        const pending = await this.pool.query<{ count: string }>(
            `SELECT COUNT(*)::TEXT AS count
             FROM attachment_deletion_jobs
             WHERE deleted_at IS NULL
               AND last_error_code IS NOT NULL`,
        );
        return {
            deleted,
            failed,
            failedPending: Number(pending.rows[0]?.count ?? 0),
        };
    }

    async runLifecycleReconciliation(
        now = new Date(),
    ): Promise<{ removed: number }> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const marked = await client.query<{ attachment_id: string }>(
                `UPDATE private_attachments a
                 SET deleted_reason = 'policy-expired', updated_at = $1
                 WHERE a.retention_expires_at <= $1
                    OR (
                         a.status = 'authorized'
                         AND a.upload_expires_at <= $1
                    )
                    OR (
                         a.purpose = 'aid-post'
                         AND a.subject_ref IS NOT NULL
                         AND NOT EXISTS (
                             SELECT 1 FROM request_workflows w
                             WHERE w.post_uri = a.subject_ref
                               AND w.current_status NOT IN (
                                   'resolved', 'archived'
                               )
                         )
                    )
                    OR (
                         a.purpose = 'verification-evidence'
                         AND EXISTS (
                             SELECT 1
                             FROM verification_evidence_metadata e
                             JOIN verification_applications v
                               USING (application_id)
                             WHERE e.attachment_id = a.attachment_id
                               AND v.status IN (
                                   'denied', 'revoked', 'expired'
                               )
                         )
                    )
                 RETURNING a.attachment_id`,
                [now],
            );
            if (marked.rows.length > 0) {
                await client.query(
                    `DELETE FROM private_attachments
                     WHERE attachment_id = ANY($1::uuid[])`,
                    [marked.rows.map(row => row.attachment_id)],
                );
            }
            await client.query('COMMIT');
            return { removed: marked.rows.length };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async runOrphanReconciliation(
        now = new Date(),
    ): Promise<{ orphansDeleted: number; missingQuarantined: number }> {
        const references = await this.pool.query<{
            object_key: string;
        }>(
            `SELECT object_key FROM private_attachments
             UNION
             SELECT derivative_object_key AS object_key
             FROM private_attachments
             WHERE derivative_object_key IS NOT NULL
             UNION
             SELECT object_key FROM attachment_deletion_jobs
             WHERE deleted_at IS NULL`,
        );
        const referenced = new Set(
            references.rows.map(row => row.object_key),
        );
        const objects = await this.objects.list('private/');
        let orphansDeleted = 0;
        for (const object of objects) {
            if (
                !referenced.has(object.key) &&
                now.getTime() - object.lastModified.getTime() >
                    ORPHAN_GRACE_MS
            ) {
                await this.objects.delete(object.key);
                orphansDeleted += 1;
            }
        }
        const available = new Set(objects.map(object => object.key));
        const missing = await this.pool.query(
            `UPDATE private_attachments
             SET status = 'quarantined',
                 quarantine_reason_code = 'clean-object-missing',
                 updated_at = $2
             WHERE status = 'clean'
               AND derivative_object_key IS NOT NULL
               AND NOT (derivative_object_key = ANY($1::text[]))`,
            [[...available], now],
        );
        return {
            orphansDeleted,
            missingQuarantined: missing.rowCount ?? 0,
        };
    }

    private async scanOne(
        attachmentId: string,
        now: Date,
    ): Promise<'clean' | 'quarantined' | 'retry'> {
        const client = await this.pool.connect();
        let row: AttachmentRow;
        let attemptNumber: number;
        const attemptId = randomUUID();
        try {
            await client.query('BEGIN');
            row = await this.loadForUpdate(client, attachmentId);
            if (!['uploaded', 'retry'].includes(row.status)) {
                await client.query('ROLLBACK');
                return 'retry';
            }
            attemptNumber = row.scan_attempt_count + 1;
            await client.query(
                `UPDATE private_attachments
                 SET status = 'scanning',
                     scan_attempt_count = $2, updated_at = $3
                 WHERE attachment_id = $1`,
                [attachmentId, attemptNumber, now],
            );
            await client.query(
                `INSERT INTO attachment_scan_attempts (
                    attempt_id, attachment_id, attempt_number,
                    scanner_name, verdict, started_at
                 ) VALUES ($1, $2, $3, 'clamd', 'started', $4)`,
                [attemptId, attachmentId, attemptNumber, now],
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        try {
            const original = await this.objects.get(row.object_key);
            const detected = await fileTypeFromBuffer(original);
            if (
                !detected ||
                detected.mime !== row.declared_mime ||
                detected.mime !== row.detected_mime
            ) {
                await this.finishQuarantine(
                    row,
                    attemptId,
                    'invalid',
                    'mime-mismatch',
                    now,
                );
                return 'quarantined';
            }
            const originalScan = await this.scanner.scan(original);
            if (originalScan.verdict !== 'clean') {
                await this.finishQuarantine(
                    row,
                    attemptId,
                    originalScan.verdict === 'malware' ?
                        'malware'
                    :   'uncertain',
                    originalScan.signature ?? 'scanner-uncertain',
                    now,
                    originalScan.scannerVersion,
                );
                return 'quarantined';
            }
            const transformed = await this.transform(
                original,
                detected.mime,
            );
            const transformedScan = await this.scanner.scan(transformed);
            if (transformedScan.verdict !== 'clean') {
                await this.finishQuarantine(
                    row,
                    attemptId,
                    transformedScan.verdict === 'malware' ?
                        'malware'
                    :   'uncertain',
                    transformedScan.signature ?? 'derivative-uncertain',
                    now,
                    transformedScan.scannerVersion,
                );
                return 'quarantined';
            }
            const derivativeKey =
                `private/clean/${now.getUTCFullYear()}/` +
                `${String(now.getUTCMonth() + 1).padStart(2, '0')}/` +
                `${randomUUID()}`;
            await this.objects.put(
                derivativeKey,
                transformed,
                detected.mime,
            );
            const finished = await this.pool.connect();
            try {
                await finished.query('BEGIN');
                const updated = await finished.query(
                    `UPDATE private_attachments
                     SET status = 'clean', derivative_object_key = $2,
                         clean_at = $3, next_scan_at = NULL,
                         last_scan_error_code = NULL,
                         quarantine_reason_code = NULL, updated_at = $3
                     WHERE attachment_id = $1 AND status = 'scanning'`,
                    [row.attachment_id, derivativeKey, now],
                );
                if (!updated.rowCount) {
                    throw new Error('ATTACHMENT_SCAN_CLAIM_LOST');
                }
                await finished.query(
                    `UPDATE attachment_scan_attempts
                     SET verdict = 'clean', detected_mime = $2,
                         scanner_version = $3, completed_at = $4
                     WHERE attempt_id = $1`,
                    [
                        attemptId,
                        detected.mime,
                        transformedScan.scannerVersion,
                        now,
                    ],
                );
                await finished.query('COMMIT');
            } catch (error) {
                await finished.query('ROLLBACK');
                try {
                    await this.objects.delete(derivativeKey);
                } catch {
                    // Orphan reconciliation provides the durable cleanup path.
                }
                throw error;
            } finally {
                finished.release();
            }
            return 'clean';
        } catch (error) {
            const retry = attemptNumber < MAX_SCAN_ATTEMPTS;
            const failed = await this.pool.connect();
            try {
                await failed.query('BEGIN');
                await failed.query(
                    `UPDATE private_attachments
                     SET status = $2,
                         next_scan_at = $3,
                         last_scan_error_code = $4,
                         quarantine_reason_code =
                             CASE WHEN $2 = 'quarantined'
                                  THEN 'scan-retries-exhausted'
                                  ELSE NULL END,
                         updated_at = $5
                     WHERE attachment_id = $1`,
                    [
                        row.attachment_id,
                        retry ? 'retry' : 'quarantined',
                        retry ?
                            new Date(
                                now.getTime() +
                                    2 ** attemptNumber * 60_000,
                            )
                        :   null,
                        errorCode(error),
                        now,
                    ],
                );
                await failed.query(
                    `UPDATE attachment_scan_attempts
                     SET verdict = 'error', reason_code = $2,
                         completed_at = $3
                     WHERE attempt_id = $1`,
                    [attemptId, errorCode(error), now],
                );
                await failed.query('COMMIT');
            } catch (finishError) {
                await failed.query('ROLLBACK');
                throw finishError;
            } finally {
                failed.release();
            }
            return retry ? 'retry' : 'quarantined';
        }
    }

    private async finishQuarantine(
        row: AttachmentRow,
        attemptId: string,
        verdict: 'malware' | 'invalid' | 'uncertain',
        reason: string,
        now: Date,
        scannerVersion: string | null = null,
    ): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `UPDATE private_attachments
                 SET status = 'quarantined',
                     quarantine_reason_code = $2,
                     next_scan_at = NULL, updated_at = $3
                 WHERE attachment_id = $1`,
                [row.attachment_id, reason.slice(0, 200), now],
            );
            await client.query(
                `UPDATE attachment_scan_attempts
                 SET verdict = $2, reason_code = $3,
                     scanner_version = $4, completed_at = $5
                 WHERE attempt_id = $1`,
                [
                    attemptId,
                    verdict,
                    reason.slice(0, 200),
                    scannerVersion,
                    now,
                ],
            );
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    private async transform(
        body: Buffer,
        mime: string,
    ): Promise<Buffer> {
        if (mime === 'application/pdf') {
            const pdf = await PDFDocument.load(body, {
                ignoreEncryption: false,
                throwOnInvalidObject: true,
                updateMetadata: false,
            });
            if (pdf.isEncrypted || pdf.getPageCount() < 1) {
                throw new Error('PDF_UNCERTAIN');
            }
            return body;
        }
        const image = sharp(body, {
            animated: true,
            limitInputPixels: 40_000_000,
        }).rotate();
        if (mime === 'image/jpeg') {
            return image.jpeg({ quality: 88, mozjpeg: true }).toBuffer();
        }
        if (mime === 'image/png') {
            return image.png({ compressionLevel: 9 }).toBuffer();
        }
        if (mime === 'image/webp') {
            return image.webp({ quality: 88 }).toBuffer();
        }
        if (mime === 'image/gif') {
            return image.gif().toBuffer();
        }
        throw new Error('UNSUPPORTED_ATTACHMENT_TYPE');
    }

    private async assertPurpose(
        actorDid: string,
        purpose: z.infer<typeof purposeSchema>,
        subjectRef: string | null,
    ): Promise<void> {
        if (purpose === 'aid-post') {
            if (!subjectRef) {
                throw new PublicHttpError(
                    400,
                    'ATTACHMENT_SUBJECT_REQUIRED',
                    'An aid-post attachment requires its request.',
                );
            }
            const owned = await this.pool.query(
                `SELECT 1 FROM request_workflows
                 WHERE post_uri = $1 AND requester_did = $2
                   AND current_status NOT IN (
                       'resolved', 'archived'
                   )`,
                [subjectRef, actorDid],
            );
            if (!owned.rowCount) {
                throw new PublicHttpError(
                    403,
                    'ATTACHMENT_SUBJECT_FORBIDDEN',
                    'The attachment subject is unavailable.',
                );
            }
        }
    }

    private assertAccess(
        actorDid: string,
        row: AttachmentRow,
        canReview: boolean,
    ): void {
        if (row.status !== 'clean' || !row.derivative_object_key) {
            throw new PublicHttpError(
                409,
                'ATTACHMENT_NOT_CLEAN',
                'Only a clean attachment can be accessed.',
            );
        }
        if (
            actorDid !== row.owner_did &&
            !canReview &&
            row.purpose !== 'aid-post'
        ) {
            throw new PublicHttpError(
                403,
                'ATTACHMENT_ACCESS_FORBIDDEN',
                'The attachment is private.',
            );
        }
    }

    private assertOwner(actorDid: string, row: AttachmentRow): void {
        if (actorDid !== row.owner_did) {
            throw new PublicHttpError(
                403,
                'ATTACHMENT_OWNER_REQUIRED',
                'Only the attachment owner may perform this action.',
            );
        }
    }

    private sign(
        attachmentId: string,
        actorDid: string,
        expires: number,
    ): string {
        return createHmac('sha256', this.signingKey)
            .update(`${attachmentId}|${actorDid}|${expires}`)
            .digest('base64url');
    }

    private async load(attachmentId: string): Promise<AttachmentRow> {
        const result = await this.pool.query<AttachmentRow>(
            `SELECT * FROM private_attachments WHERE attachment_id = $1`,
            [attachmentId],
        );
        if (!result.rows[0]) {
            throw new PublicHttpError(
                404,
                'ATTACHMENT_NOT_FOUND',
                'The attachment was not found.',
            );
        }
        return result.rows[0];
    }

    private async loadForUpdate(
        client: PoolClient,
        attachmentId: string,
    ): Promise<AttachmentRow> {
        const result = await client.query<AttachmentRow>(
            `SELECT * FROM private_attachments
             WHERE attachment_id = $1 FOR UPDATE`,
            [attachmentId],
        );
        if (!result.rows[0]) {
            throw new PublicHttpError(
                404,
                'ATTACHMENT_NOT_FOUND',
                'The attachment was not found.',
            );
        }
        return result.rows[0];
    }
}
