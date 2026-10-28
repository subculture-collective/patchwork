import {expect,test} from '@playwright/test';
import {lookupCountyArea} from '@patchwork/at-lexicons';
const did='did:plc:county-browser';
const uri=`at://${did}/app.patchwork.aid.post/county`;
const area=lookupCountyArea('36061')!;
for(const locale of ['en','es'] as const) test(`small ZIP warning and county-only publication in ${locale}`,async({page,baseURL})=>{
    let record:Record<string,unknown>|undefined;
    await page.context().addCookies([{name:'patchwork_csrf',value:'county-browser-csrf',url:baseURL!}]);
    await page.addInitScript(selected=>localStorage.setItem('patchwork-locale',selected),locale);
    await page.route('**/api/**',async route=>{
        const request=route.request(),path=new URL(request.url()).pathname;
        const reply=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
        if(path.endsWith('/auth/session'))return reply({session:{did,expiresAt:'2099-01-01T00:00:00Z'}});
        if(path.endsWith('/account/onboarding'))return reply({policyVersion:'2026-07-28',requiredDocuments:[],consentRequired:false,acceptedAt:'2026-10-28T00:00:00Z'});
        if(path.endsWith('/at/aid-posts')&&request.method()==='POST'){
            record=request.postDataJSON();return reply({uri,cid:'county-cid',record},201);
        }
        if(path.endsWith('/query/feed'))return reply({total:record?1:0,page:1,pageSize:20,hasNextPage:false,results:record?[{uri,authorDid:did,cid:'county-cid',title:'County pickup',summary:'Help with groceries.',status:'open',category:'food',urgency:'medium',updatedAt:'2026-10-28T12:00:00Z',countyId:'36061',approximateGeo:{latitude:area.latitude,longitude:area.longitude,precisionKm:area.precisionKm}}]:[]});
        if(path.endsWith('/query/aid-post'))return reply({total:record?1:0,results:record?[{uri,authorDid:did,cid:'county-cid',title:'County pickup',summary:'Help with groceries.',status:'open',category:'food',urgency:'medium',updatedAt:'2026-10-28T12:00:00Z',countyId:'36061',approximateGeo:{latitude:area.latitude,longitude:area.longitude,precisionKm:area.precisionKm}}]:[]});
        return reply({error:{code:'NOT_FOUND'}},404);
    });
    await page.goto('/posting');
    await page.locator('#posting-zip').fill('60625');
    await expect(page.getByRole('checkbox',{name:/Show my county|Mostrar mi condado/})).toHaveCount(0);
    await page.locator('#posting-zip').fill('10006');
    const checkbox=page.getByRole('checkbox',{name:/Show my county|Mostrar mi condado/});
    await expect(checkbox).toBeVisible();
    await expect(page.getByText(locale==='en'?'This ZIP covers a small land area. Publishing it may reveal more about where you are.':'Este código postal abarca una superficie pequeña. Publicarlo puede revelar más sobre dónde estás.')).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await page.locator('#posting-title').fill('County pickup');
    await page.locator('#posting-description').fill('Help with groceries.');
    await page.locator('button[type=submit]').click();
    await expect.poll(()=>record?.version).toBe('3.0.0');
    expect(record?.location).toEqual({countryCode:'US',countyId:'36061'});
    await page.goto(`/requests/view?uri=${encodeURIComponent(uri)}`);
    await expect(page.getByText(area.areaLabel,{exact:true})).toBeVisible();
    const resourceLink=page.locator('a[href^="/resources?"]');
    const href=await resourceLink.getAttribute('href');
    const params=new URL(href!,'http://localhost').searchParams;
    expect(params.get('lat')).toBe(String(area.latitude));
    expect(params.get('lng')).toBe(String(area.longitude));
    expect(params.get('area')).toContain(locale==='en'?'county':'condado');
    await page.goto('/feed?tab=latest');
    await page.locator('label').filter({has:page.locator('input[value=latest]')}).click();
    await expect(page.locator('input[value=latest]')).toBeChecked();
    await expect(page.getByRole('heading',{name:'County pickup'})).toBeVisible();
    await expect(page.getByText(area.areaLabel,{exact:true})).toBeVisible();
});
