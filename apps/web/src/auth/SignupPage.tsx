import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider.js';
import {
    sanitizeReturnTo,
    signup,
    type SignupResult,
    AuthApiError,
} from './auth-api.js';
import {
    CURRENT_POLICY_VERSION,
    requiredPolicyDocuments,
} from '@patchwork/shared';
import { useLocale } from '../i18n';

const safeReturnTo = (): string => {
    if (typeof window === 'undefined') return '/';
    const candidate = new URLSearchParams(window.location.search).get(
        'returnTo',
    );
    return sanitizeReturnTo(candidate ?? '/');
};

const sharedInviteToken = (): string => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('invite') ?? '';
};

const signupErrorMessage = (
    error: AuthApiError,
    t: ReturnType<typeof useLocale>['t'],
): string => {
    if (error.code === 'INVALID_SIGNUP_INPUT') {
        return t('auth.invalidSignup');
    }
    if (error.code === 'INVALID_HANDLE') {
        return t('auth.invalidHandle');
    }
    if (error.code === 'RESERVED_HANDLE') {
        return t('auth.reservedHandle');
    }
    if (error.code === 'HANDLE_ALREADY_EXISTS') {
        return t('auth.takenHandle');
    }
    if (error.code === 'INVALID_INVITE_CODE') {
        return t('auth.invalidInvite');
    }
    if (error.code === 'INVALID_SIGNUP_INVITATION') {
        return t('auth.invalidSharedInvite');
    }
    if (error.code === 'INVALID_PASSWORD') {
        return t('auth.invalidPassword');
    }
    if (error.code === 'PASSWORD_MISMATCH') {
        return t('auth.passwordMismatch');
    }
    if (error.code === 'PDS_RATE_LIMITED' || error.code === 'RATE_LIMITED') {
        return t('auth.rateLimited');
    }
    if (error.code === 'PDS_UNAVAILABLE') {
        return t('auth.signupPdsUnavailable');
    }
    return t('auth.signupFailed');
};

