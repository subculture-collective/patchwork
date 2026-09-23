import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocale } from '../i18n';
import {
    changeGroupMemberRoleViaApi,
    closeGroupViaApi,
    closeGroupRoomViaApi,
    createGroupRoomViaApi,
    createGroupViaApi,
    fetchGroupsViaApi,
    inviteGroupMemberViaApi,
    leaveGroupViaApi,
    removeGroupMemberViaApi,
    respondToGroupInvitationViaApi,
    revokeGroupInvitationViaApi,
    transferGroupOwnershipViaApi,
    type ProductionGroup,
    type ProductionGroupInvitation,
} from './api-client';

interface GroupState {
    groups: ProductionGroup[];
    invitations: ProductionGroupInvitation[];
    outgoingInvitations: ProductionGroupInvitation[];
}

const emptyState: GroupState = {
    groups: [],
    invitations: [],
    outgoingInvitations: [],
};

export const ProductionGroups = () => {
    const { t, fmt } = useLocale();
    const [data, setData] = useState<GroupState>(emptyState);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [purpose, setPurpose] = useState('');
    const [visibility, setVisibility] = useState<'private' | 'public'>('private');
    const [linkedRequestUri, setLinkedRequestUri] = useState('');
    const [invitationToken, setInvitationToken] = useState('');

    const load = useCallback(async () => {
        setBusy(true);
        setError('');
        const result = await fetchGroupsViaApi();
        if (result.ok) {
            setData(result.data);
            setMessage(t('groups.loaded'));
        } else {
            setError(t('groups.error'));
        }
        setBusy(false);
    }, [t]);

    useEffect(() => { void load(); }, [load]);

    const run = async (operation: () => Promise<{ ok: boolean }>) => {
        setBusy(true);
        setError('');
        setMessage('');
        const result = await operation();
        if (result.ok) {
            await load();
            setMessage(t('groups.operationComplete'));
        } else {
            setError(t('groups.error'));
        }
        setBusy(false);
        return result.ok;
    };

    const createGroup = async (event: FormEvent) => {
        event.preventDefault();
        const ok = await run(() => createGroupViaApi({
            name, description, purpose, visibility,
            ...(linkedRequestUri.trim() ? { linkedRequestUri: linkedRequestUri.trim() } : {}),
        }));
        if (ok) {
            setName(''); setDescription(''); setPurpose(''); setLinkedRequestUri('');
            setMessage(t('groups.created'));
        }
    };

    const respond = async (action: 'accept' | 'reject') => {
        const ok = await run(() => respondToGroupInvitationViaApi({ token: invitationToken.trim(), action }));
        if (ok) setInvitationToken('');
    };

    return (
        <section aria-labelledby='production-groups-heading' className='space-y-6'>
            <header className='mh-route-header'>
                <h1 id='production-groups-heading' className='mh-route-title'>{t('groups.heading')}</h1>
                <p className='mt-2 text-mh-textMuted'>{t('groups.description')}</p>
                <p className='mh-banner mh-banner--info mt-3'>{t('groups.trust')}</p>
            </header>

            <div aria-live='polite' role='status'>{busy ? t('groups.loading') : message}</div>
            {error && <p role='alert' className='mh-banner mh-banner--danger'>{error}</p>}

            <form onSubmit={createGroup} className='mh-card grid gap-4 p-5' aria-labelledby='create-group-heading'>
                <h2 id='create-group-heading' className='font-heading text-xl font-bold'>{t('groups.create')}</h2>
                <label className='grid gap-1 font-bold'>{t('groups.name')}
                    <input className='mh-input px-3 py-2' required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
                </label>
                <label className='grid gap-1 font-bold'>{t('groups.descriptionLabel')}
                    <textarea className='mh-input min-h-24 px-3 py-2' maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} disabled={busy} />
                </label>
                <label className='grid gap-1 font-bold'>{t('groups.purpose')}
                    <textarea className='mh-input min-h-20 px-3 py-2' required maxLength={300} value={purpose} onChange={(event) => setPurpose(event.target.value)} disabled={busy} />
                </label>
                <label className='grid gap-1 font-bold'>{t('groups.visibility')}
                    <select className='mh-input px-3 py-2' value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'public')} disabled={busy}>
                        <option value='private'>{t('groups.private')}</option>
                        <option value='public'>{t('groups.public')}</option>
                    </select>
                </label>
                <label className='grid gap-1 font-bold'>{t('groups.linkedRequest')}
                    <input className='mh-input px-3 py-2' maxLength={2048} value={linkedRequestUri} onChange={(event) => setLinkedRequestUri(event.target.value)} disabled={busy} />
                    <span className='text-sm font-normal text-mh-textMuted'>{t('groups.linkedRequestHelp')}</span>
                </label>
                <button className='mh-button mh-button--primary mh-button--md' disabled={busy}>{busy ? t('groups.creating') : t('groups.create')}</button>
            </form>

            <section className='mh-card space-y-3 p-5' aria-labelledby='invitation-token-heading'>
                <h2 id='invitation-token-heading' className='font-heading text-xl font-bold'>{t('groups.invitationToken')}</h2>
                <p className='text-sm text-mh-textMuted'>{t('groups.invitationTokenHelp')}</p>
                <label className='grid gap-1 font-bold'>{t('groups.invitationToken')}
                    <input className='mh-input px-3 py-2' value={invitationToken} onChange={(event) => setInvitationToken(event.target.value)} autoComplete='off' disabled={busy} />
                </label>
                <div className='flex flex-wrap gap-2'>
                    <button type='button' className='mh-button mh-button--primary mh-button--md' onClick={() => void respond('accept')} disabled={busy || !invitationToken.trim()}>{t('groups.accept')}</button>
                    <button type='button' className='mh-button mh-button--secondary mh-button--md' onClick={() => void respond('reject')} disabled={busy || !invitationToken.trim()}>{t('groups.reject')}</button>
                </div>
                <h3 className='font-bold'>{t('groups.pendingInvitations')}</h3>
                {data.invitations.length === 0 ? <p>{t('groups.noInvitations')}</p> :
                    <ul className='space-y-2'>{data.invitations.map((invitation) =>
                        <li key={invitation.id} className='rounded-md border border-mh-border p-3'>
                            <strong>{invitation.groupName}</strong>
                            <p className='text-sm text-mh-textMuted'>{t('groups.invitedBy', { did: invitation.invitedByDid, role: invitation.role, date: fmt.longDate(invitation.expiresAt) })}</p>
                        </li>)}</ul>}
            </section>

            <section className='space-y-4' aria-labelledby='your-groups-heading'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                    <h2 id='your-groups-heading' className='font-heading text-2xl font-bold'>{t('groups.yourGroups')}</h2>
                    <button type='button' className='mh-button mh-button--secondary mh-button--md' onClick={() => void load()} disabled={busy}>{t('groups.refresh')}</button>
                </div>
                {data.groups.length === 0 ? <p className='mh-card p-5'>{t('groups.noGroups')}</p> :
                    data.groups.map((group) => <GroupCard key={group.id} group={group}
                        outgoing={data.outgoingInvitations.filter((invitation) => invitation.groupId === group.id)}
                        busy={busy} run={run} />)}
            </section>
        </section>
    );
};

