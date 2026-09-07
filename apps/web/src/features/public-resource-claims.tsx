import { useState } from 'react';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import type { ResourceDetail } from '../resource-directory-ux';
import { fetchResourceViaApi, fetchMyOrganizationsViaApi, submitPublicResourceClaimViaApi, listPublicResourceClaimsViaApi, decidePublicResourceClaimViaApi, editPublicResourceViaApi, type MyOrganization } from './api-client';

export function PublicResourceClaim({ resource }: { resource: ResourceDetail }) {
    const [open,setOpen] = useState(false);
    const [organizations,setOrganizations] = useState<MyOrganization[]>([]);
    const [organizationId,setOrganizationId] = useState('');
    const [evidence,setEvidence] = useState('');
    const [message,setMessage] = useState('');
    const [busy,setBusy] = useState(false);
    const start = async () => {
        setOpen(true);setBusy(true);
        const result = await fetchMyOrganizationsViaApi();
        setBusy(false);
        if (!result.ok) { setMessage('Sign in to claim a listing, then choose your organization.'); return; }
        const eligible = result.data.filter(item => ['owner','admin'].includes(item.membership.role));
        setOrganizations(eligible);setOrganizationId(eligible[0]?.id ?? '');
    };
    if (!resource.publicListing) return null;
    return <div className='space-y-2 border-t border-mh-borderSoft pt-3'>
        <p className='text-sm'>{resource.publicListing.claimStatus === 'claimed' ? 'Claimed listing' : 'Unclaimed public listing'} · <a className='underline' href={resource.publicListing.sourceUrl} target='_blank' rel='noopener noreferrer'>Public source</a></p>
        <p className='text-xs text-mh-textMuted'>Listed from public information. Inclusion does not imply participation in or endorsement of Patchwork. Check the official website for current hours and service requirements.</p>
        {resource.publicListing.claimStatus === 'unclaimed' && !open && <Button variant='neutral' onClick={() => void start()}>Claim this resource</Button>}
        {resource.publicListing.claimStatus === 'claimed' && <a className='underline' href='/organizations'>Manage your organization's listings</a>}
        {open && <form className='space-y-3' onSubmit={event => {
            event.preventDefault();setBusy(true);
            void submitPublicResourceClaimViaApi({resourceUri:resource.uri,organizationId,evidence}).then(result => {
                setBusy(false);setMessage(result.ok?'Claim submitted for review. You can track it under Organizations. Editing access begins after approval.':result.error);
                if(result.ok)setOpen(false);
            });
        }}>
            <p className='text-sm'>For representatives authorized to manage this resource. A reviewer will check your organization's verification and connection to this location.</p>
            {organizations.length ? <label className='block'>Organization<select className='mh-input block w-full' value={organizationId} onChange={event=>setOrganizationId(event.target.value)}>{organizations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></label> : <p><a className='underline' href='/organizations'>Sign in and create or join your organization</a> before claiming.</p>}
            {!!organizations.length && <><label className='block'>Evidence of your connection<textarea className='mh-input block w-full' required minLength={20} maxLength={2000} value={evidence} onChange={event=>setEvidence(event.target.value)} /></label>
            <p className='text-xs'>Provide an official staff page, authorization reference or other evidence. Only you and claim reviewers can read this submission. Do not include passwords or identity document numbers.</p>
            <Button type='submit' disabled={busy||!organizationId}>Submit claim for review</Button></>}
            <Button type='button' variant='neutral' onClick={()=>setOpen(false)}>Cancel</Button>
        </form>}
        {message && <p role='status'>{message}</p>}
    </div>;
}

interface Claim { can_edit:boolean; claim_id:string; resource_uri:string; organization_name:string; status:string; evidence:string; decision_reason?:string; }
export function PublicResourceClaimManagement() {
    const [claims,setClaims] = useState<Claim[]>([]);
    const [loaded,setLoaded] = useState(false);
    const [reviewer,setReviewer] = useState(false);
    const [message,setMessage] = useState('');
    const [busy,setBusy] = useState(false);
    const load = async () => {
        setBusy(true);
        const result=await listPublicResourceClaimsViaApi();setBusy(false);
        if(!result.ok){setMessage(result.error);return;}
        const data=result.data as { claims:Claim[];reviewer:boolean };
        if(!Array.isArray(data.claims)){setMessage('Claims could not be loaded.');return;}
        setClaims(data.claims);setReviewer(data.reviewer);setLoaded(true);
    };
    return <Panel title='Resource claims'>
        <p className='text-sm'>Track claims for public listings. Approved organizations can manage listing details; public addresses remain subject to location review.</p>
        <Button variant='neutral' disabled={busy} onClick={()=>void load()}>{loaded?'Refresh claims':'View resource claims'}</Button>
        {message&&<p role='status'>{message}</p>}
        {loaded&&!claims.length&&<p>No claims yet. Open a public resource and select “Claim this resource” to begin.</p>}
        <ul className='space-y-4'>{claims.map(claim=><li key={claim.claim_id} className='border border-mh-borderSoft p-3'>
            <p className='font-bold'>{claim.organization_name} · {claim.status}</p>
            <a className='underline' href={`/resources?resource=${encodeURIComponent(claim.resource_uri)}`}>View resource</a>
            <p className='whitespace-pre-wrap text-sm'>{claim.evidence}</p>
            {claim.decision_reason&&<p>{claim.decision_reason}</p>}
            {reviewer&&['pending','approved'].includes(claim.status)&&<form onSubmit={event=>{
                event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);
                void decidePublicResourceClaimViaApi({claimId:claim.claim_id,action:String(data.get('action')) as 'approve'|'deny'|'revoke',reason:String(data.get('reason'))}).then(async result=>{setBusy(false);if(!result.ok)setMessage(result.error);else await load();});
            }}>
                <label className='block'>Decision<select name='action' className='mh-input'>{claim.status==='pending'?<><option value='approve'>Approve ownership</option><option value='deny'>Deny claim</option></>:<option value='revoke'>Revoke ownership</option>}</select></label>
                <label className='block'>Review reason<textarea name='reason' className='mh-input block w-full' required minLength={10} maxLength={2000}/></label>
                <Button disabled={busy} type='submit'>Save claim decision</Button>
            </form>}
            {claim.can_edit&&claim.status==='approved'&&<PublicResourceListingEditor resourceUri={claim.resource_uri} />}
        </li>)}</ul>
    </Panel>;
}

function PublicResourceListingEditor({resourceUri}:{resourceUri:string}) {
    const [resource,setResource]=useState<ResourceDetail>();
    const [busy,setBusy]=useState(false);
    const [message,setMessage]=useState('');
    return <div className='mt-3'>
        {!resource&&<Button variant='neutral' disabled={busy} onClick={()=>{
            setBusy(true);void fetchResourceViaApi(resourceUri).then(result=>{setBusy(false);if(result.ok)setResource(result.data);else setMessage(result.error);});
        }}>Edit listing details</Button>}
        {message&&<p role='status'>{message}</p>}
        {resource&&<form className='space-y-2' onSubmit={event=>{
            event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);
            void editPublicResourceViaApi({resourceUri,name:String(data.get('name')),openHours:String(data.get('hours')),eligibilityNotes:String(data.get('access')),contact:{url:String(data.get('website')),...(data.get('phone')?{phone:String(data.get('phone'))}:{})}}).then(result=>{setBusy(false);setMessage(result.ok?'Listing updated. The imported source remains recorded.':result.error);if(result.ok)setResource(undefined);});
        }}>
            <label className='block'>Name<input name='name' className='mh-input block w-full' required maxLength={120} defaultValue={resource.name}/></label>
            <label className='block'>Usual hours<input name='hours' className='mh-input block w-full' required maxLength={200} defaultValue={resource.openHours}/></label>
            <label className='block'>Access and service requirements<textarea name='access' className='mh-input block w-full' required maxLength={500} defaultValue={resource.eligibilityNotes}/></label>
            <label className='block'>Official website<input name='website' type='url' className='mh-input block w-full' required defaultValue={resource.contact.url}/></label>
            <label className='block'>Public phone<input name='phone' className='mh-input block w-full' maxLength={32} defaultValue={resource.contact.phone}/></label>
            <Button type='submit' disabled={busy}>Save listing details</Button>
            <Button type='button' variant='neutral' disabled={busy} onClick={()=>setResource(undefined)}>Cancel</Button>
        </form>}
    </div>;
}
