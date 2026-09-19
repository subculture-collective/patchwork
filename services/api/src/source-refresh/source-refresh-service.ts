import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { publicResourceSchema, publicResourceSourceSchema } from '../db/public-resource-catalog.js';
import { hashRefreshValue } from '../db/public-resource-refresh.js';
import { PublicHttpError } from '../http/error-response.js';

const sourceIdSchema = z.string().regex(/^[a-z0-9-]{1,80}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
    version: z.literal(1), publisher: z.string().min(1).max(200), datasetId: z.string().min(1).max(100),
    requestUrl: z.string().url(), responseUrl: z.string().url(), retrievedAt: z.string().datetime(),
    contentType: z.literal('application/json'), etag: z.string().max(1000).nullable(),
    lastModified: z.string().max(1000).nullable(), rawSha256: sha, rawBytes: z.number().int().positive().max(1_000_000),
    rowCount: z.number().int().positive(), normalizedSha256: sha,
}).strict();
const baseSchema = z.object({
    recordUpdatedAt: z.string().min(1), listingUpdatedAt: z.string().min(1),
    profileRevision: z.number().int().positive().nullable(), snapshotSha256: sha,
}).strict();
const dispositionSchema = z.enum(['unchanged','contact-automation-candidate','review','new-listing-review','missing-review']);
const candidateSchema = z.object({
    resourceUri: z.string().min(1).max(500), disposition: dispositionSchema,
    fields: z.array(z.string().min(1).max(80)).max(30), reasons: z.array(z.string().min(1).max(100)).max(30),
    before: publicResourceSchema.nullable(), after: publicResourceSchema,
    evidence: publicResourceSourceSchema, base: baseSchema.nullable(),
}).strict();
const missingSchema = z.object({
    resourceUri: z.string().min(1).max(500), disposition: z.literal('missing-review'),
    reasons: z.array(z.string().min(1).max(100)).min(1).max(30),
}).strict();
const previewSchema = z.object({
    version: z.literal(1), mode: z.literal('preview-only'), generatedAt: z.string().datetime(), catalogSha256: sha,
    counts: z.record(z.number().int().nonnegative()), candidates: z.array(candidateSchema), missing: z.array(missingSchema),
}).strict();

export class SourceRefreshError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new SourceRefreshError(code, message); };
const contact = (resource: z.infer<typeof publicResourceSchema>) => ({
    url: resource.website, ...(resource.phone ? { phone: resource.phone } : {}),
});
const iso = (value: string | Date) => new Date(value).toISOString();

export class SourceRefreshService {
    constructor(private readonly pool: Pool) {}

    private async requireReviewer(client: PoolClient, did: string) {
        const reviewer = await client.query(
            "SELECT 1 FROM platform_roles WHERE did=$1 AND role IN ('moderator','admin','super_admin')",
            [did],
        );
        if (!reviewer.rowCount) {
            throw new PublicHttpError(403, 'REVIEWER_REQUIRED', 'A listing reviewer is required.');
        }
    }

    private async requireIndependentReviewer(client: PoolClient, resourceUri: string, did: string) {
        const affiliation = await client.query(
            `SELECT 1 FROM public_resource_listings l
             JOIN organization_memberships m ON m.organization_id=l.claimed_by_organization_id
             WHERE l.resource_uri=$1 AND m.member_did=$2 AND m.status='active'`,
            [resourceUri, did],
        );
        if (affiliation.rowCount) {
            throw new PublicHttpError(403, 'INDEPENDENT_REVIEW_REQUIRED', 'A reviewer outside this organization must decide.');
        }
    }

