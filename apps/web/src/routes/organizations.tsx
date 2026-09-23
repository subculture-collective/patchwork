import {
    useCallback,
    useEffect,
    useState,
    type FormEvent,
} from 'react';
import { StatusMessage } from '../components/StatusMessage';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type MyOrganization,
    type OrganizationMember,
    type OrganizationStewardship,
    type PublicOrganization,
    acceptOrganizationInvitationViaApi,
    assignOrganizationStewardshipViaApi,
    createOrganizationViaApi,
    fetchMyOrganizationsViaApi,
    fetchOrganizationMembersViaApi,
    fetchOrganizationsViaApi,
    fetchOrganizationStewardshipsViaApi,
    inviteOrganizationMemberViaApi,
    reconfirmOrganizationStewardshipViaApi,
    removeOrganizationMemberViaApi,
    updateOrganizationMemberRoleViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import {
    formatLocalizedLabel,
} from '../features/shell-shared';

const organizationAdminRoles = new Set(['owner', 'admin']);

export const OrganizationsRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [organizations, setOrganizations] = useState<PublicOrganization[]>(
        [],
    );
    const [mine, setMine] = useState<MyOrganization[]>([]);
    const [members, setMembers] = useState<OrganizationMember[]>([]);
    const [stewardships, setStewardships] = useState<OrganizationStewardship[]>(
        [],
    );
    const [selectedId, setSelectedId] = useState('');
    const [searchText, setSearchText] = useState('');
    const [status, setStatus] = useState(t('organizations.loading'));
    const [actionStatus, setActionStatus] = useState<string>();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [inviteeDid, setInviteeDid] = useState('');
    const [inviteRole, setInviteRole] = useState<
        'admin' | 'steward' | 'member'
    >('steward');
    const [invitationToken, setInvitationToken] = useState('');
    const [acceptToken, setAcceptToken] = useState('');
    const [resourceUri, setResourceUri] = useState('');
    const [stewardDid, setStewardDid] = useState('');

    const loadPublic = useCallback(async () => {
        setStatus(t('organizations.loading'));
        const result = await fetchOrganizationsViaApi(searchText);
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setOrganizations(result.data);
        setStatus(
            result.data.length
                ? t('organizations.results', { count: result.data.length })
                : t('organizations.noResults'),
        );
    }, [searchText, t]);

    const loadPrivate = useCallback(async () => {
        if (!did) {
            setMine([]);
            setMembers([]);
            setStewardships([]);
            return;
        }
        const result = await fetchMyOrganizationsViaApi();
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setMine(result.data);
        const nextSelected = result.data.some((item) => item.id === selectedId)
            ? selectedId
            : (result.data[0]?.id ?? '');
        setSelectedId(nextSelected);
        if (!nextSelected) {
            setMembers([]);
            setStewardships([]);
            return;
        }
        const [memberResult, stewardshipResult] = await Promise.all([
            fetchOrganizationMembersViaApi(nextSelected),
            fetchOrganizationStewardshipsViaApi(nextSelected),
        ]);
        if (memberResult.ok) setMembers(memberResult.data);
        if (stewardshipResult.ok) setStewardships(stewardshipResult.data);
    }, [did, selectedId, t]);

    useEffect(() => {
        void loadPublic();
    }, [loadPublic]);

    useEffect(() => {
        void loadPrivate();
    }, [loadPrivate]);

    const selected = mine.find((item) => item.id === selectedId);
    const canAdmin = selected
        ? organizationAdminRoles.has(selected.membership.role)
        : false;

    const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setActionStatus(t('organizations.creating'));
        const result = await createOrganizationViaApi({ name, description });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setName('');
        setDescription('');
        setSelectedId(result.data.organization.id);
        setActionStatus(t('organizations.created'));
        await Promise.all([loadPublic(), loadPrivate()]);
    };

    const invite = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        setActionStatus(t('organizations.creatingInvitation'));
        const result = await inviteOrganizationMemberViaApi({
            organizationId: selected.id,
            inviteeDid,
            role: inviteRole,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setInvitationToken(result.data.token);
        setInviteeDid('');
        setActionStatus(t('organizations.invitationCreated'));
    };

    const acceptInvitation = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setActionStatus(t('organizations.accepting'));
        const result = await acceptOrganizationInvitationViaApi(acceptToken);
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setAcceptToken('');
        setSelectedId(result.data.organizationId);
        setActionStatus(t('organizations.accepted'));
        await loadPrivate();
    };

    const assignStewardship = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        setActionStatus(t('organizations.assigning'));
        const result = await assignOrganizationStewardshipViaApi({
            organizationId: selected.id,
            resourceUri,
            stewardDid,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setResourceUri('');
        setStewardDid('');
        setActionStatus(t('organizations.assigned'));
        await loadPrivate();
    };

    const reconfirm = async (item: OrganizationStewardship) => {
        setActionStatus(t('organizations.reconfirming'));
        const result = await reconfirmOrganizationStewardshipViaApi({
            organizationId: item.organizationId,
            stewardshipId: item.id,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setActionStatus(t('organizations.reconfirmed'));
        await loadPrivate();
    };

    const updateMemberRole = async (
        member: OrganizationMember,
        role: 'admin' | 'steward' | 'member',
    ) => {
        setActionStatus(t('organizations.updatingRole'));
        const result = await updateOrganizationMemberRoleViaApi({
            organizationId: member.organizationId,
            memberDid: member.memberDid,
            role,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setActionStatus(t('organizations.roleUpdated'));
        await loadPrivate();
    };

    const removeMember = async (member: OrganizationMember) => {
        setActionStatus(t('organizations.removingMember'));
        const result = await removeOrganizationMemberViaApi({
            organizationId: member.organizationId,
            memberDid: member.memberDid,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setActionStatus(t('organizations.memberRemoved'));
        await loadPrivate();
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('organizations.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('organizations.description')}
                </p>
            </header>

            <Panel title={String(t('organizations.find'))}>
                <form
                    className='flex flex-wrap items-end gap-2'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void loadPublic();
                    }}
                >
                    <label className='grow text-sm font-bold'>
                        {t('organizations.search')}
                        <Input
                            value={searchText}
                            onChange={(event) =>
                                setSearchText(event.target.value)
                            }
                        />
                    </label>
                    <Button type='submit'>
                        {t('organizations.submitSearch')}
                    </Button>
                </form>
                <StatusMessage message={status} className='mt-3' />
                <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                    {organizations.map((organization) => (
                        <Card key={organization.id} title={organization.name}>
                            <p className='text-sm'>
                                {organization.description}
                            </p>
                            <p className='mt-2 text-xs font-bold text-mh-textMuted'>
                                {t('organizations.origin', {
                                    origin: formatLocalizedLabel(
                                        t,
                                        organization.origin,
                                    ),
                                })}
                            </p>
                            {organization.provenance ? (
                                <p className='mt-1 text-xs text-mh-textMuted'>
                                    {t('organizations.source')}{' '}
                                    <a
                                        className='mh-link'
                                        href={organization.provenance.sourceUrl}
                                        rel='noreferrer'
                                        target='_blank'
                                    >
                                        {t('organizations.authoritative')}
                                    </a>{' '}
                                    ·{' '}
                                    {fmt.shortDate(
                                        organization.provenance.lastVerifiedAt,
                                    )}
                                </p>
                            ) : null}
                            <p className='mt-2 text-xs text-mh-textMuted'>
                                {organization.nonEndorsementLabel}
                            </p>
                        </Card>
                    ))}
                </div>
            </Panel>

            {did ? (
                <>
                    <Panel title={String(t('organizations.join'))}>
                        <form
                            className='flex flex-wrap items-end gap-2'
                            onSubmit={acceptInvitation}
                        >
                            <label className='grow text-sm font-bold'>
                                {t('organizations.token')}
                                <Input
                                    value={acceptToken}
                                    onChange={(event) =>
                                        setAcceptToken(event.target.value)
                                    }
                                />
                            </label>
                            <Button type='submit'>
                                {t('organizations.accept')}
                            </Button>
                        </form>
                    </Panel>

                    <Panel title={String(t('organizations.create'))}>
                        <form
                            className='space-y-3'
                            onSubmit={createOrganization}
                        >
                            <label className='block text-sm font-bold'>
                                {t('organizations.name')}
                                <Input
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                />
                            </label>
                            <label className='block text-sm font-bold'>
                                {t('organizations.descriptionLabel')}
                                <textarea
                                    className='mh-input mt-1 min-h-24 w-full px-3 py-2'
                                    value={description}
                                    onChange={(event) =>
                                        setDescription(event.target.value)
                                    }
                                />
                            </label>
                            <Button type='submit'>
                                {t('organizations.createAction')}
                            </Button>
                        </form>
                    </Panel>

                    {mine.length ? (
                        <Panel title={String(t('organizations.manage'))}>
                            <label className='block text-sm font-bold'>
                                {t('organizations.organization')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={selectedId}
                                    onChange={(event) =>
                                        setSelectedId(event.target.value)
                                    }
                                >
                                    {mine.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name} · {item.membership.role}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {selected ? (
                                <>
                                    <p className='mt-3 text-sm'>
                                        {t('organizations.role', {
                                            role: formatLocalizedLabel(
                                                t,
                                                selected.membership.role,
                                            ),
                                        })}
                                    </p>
                                    <ul className='mt-3 space-y-2 text-sm'>
                                        {members.map((member) => {
                                            const canManageMember =
                                                canAdmin &&
                                                member.role !== 'owner' &&
                                                (selected.membership.role ===
                                                    'owner' ||
                                                    member.role !== 'admin');
                                            return (
                                                <li
                                                    key={member.memberDid}
                                                    className='flex flex-wrap items-center gap-2'
                                                >
                                                    <span>
                                                        {member.memberDid} ·{' '}
                                                        {member.role}
                                                    </span>
                                                    {canManageMember ? (
                                                        <>
                                                            <label className='text-xs font-bold'>
                                                                {t(
                                                                    'organizations.roleFor',
                                                                    {
                                                                        did: member.memberDid,
                                                                    },
                                                                )}
                                                                <select
                                                                    className='mh-input ml-2 px-2 py-1'
                                                                    value={
                                                                        member.role
                                                                    }
                                                                    onChange={(
                                                                        event,
                                                                    ) =>
                                                                        void updateMemberRole(
                                                                            member,
                                                                            event
                                                                                .target
                                                                                .value as
                                                                                | 'admin'
                                                                                | 'steward'
                                                                                | 'member',
                                                                        )
                                                                    }
                                                                >
                                                                    <option value='admin'>
                                                                        {t(
                                                                            'organizations.admin',
                                                                        )}
                                                                    </option>
                                                                    <option value='steward'>
                                                                        {t(
                                                                            'organizations.steward',
                                                                        )}
                                                                    </option>
                                                                    <option value='member'>
                                                                        {t(
                                                                            'organizations.member',
                                                                        )}
                                                                    </option>
                                                                </select>
                                                            </label>
                                                            <Button
                                                                type='button'
                                                                variant='neutral'
                                                                onClick={() =>
                                                                    void removeMember(
                                                                        member,
                                                                    )
                                                                }
                                                            >
                                                                {t(
                                                                    'organizations.remove',
                                                                )}{' '}
                                                                {
                                                                    member.memberDid
                                                                }
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                </li>
                                            );
                                        })}
                                    </ul>

                                    {canAdmin ? (
                                        <div className='mt-5 grid gap-5 lg:grid-cols-2'>
                                            <form
                                                className='space-y-3'
                                                onSubmit={invite}
                                            >
                                                <h3 className='font-bold'>
                                                    {t('organizations.invite')}
                                                </h3>
                                                <label className='block text-sm font-bold'>
                                                    {t('organizations.invitee')}
                                                    <Input
                                                        value={inviteeDid}
                                                        onChange={(event) =>
                                                            setInviteeDid(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <label className='block text-sm font-bold'>
                                                    {t(
                                                        'organizations.organizationRole',
                                                    )}
                                                    <select
                                                        className='mh-input mt-1 w-full px-3 py-2'
                                                        value={inviteRole}
                                                        onChange={(event) =>
                                                            setInviteRole(
                                                                event.target
                                                                    .value as typeof inviteRole,
                                                            )
                                                        }
                                                    >
                                                        <option value='admin'>
                                                            {t(
                                                                'organizations.admin',
                                                            )}
                                                        </option>
                                                        <option value='steward'>
                                                            {t(
                                                                'organizations.steward',
                                                            )}
                                                        </option>
                                                        <option value='member'>
                                                            {t(
                                                                'organizations.member',
                                                            )}
                                                        </option>
                                                    </select>
                                                </label>
                                                <Button type='submit'>
                                                    {t(
                                                        'organizations.createInvitation',
                                                    )}
                                                </Button>
                                                {invitationToken ? (
                                                    <label className='block text-sm font-bold'>
                                                        {t(
                                                            'organizations.oneTimeToken',
                                                        )}
                                                        <Input
                                                            readOnly
                                                            value={
                                                                invitationToken
                                                            }
                                                        />
                                                    </label>
                                                ) : null}
                                            </form>

                                            <form
                                                className='space-y-3'
                                                onSubmit={assignStewardship}
                                            >
                                                <h3 className='font-bold'>
                                                    {t('organizations.assign')}
                                                </h3>
                                                <label className='block text-sm font-bold'>
                                                    {t(
                                                        'organizations.resourceUri',
                                                    )}
                                                    <Input
                                                        value={resourceUri}
                                                        onChange={(event) =>
                                                            setResourceUri(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <label className='block text-sm font-bold'>
                                                    {t(
                                                        'organizations.stewardDid',
                                                    )}
                                                    <Input
                                                        value={stewardDid}
                                                        onChange={(event) =>
                                                            setStewardDid(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <Button type='submit'>
                                                    {t(
                                                        'organizations.assignAction',
                                                    )}
                                                </Button>
                                            </form>
                                        </div>
                                    ) : null}

                                    <div className='mt-5 space-y-2'>
                                        <h3 className='font-bold'>
                                            {t('organizations.stewarded')}
                                        </h3>
                                        {stewardships.length ? (
                                            stewardships.map((item) => {
                                                const mayReconfirm =
                                                    canAdmin ||
                                                    (selected.membership
                                                        .role === 'steward' &&
                                                        item.stewardDid ===
                                                            did);
                                                return (
                                                    <Card
                                                        key={item.id}
                                                        title={item.resourceUri}
                                                    >
                                                        <p className='text-xs'>
                                                            {item.status} ·{' '}
                                                            {t(
                                                                'organizations.due',
                                                                {
                                                                    date: fmt.shortDate(
                                                                        item.reconfirmDueAt,
                                                                    ),
                                                                },
                                                            )}
                                                        </p>
                                                        {mayReconfirm ? (
                                                            <p className='mt-2'>
                                                                <Button
                                                                    type='button'
                                                                    variant='neutral'
                                                                    onClick={() =>
                                                                        void reconfirm(
                                                                            item,
                                                                        )
                                                                    }
                                                                >
                                                                    {t(
                                                                        'organizations.reconfirm',
                                                                    )}
                                                                </Button>
                                                            </p>
                                                        ) : null}
                                                    </Card>
                                                );
                                            })
                                        ) : (
                                            <p className='text-sm text-mh-textMuted'>
                                                {t('organizations.none')}
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : null}
                        </Panel>
                    ) : null}
                    {actionStatus ? (
                        <StatusMessage message={actionStatus} />
                    ) : null}
                </>
            ) : (
                <Panel title={String(t('organizations.signIn'))}>
                    <p>{t('organizations.signInHelp')}</p>
                </Panel>
            )}
        </section>
    );
};
