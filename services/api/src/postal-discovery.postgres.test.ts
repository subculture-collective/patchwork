import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importPublicResources } from './db/public-resource-seed.js';
import { publicResourceSeed } from './db/public-resource-catalog.js';
import { queryProjected, readProjectionPage } from './projected-discovery.js';
import { OrganizationService } from './organization-service.js';
import { AccountPrivacyService } from './account-privacy-service.js';
import { PublicResourceClaimService } from './public-resource-claim-service.js';

const databaseUrl=process.env.TEST_DATABASE_URL;
describe('ZIP discovery and sourced-resource claims',()=>{
    const pool=new Pool({connectionString:databaseUrl});
    beforeAll(async()=>{
        await pool.query('TRUNCATE public_resource_claims,public_resource_listings,public_resource_audit_events,showcase_record_metadata,showcase_seed_runs,indexer_aid_post_projections,indexer_directory_resource_projections,organizations CASCADE');
        const preview = await importPublicResources(pool,{maxNewPerState:5});
        expect(Object.values(preview.additionsByState).every(count => count <= 5)).toBe(true);
        expect(preview.newResources).toBeGreaterThan(250);
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_listings')).rows[0].count).toBe(0);
        await importPublicResources(pool,{apply:true,maxNewPerState:5});
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_listings')).rows[0].count).toBe(preview.newResources);
        await importPublicResources(pool,{apply:true});
    }, 30000);
    afterAll(async()=>pool.end());
    it('imports real resources without creating requests or claiming ownership',async()=>{
        const requests=await pool.query('SELECT count(*)::integer AS total,count(postal_code)::integer AS located FROM indexer_aid_post_projections');
        expect(requests.rows[0]).toEqual({total:0,located:0});
        const resources=await pool.query('SELECT count(*)::integer AS total,count(claimed_by_organization_id)::integer AS claimed FROM public_resource_listings');
        expect(resources.rows[0]).toEqual({total:publicResourceSeed.length,claimed:0});
        expect((await pool.query("SELECT count(*)::integer AS count FROM indexer_directory_resource_projections WHERE record_origin='synthetic'")).rows[0].count).toBe(0);
    });
    it('returns an empty request map without inventing activity',async()=>{
        const result=await queryProjected(pool,new URLSearchParams(),'map');
        expect(result.statusCode).toBe(200);
        expect(result.body).toMatchObject({total:0,results:[],aggregates:{cells:[]}});
    });
    it('orders resources by eligible exact coordinates before pagination',async()=>{
        const params=new URLSearchParams({latitude:'41.97558',longitude:'-87.71361',radiusKm:'100',pageSize:'5'});
        const result=await queryProjected(pool,params,'directory');
        expect(result.statusCode).toBe(200);
        const distance = (latitude:number, longitude:number) => {
            const radians = Math.PI / 180;
            const a = Math.sin((latitude-41.97558)*radians/2)**2
                + Math.cos(41.97558*radians)*Math.cos(latitude*radians)*Math.sin((longitude+87.71361)*radians/2)**2;
            return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        };
        const expected = publicResourceSeed.map(row => distance(row.latitude,row.longitude)).sort((a,b)=>a-b).slice(0,5);
        const rows = (result.body as {results:{uri:string}[]}).results;
        expect(rows).toHaveLength(5);
        rows.forEach((row,index) => {
            const resource = publicResourceSeed.find(seed => row.uri.endsWith('/'+seed.id))!;
            expect(distance(resource.latitude,resource.longitude)).toBeCloseTo(expected[index]!,4);
        });
    });
    it('filters overlapping services and unordered words before pagination', async () => {
        const result = await queryProjected(pool, new URLSearchParams({service:'hygiene', searchText:'laundry showers', pageSize:'1'}), 'directory');
        expect(result.statusCode).toBe(200);
        expect(result.body).toMatchObject({total:1, results:[{name:'DuPagePads — Client Access Center'}]});
        const legal = await queryProjected(pool, new URLSearchParams({service:'legal', pageSize:'1'}), 'directory');
        expect(legal.body).toMatchObject({total:publicResourceSeed.filter(resource => resource.services?.includes('legal')).length, hasNextPage:true});
        const socialSecurity = await queryProjected(pool, new URLSearchParams({service:'benefits', searchText:'SSI', pageSize:'1'}), 'directory');
        expect(socialSecurity.body).toMatchObject({total:publicResourceSeed.filter(resource => resource.sourceId === 'ssa-field-offices').length, hasNextPage:true});
        const disability = await queryProjected(pool, new URLSearchParams({service:'disability', searchText:'SSA', pageSize:'1'}), 'directory');
        expect(disability.body).toMatchObject({total:publicResourceSeed.filter(resource => resource.sourceId === 'ssa-field-offices').length});
        const invalid = await queryProjected(pool, new URLSearchParams({service:'not-a-service'}), 'directory');
        expect(invalid.statusCode).toBe(400);
        const libraries = await queryProjected(pool, new URLSearchParams({service:'community'}), 'directory');
        expect((libraries.body as {total:number}).total).toBeGreaterThan(80);
    });
    it('combines published program evidence with other filters before pagination', async () => {
        const cases = [
            ['wic', (r: typeof publicResourceSeed[number]) => ['idhs-wic','colorado-wic'].includes(r.sourceId)],
            ['snap', (r: typeof publicResourceSeed[number]) => ['idhs-benefits','idhs-snap-outreach'].includes(r.sourceId)],
            ['public-housing', (r: typeof publicResourceSeed[number]) => r.sourceId === 'hud-public-housing-authorities' && r.publicAccess.includes('for public housing')],
            ['housing-vouchers', (r: typeof publicResourceSeed[number]) => r.sourceId === 'hud-public-housing-authorities' && r.publicAccess.includes('Housing Choice Voucher')],
            ['va-benefits', (r: typeof publicResourceSeed[number]) => r.sourceId === 'va-public-offices' && r.publicAccess.includes('Government VA benefits office')],
            ['vet-center', (r: typeof publicResourceSeed[number]) => r.sourceId === 'va-public-offices' && r.publicAccess.includes('Government VA Vet Center')],
        ] as const;
        for (const [program, matches] of cases) {
            const expected = publicResourceSeed.filter(matches);
            expect(expected.length).toBeGreaterThan(1);
            const response = await queryProjected(pool, new URLSearchParams({program, pageSize:'1'}), 'directory');
            expect(response.statusCode).toBe(200);
            expect(response.body).toMatchObject({total:expected.length, hasNextPage:true});
            const rows = (response.body as {results:{uri:string}[]}).results;
            expect(rows).toHaveLength(1);
            expect(expected.some(r => rows[0]!.uri.endsWith('/'+r.id))).toBe(true);
        }
        const wic = await queryProjected(pool, new URLSearchParams({program:'wic',service:'youth',category:'clinic',pageSize:'1'}), 'directory');
        expect(wic.body).toMatchObject({total:publicResourceSeed.filter(r => ['idhs-wic','colorado-wic'].includes(r.sourceId)).length});
        const incompatible = await queryProjected(pool, new URLSearchParams({program:'wic',service:'legal'}), 'directory');
        expect(incompatible.body).toMatchObject({total:0,results:[]});
        const invalid = await queryProjected(pool, new URLSearchParams({program:'not-a-program'}), 'directory');
        expect(invalid.statusCode).toBe(400);
    });
    it('requires independent verified ownership, preserves source evidence, and revokes edits',async()=>{
        const owner=`did:plc:postal-owner-${randomUUID()}`,reviewer='did:plc:postal-reviewer';
        const created=await new OrganizationService(pool).create(owner,{name:'Test Resource Operator',description:'Local test operator.'}) as {organization:{id:string}};
        const organizationId=created.organization.id;
        const service=new PublicResourceClaimService(pool);
        const resourceUri=(await pool.query('SELECT resource_uri FROM public_resource_listings ORDER BY resource_uri LIMIT 1')).rows[0].resource_uri;
        const sourceBefore=(await pool.query('SELECT source_snapshot FROM public_resource_listings WHERE resource_uri=$1',[resourceUri])).rows[0].source_snapshot;
        const expectedUpdatedAt=(await pool.query('SELECT record_updated_at FROM indexer_directory_resource_projections WHERE uri=$1',[resourceUri])).rows[0].record_updated_at.toISOString();
        const edit={resourceUri,expectedUpdatedAt,name:'Updated public library',openHours:'Check official hours',eligibilityNotes:'Public access',contact:{url:'https://www.chipublib.org/'}};
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
        const evidence={sourceUrl:'https://www.chipublib.org/',sourceName:'Library',confirmedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),reviewStatus:'pending'};
        const serviceProfile={version:1,services:[{id:'library',name:'Library service',eligibility:[],delivery:{value:'in-person',evidence}}]};
        await service.edit(owner,{...edit,serviceProfile,serviceProfileRevision:0});
        await expect(service.edit(owner,edit)).rejects.toMatchObject({code:'RESOURCE_REVISION_CONFLICT'});
        const profile=(await pool.query('SELECT profile,revision FROM resource_service_profiles WHERE resource_uri=$1',[resourceUri])).rows[0];
        expect(profile.revision).toBe(1);
        expect(profile.profile.services[0].delivery.evidence.reviewStatus).toBe('reviewed');
        await importPublicResources(pool,{apply:true});
        expect((await pool.query('SELECT profile FROM resource_service_profiles WHERE resource_uri=$1',[resourceUri])).rows[0].profile).toEqual(profile.profile);
        const refreshedTimestamp=(await pool.query('SELECT record_updated_at FROM indexer_directory_resource_projections WHERE uri=$1',[resourceUri])).rows[0].record_updated_at.toISOString();
        await service.edit(owner,{...edit,name:'Renamed public library',expectedUpdatedAt:refreshedTimestamp,serviceProfile:profile.profile,serviceProfileRevision:1});
        expect((await pool.query('SELECT profile,revision FROM resource_service_profiles WHERE resource_uri=$1',[resourceUri])).rows[0]).toEqual({profile:profile.profile,revision:2});
        expect((await pool.query('SELECT profile FROM resource_service_profile_history WHERE resource_uri=$1 AND revision=1',[resourceUri])).rows[0].profile).toEqual(profile.profile);


        expect((await pool.query('SELECT source_snapshot FROM public_resource_listings WHERE resource_uri=$1',[resourceUri])).rows[0].source_snapshot).toEqual(sourceBefore);
        await service.decide(reviewer,{...decision,action:'revoke'});
        await expect(service.edit(owner,edit)).rejects.toMatchObject({code:'APPROVED_CLAIM_REQUIRED'});
        const privacy = new AccountPrivacyService(pool);
        const {SavedDiscoveryService}=await import('./saved-discovery-service.js');
        await new SavedDiscoveryService(pool).save(owner,{kind:'search',search:{postalCode:'60608'}});
        const exported = await privacy.exportFor(owner);
        expect(JSON.stringify(exported)).toContain('savedDiscovery');
        expect(JSON.stringify(exported)).toContain('Official authorization evidence for testing.');
        await privacy.deactivate(owner,randomUUID());
        expect((await new SavedDiscoveryService(pool).list(owner)).items).toEqual([]);
        await expect(new SavedDiscoveryService(pool).save(owner,{kind:'search',search:{postalCode:'60608'}})).rejects.toMatchObject({code:'ACCOUNT_DEACTIVATED'});
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_listings WHERE resource_uri=$1',[resourceUri])).rows[0].count).toBe(1);
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_claims WHERE applicant_did=$1',[owner])).rows[0].count).toBe(0);
        expect((await pool.query('SELECT count(*)::integer AS count FROM public_resource_audit_events WHERE actor_did=$1',[owner])).rows[0].count).toBe(0);
    });
    it('aggregates the complete filtered resource set independently of the list page',async()=>{
        const params=new URLSearchParams({program:'wic',pageSize:'1',mapZoom:'4',west:'-180',east:'180',south:'-85',north:'85'});
        const result=await readProjectionPage(pool,params,'directory');
        expect(result.rows).toHaveLength(1);
        expect(result.total).toBeGreaterThan(100);
        expect(result.resourceMap!.cells.reduce((sum,cell)=>sum+cell.count,0)).toBe(result.resourceMap!.mapped);
        expect(result.resourceMap!.mapped).toBe(result.total);
        params.set('mapZoom','20');
        const bounded = await readProjectionPage(pool,params,'directory');
        expect(bounded.resourceMap!.cells.length).toBeLessThanOrEqual(1800);
        expect(bounded.resourceMap!.cells.reduce((sum,cell)=>sum+cell.count,0)).toBe(result.total);
        params.set('west','-88');params.set('east','-87');params.set('south','41');params.set('north','42');params.set('mapZoom','12');
        const chicago=await readProjectionPage(pool,params,'directory');
        expect(chicago.total).toBe(result.total);
        expect(chicago.resourceMap!.mapped).toBeLessThan(result.resourceMap!.mapped);
        expect(chicago.resourceMap!.cells.every(cell=>cell.latitude>=41&&cell.latitude<=42&&cell.longitude>=-88&&cell.longitude<=-87)).toBe(true);
    });
    it('reruns without duplicating resources or dropping visitor records',async()=>{
        const uri='at://did:plc:visitor/app.patchwork.aid.post/preserve';
        await pool.query(`INSERT INTO indexer_aid_post_projections(uri,collection,author_did_hash,title,description,category,urgency,status,searchable_text,record_created_at,record_updated_at,source_cursor,source_event_id)
            VALUES($1,'app.patchwork.aid.post',repeat('a',64),'Visitor','Visitor request','other','low','open','visitor',NOW(),NOW(),1,'visitor')`,[uri]);
        await importPublicResources(pool,{apply:true});
        expect((await pool.query('SELECT count(*)::integer AS total FROM indexer_aid_post_projections')).rows[0].total).toBe(1);
        expect((await pool.query('SELECT count(*)::integer AS total FROM public_resource_listings')).rows[0].total).toBe(publicResourceSeed.length);
    });
});