export const SignupPage = () => {
    const auth = useAuth();
    const { t } = useLocale();
    const [handleLabel, setHandleLabel] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirm, setPasswordConfirm] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [inviteToken] = useState(sharedInviteToken);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [eligibilityAccepted, setEligibilityAccepted] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<AuthApiError | null>(null);
    const [createdAccount, setCreatedAccount] = useState<SignupResult | null>(
        null,
    );

    const fullHandle = handleLabel.trim()
        ? `${handleLabel.trim().toLowerCase()}.subcult.tv`
        : '';

    const handleLabelValid = /^[a-z0-9](?:[a-z0-9-]{1,16}[a-z0-9])$/.test(
        handleLabel,
    );

    const passwordsMatch = password === passwordConfirm && password.length > 0;

    const clearPasswords = () => {
        setPassword('');
        setPasswordConfirm('');
    };

    const returnTo = safeReturnTo();

    useEffect(() => {
        if (!inviteToken || typeof window === 'undefined') return;
        const scrubbed = new URL(window.location.href);
        scrubbed.searchParams.delete('invite');
        window.history.replaceState(
            window.history.state,
            '',
            `${scrubbed.pathname}${scrubbed.search}${scrubbed.hash}`,
        );
    }, [inviteToken]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(null);

        if (!handleLabelValid) {
            setError(
                new AuthApiError(
                    'INVALID_HANDLE',
                    'Handle must be 3-18 characters.',
                ),
            );
            clearPasswords();
            return;
        }

        if (!passwordsMatch) {
            setError(
                new AuthApiError('PASSWORD_MISMATCH', 'Passwords do not match.'),
            );
            clearPasswords();
            return;
        }

        if (!termsAccepted || !eligibilityAccepted) {
            setError(
                new AuthApiError(
                    'INVALID_SIGNUP_INPUT',
                    'You must accept the Terms of Service and Privacy Policy.',
                ),
            );
            clearPasswords();
            return;
        }

        setIsLoading(true);

        try {
            const result: SignupResult = await signup({
                handle: fullHandle,
                email: email.trim(),
                password,
                ...(inviteToken ?
                    { inviteToken }
                :   { inviteCode: inviteCode.trim() }),
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            });
            clearPasswords();
            setCreatedAccount(result);
            const started = await auth.login(result.handle, returnTo);
            if (!started) return;
        } catch (err) {
            clearPasswords();
            if (err instanceof AuthApiError) {
                setError(err);
            } else {
                setError(
                    new AuthApiError(
                        'UNKNOWN',
                        'An unexpected error occurred.',
                    ),
                );
            }
        } finally {
            setIsLoading(false);
        }
    };

    if (createdAccount && auth.status === 'error') {
        const loginUrl = `/login${
            returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''
        }`;
        return (
            <main
                id='main-content'
                tabIndex={-1}
                aria-labelledby='signup-recovery-heading'
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
                    <p className='mh-kicker mt-12'>{t('auth.accountReady')}</p>
                    <h1
                        id='signup-recovery-heading'
                        className='font-heading mt-3 text-5xl font-black leading-none tracking-[-0.045em] sm:text-6xl'
                    >
                        {t('auth.oneMoreStep')}
                    </h1>
                </section>
                <div role='status' className='mh-card space-y-4 p-6 sm:p-8'>
                    <p>
                        {t('auth.accountCreated', {
                            handle: createdAccount.handle,
                        })}
                    </p>
                    <p className='text-mh-textMuted'>
                        {t('auth.autoLoginFailed')}
                    </p>
                    <a
                        href={loginUrl}
                        className='mh-button mh-button--primary inline-flex px-4 py-2 font-bold'
                    >
                        {t('auth.continueLogin')}
                    </a>
                </div>
            </main>
        );
    }

    return (
        <main
            id='main-content'
            tabIndex={-1}
            aria-labelledby='signup-heading'
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
                <p className='mh-kicker mt-12'>
                    {t(inviteToken ? 'auth.invitedKicker' : 'auth.safer')}
                </p>
                <h1
                    id='signup-heading'
                    className='font-heading mt-3 text-5xl font-black leading-none tracking-[-0.045em] sm:text-6xl'
                >
                    {t(inviteToken ? 'auth.invitedHeading' : 'auth.joinHeading')}
                </h1>
                <p className='mt-5 max-w-md text-mh-textMuted'>
                    {t(inviteToken ? 'auth.joinHelpShared' : 'auth.joinHelp')}
                </p>
                <p className='mt-4 max-w-md text-sm text-mh-textSoft'>
                    {t('auth.pdsOwnership')}
                </p>
            </section>
            <form
                className='mh-card space-y-4 p-6 sm:p-8'
                onSubmit={submit}
                aria-describedby={error ? 'signup-error' : undefined}
            >
                <p className='mh-kicker'>{t('auth.createYourAccount')}</p>

                {inviteToken ? (
                    <div className='mh-invite-welcome' role='status'>
                        <span className='mh-invite-welcome__mark' aria-hidden='true' />
                        <div>
                            <strong>{t('auth.sharedInviteReady')}</strong>
                            <p className='mt-1 text-sm text-mh-textMuted'>
                                {t('auth.sharedInviteHelp')}
                            </p>
                        </div>
                    </div>
                ) : null}

                <div>
                    <label htmlFor='handle-label' className='block font-bold'>
                        {t('auth.chooseHandle')}
                    </label>
                    <div className='relative'>
                        <input
                            id='handle-label'
                            name='handleLabel'
                            autoComplete='username'
                            required
                            pattern='^[a-z0-9](?:[a-z0-9-]{1,16}[a-z0-9])$'
                            title={t('auth.handleTitle')}
                            value={handleLabel}
                            onChange={(event) =>
                                setHandleLabel(
                                    event.target.value
                                        .toLowerCase()
                                        .replace(/[^a-z0-9-]/g, '')
                                        .slice(0, 18),
                                )
                            }
                            className='mh-input w-full px-3 py-2 pr-[5.5rem]'
                            disabled={isLoading}
                            aria-describedby='handle-suffix'
                        />
                        <span
                            id='handle-suffix'
                            className='pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mh-textMuted'
                            aria-hidden='true'
                        >
                            .subcult.tv
                        </span>
                    </div>
                    <p className='mt-1 text-xs text-mh-textSoft'>
                        {handleLabel.length > 0 && !handleLabelValid
                            ? t('auth.handleInvalid', {
                                  count: handleLabel.length,
                              })
                            : t('auth.handleUnique')}
                    </p>
                </div>

                <div>
                    <label htmlFor='email' className='block font-bold'>
                        {t('auth.email')}
                    </label>
                    <input
                        id='email'
                        name='email'
                        type='email'
                        autoComplete='email'
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className='mh-input w-full px-3 py-2'
                        disabled={isLoading}
                    />
                </div>

                <div>
                    <label htmlFor='password' className='block font-bold'>
                        {t('auth.password')}
                    </label>
                    <input
                        id='password'
                        name='password'
                        type='password'
                        autoComplete='new-password'
                        required
                        minLength={8}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className='mh-input w-full px-3 py-2'
                        disabled={isLoading}
                    />
                </div>

                <div>
                    <label
                        htmlFor='password-confirm'
                        className='block font-bold'
                    >
                        {t('auth.confirmPassword')}
                    </label>
                    <input
                        id='password-confirm'
                        name='passwordConfirm'
                        type='password'
                        autoComplete='new-password'
                        required
                        minLength={8}
                        value={passwordConfirm}
                        onChange={(event) =>
                            setPasswordConfirm(event.target.value)
                        }
                        className='mh-input w-full px-3 py-2'
                        disabled={isLoading}
                        aria-describedby={
                            !passwordsMatch && passwordConfirm.length > 0
                                ? 'password-mismatch'
                                : undefined
                        }
                    />
                    {passwordConfirm.length > 0 && !passwordsMatch && (
                        <p
                            id='password-mismatch'
                            className='mt-1 text-xs text-mh-danger'
                            role='alert'
                        >
                            {t('auth.passwordMismatch')}
                        </p>
                    )}
                </div>

                {!inviteToken ? <div>
                    <label htmlFor='invite-code' className='block font-bold'>
                        {t('auth.inviteCode')}
                    </label>
                    <input
                        id='invite-code'
                        name='inviteCode'
                        type='text'
                        autoComplete='off'
                        required
                        value={inviteCode}
                        onChange={(event) => setInviteCode(event.target.value)}
                        className='mh-input w-full px-3 py-2'
                        disabled={isLoading}
                    />
                </div> : null}

                <div className='flex items-start gap-2'>
                    <input
                        id='terms-accepted'
                        name='termsAccepted'
                        type='checkbox'
                        required
                        checked={termsAccepted}
                        onChange={(event) =>
                            setTermsAccepted(event.target.checked)
                        }
                        className='mt-1 h-4 w-4 accent-mh-accent'
                        disabled={isLoading}
                    />
                    <label
                        htmlFor='terms-accepted'
                        className='text-sm leading-relaxed text-mh-textMuted'
                    >
                        {t('auth.acceptPoliciesPrefix', {
                            version: CURRENT_POLICY_VERSION,
                        })}{' '}
                        <a
                            href='/legal/terms'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='text-mh-link hover:underline'
                        >
                            {t('legal.termsNav')}
                        </a>{' '}
                        {t('auth.and')}{' '}
                        <a
                            href='/legal/privacy'
                            target='_blank'
                            rel='noopener noreferrer'
                            className='text-mh-link hover:underline'
                        >
                            {t('legal.privacyNav')}
                        </a>
                    </label>
                </div>

                <div className='flex items-start gap-2'>
                    <input
                        id='eligibility-accepted'
                        name='eligibilityAccepted'
                        type='checkbox'
                        required
                        checked={eligibilityAccepted}
                        onChange={(event) =>
                            setEligibilityAccepted(event.target.checked)
                        }
                        className='mt-1 h-4 w-4 accent-mh-accent'
                        disabled={isLoading}
                    />
                    <label
                        htmlFor='eligibility-accepted'
                        className='text-sm font-bold leading-relaxed'
                    >
                        {t('auth.age')}
                    </label>
                </div>

                <button
                    type='submit'
                    disabled={
                        isLoading ||
                        !handleLabelValid ||
                        !passwordsMatch ||
                        !termsAccepted ||
                        !eligibilityAccepted
                    }
                    className='mh-button mh-button--primary px-4 py-2 font-bold w-full sm:w-auto'
                >
                    {isLoading ? t('auth.creating') : t('auth.create')}
                </button>

                <p className='text-xs leading-relaxed text-mh-textSoft'>
                    {t('auth.already')}{' '}
                    <a
                        href={`/login${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`}
                        className='text-mh-link hover:underline'
                    >
                        {t('auth.signIn')}
                    </a>
                </p>
                <p className='text-xs leading-relaxed text-mh-textSoft'>
                    {t('auth.recovery')}
                </p>
            </form>
            <div
                aria-live='polite'
                aria-atomic='true'
                className='mh-login-status'
            >
                {isLoading ? t('auth.creatingYour') : null}
            </div>
            {error && (
                <div
                    id='signup-error'
                    role='alert'
                    className='mh-alert mh-login-error p-4'
                >
                    <p>{signupErrorMessage(error, t)}</p>
                    <button type='button' onClick={() => setError(null)}>
                        {t('auth.tryAgain')}
                    </button>
                </div>
            )}
        </main>
    );
};
