import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider.js';
import {
    AuthApiError,
    createSignupInvitation,
    listSignupInvitations,
    revokeSignupInvitation,
    type SignupInvitationSummary,
} from './auth-api.js';
import { useLocale } from '../i18n';

const durationOptions = [
    { hours: 1, labelKey: 'adminInvites.oneHour' },
    { hours: 24, labelKey: 'adminInvites.oneDay' },
    { hours: 24 * 7, labelKey: 'adminInvites.sevenDays' },
    { hours: 24 * 30, labelKey: 'adminInvites.thirtyDays' },
];

export const InviteManagementPage = () => {
    const auth = useAuth();
    const { t } = useLocale();
    const [validForHours, setValidForHours] = useState(24);
    const [invitations, setInvitations] = useState<SignupInvitationSummary[]>([]);
    const [createdUrl, setCreatedUrl] = useState('');
    const [status, setStatus] = useState('');
    const [busy, setBusy] = useState(false);

    const load = async () => {
        try {
            setInvitations(await listSignupInvitations());
        } catch (error) {
            setStatus(error instanceof AuthApiError ? error.message : t('adminInvites.loadFailed'));
        }
    };

    useEffect(() => {
        if (auth.session?.canManageSignupInvitations) void load();
    }, [auth.session?.canManageSignupInvitations]);

    if (auth.status === 'booting') {
        return (
            <main className='mh-login-shell'>
                <p role='status'>{t('adminInvites.checking')}</p>
            </main>
        );
    }
    if (!auth.session) {
        return (
            <main className='mh-login-shell'>
                <section className='mh-card p-6'>
                    <h1 className='text-3xl font-black'>{t('adminInvites.title')}</h1>
                    <p className='mt-3'>{t('adminInvites.signInHelp')}</p>
                    <a
                        className='mh-button mh-button--primary mt-5 inline-flex px-4 py-2'
                        href='/login?returnTo=%2Fadmin%2Finvites'
                    >
                        {t('adminInvites.signIn')}
                    </a>
                </section>
            </main>
        );
    }
    if (!auth.session.canManageSignupInvitations) {
        return (
            <main className='mh-login-shell'>
                <section className='mh-card p-6'>
                    <h1 className='text-3xl font-black'>{t('adminInvites.accessRequired')}</h1>
                    <p className='mt-3'>{t('adminInvites.accessHelp')}</p>
                    <a className='mt-5 inline-block font-bold underline' href='/'>
                        {t('adminInvites.return')}
                    </a>
                </section>
            </main>
        );
    }

    const create = async () => {
        setBusy(true);
        setStatus('');
        setCreatedUrl('');
        try {
            const result = await createSignupInvitation(validForHours);
            setCreatedUrl(result.url);
            setStatus(t('adminInvites.created'));
            await load();
        } catch (error) {
            setStatus(error instanceof AuthApiError ? error.message : t('adminInvites.createFailed'));
        } finally {
            setBusy(false);
        }
    };

    const revoke = async (inviteId: string) => {
        setBusy(true);
        setStatus('');
        try {
            await revokeSignupInvitation(inviteId);
            setStatus(t('adminInvites.revoked'));
            await load();
        } catch (error) {
            setStatus(error instanceof AuthApiError ? error.message : t('adminInvites.revokeFailed'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className='mh-grain min-h-screen bg-mh-bg px-4 py-8 text-mh-text'>
            <div className='mx-auto max-w-4xl space-y-6'>
                <header>
                    <a className='font-bold underline' href='/'>
                        {t('adminInvites.returnArrow')}
                    </a>
                    <p className='mh-kicker mt-8'>{t('adminInvites.kicker')}</p>
                    <h1 className='mh-route-title'>{t('adminInvites.title')}</h1>
                    <p className='mt-2 text-mh-textMuted'>
                        {t('adminInvites.description')}
                    </p>
                </header>
                <section className='mh-card p-6' aria-labelledby='create-invite-heading'>
                    <h2 id='create-invite-heading' className='text-2xl font-black'>
                        {t('adminInvites.createHeading')}
                    </h2>
                    <label className='mt-4 block font-bold' htmlFor='invite-validity'>
                        {t('adminInvites.validFor')}
                    </label>
                    <select
                        id='invite-validity'
                        className='mh-input mt-1 w-full px-3 py-2 sm:w-64'
                        value={validForHours}
                        onChange={(event) => setValidForHours(Number(event.target.value))}
                        disabled={busy}
                    >
                        {durationOptions.map((option) => (
                            <option key={option.hours} value={option.hours}>
                                {t(option.labelKey)}
                            </option>
                        ))}
                    </select>
                    <button
                        type='button'
                        className='mh-button mh-button--primary mt-4 px-4 py-2 font-bold'
                        onClick={() => void create()}
                        disabled={busy}
                    >
                        {busy ? t('adminInvites.working') : t('adminInvites.create')}
                    </button>
                    {createdUrl ? (
                        <div className='mt-5 border-2 border-mh-success p-4'>
                            <label className='block font-bold' htmlFor='created-invite-url'>
                                {t('adminInvites.share')}
                            </label>
                            <div className='mt-2 flex flex-col gap-2 sm:flex-row'>
                                <input
                                    id='created-invite-url'
                                    className='mh-input min-w-0 flex-1 px-3 py-2'
                                    readOnly
                                    value={createdUrl}
                                    onFocus={(event) => event.currentTarget.select()}
                                />
                                <button
                                    type='button'
                                    className='mh-button mh-button--secondary px-4 py-2 font-bold'
                                    onClick={() =>
                                        void navigator.clipboard
                                            .writeText(createdUrl)
                                            .then(() => setStatus(t('adminInvites.copied')))
                                    }
                                >
                                    {t('adminInvites.copy')}
                                </button>
                            </div>
                        </div>
                    ) : null}
                    {status ? (
                        <p className='mt-4 text-sm font-bold' role='status'>
                            {status}
                        </p>
                    ) : null}
                </section>
                <section className='mh-card p-6' aria-labelledby='recent-invites-heading'>
                    <h2 id='recent-invites-heading' className='text-2xl font-black'>
                        {t('adminInvites.recent')}
                    </h2>
                    {invitations.length === 0 ? (
                        <p className='mt-3 text-mh-textMuted'>{t('adminInvites.none')}</p>
                    ) : (
                        <ul className='mt-4 space-y-3'>
                            {invitations.map((invitation) => (
                                <li key={invitation.inviteId} className='border-2 border-mh-border p-4'>
                                    <div className='flex flex-wrap items-start justify-between gap-3'>
                                        <div>
                                            <strong className='capitalize'>{invitation.status}</strong>
                                            <p className='text-sm'>
                                                {t('adminInvites.expires', {
                                                    date: new Date(invitation.expiresAt).toLocaleString(),
                                                })}
                                            </p>
                                            <p className='text-sm text-mh-textMuted'>
                                                {t('adminInvites.successfulSignups', {
                                                    count: invitation.successfulUseCount,
                                                })}
                                            </p>
                                        </div>
                                        {invitation.status === 'active' ? (
                                            <button
                                                type='button'
                                                className='mh-button mh-button--neutral px-3 py-2 text-sm font-bold'
                                                disabled={busy}
                                                onClick={() => void revoke(invitation.inviteId)}
                                            >
                                                {t('adminInvites.revoke')}
                                            </button>
                                        ) : null}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            </div>
        </main>
    );
};