    async listCandidates(did: string, page: number, status: 'pending' | 'resolved' = 'pending') {
        const client = await this.pool.connect();
        try {
            await this.requireReviewer(client, did);
            const statuses = status === 'pending' ? ['pending'] : ['applied', 'dismissed', 'superseded'];
            const result = await client.query(
                `SELECT c.candidate_id,c.run_id,c.resource_uri,c.disposition,c.changed_fields,c.reasons,
                    c.before_value,c.after_value,c.evidence,c.status,c.decision_details,c.created_at,c.updated_at,c.applied_at,
                    r.source_id,r.raw_sha256,r.normalized_sha256,r.retrieved_at,
                    count(*) OVER()::integer AS total
                 FROM source_refresh_candidates c JOIN source_refresh_runs r USING(run_id)
                 WHERE c.status=ANY($1::text[])
                 ORDER BY c.created_at,c.candidate_id LIMIT 50 OFFSET $2`,
                [statuses, (page - 1) * 50],
            );
            return {
                items: result.rows.map(row => ({
                    candidateId: row.candidate_id, runId: row.run_id, resourceUri: row.resource_uri,
                    disposition: row.disposition, changedFields: row.changed_fields, reasons: row.reasons,
                    before: row.before_value, after: row.after_value, evidence: row.evidence,
                    status: row.status, decisionDetails: row.decision_details,
                    sourceId: row.source_id, rawSha256: row.raw_sha256, normalizedSha256: row.normalized_sha256,
                    retrievedAt: iso(row.retrieved_at), createdAt: iso(row.created_at),
                    updatedAt: iso(row.updated_at), appliedAt: row.applied_at ? iso(row.applied_at) : null,
                })),
                page,
                hasNextPage: result.rows.length > 0 && page * 50 < result.rows[0].total,
            };
        } finally { client.release(); }
    }

