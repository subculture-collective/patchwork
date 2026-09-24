import { resourceProfileSchema } from '@patchwork/shared';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';
const receipt = z.string().regex(/^[a-f0-9]{64}$/);
const publicUrl = z
    .string()
    .url()
    .max(2000)
    .refine((value) => /^https?:\/\//.test(value));
const submission = z
    .object({
        receipt,
        resourceUri: z.string().max(500),
        category: z.enum(['contact', 'hours', 'access', 'closure', 'other']),
        explanation: z.string().trim().min(10).max(2000),
        sourceUrl: publicUrl.optional(),
    })
    .strict();
const hash = (value: string) =>
    createHash('sha256').update(value).digest('hex');
const fail = (status: number, code: string, message: string): never => {
    throw new PublicHttpError(status, code, message);
};
const statusFields =
    'id,resource_uri,category,explanation,source_url,status,revision,response,submitted_at,updated_at';
export class ResourceCorrectionService {
    constructor(private readonly pool: Pool) {}
    private async reviewer(client: PoolClient, did: string) {
        const found = await client.query(
            "SELECT 1 FROM platform_roles WHERE did=$1 AND role IN ('moderator','admin','super_admin')",
            [did],
        );
        if (!found.rowCount)
            fail(403, 'REVIEWER_REQUIRED', 'A listing reviewer is required.');
    }
    async submit(body: unknown, did?: string) {
        const input = submission.parse(body);
        const { receipt: secret, ...content } = input;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            if (did) {
                await client.query(
                    "SELECT pg_advisory_xact_lock(hashtext('account:' || $1))",
                    [hash(did)],
                );
                const disabled = await client.query(
                    'SELECT 1 FROM account_deactivations WHERE did_hash=$1',
                    [hash(did)],
                );
                if (disabled.rowCount)
                    fail(
                        403,
                        'ACCOUNT_DEACTIVATED',
                        'This account is deactivated.',
                    );
            }
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
                hash(secret),
            ]);
            const previous = await client.query(
                'SELECT id,submission_hash FROM resource_corrections WHERE receipt_hash=$1',
                [hash(secret)],
            );
            if (previous.rowCount) {
                if (
                    previous.rows[0].submission_hash !==
                    hash(JSON.stringify(content))
                )
                    fail(
                        409,
                        'SUBMISSION_CONFLICT',
                        'This receipt already belongs to a different correction.',
                    );
                await client.query('COMMIT');
                return { id: previous.rows[0].id };
            }
            const listing = await client.query(
                'SELECT 1 FROM public_resource_listings WHERE resource_uri=$1 AND listed',
                [input.resourceUri],
            );
            if (!listing.rowCount)
                fail(
                    404,
                    'RESOURCE_NOT_FOUND',
                    'This public listing is unavailable.',
                );
            const result = await client.query(
                `INSERT INTO resource_corrections(resource_uri,reporter_did,receipt_hash,submission_hash,category,explanation,source_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
                [
                    input.resourceUri,
                    did ?? null,
                    hash(secret),
                    hash(JSON.stringify(content)),
                    input.category,
                    input.explanation,
                    input.sourceUrl ?? null,
                ],
            );
            await client.query(
                "INSERT INTO resource_correction_events(correction_id,actor_did,revision,action,details) VALUES($1,$2,1,'submitted',$3)",
                [result.rows[0].id, did ?? null, JSON.stringify(content)],
            );
            await client.query('COMMIT');
            return { id: result.rows[0].id };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    async retain(now = new Date()) {
        await this.pool.query(
            'DELETE FROM resource_corrections WHERE retention_until<=$1',
            [now],
        );
    }
    async status(body: unknown) {
        const input = z.object({ receipt }).strict().parse(body);
        const result = await this.pool.query(
            `SELECT ${statusFields} FROM resource_corrections WHERE receipt_hash=$1 AND retention_until>NOW()`,
            [hash(input.receipt)],
        );
        if (!result.rowCount)
            fail(
                404,
                'RECEIPT_NOT_FOUND',
                'This receipt is unavailable or expired.',
            );
        return { correction: result.rows[0] };
    }
    async list(did: string, review: boolean, page: number) {
        const client = await this.pool.connect();
        try {
            if (review) await this.reviewer(client, did);
            const where = review
                ? "status IN ('pending','needs-information')"
                : 'reporter_did=$1';
            const result = await client.query(
                `SELECT ${statusFields},count(*) OVER()::integer AS total FROM resource_corrections WHERE retention_until>NOW() AND ${where} ORDER BY submitted_at,id LIMIT 50 OFFSET $${review ? 1 : 2}`,
                review ? [(page - 1) * 50] : [did, (page - 1) * 50],
            );
            return {
                items: result.rows,
                page,
                hasNextPage:
                    result.rows.length > 0 && page * 50 < result.rows[0].total,
            };
        } finally {
            client.release();
        }
    }
    async respond(body: unknown, did?: string) {
        const input = z
            .object({
                receipt: receipt.optional(),
                id: z.string().uuid().optional(),
                revision: z.number().int().positive(),
                explanation: z.string().trim().min(10).max(2000),
                sourceUrl: publicUrl.optional(),
            })
            .strict()
            .refine((input) => Boolean(input.receipt || (input.id && did)))
            .parse(body);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const found = await client.query(
                'SELECT * FROM resource_corrections WHERE (receipt_hash=$1 OR (id=$2 AND reporter_did=$3)) AND retention_until>NOW() FOR UPDATE',
                [
                    input.receipt ? hash(input.receipt) : null,
                    input.id ?? null,
                    did ?? null,
                ],
            );
            const row = found.rows[0];
            if (!row)
                fail(
                    404,
                    'RECEIPT_NOT_FOUND',
                    'This receipt is unavailable or expired.',
                );
            if (
                row.revision !== input.revision ||
                row.status !== 'needs-information'
            )
                fail(
                    409,
                    'CORRECTION_CHANGED',
                    'Reload the correction status before responding.',
                );
            await client.query(
                `UPDATE resource_corrections SET explanation=$2,source_url=$3,status='pending',revision=revision+1,updated_at=NOW() WHERE id=$1`,
                [row.id, input.explanation, input.sourceUrl ?? null],
            );
            await client.query(
                `INSERT INTO resource_correction_events(correction_id,revision,action,details) VALUES($1,$2,'responded',$3)`,
                [
                    row.id,
                    row.revision + 1,
                    JSON.stringify({
                        explanation: input.explanation,
                        sourceUrl: input.sourceUrl,
                    }),
                ],
            );
            await client.query('COMMIT');
            return { updated: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
    async decide(did: string, body: unknown) {
        const patchSchema = z
            .object({
                name: z.string().trim().min(1).max(120).optional(),
                openHours: z.string().trim().min(1).max(200).optional(),
                eligibilityNotes: z.string().trim().min(1).max(500).optional(),
                contact: z
                    .object({
                        url: publicUrl,
                        phone: z.string().max(32).optional(),
                    })
                    .strict()
                    .optional(),
            })
            .strict()
            .refine((p) => Object.keys(p).length > 0);
        const input = z
            .object({
                id: z.string().uuid(),
                revision: z.number().int().positive(),
                action: z.enum([
                    'applied',
                    'denied',
                    'duplicate',
                    'needs-information',
                ]),
                response: z.string().trim().min(10).max(2000),
                expectedUpdatedAt: z.string().datetime().optional(),
                sourceUrl: publicUrl.optional(),
                patch: patchSchema.optional(),
            })
            .strict()
            .parse(body);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.reviewer(client, did);
            const found = await client.query(
                'SELECT * FROM resource_corrections WHERE id=$1 AND retention_until>NOW() FOR UPDATE',
                [input.id],
            );
            const row = found.rows[0];
            if (!row)
                fail(
                    404,
                    'CORRECTION_NOT_FOUND',
                    'This correction is unavailable.',
                );
            if (row.reporter_did === did)
                fail(
                    403,
                    'INDEPENDENT_REVIEW_REQUIRED',
                    'Another reviewer must decide your correction.',
                );
            const affiliation = await client.query(
                `SELECT 1 FROM public_resource_listings l JOIN organization_memberships m ON m.organization_id=l.claimed_by_organization_id WHERE l.resource_uri=$1 AND m.member_did=$2 AND m.status='active'`,
                [row.resource_uri, did],
            );
            if (affiliation.rowCount)
                fail(
                    403,
                    'INDEPENDENT_REVIEW_REQUIRED',
                    'A reviewer outside this organization must decide.',
                );
            if (
                row.revision !== input.revision ||
                !['pending', 'needs-information'].includes(row.status)
            )
                fail(
                    409,
                    'CORRECTION_CHANGED',
                    'This correction changed. Reload it before deciding.',
                );
            if (input.action === 'applied') {
                if (
                    !input.patch ||
                    !input.expectedUpdatedAt ||
                    !input.sourceUrl
                )
                    fail(
                        400,
                        'CORRECTION_EVIDENCE_REQUIRED',
                        'A verified source, current listing revision and correction are required.',
                    );
                const current = await client.query(
                    'SELECT * FROM indexer_directory_resource_projections WHERE uri=$1 FOR UPDATE',
                    [row.resource_uri],
                );
                const old = current.rows[0];
                if (
                    !old ||
                    old.record_updated_at.toISOString() !==
                        input.expectedUpdatedAt
                )
                    fail(
                        409,
                        'RESOURCE_REVISION_CONFLICT',
                        'The listing changed. Reload it before applying.',
                    );
                const patch = input.patch!;
                // A reviewed correction to legacy notes must not leave contradictory
                // structured schedules or requirements driving matching.
                if (
                    patch.openHours !== undefined ||
                    patch.eligibilityNotes !== undefined ||
                    row.category === 'closure'
                ) {
                    const saved = await client.query(
                        'SELECT profile FROM resource_service_profiles WHERE resource_uri=$1 FOR UPDATE',
                        [row.resource_uri],
                    );
                    if (saved.rowCount) {
                        const profile = resourceProfileSchema.parse(
                            saved.rows[0].profile,
                        );
                        for (const service of profile.services) {
                            if (
                                service.hours &&
                                (patch.openHours !== undefined ||
                                    row.category === 'closure')
                            )
                                service.hours.evidence.reviewStatus =
                                    'conflicting';
                            if (patch.eligibilityNotes !== undefined) {
                                for (const rule of service.eligibility)
                                    rule.evidence.reviewStatus = 'conflicting';
                            }
                        }
                        await client.query(
                            'UPDATE resource_service_profiles SET profile=$2,revision=revision+1,updated_at=NOW() WHERE resource_uri=$1',
                            [row.resource_uri, JSON.stringify(profile)],
                        );
                    }
                }

                await client.query(
                    `UPDATE indexer_directory_resource_projections SET name=$2,open_hours=$3,eligibility_notes=$4,contact=$5,searchable_text=lower($2||' '||coalesce($4,'')),record_updated_at=greatest(NOW(),record_updated_at+INTERVAL '1 millisecond') WHERE uri=$1`,
                    [
                        row.resource_uri,
                        patch.name ?? old.name,
                        patch.openHours ?? old.open_hours,
                        patch.eligibilityNotes ?? old.eligibility_notes,
                        JSON.stringify(patch.contact ?? old.contact),
                    ],
                );
                await client.query(
                    "INSERT INTO public_resource_audit_events(resource_uri,actor_did,action,details) VALUES($1,$2,'listing-edited',$3)",
                    [
                        row.resource_uri,
                        did,
                        JSON.stringify({
                            correctionId: row.id,
                            sourceUrl: input.sourceUrl,
                            patch,
                            before: {
                                name: old.name,
                                openHours: old.open_hours,
                                eligibilityNotes: old.eligibility_notes,
                                contact: old.contact,
                            },
                        }),
                    ],
                );
            } else if (input.patch)
                fail(
                    400,
                    'UNEXPECTED_CORRECTION',
                    'Only an applied correction may change a listing.',
                );
            await client.query(
                'UPDATE resource_corrections SET status=$2,response=$3,revision=revision+1,updated_at=NOW() WHERE id=$1',
                [row.id, input.action, input.response],
            );
            await client.query(
                'INSERT INTO resource_correction_events(correction_id,actor_did,revision,action,details) VALUES($1,$2,$3,$4,$5)',
                [
                    row.id,
                    did,
                    row.revision + 1,
                    input.action,
                    JSON.stringify({
                        response: input.response,
                        sourceUrl: input.sourceUrl,
                        patch: input.patch,
                    }),
                ],
            );
            await client.query('COMMIT');
            return { updated: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
