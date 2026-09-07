import { Pool } from 'pg';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AttachmentService } from './attachment-service.js';
import { ClamdMalwareScanner } from './clamd-scanner.js';
import { MinioPrivateObjectStore } from './private-object-store.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const objectEndpoint = process.env.TEST_ATTACHMENT_OBJECT_ENDPOINT;
const objectAccessKey = process.env.TEST_ATTACHMENT_OBJECT_ACCESS_KEY;
const objectSecretKey = process.env.TEST_ATTACHMENT_OBJECT_SECRET_KEY;
const objectBucket = process.env.TEST_ATTACHMENT_OBJECT_BUCKET;
const clamdHost = process.env.TEST_ATTACHMENT_CLAMD_HOST;
const clamdPort = Number(process.env.TEST_ATTACHMENT_CLAMD_PORT ?? '3310');

describe('real MinIO and ClamAV attachment boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const objects = new MinioPrivateObjectStore(
        objectBucket ?? 'disabled-test-bucket',
        {
            endpoint: objectEndpoint ?? 'http://127.0.0.1:9000',
            accessKey: objectAccessKey ?? 'disabled',
            secretKey: objectSecretKey ?? 'disabled',
        },
    );
    const service = new AttachmentService(
        pool,
        objects,
        new ClamdMalwareScanner(clamdHost ?? '127.0.0.1', clamdPort),
        'real-integration-signing-key-that-is-long-enough',
        'https://patchwork.test/api',
    );
    const ownerDid = 'did:plc:real-attachment-owner';

    beforeAll(async () => {
        await service.ensureReady();
        for (const object of await objects.list('private/')) {
            await objects.delete(object.key);
        }
        await pool.query(
            `TRUNCATE attachment_moderator_actions,
                      attachment_scan_attempts,
                      attachment_deletion_jobs,
                      verification_evidence_metadata,
                      verification_applications,
                      private_attachments
             RESTART IDENTITY CASCADE`,
        );
    });

    afterAll(async () => {
        for (const object of await objects.list('private/')) {
            await objects.delete(object.key);
        }
        await pool.end();
    });

    const upload = async (
        body: Buffer,
        filename: string,
        declaredMime = 'image/png',
    ) => {
        const authorized = await service.authorizeUpload(ownerDid, {
            filename,
            declaredMime,
            byteSize: body.length,
            purpose: 'verification-evidence',
            subjectRef: null,
        });
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
            declaredMime,
        );
        return attachmentId;
    };

    it('persists clean transformed bytes and quarantines a test-signature image with the real services', async () => {
        const png = await sharp({
            create: {
                width: 8,
                height: 8,
                channels: 4,
                background: '#287c52',
            },
        })
            .withExif({ IFD0: { Copyright: 'must be removed' } })
            .png()
            .toBuffer();
        const cleanId = await upload(png, 'clean.png');
        await expect(service.runScanSweep()).resolves.toMatchObject({
            clean: 1,
        });
        const restarted = new AttachmentService(
            pool,
            objects,
            new ClamdMalwareScanner(
                clamdHost ?? '127.0.0.1',
                clamdPort,
            ),
            'real-integration-signing-key-that-is-long-enough',
            'https://patchwork.test/api',
        );
        const access = await restarted.issueAccess(
            ownerDid,
            { attachmentId: cleanId },
            false,
        );
        expect(access).toMatchObject({
            attachment: {
                id: cleanId,
                status: 'clean',
                detectedMime: 'image/png',
            },
        });

        const antivirusTestMarker = Buffer.from(
            [
                'X5O!P%@AP[4',
                String.fromCharCode(92),
                'PZX54(P^)7CC)7}$',
                'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
            ].join(''),
        );
        const antivirusTestPdf = await PDFDocument.create();
        antivirusTestPdf.addPage();
        await antivirusTestPdf.attach(
            antivirusTestMarker,
            'antivirus-test.txt',
            { mimeType: 'text/plain' },
        );
        const infectedId = await upload(
            Buffer.from(await antivirusTestPdf.save()),
            'antivirus-test.pdf',
            'application/pdf',
        );
        await expect(service.runScanSweep()).resolves.toMatchObject({
            quarantined: 1,
        });
        await expect(
            service.issueAccess(
                ownerDid,
                { attachmentId: infectedId },
                false,
            ),
        ).rejects.toMatchObject({
            code: 'ATTACHMENT_NOT_CLEAN',
        });

        await pool.query(
            `UPDATE private_attachments
             SET deleted_reason = 'account-deactivated'
             WHERE owner_did = $1 AND attachment_id = $2`,
            [ownerDid, cleanId],
        );
        await pool.query(
            `DELETE FROM private_attachments
             WHERE owner_did = $1 AND attachment_id = $2`,
            [ownerDid, cleanId],
        );
        await service.review('did:plc:real-attachment-moderator', {
            attachmentId: infectedId,
            action: 'delete',
            reason: 'Quarantined integration cleanup.',
        });
        await expect(restarted.runDeletionSweep()).resolves.toMatchObject({
            deleted: 3,
            failed: 0,
        });
        expect(await objects.list('private/')).toEqual([]);
    });
});