    async dismissCandidate(did: string, body: unknown) {
        const input = z.object({
            candidateId: z.string().uuid(), expectedUpdatedAt: z.string().datetime(),
            reason: z.string().trim().min(10).max(2000),
        }).strict().parse(body);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.requireReviewer(client, did);
            const selected = await client.query(
                'SELECT * FROM source_refresh_candidates WHERE candidate_id=$1 FOR UPDATE',
                [input.candidateId],
            );
            const candidate = selected.rows[0];
            if (!candidate) throw new PublicHttpError(404, 'REFRESH_CANDIDATE_NOT_FOUND', 'The source-refresh candidate was not found.');
            await this.requireIndependentReviewer(client, candidate.resource_uri, did);
            if (candidate.status !== 'pending' || iso(candidate.updated_at) !== iso(input.expectedUpdatedAt)) {
                throw new PublicHttpError(409, 'REFRESH_CANDIDATE_CHANGED', 'This candidate changed. Reload it before deciding.');
            }
            await client.query(
                `UPDATE source_refresh_candidates SET status='dismissed',decision_details=$2,updated_at=NOW()
                 WHERE candidate_id=$1`,
                [input.candidateId, JSON.stringify({ action: 'dismissed', reason: input.reason, reviewerDid: did })],
            );
            await client.query('COMMIT');
            return { updated: true };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async persistPreview(sourceIdValue: string, manifestValue: unknown, previewValue: unknown) {
        const sourceId = sourceIdSchema.parse(sourceIdValue);
        const manifest = manifestSchema.parse(manifestValue);
        const preview = previewSchema.parse(previewValue);
        const candidates = [
            ...preview.candidates.filter(candidate => candidate.disposition !== 'unchanged'),
            ...preview.missing.map(candidate => ({ ...candidate, fields: [], before: null, after: null, evidence: null, base: null })),
        ];
        if (new Set(candidates.map(candidate => candidate.resourceUri)).size !== candidates.length) {
            fail('DUPLICATE_REFRESH_CANDIDATE', 'A refresh preview contains duplicate resource candidates.');
        }
        for (const candidate of candidates) {
            if (candidate.evidence && (candidate.evidence.sha256 !== manifest.rawSha256
                || candidate.after?.sourceId !== sourceId)) {
                fail('REFRESH_EVIDENCE_MISMATCH', 'A refresh candidate does not match its retained publisher evidence.');
            }
        }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SELECT pg_advisory_xact_lock(hashtext('source-refresh:' || $1 || ':' || $2))", [sourceId, manifest.rawSha256]);
            const previous = await client.query('SELECT run_id,normalized_sha256,candidate_count FROM source_refresh_runs WHERE source_id=$1 AND raw_sha256=$2', [sourceId,manifest.rawSha256]);
            if (previous.rowCount) {
                if (previous.rows[0].normalized_sha256 !== manifest.normalizedSha256) {
                    fail('REFRESH_REPLAY_MISMATCH', 'The same raw evidence produced a different normalized catalog.');
                }
                await client.query('COMMIT');
                return { runId: previous.rows[0].run_id as string, candidates: previous.rows[0].candidate_count as number, replayed: true };
            }
            const run = await client.query<{run_id:string}>(`INSERT INTO source_refresh_runs
                (source_id,raw_sha256,normalized_sha256,catalog_sha256,retrieved_at,evidence,preview,candidate_count)
                VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING run_id`,
            [sourceId,manifest.rawSha256,manifest.normalizedSha256,preview.catalogSha256,manifest.retrievedAt,
                JSON.stringify(manifest),JSON.stringify(preview),candidates.length]);
            const runId = run.rows[0]!.run_id;
            for (const candidate of candidates) {
                const inserted = await client.query<{candidate_id:string}>(`INSERT INTO source_refresh_candidates
                    (run_id,resource_uri,disposition,changed_fields,reasons,before_value,after_value,evidence,base_revision,candidate_sha256)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING candidate_id`,
                [runId,candidate.resourceUri,candidate.disposition,candidate.fields,candidate.reasons,
                    candidate.before ? JSON.stringify(candidate.before) : null,
                    candidate.after ? JSON.stringify(candidate.after) : null,
                    candidate.evidence ? JSON.stringify(candidate.evidence) : null,
                    candidate.base ? JSON.stringify(candidate.base) : null,hashRefreshValue(candidate)]);
                const candidateId = inserted.rows[0]!.candidate_id;
                await client.query(
                    `UPDATE source_refresh_candidates SET status='superseded',updated_at=NOW(),
                        decision_details=jsonb_build_object('action','superseded','supersededBy',$2::text)
                     WHERE resource_uri=$1 AND candidate_id<>$2 AND status='pending'`,
                    [candidate.resourceUri, candidateId],
                );
            }
            await client.query('COMMIT');
            return { runId, candidates: candidates.length, replayed: false };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }

    async applyContactCandidate(candidateId: string, reviewerDid?: string) {
        const id = z.string().uuid().parse(candidateId);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const selected = await client.query(`SELECT c.*,r.source_id,r.raw_sha256,r.retrieved_at
                FROM source_refresh_candidates c JOIN source_refresh_runs r USING(run_id)
                WHERE c.candidate_id=$1 FOR UPDATE OF c`,[id]);
            const candidate = selected.rows[0];
            if (!candidate) fail('REFRESH_CANDIDATE_NOT_FOUND','The source-refresh candidate was not found.');
            if (reviewerDid) {
                await this.requireReviewer(client, reviewerDid);
                await this.requireIndependentReviewer(client, candidate.resource_uri, reviewerDid);
            }
            if (candidate.status !== 'pending' || candidate.disposition !== 'contact-automation-candidate') {
                fail('REFRESH_CANDIDATE_NOT_APPLICABLE','Only a pending contact automation candidate may be applied.');
            }
            await client.query("SELECT pg_advisory_xact_lock(hashtext('source-refresh-resource:' || $1))",[candidate.resource_uri]);
            const listingResult = await client.query('SELECT * FROM public_resource_listings WHERE resource_uri=$1 FOR UPDATE',[candidate.resource_uri]);
            const projectionResult = await client.query('SELECT * FROM indexer_directory_resource_projections WHERE uri=$1 FOR UPDATE',[candidate.resource_uri]);
            const listing = listingResult.rows[0], projection = projectionResult.rows[0];
            if (!listing || !projection) fail('REFRESH_RESOURCE_MISSING','The source listing is no longer available.');
            const before = publicResourceSchema.parse(candidate.before_value);
            const after = publicResourceSchema.parse(candidate.after_value);
            const evidence = publicResourceSourceSchema.parse(candidate.evidence);
            const base = baseSchema.parse(candidate.base_revision);
            const changedFields = Object.keys(after).filter(key =>
                !isDeepStrictEqual(after[key as keyof typeof after],before[key as keyof typeof before])).sort();
            if (changedFields.length === 0 || changedFields.some(field => field !== 'phone' && field !== 'website')
                || candidate.reasons.length !== 0 || !isDeepStrictEqual(changedFields,[...candidate.changed_fields].sort())) {
                fail('REFRESH_CONTACT_SCOPE_CHANGED','The candidate is no longer limited to its validated contact fields.');
            }
            if (before.phone && !after.phone) fail('REFRESH_CONTACT_SCOPE_CHANGED','Source automation cannot remove contact data.');
            if (after.phone && (!/^\+?[\d ().-]{7,30}$/.test(after.phone)
                || !/^\d{7,15}$/.test(after.phone.replace(/\D/g,'')))) {
                fail('REFRESH_CONTACT_SCOPE_CHANGED','The candidate phone number is not eligible for source automation.');
            }
            if (changedFields.includes('website')) {
                const previousUrl = new URL(before.website), nextUrl = new URL(after.website);
                if (nextUrl.protocol !== 'https:' || nextUrl.username || nextUrl.password
                    || nextUrl.hostname !== previousUrl.hostname) {
                    fail('REFRESH_CONTACT_SCOPE_CHANGED','The candidate website is not eligible for source automation.');
                }
            }
            if (before.sourceId !== candidate.source_id || after.sourceId !== candidate.source_id
                || evidence.sha256 !== candidate.raw_sha256) {
                fail('REFRESH_EVIDENCE_MISMATCH','The candidate evidence no longer matches its source run.');
            }
            const evidenceTime = Date.parse(evidence.retrievedAt), runTime = new Date(candidate.retrieved_at).getTime();
            if (evidenceTime > runTime || evidenceTime + 90*86400000 <= runTime || evidence.url !== listing.source_url) {
                fail('REFRESH_EVIDENCE_MISMATCH','The candidate publisher evidence is stale or does not match the listing source.');
            }
            if (projection.record_origin !== 'sourced-public' || !listing.listed || listing.claimed_by_organization_id) {
                fail('REFRESH_OWNERSHIP_CONFLICT','The listing is no longer eligible for source automation.');
            }
            if (iso(projection.record_updated_at) !== iso(base.recordUpdatedAt)
                || iso(listing.updated_at) !== iso(base.listingUpdatedAt)
                || hashRefreshValue(listing.source_snapshot) !== base.snapshotSha256) {
                fail('REFRESH_REVISION_CONFLICT','The listing changed after the refresh preview.');
            }
            const profile = await client.query('SELECT revision FROM resource_service_profiles WHERE resource_uri=$1 FOR UPDATE',[candidate.resource_uri]);
            if ((profile.rows[0]?.revision ?? null) !== base.profileRevision) {
                fail('REFRESH_PROFILE_CONFLICT','Reviewed service evidence changed after the refresh preview.');
            }
            const correction = await client.query("SELECT 1 FROM resource_corrections WHERE resource_uri=$1 AND status IN ('pending','needs-information') LIMIT 1",[candidate.resource_uri]);
            if (correction.rowCount) fail('REFRESH_CORRECTION_CONFLICT','A listing correction requires review before source automation.');
            if (!isDeepStrictEqual(projection.contact,contact(before))) {
                fail('REFRESH_CONTACT_CONFLICT','Current contact data differs from the candidate baseline.');
            }
            const nextContact = contact(after);
            await client.query(`UPDATE indexer_directory_resource_projections SET contact=$2,
                record_updated_at=greatest(NOW(),record_updated_at+INTERVAL '1 millisecond') WHERE uri=$1`,
            [candidate.resource_uri,JSON.stringify(nextContact)]);
            const details = { candidateId:id, runId:candidate.run_id, sourceId:candidate.source_id,
                rawSha256:candidate.raw_sha256, sourceUrl:evidence.url, changedFields, before:contact(before), after:nextContact };
            await client.query(`UPDATE source_refresh_candidates SET status='applied',decision_details=$2,
                applied_at=NOW(),updated_at=NOW() WHERE candidate_id=$1`,[id,JSON.stringify(details)]);
            await client.query(`UPDATE source_refresh_candidates SET status='superseded',updated_at=NOW(),
                decision_details=jsonb_build_object('supersededBy',$2::text)
                WHERE resource_uri=$1 AND candidate_id<>$2 AND status='pending' AND disposition='contact-automation-candidate'`,
            [candidate.resource_uri,id]);
            await client.query("INSERT INTO public_resource_audit_events(resource_uri,actor_did,action,details) VALUES($1,$2,'source-refresh-contact-applied',$3)",
                [candidate.resource_uri,reviewerDid ?? null,JSON.stringify(details)]);
            await client.query('COMMIT');
            return { candidateId:id, resourceUri:candidate.resource_uri as string, contact:nextContact, applied:true };
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
    }
}
