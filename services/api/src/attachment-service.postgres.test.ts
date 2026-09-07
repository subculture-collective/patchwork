import { Pool } from 'pg';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
    AttachmentService,
} from './attachment-service.js';
import type {
    MalwareScanner,
    MalwareScanResult,
} from './clamd-scanner.js';
import type {
    PrivateObject,
    PrivateObjectStore,
} from './private-object-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const ownerDid = 'did:plc:attachment-owner';
const outsiderDid = 'did:plc:attachment-outsider';
const requestUri =
    `at://${ownerDid}/app.patchwork.aid.post/attachment-request`;

class MemoryObjectStore implements PrivateObjectStore {
    readonly objects = new Map<
        string,
        { body: Buffer; contentType: string; lastModified: Date }
    >();
    readonly deleted: string[] = [];
    failDeletion = false;

    async ensureReady(): Promise<void> {}

    async put(
        key: string,
        body: Buffer,
        contentType: string,
    ): Promise<void> {
        this.objects.set(key, {
            body: Buffer.from(body),
            contentType,
            lastModified: new Date(),
        });
    }

    async get(key: string): Promise<Buffer> {
        const object = this.objects.get(key);
        if (!object) throw new Error('OBJECT_NOT_FOUND');
        return Buffer.from(object.body);
    }

    async delete(key: string): Promise<void> {
        if (this.failDeletion) throw new Error('OBJECT_DELETE_FAILED');
        this.objects.delete(key);
        this.deleted.push(key);
    }

    async list(prefix: string): Promise<PrivateObject[]> {
        return [...this.objects.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({
                key,
                size: value.body.length,
                lastModified: value.lastModified,
            }));
    }
}

class QueueScanner implements MalwareScanner {
    readonly results: Array<MalwareScanResult | Error> = [];

    async scan(): Promise<MalwareScanResult> {
        const next = this.results.shift() ?? {
            verdict: 'clean' as const,
            signature: null,
            scannerVersion: 'test-clamd',
        };
        if (next instanceof Error) throw next;
        return next;
    }
}

