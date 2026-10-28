import { expect, test, type Page } from '@playwright/test';

const owner = 'did:plc:pickup-browser-owner';
const helpers = ['did:plc:pickup-browser-one', 'did:plc:pickup-browser-two'];
const uri = `at://${owner}/app.patchwork.aid.post/pickup`;
const now = '2026-10-28T12:00:00Z';

test('a requester coordinates two private helper handoffs and explicitly closes the pickup', async ({browser,baseURL}) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error('baseURL required');
    let capacity=1, configured=false, closed=false;
    const offers: {id:string;helper:string;status:string;note:string}[]=[];
    const connections: {id:string;offerId:string;helper:string;status:string}[]=[];
    const feedback: {id:string;connectionId:string;submitter:string;outcome:string;rating:number;comment:string|null;tags:string[];submittedAt:string}[]=[];
    const commands: unknown[]=[];
    const pickup=()=>({requestUri:uri,helperCapacity:capacity,configured,status:closed?'resolved':'assigned',
        occupied:connections.filter(c=>['active','completed'].includes(c.status)).length,active:connections.filter(c=>c.status==='active').length});
    const install=async(page:Page,actor:string)=> {
        await page.context().addCookies([{name:'patchwork_csrf',value:'pickup-browser-csrf',url:baseURL}]);
        await page.route('**/api/**',async route=>{
            const req=route.request(), path=new URL(req.url()).pathname.replace(/^\/api/,'');
            const fulfill=(body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
            if(path==='/auth/session') return fulfill({session:{did:actor,expiresAt:'2099-01-01T00:00:00Z'}});
            if(path==='/account/onboarding') return fulfill({policyVersion:'2026-07-28',requiredDocuments:[],consentRequired:false,acceptedAt:now});
            if(path==='/identity/handles') return fulfill({handles:{[owner]:'requester.example',[helpers[0]!]:'one.example',[helpers[1]!]:'two.example'}});
            if(path==='/query/feed') return fulfill({total:1,page:1,pageSize:20,hasNextPage:false,results:[{uri,authorDid:owner,title:'One-time grocery pickup',summary:'Help with one pickup.',status:'open',category:'food',urgency:'medium',updatedAt:now}]});
            const renderOffer=(o:typeof offers[number])=>({id:o.id,requestUri:uri,direction:actor===owner?'received':'sent',note:o.note,status:o.status,offeredAt:now,expiresAt:'2099-01-01T00:00:00Z',decidedAt:o.status==='pending'?null:now,...(o.status==='accepted'?{requesterDid:owner,helperDid:o.helper}:{})});
            const renderConnection=(c:typeof connections[number])=>({id:c.id,offerId:c.offerId,requestUri:uri,status:c.status,requesterDid:owner,helperDid:c.helper,counterpartDid:actor===owner?c.helper:owner,acceptedAt:now,completedAt:c.status==='completed'?now:null,updatedAt:now});
            if(path==='/coordination/mine') return fulfill({offers:offers.filter(o=>actor===owner||o.helper===actor).map(renderOffer),connections:connections.filter(c=>actor===owner||c.helper===actor).map(renderConnection),pickups:actor===owner?[pickup()]:[]});
            if(path==='/inbox') return fulfill({items:[],unread:0});
            if(path==='/outcomes/mine') return fulfill({feedback:feedback.filter(f=>f.submitter===actor)});
            if(req.method()==='POST') {
                const body=req.postDataJSON(); commands.push(body);
                expect(req.headers()['idempotency-key']).toBeTruthy();
                if(path==='/coordination/pickups') {
                    expect(actor).toBe(owner);
                    if(body.action==='set-capacity'){capacity=body.helperCapacity;configured=true;}
                    else {expect(connections.filter(c=>c.status==='active')).toHaveLength(0);closed=true;}
                    return fulfill({pickup:pickup()});
                }
                if(path==='/coordination/offers') {
                    const offer={id:crypto.randomUUID(),helper:actor,status:'pending',note:body.note};offers.push(offer);
                    return fulfill({offer:renderOffer(offer)},201);
                }
                if(path==='/coordination/offer-decisions') {
                    expect(actor).toBe(owner);
                    const offer=offers.find(o=>o.id===body.offerId)!;
                    expect(connections.length).toBeLessThan(capacity);offer.status='accepted';
                    const connection={id:crypto.randomUUID(),offerId:offer.id,helper:offer.helper,status:'active'};connections.push(connection);
                    return fulfill({offer:renderOffer(offer),connection:renderConnection(connection)});
                }
                if(path==='/coordination/connections') {
                    const connection=connections.find(c=>c.id===body.connectionId)!;
                    expect([owner,connection.helper]).toContain(actor);connection.status='completed';
                    return fulfill({connection:renderConnection(connection)});
                }
                if(path==='/outcomes') {
                    const item={...body,id:crypto.randomUUID(),submitter:actor,submittedAt:now};feedback.push(item);
                    return fulfill({feedback:item,safetyEscalated:false},201);
                }
            }
            return fulfill({error:{code:'NOT_FOUND',message:'Not found.'}},404);
        });
    };
    const contexts=await Promise.all([owner,...helpers].map(()=>browser.newContext()));
    try {
        const pages=await Promise.all(contexts.map(context=>context.newPage()));
        const requester=pages[0]!;
        for(const [index,actor] of [owner,...helpers].entries()) {
            await install(pages[index]!,actor); await pages[index]!.goto('/inbox');
            await expect(pages[index]!.getByRole('heading',{name:'Coordination inbox'})).toBeVisible();
        }
        await requester.getByLabel('Helper capacity').fill('2');
        await requester.getByRole('button',{name:'Set pickup capacity'}).click();
        await expect(requester.getByText('0 of 2 places committed; 0 active arrangements.')).toBeVisible();
        for(const helper of pages.slice(1)) {
            await helper.getByRole('button',{name:/Offer help for One-time grocery pickup/}).click();
            const dialog=helper.getByRole('dialog');
            await dialog.getByRole('textbox').fill('My private pickup arrangement');
            await dialog.getByRole('button',{name:'Offer help',exact:true}).click();
        }
        await requester.reload();
        await requester.getByRole('button',{name:'Accept',exact:true}).first().click();
        await expect(requester.getByRole('button',{name:'Accept',exact:true})).toHaveCount(1);
        await requester.getByRole('button',{name:'Accept',exact:true}).click();
        await expect(requester.getByText('2 of 2 places committed; 2 active arrangements.')).toBeVisible();
        await expect(requester.getByRole('button',{name:'Close pickup',exact:true})).toBeDisabled();
        const first=pages[1]!, second=pages[2]!;
        await first.reload(); await second.reload();
        await expect(first.getByText('Connected with @requester.example')).toBeVisible();
        await expect(first.getByText('@two.example',{exact:false})).toHaveCount(0);
        await first.getByRole('button',{name:'Complete handoff',exact:true}).click();
        await first.getByRole('combobox',{name:'Outcome'}).selectOption('successful');
        await first.getByLabel('Optional comment').fill('First helper private feedback');
        await first.getByRole('button',{name:'Submit outcome'}).click();
        await requester.reload();
        await expect(requester.getByText('2 of 2 places committed; 1 active arrangements.')).toBeVisible();
        await expect(requester.getByRole('button',{name:'Close pickup',exact:true})).toBeDisabled();
        await second.reload();
        await expect(second.getByRole('button',{name:'Complete handoff',exact:true})).toBeVisible();
        await expect(second.getByText('First helper private feedback')).toHaveCount(0);
        await second.getByRole('button',{name:'Complete handoff',exact:true}).click();
        await requester.reload();
        await expect(requester.getByRole('button',{name:'Close pickup',exact:true})).toBeEnabled();
        await requester.getByRole('button',{name:'Close pickup',exact:true}).click();
        await expect(requester.getByRole('button',{name:'Close pickup',exact:true})).toHaveCount(0);
        expect(closed).toBe(true);
        expect(connections.map(c=>c.status)).toEqual(['completed','completed']);
        expect(JSON.stringify(commands)).not.toContain('requesterDid');
    } finally { await Promise.all(contexts.map(context=>context.close())); }
});
