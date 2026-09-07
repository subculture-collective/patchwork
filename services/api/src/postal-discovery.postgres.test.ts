import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { replacePostalDiscoverySeed } from './db/postal-discovery-seed.js';
import { queryProjected } from './projected-discovery.js';
import { OrganizationService } from './organization-service.js';
import { AccountPrivacyService } from './account-privacy-service.js';
import { PublicResourceClaimService } from './public-resource-claim-service.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
const suite=databaseUrl?describe:describe.skip;
suite('ZIP discovery and sourced-resource claims',()=>{
    const pool=new Pool({connectionString:databaseUrl});
    beforeAll(async()=>{
        await pool.query('TRUNCATE public_resource_claims,public_resource_listings,public_resource_audit_events,showcase_record_metadata,showcase_seed_runs,indexer_aid_post_projections,indexer_directory_resource_projections,organizations CASCADE');
        await replacePostalDiscoverySeed(pool,true);
    });
    afterAll(async()=>pool.end());
    it('seeds 512 ZIP-only request areas and 81 unclaimed public resources',async()=>{
        const requests=await pool.query('SELECT count(*)::integer AS total,count(postal_code)::integer AS located FROM indexer_aid_post_projections');
        expect(requests.rows[0]).toEqual({total:512,located:512});
        const resources=await pool.query('SELECT count(*)::integer AS total,count(claimed_by_organization_id)::integer AS claimed FROM public_resource_listings');
        expect(resources.rows[0]).toEqual({total:81,claimed:0});
        expect((await pool.query("SELECT count(*)::integer AS count FROM indexer_directory_resource_projections WHERE record_origin='synthetic'")).rows[0].count).toBe(0);
    });
    it('conserves request counts and filters by exact ZIP identity',async()=>{
        const result=await queryProjected(pool,new URLSearchParams(),'map');
        expect(result.statusCode).toBe(200);
        const body=result.body as {total:number;aggregates:{cells:{count:number;postalCode:string}[]}};
        expect(body.aggregates.cells.reduce((sum,cell)=>sum+cell.count,0)).toBe(512);
        const code=body.aggregates.cells[0]!.postalCode;
        const selected=await queryProjected(pool,new URLSearchParams({postalCode:code,pageSize:'100'}),'map');
        expect((selected.body as {results:{postalCode:string}[]}).results.every(row=>row.postalCode===code)).toBe(true);
    });
    it('orders resources by eligible exact coordinates before pagination',async()=>{
        const params=new URLSearchParams({latitude:'41.97558',longitude:'-87.71361',radiusKm:'100',pageSize:'5'});
        const result=await queryProjected(pool,params,'directory');
        expect(result.statusCode).toBe(200);
        const names=(result.body as {results:{name:string}[]}).results.map(row=>row.name);
        expect(names[0]).toContain('Albany Park');
    });
    it('requires independent verified ownership, preserves source evidence, and revokes edits',async()=>{
        const owner=`did:plc:postal-owner-${randomUUID()}`,reviewer='did:plc:postal-reviewer';
        const created=await new OrganizationService(pool).create(owner,{name:'Test Resource Operator',description:'Local test operator.'}) as {organization:{id:string}};
        const organizationId=created.organization.id;
        const service=new PublicResourceClaimService(pool);
        const resourceUri=(await pool.query('SELECT resource_uri FROM public_resource_listings ORDER BY resource_uri LIMIT 1')).rows[0].resource_uri;
        const sourceBefore=(await pool.query('SELECT source_snapshot FROM public_resource_listings WHERE resource_uri=$1',[resourceUri])).rows[0].source_snapshot;
        const edit={resourceUri,name:'Updated public library',openHours:'Check official hours',eligibilityNotes:'Public access',contact:{url:'https://www.chipublib.org/'}};
        await expect(service.edit(owner,edit)).rejects.toMatchObject({code:'APPROVED_CLAIM_REQUIRED'});
        await expect(service.submit('did:plc:outsider',{resourceUri,organizationId,evidence:'Official authorization evidence for testing.'})).rejects.toMatchObject({code:'ORGANIZATION_MANAGER_REQUIRED'});
        const claim=await service.submit(owner,{resourceUri,organizationId,evidence:'Official authorization evidence for testing.'});
        await expect(service.submit(owner,{resourceUri,organizationId,evidence:'Duplicate authorization evidence for testing.'})).rejects.toMatchObject({code:'CLAIM_PENDING'});
        await pool.query("INSERT INTO platform_roles(did,role,updated_by,updated_at) VALUES($1,'admin',$1,NOW()),($2,'admin',$2,NOW()) ON CONFLICT(did) DO UPDATE SET role='admin'",[reviewer,owner]);
        const decision={claimId:claim.claimId,action:'approve',reason:'Independent verification of official authorization.'};
        await expect(service.decide(owner,decision)).rejects.toMatchObject({code:'INDEPENDENT_REVIEW_REQUIRED'});
        await expect(service.decide(reviewer,decision)).rejects.toMatchObject({code:'ORGANIZATION_VERIFICATION_REQUIRED'});
        await pool.query("INSERT INTO verification_applications(application_id,applicant_did,subject_type,organization_id,subject_ref,status,submitted_at,expires_at,updated_at) VALUES($1,$2,'organization',$3::uuid,$3::uuid::text,'approved',NOW(),NOW()+INTERVAL '1 year',NOW())",[randomUUID(),owner,organizationId]);
        expect(await service.decide(reviewer,decision)).toMatchObject({status:'approved'});
        await service.edit(owner,edit);
        expect((await pool.query('SELECT source_snapshot FROM public_resource_listings WHERE resource_uri=$1',[resourceUri])).rows[0].source_snapshot).toEqual(sourceBefore);
        await service.decide(reviewer,{...decision,action:'revoke'});
        await expect(service.edit(owner,edit)).rejects.toMatchObject({code:'APPROVED_CLAIM_REQUIRED'});
        const privacy = new AccountPrivacyService(pool);
        const exported = await privacy.exportFor(owner);
        expect(JSON.stringify(exported)).toContain('Official authorization evidence for testing.');
        await privacy.deactivate(owner,randomUUID());
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_listings WHERE resource_uri=$1',[resourceUri])).rows[0].count).toBe(1);
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_claims WHERE applicant_did=$1',[owner])).rows[0].count).toBe(0);
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_audit_events WHERE actor_did=$1',[owner])).rows[0].count).toBe(0);
    });
    it('reruns without duplicating resources or dropping visitor records',async()=>{
        const uri='at://did:plc:visitor/app.patchwork.aid.post/preserve';
        await pool.query(`INSERT INTO indexer_aid_post_projections(uri,collection,author_did_hash,title,description,category,urgency,status,searchable_text,record_created_at,record_updated_at,source_cursor,source_event_id)
            VALUES($1,'app.patchwork.aid.post',repeat('a',64),'Visitor','Visitor request','other','low','open','visitor',NOW(),NOW(),1,'visitor')`,[uri]);
        await replacePostalDiscoverySeed(pool,true);
        expect((await pool.query('SELECT count(*)::integer AS total FROM indexer_aid_post_projections')).rows[0].total).toBe(513);
        expect((await pool.query('SELECT count(*)::integer AS total FROM public_resource_listings')).rows[0].total).toBe(81);
    });
});
