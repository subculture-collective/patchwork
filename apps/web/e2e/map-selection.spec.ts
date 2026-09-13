import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });

const uri = 'at://did:plc:map-link/app.patchwork.aid.post/outside-page';
const request = { uri, authorDid: 'did:plc:map-link', title: 'Request outside this page', summary: 'A public request.', category: 'food', status: 'open', urgency: 'high', approximateGeo: { latitude: 41.88, longitude: -87.63, precisionKm: 2 }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', recordOrigin: 'visitor-created' };
const pageResult = (results: unknown[]) => ({ results, total: results.length, page: 1, pageSize: 20, hasNextPage: false });

test('map deep links load outside the result page and restore selection through reload and Back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/query/aid-post')) {
            expect(url.searchParams.get('uri')).toBe(uri);
            expect(url.searchParams.get('dataset')).toBe('all');
            return route.fulfill({ json: pageResult([request]) });
        }
        if (url.pathname.endsWith('/query/map') || url.pathname.endsWith('/query/directory')) return route.fulfill({ json: pageResult([]) });
        return route.fulfill({ status: 401, json: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' } } });
    });
    await page.goto(`/nearby?view=map&lat=41.88&lng=-87.63&r=20000&uri=${encodeURIComponent(uri)}`);
    const detail = page.getByRole('region', { name: 'Details for Request outside this page' });
    await expect(detail).toBeVisible();
    await page.reload();
    await expect(detail).toBeVisible();
    await page.getByRole('button', { name: 'Close drawer', exact: true }).click();
    await expect(detail).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('uri')).toBe(false);
    await page.goBack();
    await expect(detail).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('uri')).toBe(false);
});

test('integrated discovery removes the examples switch and normalizes legacy dataset links', async ({ page }) => {
    const datasets: string[] = [];
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        if (/\/query\/(feed|map)$/.test(url.pathname)) datasets.push(url.searchParams.get('dataset') ?? 'missing');
        if (url.pathname.includes('/query/')) return route.fulfill({ json: pageResult([]) });
        return route.fulfill({ status: 401, json: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' } } });
    });
    await page.goto('/nearby?view=list&dataset=demo&lat=41.88&lng=-87.63&r=20000');
    await expect.poll(() => datasets.includes('all')).toBe(true);
    await expect(page.getByRole('button', { name: 'Explore examples', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Community', exact: true })).toHaveCount(0);
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Nearby view' })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has('dataset')).toBe(false);
    expect(datasets.every(dataset => dataset === 'all')).toBe(true);
});


test('nearby resource list opens visit information and returns to the same search and map', async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    const resourceUri='at://did:plc:public-resource/app.patchwork.directory.resource/clinic';
    const resource={uri:resourceUri,authorDid:'did:plc:public-resource',name:'Neighborhood WIC clinic',category:'clinic',serviceArea:'Chicago, IL 60608',status:'unverified',operationalStatus:'unknown',recordOrigin:'sourced-public',
        approximateGeo:{latitude:41.85,longitude:-87.67,precisionKm:1},contact:{url:'https://example.org/wic',phone:'312-555-0100'},
        openHours:'Tuesday by appointment',eligibilityNotes:'WIC eligibility applies. Call before visiting.',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
        publicListing:{sourceName:'Public clinic directory',sourceUrl:'https://example.org',sourceRetrievedAt:new Date().toISOString(),claimStatus:'unclaimed'},
        exactPublicAddress:{streetAddress:'100 Public Street, Chicago IL 60608',latitude:41.85,longitude:-87.67,kind:'exact-public-resource',approvalExpiresAt:new Date(Date.now()+86400000).toISOString()}};
    const queries: string[]=[];
    await page.route('**/api/**', route => {
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/query/directory')) {queries.push(url.search);return route.fulfill({json:pageResult([resource])});}
        if(url.pathname.endsWith('/query/map')) return route.fulfill({json:pageResult([])});
        return route.fulfill({status:401,json:{error:{code:'AUTHENTICATION_REQUIRED',message:'Sign in.'}}});
    });
    await page.goto('/nearby?nearby=resources&zip=60608&program=wic&r=5000');
    await page.getByRole('button',{name:'Resources (1)',exact:true}).click();
    await page.locator('.mh-resource-result').click();
    await expect(page.getByRole('region',{name:'Published hours',exact:true})).toContainText('Tuesday by appointment');
    await expect(page.getByRole('region',{name:'Before you visit',exact:true})).toContainText('Call before visiting');
    await expect(page.getByRole('link',{name:'Get directions',exact:true})).toHaveAttribute('href',/41.85/);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.getByRole('button',{name:'Resources (1)',exact:true})).toHaveAttribute('aria-pressed','true');
    expect(new URL(page.url()).searchParams.get('r')).toBe('5000');
    const count=queries.length;
    await page.getByRole('button',{name:'Show Neighborhood WIC clinic on map',exact:true}).click();
    await expect(page.getByRole('button',{name:'Map',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByTitle('Neighborhood WIC clinic',{exact:true})).toBeVisible();
    expect(queries.length).toBe(count);
});


test('resource map aggregates include results outside the loaded page and expand to exact pins',async({page})=>{
    const uri='at://did:plc:aggregate/app.patchwork.directory.resource/outside';
    const queries:number[]=[];
    await page.route('**/api/**',route=>{
        const url=new URL(route.request().url());
        if(url.pathname.endsWith('/query/resource-map')){
            const zoom=Number(url.searchParams.get('mapZoom'));queries.push(zoom);
            return route.fulfill({json:{total:150,mapped:150,cells:zoom<13?[{latitude:41.85,longitude:-87.67,count:150,resourceUri:null,members:[],west:-87.675,east:-87.665,south:41.845,north:41.855}]:[{latitude:41.85,longitude:-87.67,count:1,resourceUri:uri,members:[{uri,name:'Clinic outside first page'}],west:-87.67,east:-87.67,south:41.85,north:41.85}]}});
        }
        if(url.pathname.includes('/query/'))return route.fulfill({json:pageResult([])});
        return route.fulfill({status:401,json:{error:{code:'AUTHENTICATION_REQUIRED',message:'Sign in.'}}});
    });
    await page.goto('/nearby?nearby=resources&zip=60608&r=20000');
    await page.getByTitle('150 resources — zoom to explore',{exact:true}).click();
    await expect(page.getByTitle('Clinic outside first page',{exact:true})).toBeVisible();
    expect(queries.some(zoom=>zoom>=13)).toBe(true);
});
