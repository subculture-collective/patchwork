import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { ResourceCorrectionService } from './resource-correction-service.js';
import { AccountPrivacyService } from './account-privacy-service.js';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const service = new ResourceCorrectionService(pool);
const uri =
    'at://did:plc:correction-fixture/app.patchwork.directory.resource/office';
const reporter = 'did:plc:correction-reporter',
    reviewer = 'did:plc:correction-reviewer';
const input = () => ({
    receipt: randomBytes(32).toString('hex'),
    resourceUri: uri,
    category: 'contact',
    explanation: 'The public phone number has changed.',
    sourceUrl: 'https://example.org/contact',
});
describe('listing correction workflow', () => {
    beforeAll(async () => {
        await pool.query(
            `INSERT INTO public_resource_listings(resource_uri,source_name,source_url,source_retrieved_at,source_snapshot,source_expires_at,street_address,postal_code,latitude,longitude,public_access)
   VALUES($1,'Fixture','https://example.org',NOW(),'{}',NOW()+INTERVAL '30 days','1 Test Street','60608',41.85,-87.67,'Public') ON CONFLICT DO NOTHING`,
            [uri],
        );
        await pool.query(
            `INSERT INTO indexer_directory_resource_projections(uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,operational_status,record_created_at,record_updated_at,source_cursor,source_event_id)
   VALUES($1,'app.patchwork.directory.resource',repeat('a',64),'Test office','Chicago','other','unverified','{"url":"https://example.org","phone":"111"}','test office','unknown',NOW(),NOW(),1,'correction-fixture') ON CONFLICT DO NOTHING`,
            [uri],
        );
        await pool.query(
            "INSERT INTO platform_roles(did,role,updated_by,updated_at) VALUES($1,'admin',$1,NOW()),($2,'admin',$2,NOW()) ON CONFLICT(did) DO UPDATE SET role='admin'",
            [reporter, reviewer],
        );
    });
    beforeEach(async () => {
        await pool.query(
            'DELETE FROM resource_corrections WHERE resource_uri=$1',
            [uri],
        );
    });
    afterAll(async () => {
        await pool.end();
    });
    it('deduplicates uncertain anonymous submission without storing or returning the receipt', async () => {
        const submission = input();
        const [a, b] = await Promise.all([
            service.submit(submission),
            service.submit(submission),
        ]);
        expect(a.id).toBe(b.id);
        const status = await service.status({ receipt: submission.receipt });
        expect(status.correction.status).toBe('pending');
        expect(JSON.stringify(status)).not.toContain(submission.receipt);
        const stored = await pool.query(
            'SELECT * FROM resource_corrections WHERE id=$1',
            [a.id],
        );
        expect(JSON.stringify(stored.rows)).not.toContain(submission.receipt);
        await expect(
            service.status({ receipt: randomBytes(32).toString('hex') }),
        ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
        await expect(
            service.submit({
                ...submission,
                explanation: 'Different correction content.',
            }),
        ).rejects.toMatchObject({ code: 'SUBMISSION_CONFLICT' });
        expect((await service.list(reporter, false, 1)).items).toEqual([]);
    });
    it('requires independent review and current revisions, preserves source evidence, and completes follow-up', async () => {
        const submission = input();
        const created = await service.submit(submission, reporter);
        await expect(
            service.decide(reporter, {
                id: created.id,
                revision: 1,
                action: 'denied',
                response: 'This needs another reviewer.',
            }),
        ).rejects.toMatchObject({ code: 'INDEPENDENT_REVIEW_REQUIRED' });
        await expect(
            service.list('did:plc:ordinary', true, 1),
        ).rejects.toMatchObject({ code: 'REVIEWER_REQUIRED' });
        await service.decide(reviewer, {
            id: created.id,
            revision: 1,
            action: 'needs-information',
            response: 'Please provide the official contact page.',
        });
        await expect(
            service.respond(
                {
                    id: created.id,
                    revision: 2,
                    explanation: 'Here is the public source information.',
                },
                'did:plc:ordinary',
            ),
        ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
        await service.respond({
            receipt: submission.receipt,
            revision: 2,
            explanation: 'The official contact page lists this new number.',
            sourceUrl: 'https://example.org/contact',
        });
        const current = (
            await pool.query(
                'SELECT record_updated_at FROM indexer_directory_resource_projections WHERE uri=$1',
                [uri],
            )
        ).rows[0].record_updated_at.toISOString();
        const decision = {
            id: created.id,
            revision: 3,
            action: 'applied',
            response: 'Verified and corrected the official phone number.',
            sourceUrl: 'https://example.org/contact',
            expectedUpdatedAt: current,
            patch: { contact: { url: 'https://example.org', phone: '222' } },
        };
        await expect(
            service.decide(reviewer, {
                ...decision,
                expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
            }),
        ).rejects.toMatchObject({ code: 'RESOURCE_REVISION_CONFLICT' });
        const results = await Promise.allSettled([
            service.decide(reviewer, decision),
            service.decide(reviewer, decision),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(
            (await service.status({ receipt: submission.receipt })).correction
                .status,
        ).toBe('applied');
        expect(
            (
                await pool.query(
                    'SELECT contact FROM indexer_directory_resource_projections WHERE uri=$1',
                    [uri],
                )
            ).rows[0].contact.phone,
        ).toBe('222');
        expect(
            (
                await pool.query(
                    'SELECT source_snapshot FROM public_resource_listings WHERE resource_uri=$1',
                    [uri],
                )
            ).rows[0].source_snapshot,
        ).toEqual({});
        expect(
            (
                await pool.query(
                    'SELECT revision FROM resource_correction_events WHERE correction_id=$1 ORDER BY revision',
                    [created.id],
                )
            ).rows.map((row) => row.revision),
        ).toEqual([1, 2, 3, 4]);
    });
    it('quarantines structured hours when a reviewed correction contradicts published notes', async () => {
        const evidence = {
            sourceUrl: 'https://example.org',
            sourceName: 'Fixture',
            confirmedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            reviewStatus: 'reviewed',
        };
        const profile = {
            version: 1,
            services: [
                {
                    id: 'office',
                    name: 'Office service',
                    eligibility: [],
                    hours: {
                        evidence,
                        value: {
                            timezone: 'America/Chicago',
                            weekly: [{ day: 1, start: 540, end: 1020 }],
                            exceptions: [],
                        },
                    },
                },
            ],
        };
        await pool.query(
            'INSERT INTO resource_service_profiles(resource_uri,profile) VALUES($1,$2) ON CONFLICT(resource_uri) DO UPDATE SET profile=$2,revision=resource_service_profiles.revision+1',
            [uri, JSON.stringify(profile)],
        );
        const submission = { ...input(), category: 'closure' };
        const created = await service.submit(submission);
        const current = (
            await pool.query(
                'SELECT record_updated_at FROM indexer_directory_resource_projections WHERE uri=$1',
                [uri],
            )
        ).rows[0].record_updated_at.toISOString();
        await service.decide(reviewer, {
            id: created.id,
            revision: 1,
            action: 'applied',
            response: 'Provider confirms a temporary closure.',
            sourceUrl: 'https://example.org/closure',
            expectedUpdatedAt: current,
            patch: { openHours: 'Temporarily closed; contact provider.' },
        });
        expect(
            (
                await pool.query(
                    'SELECT profile FROM resource_service_profiles WHERE resource_uri=$1',
                    [uri],
                )
            ).rows[0].profile.services[0].hours.evidence.reviewStatus,
        ).toBe('conflicting');
        expect(
            (
                await pool.query(
                    'SELECT profile FROM resource_service_profile_history WHERE resource_uri=$1 ORDER BY revision DESC LIMIT 1',
                    [uri],
                )
            ).rows[0].profile,
        ).toEqual(profile);
    });
    it('exports owned corrections without receipts and removes them on deactivation', async () => {
        const did = 'did:plc:correction-deactivate';
        const submission = input();
        await service.submit(submission, did);
        const privacy = new AccountPrivacyService(pool);
        const exported = await privacy.exportFor(did);
        expect(JSON.stringify(exported)).toContain('resourceCorrections');
        expect(JSON.stringify(exported)).not.toContain(submission.receipt);
        await privacy.deactivate(did, crypto.randomUUID());
        expect((await service.list(did, false, 1)).items).toEqual([]);
        await expect(service.submit(input(), did)).rejects.toMatchObject({
            code: 'ACCOUNT_DEACTIVATED',
        });
    });
    it('expires private receipts and removes retained correction events', async () => {
        const submission = input();
        await service.submit(submission);
        await pool.query(
            "UPDATE resource_corrections SET retention_until=NOW()-INTERVAL '1 day' WHERE resource_uri=$1",
            [uri],
        );
        await expect(
            service.status({ receipt: submission.receipt }),
        ).rejects.toMatchObject({ code: 'RECEIPT_NOT_FOUND' });
        await service.retain();
        expect(
            (
                await pool.query(
                    'SELECT id FROM resource_corrections WHERE resource_uri=$1',
                    [uri],
                )
            ).rows,
        ).toEqual([]);
    });
});
