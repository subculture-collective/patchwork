import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { PublicHttpError } from './http/error-response.js';

const claimSchema = z.object({ resourceUri: z.string().max(500), organizationId: z.string().uuid(), evidence: z.string().trim().min(20).max(2000) }).strict();
const decisionSchema = z.object({ claimId: z.string().uuid(), action: z.enum(['approve','deny','revoke']), reason: z.string().trim().min(10).max(2000) }).strict();
const editSchema = z.object({ resourceUri: z.string().max(500), name: z.string().trim().min(1).max(120), openHours: z.string().trim().min(1).max(200), eligibilityNotes: z.string().trim().min(1).max(500), contact: z.object({ url: z.string().url().refine(url => /^https?:/.test(url)), phone: z.string().max(32).optional() }).strict() }).strict();
const fail = (status: number, code: string, message: string): never => { throw new PublicHttpError(status,code,message); };

export class PublicResourceClaimService {
    constructor(private readonly pool: Pool) {}
    private async requireManager(client: PoolClient, organizationId: string, did: string) {
        const membership = await client.query(`SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND member_did=$2 AND status='active' AND role IN('owner','admin')`,[organizationId,did]);
        if (!membership.rowCount) fail(403,'ORGANIZATION_MANAGER_REQUIRED','An organization owner or admin must submit and manage this claim.');
    }
    private async requireReviewer(client: PoolClient, did: string) {
        const role = await client.query("SELECT 1 FROM platform_roles WHERE did=$1 AND role IN('moderator','admin','super_admin')",[did]);
        if (!role.rowCount) fail(403,'REVIEWER_REQUIRED','A resource claim reviewer is required.');
    }
    async list(actorDid: string) {
        const reviewer = await this.pool.query("SELECT 1 FROM platform_roles WHERE did=$1 AND role IN('moderator','admin','super_admin')",[actorDid]);
        const rows = await this.pool.query(`SELECT c.*, o.name AS organization_name, EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=c.organization_id AND m.member_did=$1 AND m.status='active' AND m.role IN('owner','admin')) AS can_edit FROM public_resource_claims c JOIN organizations o USING(organization_id)
            WHERE ($2::boolean OR c.applicant_did=$1) ORDER BY c.submitted_at DESC LIMIT 200`,[actorDid,Boolean(reviewer.rowCount)]);
        return { claims: rows.rows, reviewer: Boolean(reviewer.rowCount) };
    }
    async submit(actorDid: string, input: unknown) {
        const parsed = claimSchema.parse(input);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.requireManager(client,parsed.organizationId,actorDid);
            const listing = await client.query('SELECT * FROM public_resource_listings WHERE resource_uri=$1 FOR UPDATE',[parsed.resourceUri]);
            if (!listing.rowCount) fail(404,'PUBLIC_LISTING_NOT_FOUND','This resource is not an imported public listing.');
            if (listing.rows[0].claimed_by_organization_id) fail(409,'RESOURCE_ALREADY_CLAIMED','This listing is already claimed. Contact a reviewer to dispute ownership.');
            const existing = await client.query("SELECT claim_id FROM public_resource_claims WHERE resource_uri=$1 AND organization_id=$2 AND status='pending'",[parsed.resourceUri,parsed.organizationId]);
            if (existing.rowCount) fail(409,'CLAIM_PENDING','Your organization already has a pending claim.');
            const id = randomUUID();
            await client.query("INSERT INTO public_resource_claims(claim_id,resource_uri,organization_id,applicant_did,evidence,status) VALUES($1,$2,$3,$4,$5,'pending')",[id,parsed.resourceUri,parsed.organizationId,actorDid,parsed.evidence]);
            await client.query("INSERT INTO public_resource_audit_events(resource_uri,actor_did,action,details) VALUES($1,$2,'claim-submitted',$3)",[parsed.resourceUri,actorDid,JSON.stringify({claimId:id,organizationId:parsed.organizationId})]);
            await client.query('COMMIT');
            return { claimId:id, status:'pending' };
        } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    async decide(actorDid: string, input: unknown) {
        const parsed = decisionSchema.parse(input);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.requireReviewer(client,actorDid);
            const reference = await client.query('SELECT resource_uri FROM public_resource_claims WHERE claim_id=$1',[parsed.claimId]);
            if (!reference.rowCount) fail(404,'CLAIM_NOT_FOUND','The claim was not found.');
            // Every mutation locks the listing first, including competing claims.
            const listing = await client.query('SELECT * FROM public_resource_listings WHERE resource_uri=$1 FOR UPDATE',[reference.rows[0].resource_uri]);
            const result = await client.query('SELECT * FROM public_resource_claims WHERE claim_id=$1 FOR UPDATE',[parsed.claimId]);
            const claim = result.rows[0]!;
            const affiliation = await client.query("SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND member_did=$2 AND status='active'",[claim.organization_id,actorDid]);
            if (claim.applicant_did===actorDid || affiliation.rowCount) fail(403,'INDEPENDENT_REVIEW_REQUIRED','A reviewer outside the claiming organization must decide this claim.');
            if (parsed.action==='revoke' ? claim.status!=='approved' : claim.status!=='pending') fail(409,'CLAIM_STATE_CONFLICT','This claim is no longer in the required state.');
            if (parsed.action==='approve') {
                await this.requireManager(client,claim.organization_id,claim.applicant_did);
                const verified = await client.query("SELECT 1 FROM verification_applications WHERE subject_type='organization' AND organization_id=$1 AND subject_ref=$1::uuid::text AND status='approved' AND expires_at>NOW()",[claim.organization_id]);
                if (!verified.rowCount) fail(409,'ORGANIZATION_VERIFICATION_REQUIRED','Verify the organization before approving its claim.');
                if (listing.rows[0].claimed_by_organization_id) fail(409,'RESOURCE_ALREADY_CLAIMED','Another claim already controls this listing.');
                await client.query('UPDATE public_resource_listings SET claimed_by_organization_id=$2,updated_at=NOW() WHERE resource_uri=$1',[claim.resource_uri,claim.organization_id]);
            } else if (parsed.action==='revoke') {
                await client.query('UPDATE public_resource_listings SET claimed_by_organization_id=NULL,updated_at=NOW() WHERE resource_uri=$1 AND claimed_by_organization_id=$2',[claim.resource_uri,claim.organization_id]);
            }
            const status = parsed.action==='approve'?'approved':parsed.action==='deny'?'denied':'revoked';
            await client.query('UPDATE public_resource_claims SET status=$2,decided_at=NOW(),decided_by_did=$3,decision_reason=$4 WHERE claim_id=$1',[parsed.claimId,status,actorDid,parsed.reason]);
            await client.query("INSERT INTO public_resource_audit_events(resource_uri,actor_did,action,details) VALUES($1,$2,$3,$4)",[claim.resource_uri,actorDid,`claim-${status}`,JSON.stringify({claimId:parsed.claimId,reason:parsed.reason})]);
            await client.query('COMMIT'); return { claimId:parsed.claimId,status };
        } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
    async edit(actorDid: string, input: unknown) {
        const parsed = editSchema.parse(input);
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query('SELECT * FROM public_resource_listings WHERE resource_uri=$1 FOR UPDATE',[parsed.resourceUri]);
            const listing = result.rows[0];
            if (!listing?.claimed_by_organization_id) fail(403,'APPROVED_CLAIM_REQUIRED','An approved claim is required to edit this listing.');
            await this.requireManager(client,listing.claimed_by_organization_id,actorDid);
            const verified = await client.query("SELECT 1 FROM verification_applications WHERE subject_type='organization' AND organization_id=$1 AND subject_ref=$1::uuid::text AND status='approved' AND expires_at>NOW()",[listing.claimed_by_organization_id]);
            if (!verified.rowCount) fail(403,'ORGANIZATION_VERIFICATION_REQUIRED','Renew organization verification before editing this listing.');
            const updated = await client.query(`UPDATE indexer_directory_resource_projections SET name=$2,open_hours=$3,eligibility_notes=$4,contact=$5,
                searchable_text=lower($2||' '||$4),record_updated_at=NOW() WHERE uri=$1`,[parsed.resourceUri,parsed.name,parsed.openHours,parsed.eligibilityNotes,JSON.stringify(parsed.contact)]);
            if (!updated.rowCount) fail(404,'PUBLIC_LISTING_NOT_FOUND','The resource listing is no longer available.');
            await client.query("INSERT INTO public_resource_audit_events(resource_uri,actor_did,action,details) VALUES($1,$2,'listing-edited',$3)",[parsed.resourceUri,actorDid,JSON.stringify(parsed)]);
            await client.query('COMMIT'); return { updated:true };
        } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }
}
