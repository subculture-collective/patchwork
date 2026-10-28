import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {lookupCountyArea} from '@patchwork/at-lexicons';
import {normalizeFirehoseEvent,recordNsid} from '@patchwork/shared';
import {PostgresProjectionStore} from '../../indexer/src/db/projection-store.js';
import {AccountPrivacyService} from './account-privacy-service.js';
import {queryProjected} from './projected-discovery.js';

const uri='at://did:plc:countyprivacy133/app.patchwork.aid.post/county';
describe('county-only request ingestion and public discovery',()=>{
    const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
    const area=lookupCountyArea('17031')!;
    beforeAll(async()=>{
        const normalized=normalizeFirehoseEvent({seq:13300001,action:'create',uri,collection:recordNsid.aidPost,
            authorDid:'did:plc:countyprivacy133',record:{$type:recordNsid.aidPost,version:'3.0.0',title:'countyprivacy133 groceries',
                description:'County-wide pickup help.',category:'food',urgency:'medium',status:'open',
                location:{countryCode:'US',countyId:area.countyId},createdAt:'2026-10-28T12:00:00Z'}});
        if(!normalized.success) throw new Error('County normalization failed');
        await new PostgresProjectionStore(pool).apply(normalized.event);
    });
    afterAll(async()=>{
        await pool.query('DELETE FROM indexer_aid_post_projections WHERE uri=$1',[uri]);
        await pool.query('DELETE FROM indexer_projection_events WHERE event_id=$1',[`13300001:${uri}:create`]);
        await pool.end();
    });
    it('persists only county identity and its canonical representative point',async()=>{
        expect((await pool.query('SELECT postal_code,county_id,latitude,longitude FROM indexer_aid_post_projections WHERE uri=$1',[uri])).rows)
            .toEqual([{postal_code:null,county_id:area.countyId,latitude:area.latitude,longitude:area.longitude}]);
    });
    it('keeps the chosen county identity in the author account export',async()=>{
        expect(await new AccountPrivacyService(pool).exportFor('did:plc:countyprivacy133')).toMatchObject({data:{publicAidPosts:[expect.objectContaining({uri,countyId:area.countyId})]}});
    });
    it('includes county requests in feed/map and nearby results but never ZIP filters',async()=>{
        const filters={searchText:'countyprivacy133'};
        const feed=await queryProjected(pool,new URLSearchParams(filters),'feed');
        expect(feed.body).toMatchObject({total:1,results:[{countyId:area.countyId,approximateGeo:{latitude:area.latitude,longitude:area.longitude}}]});
        expect(JSON.stringify(feed.body)).not.toContain('postalCode');
        const map=await queryProjected(pool,new URLSearchParams(filters),'map');
        expect(map.body).toMatchObject({aggregates:{locatedRequestCount:1,cells:[{countyId:area.countyId,count:1,postalCode:null}]}});
        expect((await queryProjected(pool,new URLSearchParams({...filters,postalCode:'60625'}),'map')).body).toMatchObject({total:0,aggregates:{cells:[]}});
        expect((await queryProjected(pool,new URLSearchParams({...filters,latitude:String(area.latitude),longitude:String(area.longitude),radiusKm:'1'}),'map')).body).toMatchObject({total:1});
    });
});
