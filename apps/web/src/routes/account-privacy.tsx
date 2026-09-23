import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Panel } from '../components/Panel';
import {
    deactivateAccountViaApi,
    exportDataViaApi,
    fetchAccountPreferencesViaApi,
    updateAccountPreferencesViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import { defaultAccountPreferences, type AccountPreferences } from '@patchwork/shared';

interface AccountPrivacyRouteProps {
    onDeactivated: () => Promise<void>;
}

export const AccountPrivacyRoute = ({ onDeactivated }: AccountPrivacyRouteProps) => {
    const { changeLocale, t } = useLocale();
    const [accountActionResult, setAccountActionResult] = useState<string>();
    const [confirmDeactivation, setConfirmDeactivation] = useState(false);
    const [pendingAction, setPendingAction] = useState<
        'export' | 'deactivate'
    >();
    const [preferences, setPreferences] = useState<AccountPreferences>(
        defaultAccountPreferences,
    );
    const [preferencesStatus, setPreferencesStatus] = useState<string>();

    useEffect(() => {
        const controller = new AbortController();
        void fetchAccountPreferencesViaApi(controller.signal).then((result) => {
            if (!controller.signal.aborted && result.ok) {
                setPreferences(result.data);
                changeLocale(result.data.language);
            }
        });
        return () => controller.abort();
    }, [changeLocale]);

    const savePreferences = async () => {
        setPreferencesStatus(String(t('account.saving')));
        const result = await updateAccountPreferencesViaApi(preferences);
        if (!result.ok) {
            setPreferencesStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setPreferences(result.data);
        changeLocale(result.data.language);
        setPreferencesStatus(String(t('account.saved')));
    };

    const handleExport = async () => {
        setPendingAction('export');
        setAccountActionResult(undefined);
        const result = await exportDataViaApi();
        setPendingAction(undefined);

        if (!result.ok) {
            setAccountActionResult(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }

        const blob = new Blob([JSON.stringify(result.data, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'patchwork-account-export.json';
        anchor.click();
        URL.revokeObjectURL(url);
        setAccountActionResult(t('account.exportReady'));
    };

    const handleDeactivate = async () => {
        setPendingAction('deactivate');
        setAccountActionResult(undefined);
        const result = await deactivateAccountViaApi();
        setPendingAction(undefined);

        if (!result.ok) {
            setAccountActionResult(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }

        setConfirmDeactivation(false);
        await onDeactivated();
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('account.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('account.description')}
                </p>
            </header>

            <Panel title={String(t('account.controls'))}>
                <div className='space-y-4'>
                    <Card title={String(t('account.preferences'))}>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('account.visibility')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={preferences.audience}
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            audience: event.target
                                                .value as AccountPreferences['audience'],
                                        }))
                                    }
                                >
                                    <option value='public'>
                                        {t('account.public')}
                                    </option>
                                    <option value='authenticated'>
                                        {t('account.signedIn')}
                                    </option>
                                    <option value='hidden'>
                                        {t('account.hidden')}
                                    </option>
                                </select>
                            </label>
                            <label className='text-sm font-bold'>
                                {t('account.language')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={preferences.language}
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            language: event.target
                                                .value as AccountPreferences['language'],
                                        }))
                                    }
                                >
                                    <option value='en'>
                                        {t('account.english')}
                                    </option>
                                    <option value='es'>
                                        {t('account.spanish')}
                                    </option>
                                </select>
                            </label>
                            <label className='text-sm font-bold'>
                                {t('account.location')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={preferences.location.sharing}
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            location: {
                                                ...current.location,
                                                sharing: event.target
                                                    .value as AccountPreferences['location']['sharing'],
                                            },
                                        }))
                                    }
                                >
                                    <option value='approximate'>
                                        {t('account.approximate')}
                                    </option>
                                    <option value='hidden'>
                                        {t('account.hidden')}
                                    </option>
                                </select>
                            </label>
                        </div>
                        <p className='mt-3 rounded-md border border-mh-border p-3 text-sm text-mh-textMuted'>
                            {t('account.exposurePreview', {
                                audience:
                                    preferences.audience === 'authenticated'
                                        ? t('account.signedIn')
                                        : t(`account.${preferences.audience}`),
                                location:
                                    preferences.location.sharing === 'approximate'
                                        ? t('account.approximate')
                                        : t('account.hidden'),
                            })}
                        </p>
                        <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                            {(
                                [
                                    ['inApp', 'In-app notifications'],
                                    ['email', 'Email notifications'],
                                    ['push', 'Browser push notifications'],
                                ] as const
                            ).map(([channel, label]) => (
                                <label
                                    key={channel}
                                    className='inline-flex items-center gap-2 text-sm'
                                >
                                    <input
                                        type='checkbox'
                                        checked={
                                            preferences.notifications[channel]
                                        }
                                        onChange={(event) =>
                                            setPreferences((current) => ({
                                                ...current,
                                                notifications: {
                                                    ...current.notifications,
                                                    [channel]:
                                                        event.target.checked,
                                                },
                                            }))
                                        }
                                    />
                                    {label}
                                </label>
                            ))}
                            <label className='inline-flex items-center gap-2 text-sm'>
                                <input
                                    type='checkbox'
                                    checked={
                                        preferences.location.noPermanentAddress
                                    }
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            location: {
                                                ...current.location,
                                                noPermanentAddress:
                                                    event.target.checked,
                                            },
                                        }))
                                    }
                                />
                                {t('account.noAddress')}
                            </label>
                        </div>
                        <div className='mt-3 flex items-center gap-3'>
                            <Button
                                size='sm'
                                onClick={() => void savePreferences()}
                            >
                                {t('account.save')}
                            </Button>
                            {preferencesStatus ? (
                                <span
                                    role={
                                        preferencesStatus.startsWith('Error:')
                                            ? 'alert'
                                            : 'status'
                                    }
                                    className='text-xs'
                                >
                                    {preferencesStatus}
                                </span>
                            ) : null}
                        </div>
                    </Card>
                    <Card title={String(t('account.export'))}>
                        <p className='text-sm text-mh-textMuted'>
                            {t('account.exportHelp')}
                        </p>
                        <div className='mt-3'>
                            <Button
                                variant='secondary'
                                size='sm'
                                disabled={pendingAction !== undefined}
                                onClick={() => void handleExport()}
                            >
                                {pendingAction === 'export'
                                    ? t('account.preparing')
                                    : t('account.download')}
                            </Button>
                        </div>
                    </Card>

                    <Card title={String(t('account.deactivation'))}>
                        <p className='text-sm text-mh-textMuted'>
                            {t('account.deactivationHelp')}
                        </p>
                        <div className='mt-3'>
                            <Button
                                variant='neutral'
                                size='sm'
                                disabled={pendingAction !== undefined}
                                onClick={() => setConfirmDeactivation(true)}
                            >
                                {t('account.deactivate')}
                            </Button>
                        </div>
                        {confirmDeactivation ? (
                            <div
                                role='alertdialog'
                                aria-label={String(
                                    t('account.confirmDeactivate'),
                                )}
                                className='mh-alert mt-3'
                            >
                                <p className='text-sm font-bold'>
                                    {t('account.confirm')}
                                </p>
                                <p className='mt-1 text-xs'>
                                    {t('account.confirmHelp')}
                                </p>
                                <div className='mt-2 flex flex-wrap gap-2'>
                                    <Button
                                        type='button'
                                        variant='danger'
                                        disabled={pendingAction !== undefined}
                                        onClick={() => void handleDeactivate()}
                                    >
                                        {pendingAction === 'deactivate'
                                            ? t('account.deactivating')
                                            : t('account.confirmDeactivate')}
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='neutral'
                                        disabled={pendingAction !== undefined}
                                        onClick={() =>
                                            setConfirmDeactivation(false)
                                        }
                                    >
                                        {t('account.keep')}
                                    </Button>
                                </div>
                            </div>
                        ) : null}
                    </Card>

                    {accountActionResult ? (
                        <p
                            role={
                                accountActionResult.startsWith('Error:')
                                    ? 'alert'
                                    : 'status'
                            }
                            className='rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold'
                        >
                            {accountActionResult}
                        </p>
                    ) : null}
                </div>
            </Panel>
        </section>
    );
};
