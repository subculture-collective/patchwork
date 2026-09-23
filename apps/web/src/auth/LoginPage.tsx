import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider.js';
import { sanitizeReturnTo } from './auth-api.js';
import { useLocale } from '../i18n';

const safeReturnTo = (): string => {
    if (typeof window === 'undefined') return '/';
    const candidate = new URLSearchParams(window.location.search).get(
        'returnTo',
    );
    return sanitizeReturnTo(candidate ?? '/');
};

const recoveryMessage = (
    code: string,
    t: ReturnType<typeof useLocale>['t'],
): string => {
    if (code === 'PDS_UNAVAILABLE') {
        return t('auth.pdsUnavailable');
    }
    if (code === 'OAUTH_DENIED' || code === 'UNAUTHORIZED') {
        return t('auth.denied');
    }
    if (code === 'OAUTH_STATE_INVALID') {
        return t('auth.stateInvalid');
    }
    if (code === 'SESSION_EXPIRED') {
        return t('auth.sessionExpired');
    }
    return t('auth.authFailed');
};

export const LoginPage = () => {
    const auth = useAuth();
    const { t } = useLocale();
    const [handle, setHandle] = useState('');

    const returnTo = safeReturnTo();

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (handle.trim()) void auth.login(handle, returnTo);
    };

    return (
        <main
            id='main-content'
            tabIndex={-1}
            aria-labelledby='login-heading'
            className='mh-login-shell'
        >
            <section className='mh-login-intro'>
                <a href='/' className='mh-brand'>
                    <span className='mh-brand-mark' aria-hidden='true'>
                        P
                    </span>
                    <span>
                        <strong>{t('app.title')}</strong>
                        <small>{t('auth.tagline')}</small>
                    </span>
                </a>
                <p className='mh-eyebrow mt-10 sm:mt-16'>{t('auth.safer')}</p>
                <h1 id='login-heading' className='mh-login-title'>
                    {t('auth.loginHeading')}
                </h1>
                <p className='mh-page-header__description max-w-md'>
                    {t('auth.loginHelp')}
                </p>
            </section>

            <div className='mh-login-panel'>
                <form className='mh-surface grid gap-4 p-6 sm:p-8' onSubmit={submit}>
                    <p className='mh-eyebrow'>{t('auth.connect')}</p>
                    {auth.error ? (
                        <div role='alert' className='mh-banner mh-banner--danger'>
                            <div className='min-w-0 flex-1'>
                                <p className='font-bold'>{auth.error.message}</p>
                                <p className='mt-1'>
                                    {recoveryMessage(auth.error.code, t)}
                                </p>
                            </div>
                            <button
                                type='button'
                                className='mh-button mh-button--secondary mh-button--sm'
                                onClick={() => void auth.restore()}
                            >
                                {t('auth.retry')}
                            </button>
                        </div>
                    ) : null}
                    <div className='grid gap-1.5'>
                        <label htmlFor='at-handle' className='mh-field-label'>
                            {t('auth.handle')}
                        </label>
                        <p id='at-handle-hint' className='mh-field-hint'>
                            {t('auth.handleHint')}
                        </p>
                        <input
                            id='at-handle'
                            name='handle'
                            autoComplete='username'
                            autoCapitalize='none'
                            spellCheck={false}
                            required
                            aria-describedby='at-handle-hint'
                            placeholder={String(t('auth.handlePlaceholder'))}
                            value={handle}
                            onChange={(event) => setHandle(event.target.value)}
                            className='mh-input w-full px-3 py-2'
                        />
                    </div>
                    <button
                        type='submit'
                        disabled={auth.status === 'redirecting'}
                        className='mh-button mh-button--primary mh-button--md w-full'
                    >
                        {auth.status === 'redirecting'
                            ? t('auth.opening')
                            : t('auth.continue')}
                    </button>
                    <p className='mh-field-hint'>{t('auth.providerHelp')}</p>
                    <div aria-live='polite' className='text-sm text-mh-textMuted'>
                        {auth.status === 'booting'
                            ? t('auth.checkingSession')
                            : null}
                        {auth.status === 'refreshing'
                            ? t('auth.refreshingSession')
                            : null}
                        {auth.status === 'authenticated' && auth.session ? (
                            <p>
                                {t('auth.signedInAs', {
                                    handle: auth.session.handle
                                        ? `@${auth.session.handle.replace(/^@/, '')}`
                                        : t('nav.accountFallback'),
                                })}{' '}
                                <a className='mh-link' href={returnTo}>
                                    {t('auth.continueToPatchwork')}
                                </a>
                            </p>
                        ) : null}
                    </div>
                </form>

                <div className='mh-login-signup'>
                    <p className='mh-field-label'>{t('auth.newHeading')}</p>
                    <p className='mh-field-hint'>{t('auth.newNetwork')}</p>
                    <a
                        href={`/signup${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}
                        className='mh-button mh-button--secondary mh-button--md'
                    >
                        {t('auth.createSubcult')}
                    </a>
                </div>
            </div>
        </main>
    );
};
