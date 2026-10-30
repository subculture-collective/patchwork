import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const locale of ['en','es'] as const) test(`public group introduction, moderator reply and approval (${locale})`, async ({ browser }) => {
    const applicant = 'did:plc:join-browser-applicant';
    const owner = 'did:plc:join-browser-owner';
    const groupId = '61111111-1111-4111-8111-111111111111';
    const conversationId = '61111111-1111-4111-8111-111111111112';
    const requestId = '61111111-1111-4111-8111-111111111113';
    const now = new Date().toISOString();
    let application: Record<string, unknown> | null = null;
    let approved = false;
    let accessRevoked = false;
    const messages: Array<Record<string,unknown>> = [];
    const bodies: Array<Record<string,unknown>> = [];
    const group = { id: groupId, name: 'Weekend pantry', description: 'Neighbors share surplus.', purpose: 'Share food',
        ownerDid: owner, visibility: 'public', status: 'active', version: 1,
        rooms: [], members: [], createdAt: now, updatedAt: now, closedAt: null };
    const contexts = await Promise.all([applicant,owner].map(async actor => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
        await context.route('**/api/**', async route => {
            const request = route.request();
            const path = new URL(request.url()).pathname.replace(/^\/api/, '');
            const fulfill = (body: unknown, status = 200) => route.fulfill({ status,
                contentType: 'application/json', body: JSON.stringify(body) });
            if (path === '/auth/session') return fulfill({ session: { did: actor, expiresAt: '2099-01-01T00:00:00Z' } });
            if (path === '/account/onboarding') return fulfill({ policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: now });
            if (path === '/account/preferences') return fulfill({ preferences: { privacy: 'private', notifications: { inApp:true,email:false,push:false }, visibility:'authenticated',language:locale,location:{ sharing:'hidden',noPermanentAddress:false } } });
            if (path === '/groups') return fulfill({ groups: actor===owner || approved ? [{ ...group, actorRole:actor===owner?'owner':'member' }] : [], invitations:[],outgoingInvitations:[] });
            if (path === '/groups/linkable-requests') return fulfill({ requests:[] });
            if (path === '/groups/details') return fulfill({ group: { id:groupId,name:group.name,description:group.description,purpose:group.purpose,memberCount:approved?2:1 } });
            if (path === '/groups/join-requests' && request.method()==='GET') return fulfill({ requests: application && (actor===applicant || !approved) ? [{ ...application,canDecide:actor===owner }] : [] });
            if (path === '/groups/join-requests' && request.method()==='POST') {
                const body = request.postDataJSON() as Record<string,unknown>; bodies.push(body);
                expect(request.headers()['idempotency-key']).toBeTruthy();
                application = { id:requestId,groupId,requesterDid:applicant,groupName:group.name,introduction:body.introduction,status:'pending',conversationId,expiresAt:'2099-01-01T00:00:00Z',createdAt:now,updatedAt:now };
                return fulfill({ request:application },201);
            }
            if (path === '/groups/join-decisions') {
                expect(actor).toBe(owner);
                expect(request.postDataJSON()).toEqual({ groupId,requestId,action:'approve' });
                approved=true; application={ ...application,status:'approved',conversationId:null };
                return fulfill({ request:application });
            }
            if (path === '/coordination/mine') return fulfill({ offers:[],connections:[] });
            if (path === '/chat/conversations') return fulfill({ conversations: application && !approved ? [{
                id:conversationId,kind:'join-request',joinRequestId:requestId,connectionId:null,roomId:null,
                title:group.name,groupId,status:'active',version:1,unreadCount:0,lastSequence:null,
                lastReadSequence:0,lastMessageAt:null,createdAt:now,updatedAt:now,closedAt:null,
            }] : [] });
            if (path === '/chat/messages' && request.method()==='GET') return accessRevoked && actor===applicant
                ? fulfill({ error:{ code:'GROUP_NOT_FOUND',message:'Unavailable.' } },404)
                : fulfill({ messages,nextCursor:null });
            if (path === '/chat/messages' && request.method()==='POST') {
                const body=request.postDataJSON();
                const message={ id:'61111111-1111-4111-8111-111111111114',sequence:1,conversationId,
                    authorDid:actor,body:body.body,status:'active',deliveryState:'delivered',createdAt:now,redactedAt:null };
                messages.push(message); return fulfill({ message,created:true },201);
            }
            if (path === '/chat/read') return fulfill({ conversationId,lastReadSequence:messages.length });
            return fulfill({ error:{ code:'NOT_FOUND',message:'Unavailable.' } },404);
        });
        return context;
    }));
    try {
        const neighbor=await contexts[0].newPage();
        const moderator=await contexts[1].newPage();
        await neighbor.goto(`/groups?group=${groupId}`);
        await expect(neighbor.getByRole('heading',{ name:'Weekend pantry' })).toBeVisible();
        await expect(neighbor.getByRole('heading',{ name:locale==='en'?'Members':'Miembros',exact:true })).toHaveCount(0);
        await neighbor.getByLabel(locale==='en'?'Your introduction':'Tu presentación').fill('I can help with the weekend pantry.');
        await neighbor.getByRole('button',{ name:locale==='en'?'Ask to join':'Solicitar ingreso',exact:true }).click();
        await expect(neighbor.getByText(locale==='en'?'Awaiting a moderator’s decision.':'Esperando la decisión de un moderador.')).toBeVisible();
        await moderator.goto('/groups');
        await expect(moderator.getByText('I can help with the weekend pantry.')).toBeVisible();
        await moderator.getByRole('link',{ name:locale==='en'?'Open private conversation':'Abrir conversación privada' }).click();
        await moderator.getByLabel(locale==='en'?'Message':'Mensaje',{ exact:true }).fill('Welcome! Can you join on Saturday?');
        await moderator.getByRole('button',{ name:locale==='en'?'Send message':'Enviar mensaje',exact:true }).click();
        await expect(moderator.getByText('Welcome! Can you join on Saturday?')).toBeVisible();
        await neighbor.getByRole('link',{ name:locale==='en'?'Open private conversation':'Abrir conversación privada' }).click();
        await expect(neighbor.getByText('Welcome! Can you join on Saturday?')).toBeVisible();
        expect((await new AxeBuilder({ page:neighbor }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
        accessRevoked = true;
        await expect(neighbor.getByText('Welcome! Can you join on Saturday?')).toHaveCount(0, { timeout: 10000 });
        await moderator.goto('/groups');
        await moderator.getByRole('button',{ name:locale==='en'?'Approve membership':'Aprobar ingreso' }).click();
        await neighbor.goto('/groups');
        await expect(neighbor.getByText(locale==='en'?'Approved. You are now a member.':'Aprobada. Ya eres miembro.')).toBeVisible();
        await expect(neighbor.getByRole('heading',{ name:locale==='en'?'Members':'Miembros',exact:true })).toBeVisible();
        await expect(neighbor.getByRole('link',{ name:locale==='en'?'Open private conversation':'Abrir conversación privada' })).toHaveCount(0);
        expect(bodies).toEqual([{ groupId,introduction:'I can help with the weekend pantry.' }]);
    } finally { await Promise.all(contexts.map(context => context.close())); }
});
