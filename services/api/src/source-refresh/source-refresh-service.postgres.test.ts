import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import snapshot from '../db/seed-data/chicago-metro-public-resources.json' with { type: 'json' };
import { hashRefreshValue, planPublicResourceRefresh, type RefreshListing } from '../db/public-resource-refresh.js';
import { previewPublicResourceRefresh } from '../db/public-resource-refresh-preview.js';
import { SourceRefreshError, SourceRefreshService } from './source-refresh-service.js';
import { runCplSourceRefresh } from './chicago-public-library-run.js';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const service = new SourceRefreshService(pool);
const prefix = 'at://did:plc:patchwork-public-catalog/app.patchwork.directory.resource/refresh-service-';
const claimedOrganization = '00000000-0000-4000-8000-000000000036';
const reviewer = 'did:plc:source-refresh-reviewer';
const source = snapshot.sources.cpl;
const original = snapshot.resources.find(resource => resource.sourceId === 'cpl')!;
const cleanup = async () => {
    const uris = (await pool.query("SELECT uri FROM indexer_directory_resource_projections WHERE uri LIKE $1",[`${prefix}%`])).rows.map(row=>row.uri);
    if (uris.length) {
        await pool.query('DELETE FROM public_resource_audit_events WHERE resource_uri=ANY($1::text[])',[uris]);
        await pool.query('DELETE FROM resource_corrections WHERE resource_uri=ANY($1::text[])',[uris]);
        await pool.query('DELETE FROM resource_service_profiles WHERE resource_uri=ANY($1::text[])',[uris]);
        await pool.query('DELETE FROM source_refresh_candidates WHERE resource_uri=ANY($1::text[])',[uris]);
        await pool.query('DELETE FROM public_resource_listings WHERE resource_uri=ANY($1::text[])',[uris]);
        await pool.query('DELETE FROM indexer_directory_resource_projections WHERE uri=ANY($1::text[])',[uris]);
    }
    await pool.query("DELETE FROM source_refresh_runs WHERE evidence->>'datasetId'='integration-fixture'");
    await pool.query('DELETE FROM organizations WHERE organization_id=$1',[claimedOrganization]);
    await pool.query('DELETE FROM platform_roles WHERE did=$1',[reviewer]);
};
afterAll(async () => { await cleanup(); await pool.end(); });

async function seed(key: string) {
    const uri = `${prefix}${key}`;
    const resource = { ...original, id:`refresh-service-${key}`, category:'library' as const, phone:'(312) 555-0100' };
    await pool.query(`INSERT INTO public_resource_listings
        (resource_uri,source_name,source_url,source_retrieved_at,source_snapshot,source_expires_at,street_address,postal_code,latitude,longitude,public_access)
        VALUES($1,$2,$3,'2026-09-08',$4,'2026-12-07',$5,$6,$7,$8,$9)`,
    [uri,source.name,source.url,JSON.stringify(resource),resource.streetAddress,resource.postalCode,resource.latitude,resource.longitude,resource.publicAccess]);
    await pool.query(`INSERT INTO indexer_directory_resource_projections
        (uri,collection,author_did_hash,name,service_area,category,verification_status,contact,searchable_text,operational_status,
         record_created_at,record_updated_at,source_cursor,source_event_id,record_origin,seed_version)
        VALUES($1,'app.patchwork.directory.resource',repeat('a',64),$2,'Chicago, IL',$3,'unverified',$4,lower($2),'unknown',NOW(),NOW(),0,$1,'sourced-public','fixture')`,
    [uri,resource.name,resource.category,JSON.stringify({url:resource.website,phone:resource.phone})]);
    return { uri, resource };
}

async function prepare(key: string, hashCharacter: string) {
    const { uri, resource } = await seed(key);
    const rawSha256 = hashCharacter.repeat(64);
    const next = { ...resource, phone:'(312) 555-0199' };
    const catalog = { scope:{name:'CPL fixture',countyIds:['17031'],sourceUrl:source.url},
        sources:{cpl:{...source,retrievedAt:'2026-09-19',sha256:rawSha256}}, resources:[next] };
    const state = (await pool.query(`SELECT l.source_snapshot,l.source_url,l.source_retrieved_at,l.claimed_by_organization_id,l.listed,l.updated_at,
        p.record_origin,p.contact,p.record_updated_at FROM public_resource_listings l
        JOIN indexer_directory_resource_projections p ON p.uri=l.resource_uri WHERE l.resource_uri=$1`,[uri])).rows[0];
    const listing: RefreshListing = { resourceUri:uri,sourceSnapshot:state.source_snapshot,sourceUrl:state.source_url,
        sourceRetrievedAt:state.source_retrieved_at.toISOString(),recordOrigin:state.record_origin,contact:state.contact,
        claimed:Boolean(state.claimed_by_organization_id),listed:state.listed,profileRevision:null,pendingCorrection:false,
        recordUpdatedAt:state.record_updated_at.toISOString(),listingUpdatedAt:state.updated_at.toISOString() };
    const now = new Date('2026-09-19T18:00:00.000Z');
    const preview = planPublicResourceRefresh(catalog,[listing],now);
    expect(preview.candidates[0]!.disposition).toBe('contact-automation-candidate');
    const manifest = { version:1 as const,publisher:'City of Chicago',datasetId:'integration-fixture',
        requestUrl:source.apiUrl,responseUrl:source.apiUrl,retrievedAt:now.toISOString(),contentType:'application/json' as const,
        etag:null,lastModified:null,rawSha256,rawBytes:100,rowCount:1,normalizedSha256:hashRefreshValue(catalog) };
    const persisted = await service.persistPreview('cpl',manifest,preview);
    const candidate = await pool.query('SELECT candidate_id FROM source_refresh_candidates WHERE run_id=$1',[persisted.runId]);
    return { uri, resource, next, catalog, preview, manifest, persisted, candidateId:candidate.rows[0].candidate_id as string };
}