describe('durable private attachment pipeline', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    let objects: MemoryObjectStore;
    let scanner: QueueScanner;
    let service: AttachmentService;
    let image: Buffer;

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE attachment_moderator_actions,
                      attachment_scan_attempts,
                      attachment_deletion_jobs,
                      verification_evidence_metadata,
                      verification_applications,
                      private_attachments,
                      request_transition_events,
                      request_workflows
             RESTART IDENTITY CASCADE`,
        );
        await pool.query(
            `INSERT INTO request_workflows (
                post_uri, requester_did, current_status,
                create_command_id, created_at, updated_at
             ) VALUES (
                $1, $2, 'open', 'attachment-request', NOW(), NOW()
             )`,
            [requestUri, ownerDid],
        );
        objects = new MemoryObjectStore();
        scanner = new QueueScanner();
        service = new AttachmentService(
            pool,
            objects,
            scanner,
            'test-attachment-signing-key-that-is-long-enough',
            'https://patchwork.test/api',
        );
        image = await sharp({
            create: {
                width: 4,
                height: 4,
                channels: 4,
                background: '#287c52',
            },
        })
            .withExif({
                IFD0: { Copyright: 'private camera metadata' },
            })
            .png()
            .toBuffer();
    });

    afterAll(async () => pool.end());

    const upload = async (
        purpose:
            | 'verification-evidence'
            | 'aid-post'
            | 'moderation-evidence' = 'verification-evidence',
        subjectRef: string | null =
            purpose === 'aid-post' ? requestUri : null,
    ) => {
        const authorized = await service.authorizeUpload(ownerDid, {
            filename: 'evidence.png',
            declaredMime: 'image/png',
            byteSize: image.length,
            purpose,
            subjectRef,
        });
        const attachment = authorized['attachment'] as { id: string };
        const token = (
            authorized['upload'] as { token: string }
        ).token;
        const completed = await service.completeUpload(
            ownerDid,
            {
                attachmentId: attachment.id,
                uploadToken: token,
            },
            image,
            'image/png',
        );
        return (
            completed['attachment'] as {
                id: string;
                status: string;
            }
        );
    };

    it('authorizes, detects, scans, strips image metadata, signs access, and survives service restart', async () => {
        const attachment = await upload();
        expect(attachment.status).toBe('uploaded');
        await expect(service.runScanSweep()).resolves.toEqual({
            clean: 1,
            quarantined: 0,
            retry: 0,
        });

        const restarted = new AttachmentService(
            pool,
            objects,
            scanner,
            'test-attachment-signing-key-that-is-long-enough',
            'https://patchwork.test/api',
        );
        const access = await restarted.issueAccess(
            ownerDid,
            { attachmentId: attachment.id },
            false,
            new Date('2026-07-28T12:00:00.000Z'),
        );
        const url = new URL(
            (access['access'] as { url: string }).url,
        );
        const downloaded = await restarted.readSigned(
            ownerDid,
            attachment.id,
            url.searchParams.get('expires')!,
            url.searchParams.get('signature')!,
            false,
            new Date('2026-07-28T12:00:01.000Z'),
        );
        expect(downloaded.contentType).toBe('image/png');
        expect((await sharp(downloaded.body).metadata()).exif).toBeUndefined();
        expect(downloaded.body.equals(image)).toBe(false);
        await expect(
            restarted.issueAccess(
                outsiderDid,
                { attachmentId: attachment.id },
                false,
            ),
        ).rejects.toMatchObject({
            statusCode: 403,
            code: 'ATTACHMENT_ACCESS_FORBIDDEN',
        });

        const attempts = await pool.query(
            `SELECT verdict, scanner_name, scanner_version
             FROM attachment_scan_attempts`,
        );
        expect(attempts.rows).toEqual([
            {
                verdict: 'clean',
                scanner_name: 'clamd',
                scanner_version: 'test-clamd',
            },
        ]);
    });

    it('rejects spoofed content and quarantines malware without signed access', async () => {
        const authorized = await service.authorizeUpload(ownerDid, {
            filename: 'spoof.png',
            declaredMime: 'image/png',
            byteSize: 8,
            purpose: 'verification-evidence',
            subjectRef: null,
        });
        await expect(
            service.completeUpload(
                ownerDid,
                {
                    attachmentId: (
                        authorized['attachment'] as { id: string }
                    ).id,
                    uploadToken: (
                        authorized['upload'] as { token: string }
                    ).token,
                },
                Buffer.from('not-png!'),
                'image/png',
            ),
        ).rejects.toMatchObject({
            code: 'ATTACHMENT_CONTENT_MISMATCH',
        });

        const attachment = await upload();
        scanner.results.push({
            verdict: 'malware',
            signature: 'Eicar-Signature',
            scannerVersion: 'test-clamd',
        });
        await service.runScanSweep();
        await expect(
            service.issueAccess(
                ownerDid,
                { attachmentId: attachment.id },
                false,
            ),
        ).rejects.toMatchObject({
            code: 'ATTACHMENT_NOT_CLEAN',
        });
        const state = await service.listMine(ownerDid);
        expect(state).toMatchObject({
            attachments: [
                expect.objectContaining({
                    id: attachment.id,
                    status: 'quarantined',
                }),
                expect.objectContaining({ status: 'authorized' }),
            ],
        });
        expect(JSON.stringify(state)).not.toContain('Eicar-Signature');
    });

    it('persists retry state, permits moderator rescan, and serves aid-post attachments only after clean', async () => {
        const attachment = await upload('aid-post', requestUri);
        scanner.results.push(new Error('CLAMD_UNAVAILABLE'));
        await expect(service.runScanSweep()).resolves.toMatchObject({
            retry: 1,
        });
        const retryState = await pool.query(
            `SELECT status, scan_attempt_count, last_scan_error_code
             FROM private_attachments WHERE attachment_id = $1`,
            [attachment.id],
        );
        expect(retryState.rows[0]).toMatchObject({
            status: 'retry',
            scan_attempt_count: 1,
            last_scan_error_code: 'CLAMD_UNAVAILABLE',
        });

        await service.review('did:plc:attachment-moderator', {
            attachmentId: attachment.id,
            action: 'release-for-rescan',
            reason: 'Scanner recovered.',
        });
        await service.runScanSweep(new Date(Date.now() + 5 * 60_000));
        await expect(
            service.issueAccess(
                outsiderDid,
                { attachmentId: attachment.id },
                false,
            ),
        ).resolves.toMatchObject({
            attachment: { status: 'clean' },
        });
    });

    it('validates PDFs and quarantines an uncertain zero-page document after durable retries', async () => {
        const first = new Date('2026-07-28T12:00:00.000Z');
        const pdf = await PDFDocument.create();
        const body = Buffer.from(
            await pdf.save({ addDefaultPage: false }),
        );
        const authorized = await service.authorizeUpload(
            ownerDid,
            {
                filename: 'uncertain.pdf',
                declaredMime: 'application/pdf',
                byteSize: body.length,
                purpose: 'verification-evidence',
                subjectRef: null,
            },
            first,
        );
        const attachmentId = (
            authorized['attachment'] as { id: string }
        ).id;
        await service.completeUpload(
            ownerDid,
            {
                attachmentId,
                uploadToken: (
                    authorized['upload'] as { token: string }
                ).token,
            },
            body,
            'application/pdf',
            first,
        );

        await expect(service.runScanSweep(first)).resolves.toMatchObject({
            retry: 1,
        });
        await expect(
            service.runScanSweep(
                new Date(first.getTime() + 3 * 60_000),
            ),
        ).resolves.toMatchObject({ retry: 1 });
        await expect(
            service.runScanSweep(
                new Date(first.getTime() + 8 * 60_000),
            ),
        ).resolves.toMatchObject({ quarantined: 1 });
        await expect(
            service.issueAccess(
                ownerDid,
                { attachmentId },
                false,
            ),
        ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_CLEAN' });
        expect(
            (
                await pool.query(
                    `SELECT status, scan_attempt_count,
                            quarantine_reason_code
                     FROM private_attachments
                     WHERE attachment_id = $1`,
                    [attachmentId],
                )
            ).rows[0],
        ).toMatchObject({
            status: 'quarantined',
            scan_attempt_count: 3,
            quarantine_reason_code: 'scan-retries-exhausted',
        });
    });

    it('queues originals and derivatives for deletion, retries failures, and reconciles orphans', async () => {
        const attachment = await upload();
        await service.runScanSweep();
        await service.deleteOwn(ownerDid, {
            attachmentId: attachment.id,
        });
        const jobs = await pool.query(
            `SELECT object_key FROM attachment_deletion_jobs
             WHERE deleted_at IS NULL`,
        );
        expect(jobs.rows).toHaveLength(2);

        objects.failDeletion = true;
        await expect(service.runDeletionSweep()).resolves.toMatchObject({
            failed: 2,
        });
        objects.failDeletion = false;
        await service.runDeletionSweep(
            new Date(Date.now() + 3 * 60_000),
        );
        expect(objects.objects.size).toBe(0);

        objects.objects.set('private/original/orphan', {
            body: Buffer.from('orphan'),
            contentType: 'application/octet-stream',
            lastModified: new Date(Date.now() - 2 * 60 * 60_000),
        });
        await expect(service.runOrphanReconciliation()).resolves.toMatchObject(
            { orphansDeleted: 1 },
        );
    });

    it('deletes attachment metadata and objects when account-owned rows are removed', async () => {
        await upload();
        await service.runScanSweep();
        await pool.query(
            `UPDATE private_attachments
             SET deleted_reason = 'account-deactivated'
             WHERE owner_did = $1`,
            [ownerDid],
        );
        await pool.query(
            `DELETE FROM private_attachments WHERE owner_did = $1`,
            [ownerDid],
        );
        expect(
            (
                await pool.query(
                    `SELECT COUNT(*)::INT AS count
                     FROM attachment_deletion_jobs
                     WHERE deleted_at IS NULL`,
                )
            ).rows[0]?.count,
        ).toBe(2);
        await service.runDeletionSweep();
        expect(objects.objects.size).toBe(0);
    });

    it('removes aid-post bytes immediately when the owning public subject is deleted', async () => {
        await upload('aid-post', requestUri);
        await service.runScanSweep();

        await expect(
            service.deleteForSubject(ownerDid, requestUri),
        ).resolves.toEqual({ removed: 1 });
        expect(
            (
                await pool.query(
                    `SELECT COUNT(*)::INT AS count
                     FROM private_attachments`,
                )
            ).rows[0]?.count,
        ).toBe(0);
        await expect(service.runDeletionSweep()).resolves.toMatchObject({
            deleted: 2,
            failed: 0,
            failedPending: 0,
        });
        expect(objects.objects.size).toBe(0);

        await expect(
            service.deleteForSubject(outsiderDid, requestUri),
        ).rejects.toMatchObject({
            code: 'INVALID_ATTACHMENT_SUBJECT',
        });
    });

    it('reconciles closed workflow policy expiry into durable object deletion', async () => {
        await upload('aid-post', requestUri);
        await service.runScanSweep();
        await pool.query(
            `UPDATE request_workflows
             SET current_status = 'archived', updated_at = NOW()
             WHERE post_uri = $1`,
            [requestUri],
        );

        await expect(
            service.runLifecycleReconciliation(),
        ).resolves.toEqual({ removed: 1 });
        await expect(service.runDeletionSweep()).resolves.toMatchObject({
            deleted: 2,
            failedPending: 0,
        });
        expect(objects.objects.size).toBe(0);
    });
});
