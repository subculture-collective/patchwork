import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runModerationMigrations } from './migrate.js';
import {
    SubmissionSafetyService,
    type SubmissionAutomationProvider,
} from './submission-safety-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const acceptedRecord = {
    $type: 'app.patchwork.aid.post',
    title: 'Meal delivery',
    description: 'Shelf-stable food is needed this evening.',
    category: 'food',
    location: {
        latitude: 41.88,
        longitude: -87.63,
        precisionKm: 2,
    },
    createdAt: '2026-07-28T12:00:00.000Z',
};

const submission = (
    suffix: string,
    record: Record<string, unknown> = acceptedRecord,
) => ({
    actorDid: 'did:plc:alice',
    subjectUri: `at://did:plc:alice/app.patchwork.aid.post/${suffix}`,
    submissionType: 'aid-post' as const,
    operation: 'create' as const,
    record,
    attachmentIds: [] as string[],
    idempotencyKey: `safety-${suffix}`,
});

describe('SubmissionSafetyService', () => {
    const schema = `submission_safety_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema}`,
    });
    const service = new SubmissionSafetyService(pool);

    beforeAll(async () => {
        await adminPool.query(`CREATE SCHEMA ${schema}`);
        await runModerationMigrations({ pool });
        await pool.query(`
            CREATE TABLE private_attachments (
                attachment_id UUID PRIMARY KEY,
                owner_did TEXT NOT NULL,
                status TEXT NOT NULL
            )
        `);
    });

    afterAll(async () => {
        await pool.end();
        await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);
        await adminPool.end();
    });

    it('accepts eligible content and replays the durable decision without storing raw text', async () => {
        const input = submission('accepted');
        const first = await service.review(input);
        const replay = await new SubmissionSafetyService(pool).review(input);

        expect(first).toMatchObject({
            decision: 'accepted',
            userReasonCode: 'SUBMISSION_ACCEPTED',
            providerVersion: 'deterministic-safety-v1',
        });
        expect(replay).toEqual(first);

        const stored = await pool.query<{
            content_hash: string;
            raw_present: boolean;
            retention_until: Date;
        }>(
            `SELECT content_hash,
                    to_jsonb(review)::text LIKE '%Shelf-stable%' AS raw_present,
                    retention_until
               FROM moderation_submission_reviews review
              WHERE idempotency_key = $1`,
            [input.idempotencyKey],
        );
        expect(stored.rows[0]?.content_hash).toMatch(/^[a-f0-9]{64}$/u);
        expect(stored.rows[0]?.raw_present).toBe(false);
        expect(stored.rows[0]?.retention_until).toBeInstanceOf(Date);
    });

    it.each([
        [
            'outside-us',
            {
                ...acceptedRecord,
                location: { latitude: 48.85, longitude: 2.35, precisionKm: 2 },
            },
            'US_LOCATION_REQUIRED',
        ],
        [
            'precise',
            {
                ...acceptedRecord,
                location: { latitude: 41.88, longitude: -87.63, precisionKm: 0.2 },
            },
            'APPROXIMATE_LOCATION_REQUIRED',
        ],
        [
            'schema',
            { description: 'missing public fields' },
            'SUBMISSION_INVALID',
        ],
    ])('rejects %s submissions before publication', async (suffix, record, code) => {
        await expect(service.review(submission(suffix, record))).resolves.toMatchObject({
            decision: 'rejected',
            userReasonCode: code,
        });
    });

    it('quarantines sensitive and emergency submissions with safe previews and urgent delivery events', async () => {
        const sensitive = await service.review(submission('sensitive', {
            ...acceptedRecord,
            description: 'Please email resident@example.org about the pantry.',
        }));
        const urgentInput = submission('urgent', {
            ...acceptedRecord,
            description: 'Call 911 because there is immediate danger.',
        });
        const urgent = await service.review(urgentInput);

        expect(sensitive).toMatchObject({
            decision: 'quarantined',
            priority: 'high',
            userReasonCode: 'SENSITIVE_DATA_REVIEW',
        });
        expect(urgent).toMatchObject({
            decision: 'quarantined',
            priority: 'urgent',
            userReasonCode: 'EMERGENCY_INTENT_REVIEW',
        });

        const queue = await pool.query<{
            visibility: string;
            priority: string;
            safe_preview: Record<string, string>;
        }>(
            `SELECT visibility, priority, safe_preview
               FROM moderation_queue_items WHERE subject_uri = $1`,
            [urgentInput.subjectUri],
        );
        expect(queue.rows[0]).toMatchObject({
            visibility: 'suspended',
            priority: 'urgent',
            safe_preview: { label: 'Meal delivery' },
        });
        const event = await pool.query(
            `SELECT 1 FROM moderation_notification_events
              WHERE subject_uri = $1 AND consumed_at IS NULL`,
            [urgentInput.subjectUri],
        );
        expect(event.rowCount).toBe(1);
    });

    it('holds missing, foreign, and unscanned private attachments', async () => {
        const dirtyId = randomUUID();
        await pool.query(
            `INSERT INTO private_attachments (attachment_id, owner_did, status)
             VALUES ($1, 'did:plc:alice', 'quarantined')`,
            [dirtyId],
        );
        const input = submission('attachment');
        input.attachmentIds = [dirtyId];

        await expect(service.review(input)).resolves.toMatchObject({
            decision: 'quarantined',
            userReasonCode: 'ATTACHMENT_REVIEW_REQUIRED',
        });
    });

    it('fails closed without persisting a decision when an automation provider fails', async () => {
        const provider: SubmissionAutomationProvider = {
            version: 'failing-provider',
            evaluate: async () => {
                throw new Error('provider unavailable');
            },
        };
        const input = submission('provider-failure');
        await expect(
            new SubmissionSafetyService(pool, provider).review(input),
        ).rejects.toThrow('provider unavailable');
        const stored = await pool.query(
            `SELECT 1 FROM moderation_submission_reviews
              WHERE idempotency_key = $1`,
            [input.idempotencyKey],
        );
        expect(stored.rowCount).toBe(0);
    });
});
