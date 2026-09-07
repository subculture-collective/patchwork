import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { VerificationCaseService } from './verification-case-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const ownerDid = 'did:plc:verification-owner';
const stewardDid = 'did:plc:verification-steward';
const otherDid = 'did:plc:verification-other';
const moderatorDid = 'did:plc:verification-moderator';
const organizationId = '11111111-1111-4111-8111-111111111111';
const resourceUri =
    `at://${stewardDid}/app.patchwork.directory.resource/pantry`;
const confidentialResourceUri =
    `at://${stewardDid}/app.patchwork.directory.resource/safe-house`;
const cleanAttachmentId = '22222222-2222-4222-8222-222222222222';
const quarantinedAttachmentId = '33333333-3333-4333-8333-333333333333';

describe('VerificationCaseService PostgreSQL boundary', () => {
    const pool = new Pool({ connectionString: databaseUrl });

    beforeEach(async () => {
        await pool.query(
            `TRUNCATE verification_audit_events,
                      exact_public_address_requests,
                      verification_appeals,
                      verification_decisions,
                      verification_evidence_metadata,
                      verification_applications,
                      private_attachments,
                      organization_notification_events,
                      organization_audit_events,
                      organization_resource_stewardships,
                      organization_invitations,
                      organization_memberships,
                      organizations
             RESTART IDENTITY CASCADE`,
        );
        await pool.query(
            `INSERT INTO organizations (
                organization_id, slug, name, description, origin,
                source_url, source_retrieved_at,
                source_last_verified_at, non_endorsement_label,
                created_by_did, created_at, updated_at
             ) VALUES (
                $1, 'verified-org', 'Verified Org', '',
                'visitor-created', NULL, NULL, NULL,
                'Listed for public information. Patchwork does not endorse this organization.',
                $2, NOW(), NOW()
             )`,
            [organizationId, ownerDid],
        );
        await pool.query(
            `INSERT INTO organization_memberships (
                organization_id, member_did, role, status,
                invited_by_did, joined_at, updated_at
             ) VALUES
                ($1, $2, 'owner', 'active', $2, NOW(), NOW()),
                ($1, $3, 'steward', 'active', $2, NOW(), NOW())`,
            [organizationId, ownerDid, stewardDid],
        );
        await pool.query(
            `INSERT INTO organization_resource_stewardships (
                stewardship_id, organization_id, resource_uri,
                steward_did, status, last_reconfirmed_at,
                reconfirm_due_at, created_at, updated_at
             ) VALUES
                ('44444444-4444-4444-8444-444444444444',
                 $1, $2, $4, 'active', NOW(),
                 NOW() + INTERVAL '90 days', NOW(), NOW()),
                ('55555555-5555-4555-8555-555555555555',
                 $1, $3, $4, 'active', NOW(),
                 NOW() + INTERVAL '90 days', NOW(), NOW())`,
            [
                organizationId,
                resourceUri,
                confidentialResourceUri,
                stewardDid,
            ],
        );
        await pool.query(
            `INSERT INTO private_attachments (
                attachment_id, owner_did, purpose, filename, object_key,
                declared_mime, detected_mime, byte_size, status,
                upload_expires_at, retention_expires_at,
                created_at, updated_at, deleted_at
             ) VALUES
                ($1, $3, 'verification-evidence', 'clean-evidence.pdf',
                 'verification/owner/clean-evidence',
                 'application/pdf', 'application/pdf', 100, 'clean',
                 NOW(), NOW() + INTERVAL '1 year', NOW(), NOW(), NULL),
                ($2, $3, 'verification-evidence',
                 'quarantined-evidence.pdf',
                 'verification/owner/quarantined-evidence',
                 'application/pdf', 'application/pdf', 100, 'quarantined',
                 NOW(), NOW() + INTERVAL '1 year', NOW(), NOW(), NULL)`,
            [cleanAttachmentId, quarantinedAttachmentId, ownerDid],
        );
    });

    afterAll(async () => pool.end());

    it('persists private evidence, annual decisions, appeals, and exact-address gates across restart', async () => {
        const submittedAt = new Date('2026-01-01T12:00:00.000Z');
        const service = new VerificationCaseService(pool);
        const organizationApplication = await service.submitApplication(
            ownerDid,
            {
                subjectType: 'organization',
                organizationId,
                evidence: [
                    {
                        kind: 'organization-registration',
                        label: 'State registration',
                        issuer: 'State registry',
                        issuedAt: '2025-12-01',
                        attachmentId: cleanAttachmentId,
                        privateNotes: 'Registration number is in the PDF.',
                    },
                ],
            },
            submittedAt,
        );
        const organizationApplicationId = (
            organizationApplication as { application: { id: string } }
        ).application.id;
        const resourceApplication = await service.submitApplication(
            stewardDid,
            {
                subjectType: 'resource',
                organizationId,
                resourceUri,
                evidence: [
                    {
                        kind: 'service-authorization',
                        label: 'Pantry authorization',
                        issuer: 'Verified Org',
                        issuedAt: null,
                        attachmentId: null,
                        privateNotes: 'Reviewed with organization owner.',
                    },
                ],
            },
            submittedAt,
        );
        const resourceApplicationId = (
            resourceApplication as { application: { id: string } }
        ).application.id;

        await expect(
            service.submitApplication(ownerDid, {
                subjectType: 'volunteer',
                evidence: [
                    {
                        kind: 'identity',
                        label: 'Unsafe upload',
                        issuer: null,
                        issuedAt: null,
                        attachmentId: quarantinedAttachmentId,
                        privateNotes: null,
                    },
                ],
            }),
        ).rejects.toMatchObject({
            statusCode: 400,
            code: 'VERIFICATION_ATTACHMENT_NOT_CLEAN',
        });

        const approvedAt = new Date('2026-01-02T12:00:00.000Z');
        await service.decide(
            moderatorDid,
            {
                applicationId: organizationApplicationId,
                action: 'approve',
                reason: 'Registration verified.',
            },
            approvedAt,
        );
        await service.decide(
            moderatorDid,
            {
                applicationId: resourceApplicationId,
                action: 'approve',
                reason: 'Service authority verified.',
            },
            approvedAt,
        );
        const exactRequest = await service.requestExactAddress(
            stewardDid,
            {
                organizationId,
                resourceUri,
                streetAddress: '100 Public Way, Chicago, IL',
                latitude: 41.9,
                longitude: -87.65,
                confidentialFacility: false,
            },
            new Date('2026-01-03T12:00:00.000Z'),
        );
        const exactRequestId = (
            exactRequest as { request: { id: string } }
        ).request.id;
        await expect(
            service.decideExactAddress(
                moderatorDid,
                {
                    requestId: exactRequestId,
                    decision: 'approve',
                    reason: 'Public facility address verified separately.',
                },
                new Date('2026-01-04T12:00:00.000Z'),
            ),
        ).resolves.toMatchObject({
            request: {
                status: 'approved',
                streetAddress: '100 Public Way, Chicago, IL',
                approvalExpiresAt: '2027-01-02T12:00:00.000Z',
            },
        });

        const restarted = new VerificationCaseService(pool);
        await expect(restarted.listMine(ownerDid)).resolves.toMatchObject({
            applications: [
                expect.objectContaining({
                    id: organizationApplicationId,
                    status: 'approved',
                    expiresAt: '2027-01-02T12:00:00.000Z',
                }),
            ],
            evidence: [
                expect.objectContaining({
                    label: 'State registration',
                    privateNotes: 'Registration number is in the PDF.',
                }),
            ],
        });

        const volunteerApplication = await restarted.submitApplication(
            otherDid,
            {
                subjectType: 'volunteer',
                evidence: [
                    {
                        kind: 'training',
                        label: 'Safety course',
                        issuer: null,
                        issuedAt: null,
                        attachmentId: null,
                        privateNotes: null,
                    },
                ],
            },
            new Date('2026-02-01T12:00:00.000Z'),
        );
        const volunteerApplicationId = (
            volunteerApplication as { application: { id: string } }
        ).application.id;
        await restarted.decide(
            moderatorDid,
            {
                applicationId: volunteerApplicationId,
                action: 'deny',
                reason: 'Evidence incomplete.',
            },
            new Date('2026-02-02T12:00:00.000Z'),
        );
        const appeal = await restarted.submitAppeal(
            otherDid,
            {
                applicationId: volunteerApplicationId,
                reason: 'The missing record is now confirmed.',
            },
            new Date('2026-02-03T12:00:00.000Z'),
        );
        await restarted.decideAppeal(
            moderatorDid,
            {
                appealId: (appeal as { appeal: { id: string } }).appeal.id,
                decision: 'upheld',
                resolutionNote: 'Evidence confirmed on appeal.',
            },
            new Date('2026-02-04T12:00:00.000Z'),
        );
        await expect(restarted.listMine(otherDid)).resolves.toMatchObject({
            applications: [
                expect.objectContaining({ status: 'approved' }),
            ],
            appeals: [expect.objectContaining({ status: 'upheld' })],
        });

        await restarted.decide(
            moderatorDid,
            {
                applicationId: organizationApplicationId,
                action: 'revoke',
                reason: 'Organization authority withdrawn.',
            },
            new Date('2026-03-01T12:00:00.000Z'),
        );
        const exact = await pool.query<{ status: string }>(
            `SELECT status FROM exact_public_address_requests
             WHERE request_id = $1`,
            [exactRequestId],
        );
        expect(exact.rows[0]?.status).toBe('revoked');
        await restarted.runExpirySweep(
            new Date('2028-01-01T12:00:00.000Z'),
        );

        const audits = await pool.query<{ action: string }>(
            `SELECT action FROM verification_audit_events
             ORDER BY audit_id`,
        );
        expect(audits.rows.map(row => row.action)).toEqual(
            expect.arrayContaining([
                'verification-application-submitted',
                'verification-approve',
                'exact-address-approve',
                'verification-appeal-upheld',
                'verification-revoke',
                'exact-address-revoked-by-verification',
                'verification-expired',
            ]),
        );
    });

    it('quarantines confidential and verification-incomplete exact addresses', async () => {
        const service = new VerificationCaseService(pool);
        const confidential = await service.requestExactAddress(stewardDid, {
            organizationId,
            resourceUri: confidentialResourceUri,
            streetAddress: 'Private Safe House',
            latitude: 41.91,
            longitude: -87.66,
            confidentialFacility: true,
        });
        expect(confidential).toMatchObject({
            request: { status: 'quarantined', confidentialFacility: true },
        });
        await expect(
            service.decideExactAddress(moderatorDid, {
                requestId: (confidential as { request: { id: string } })
                    .request.id,
                decision: 'approve',
                reason: 'Should not publish.',
            }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'CONFIDENTIAL_EXACT_ADDRESS_FORBIDDEN',
        });

        const pending = await service.requestExactAddress(stewardDid, {
            organizationId,
            resourceUri,
            streetAddress: '200 Ungated Way',
            latitude: 41.92,
            longitude: -87.67,
            confidentialFacility: false,
        });
        await expect(
            service.decideExactAddress(moderatorDid, {
                requestId: (pending as { request: { id: string } }).request.id,
                decision: 'approve',
                reason: 'Attempt before verification.',
            }),
        ).resolves.toMatchObject({
            request: {
                status: 'quarantined',
                reason:
                    'Active organization and resource verification are required.',
            },
        });
    });
});