describe('persistent source-refresh candidates and guarded contact application', () => {
    it('skips a concurrent CPL refresh before contacting the publisher', async () => {
        const blocker = await pool.connect();
        const fetcher = vi.fn<typeof fetch>();
        try {
            await blocker.query("SELECT pg_advisory_lock(hashtext('source-refresh:cpl'))");
            await expect(runCplSourceRefresh({ pool, outputDir:'/unused', fetch:fetcher })).resolves.toEqual({status:'skipped-concurrent'});
            expect(fetcher).not.toHaveBeenCalled();
        } finally {
            await blocker.query("SELECT pg_advisory_unlock(hashtext('source-refresh:cpl'))");
            blocker.release();
        }
    });
    it('lists reviewer candidates and dismisses only the current pending revision', async () => {
        const fixture = await prepare('review-dismiss','7');
        await pool.query("INSERT INTO platform_roles(did,role,updated_by,updated_at) VALUES($1,'admin',$1,NOW()) ON CONFLICT(did) DO UPDATE SET role='admin'",[reviewer]);
        const listed = await service.listCandidates(reviewer,1);
        const candidate = listed.items.find(item => item.candidateId === fixture.candidateId)!;
        expect(candidate).toMatchObject({resourceUri:fixture.uri,status:'pending',sourceId:'cpl'});
        await expect(service.dismissCandidate(reviewer,{
            candidateId:fixture.candidateId,expectedUpdatedAt:candidate.updatedAt,reason:'Publisher record was confirmed as a duplicate fixture.',
        })).resolves.toEqual({updated:true});
        await expect(service.dismissCandidate(reviewer,{
            candidateId:fixture.candidateId,expectedUpdatedAt:candidate.updatedAt,reason:'A second decision must fail after the candidate changes.',
        })).rejects.toMatchObject({code:'REFRESH_CANDIDATE_CHANGED'});
        const resolved = await service.listCandidates(reviewer,1,'resolved');
        expect(resolved.items.find(item => item.candidateId === fixture.candidateId)).toMatchObject({
            status:'dismissed',decisionDetails:{action:'dismissed',reviewerDid:reviewer},
        });
    });

    it('supersedes an older pending candidate when newer evidence is persisted', async () => {
        const fixture = await prepare('superseded','6');
        const newerManifest = {...fixture.manifest,rawSha256:'5'.repeat(64),retrievedAt:'2026-09-19T19:00:00.000Z'};
        const newerPreview = structuredClone(fixture.preview);
        newerPreview.generatedAt = '2026-09-19T19:00:00.000Z';
        newerPreview.candidates[0]!.evidence.sha256 = newerManifest.rawSha256;
        const newer = await service.persistPreview('cpl',newerManifest,newerPreview);
        const rows = await pool.query('SELECT candidate_id,status,decision_details FROM source_refresh_candidates WHERE resource_uri=$1 ORDER BY created_at,candidate_id',[fixture.uri]);
        expect(rows.rows).toHaveLength(2);
        const old = rows.rows.find(row => row.candidate_id === fixture.candidateId);
        const current = rows.rows.find(row => row.candidate_id !== fixture.candidateId);
        expect(old).toMatchObject({status:'superseded',decision_details:{action:'superseded',supersededBy:current.candidate_id}});
        expect(current).toMatchObject({status:'pending'});
        expect(newer.candidates).toBe(1);
    });

    it('deduplicates evidence, applies a current contact candidate, and keeps the initial snapshot immutable', async () => {
        const fixture = await prepare('success','a');
        expect(fixture.persisted).toMatchObject({candidates:1,replayed:false});
        await expect(service.persistPreview('cpl',fixture.manifest,fixture.preview)).resolves.toEqual({
            ...fixture.persisted,replayed:true,
        });
        const result = await service.applyContactCandidate(fixture.candidateId);
        expect(result).toMatchObject({resourceUri:fixture.uri,contact:{url:fixture.next.website,phone:fixture.next.phone},applied:true});
        const listing = (await pool.query('SELECT source_snapshot FROM public_resource_listings WHERE resource_uri=$1',[fixture.uri])).rows[0];
        expect(listing.source_snapshot).toEqual(fixture.resource);
        const projection = (await pool.query('SELECT contact FROM indexer_directory_resource_projections WHERE uri=$1',[fixture.uri])).rows[0];
        expect(projection.contact).toEqual({url:fixture.next.website,phone:fixture.next.phone});
        expect((await pool.query("SELECT status FROM source_refresh_candidates WHERE candidate_id=$1",[fixture.candidateId])).rows[0].status).toBe('applied');
        expect((await pool.query("SELECT count(*)::integer AS count FROM public_resource_audit_events WHERE resource_uri=$1 AND action='source-refresh-contact-applied'",[fixture.uri])).rows[0].count).toBe(1);
        const nextPreview = await previewPublicResourceRefresh(pool,fixture.catalog,new Date('2026-09-19T18:05:00.000Z'));
        expect(nextPreview.candidates[0]).toMatchObject({disposition:'unchanged',fields:[],reasons:[]});
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_CANDIDATE_NOT_APPLICABLE'});
    });

    it('rolls back when reviewed service evidence appears after preview', async () => {
        const fixture = await prepare('profile-conflict','b');
        await pool.query("INSERT INTO resource_service_profiles(resource_uri,profile) VALUES($1,'{\"version\":1,\"services\":[]}'::jsonb)",[fixture.uri]);
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_PROFILE_CONFLICT'});
        expect((await pool.query('SELECT contact FROM indexer_directory_resource_projections WHERE uri=$1',[fixture.uri])).rows[0].contact.phone).toBe(fixture.resource.phone);
        expect((await pool.query('SELECT status FROM source_refresh_candidates WHERE candidate_id=$1',[fixture.candidateId])).rows[0].status).toBe('pending');
    });

    it('rolls back when a correction appears after preview', async () => {
        const fixture = await prepare('correction-conflict','c');
        await pool.query(`INSERT INTO resource_corrections(resource_uri,receipt_hash,submission_hash,category,explanation)
            VALUES($1,$2,$3,'contact','Publisher contact change conflict fixture')`,[fixture.uri,'c'.repeat(64),'d'.repeat(64)]);
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_CORRECTION_CONFLICT'});
        expect((await pool.query('SELECT contact FROM indexer_directory_resource_projections WHERE uri=$1',[fixture.uri])).rows[0].contact.phone).toBe(fixture.resource.phone);
    });

    it('rolls back on listing revision drift and rejects non-contact candidates', async () => {
        const fixture = await prepare('revision-conflict','e');
        await pool.query("UPDATE indexer_directory_resource_projections SET record_updated_at=record_updated_at+INTERVAL '1 second' WHERE uri=$1",[fixture.uri]);
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_REVISION_CONFLICT'});
        await pool.query("UPDATE source_refresh_candidates SET disposition='review' WHERE candidate_id=$1",[fixture.candidateId]);
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_CANDIDATE_NOT_APPLICABLE'});
    });

    it('rolls back when a claim appears after preview', async () => {
        const fixture = await prepare('claim-conflict','9');
        await pool.query(`INSERT INTO organizations(organization_id,slug,name,description,origin,non_endorsement_label,created_by_did,created_at,updated_at)
            VALUES($1,'refresh-claim-fixture','Refresh claim fixture','','visitor-created','Unverified','did:plc:refresh-fixture',NOW(),NOW())`,[claimedOrganization]);
        await pool.query('UPDATE public_resource_listings SET claimed_by_organization_id=$2,updated_at=NOW() WHERE resource_uri=$1',[fixture.uri,claimedOrganization]);
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_OWNERSHIP_CONFLICT'});
        expect((await pool.query('SELECT contact FROM indexer_directory_resource_projections WHERE uri=$1',[fixture.uri])).rows[0].contact.phone).toBe(fixture.resource.phone);
    });

    it('revalidates contact policy instead of trusting persisted classification', async () => {
        const fixture = await prepare('policy-conflict','8');
        const after = { ...fixture.next, website:'https://different.example/locations/1/' };
        await pool.query("UPDATE source_refresh_candidates SET after_value=$2,changed_fields=ARRAY['phone','website'] WHERE candidate_id=$1",
            [fixture.candidateId,JSON.stringify(after)]);
        await expect(service.applyContactCandidate(fixture.candidateId)).rejects.toMatchObject({code:'REFRESH_CONTACT_SCOPE_CHANGED'});
        expect((await pool.query('SELECT contact FROM indexer_directory_resource_projections WHERE uri=$1',[fixture.uri])).rows[0].contact.phone).toBe(fixture.resource.phone);
    });

    it('rejects evidence mismatches atomically', async () => {
        const fixture = await prepare('evidence-mismatch','f');
        const changed = structuredClone(fixture.preview);
        changed.candidates[0]!.evidence.sha256 = '0'.repeat(64);
        await expect(service.persistPreview('cpl',{...fixture.manifest,rawSha256:'1'.repeat(64)},changed))
            .rejects.toBeInstanceOf(SourceRefreshError);
        expect((await pool.query("SELECT count(*)::integer AS count FROM source_refresh_runs WHERE raw_sha256=$1",['1'.repeat(64)])).rows[0].count).toBe(0);
    });
});