const GroupCard = ({ group, outgoing, busy, run }: {
    group: ProductionGroup;
    outgoing: ProductionGroupInvitation[];
    busy: boolean;
    run: (operation: () => Promise<{ ok: boolean }>) => Promise<boolean>;
}) => {
    const { t } = useLocale();
    const [inviteeDid, setInviteeDid] = useState('');
    const [inviteRole, setInviteRole] = useState<'moderator' | 'member'>('member');
    const [issuedToken, setIssuedToken] = useState('');
    const [roomName, setRoomName] = useState('');
    const [roomRequest, setRoomRequest] = useState('');
    const canModerate = group.actorRole === 'owner' || group.actorRole === 'moderator';

    const invite = async (event: FormEvent) => {
        event.preventDefault();
        const result = await inviteGroupMemberViaApi({ groupId: group.id, inviteeDid: inviteeDid.trim(), role: inviteRole });
        if (result.ok) {
            setIssuedToken(result.data.invitation.token);
            setInviteeDid('');
        }
        await run(async () => ({ ok: result.ok }));
    };
    const addRoom = async (event: FormEvent) => {
        event.preventDefault();
        const ok = await run(() => createGroupRoomViaApi({ groupId: group.id, name: roomName,
            ...(roomRequest.trim() ? { linkedRequestUri: roomRequest.trim() } : {}) }));
        if (ok) { setRoomName(''); setRoomRequest(''); }
    };
    const roleLabel = (role: string) => role === 'owner' ? t('labels.owner') : role === 'moderator' ? t('groups.moderator') : t('labels.member');

    return (
        <article className='mh-card space-y-4 p-5'>
            <header>
                <h3 className='font-heading text-xl font-bold'>{group.name}</h3>
                <p>{group.description}</p>
                <p className='text-sm text-mh-textMuted'>{group.purpose}</p>
                <p className='text-sm'>{t('groups.role', { role: roleLabel(group.actorRole) })} · {t('groups.status', { status: group.status === 'active' ? t('labels.active') : t('labels.closed') })}</p>
            </header>

            <section aria-label={t('groups.rooms')}>
                <h4 className='font-bold'>{t('groups.rooms')}</h4>
                <ul>{group.rooms.map((room) => <li key={room.id}>{room.name}{room.linkedRequestUri ? ` — ${t('groups.linked')}` : ''}{canModerate && room.status === 'active' && <button type='button' className='mh-button mh-button--secondary mh-button--sm' disabled={busy} onClick={() => void run(() => closeGroupRoomViaApi({ groupId: group.id, roomId: room.id }))}>{t('groups.closeRoom')}</button>}</li>)}</ul>
            </section>
            <section aria-label={t('groups.members')}>
                <h4 className='font-bold'>{t('groups.members')}</h4>
                <ul className='space-y-2'>{group.members.map((member) =>
                    <li key={member.did} className='break-words rounded-md border border-mh-border p-2'>
                        <span>{member.did} — {roleLabel(member.role)}</span>
                        {group.actorRole === 'owner' && member.role !== 'owner' && <div className='mt-2 flex flex-wrap gap-2'>
                            <button type='button' className='mh-button mh-button--secondary mh-button--sm' disabled={busy} onClick={() => void run(() => changeGroupMemberRoleViaApi({ groupId: group.id, memberDid: member.did, role: member.role === 'moderator' ? 'member' : 'moderator' }))}>{member.role === 'moderator' ? t('groups.demote') : t('groups.promote')}</button>
                            <button type='button' className='mh-button mh-button--secondary mh-button--sm' disabled={busy} onClick={() => window.confirm(t('groups.confirmTransfer')) && void run(() => transferGroupOwnershipViaApi({ groupId: group.id, memberDid: member.did }))}>{t('groups.transfer')}</button>
                            <button type='button' className='mh-button mh-button--danger mh-button--sm' disabled={busy} onClick={() => window.confirm(t('groups.confirmRemove')) && void run(() => removeGroupMemberViaApi({ groupId: group.id, memberDid: member.did }))}>{t('groups.remove')}</button>
                        </div>}
                        {group.actorRole === 'moderator' && member.role === 'member' && <button type='button' className='mh-button mh-button--danger mh-button--sm' disabled={busy} onClick={() => window.confirm(t('groups.confirmRemove')) && void run(() => removeGroupMemberViaApi({ groupId: group.id, memberDid: member.did }))}>{t('groups.remove')}</button>}
                    </li>)}</ul>
            </section>

            {canModerate && <>
                <form onSubmit={invite} className='grid gap-2 rounded-md border border-mh-border p-3'>
                    <h4 className='font-bold'>{t('groups.inviteMember')}</h4>
                    <label className='grid gap-1 font-bold'>{t('groups.memberDid')}<input className='mh-input px-3 py-2' required value={inviteeDid} onChange={(event) => setInviteeDid(event.target.value)} disabled={busy} /></label>
                    <label className='grid gap-1 font-bold'>{t('groups.memberRole')}<select className='mh-input px-3 py-2' value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'moderator' | 'member')} disabled={busy}><option value='member'>{t('groups.member')}</option>{group.actorRole === 'owner' && <option value='moderator'>{t('groups.moderator')}</option>}</select></label>
                    <button className='mh-button mh-button--primary mh-button--md' disabled={busy}>{t('groups.invite')}</button>
                    {issuedToken && <div role='status' className='break-all rounded-md bg-mh-surfaceAlt p-3'><p>{t('groups.tokenOnce')}</p><code>{issuedToken}</code><button type='button' className='mh-button mh-button--secondary mh-button--md' onClick={() => void navigator.clipboard.writeText(issuedToken)}>{t('groups.copyToken')}</button></div>}
                </form>
                <form onSubmit={addRoom} className='grid gap-2 rounded-md border border-mh-border p-3'>
                    <h4 className='font-bold'>{t('groups.createRoom')}</h4>
                    <label className='grid gap-1 font-bold'>{t('groups.roomName')}<input className='mh-input px-3 py-2' required maxLength={80} value={roomName} onChange={(event) => setRoomName(event.target.value)} disabled={busy} /></label>
                    <label className='grid gap-1 font-bold'>{t('groups.roomLinkedRequest')}<input className='mh-input px-3 py-2' maxLength={2048} value={roomRequest} onChange={(event) => setRoomRequest(event.target.value)} disabled={busy} /></label>
                    <button className='mh-button mh-button--primary mh-button--md' disabled={busy}>{t('groups.addRoom')}</button>
                </form>
                {outgoing.length > 0 && <section><h4 className='font-bold'>{t('groups.outgoing')}</h4><ul>{outgoing.map((invitation) => <li key={invitation.id} className='break-words'>{invitation.inviteeDid}<button type='button' className='mh-button mh-button--secondary mh-button--sm' disabled={busy} onClick={() => void run(() => revokeGroupInvitationViaApi({ groupId: group.id, invitationId: invitation.id }))}>{t('groups.revoke')}</button></li>)}</ul></section>}
            </>}

            <div className='flex flex-wrap gap-2'>
                {group.actorRole !== 'owner' && <button type='button' className='mh-button mh-button--secondary mh-button--md' disabled={busy} onClick={() => void run(() => leaveGroupViaApi(group.id))}>{t('groups.leave')}</button>}
                {group.actorRole === 'owner' && <button type='button' className='mh-button mh-button--danger mh-button--md' disabled={busy} onClick={() => window.confirm(t('groups.confirmClose')) && void run(() => closeGroupViaApi(group.id))}>{t('groups.close')}</button>}
            </div>
        </article>
    );
};
