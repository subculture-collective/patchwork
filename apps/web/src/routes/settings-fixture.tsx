import { useEffect, useMemo, useState } from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ToggleChip } from '../components/ToggleChip';
import { Card } from '../components/Card';
import { Panel } from '../components/Panel';
import {
    deactivateAccountViaApi,
    exportDataViaApi,
    fetchSettingsAuditFromApi,
    fetchSettingsFromApi,
    updateSettingsViaApi,
} from '../features/api-client';
import {
    type SettingsPatch,
    type SettingsSection,
    applySettingsPatch,
    defaultSettingsViewModel,
    isSettingsDirty,
    settingsSectionDescriptions,
    settingsSectionLabels,
    settingsSections,
    validateSettings,
} from '../settings-ux';
import {
    type UserSettings,
    geoSharingPrecisions,
    privacyExposurePreview,
    privacyLevels,
} from '@patchwork/shared';
import {
    formatCategoryLabel,
} from '../features/shell-shared';

interface SettingsRouteProps {
    currentUserDid: string;
}

export const SettingsRoute = ({ currentUserDid }: SettingsRouteProps) => {
    const [settings, setSettings] = useState<UserSettings>(
        defaultSettingsViewModel.settings,
    );
    const [savedSettings, setSavedSettings] = useState<UserSettings>(
        defaultSettingsViewModel.settings,
    );
    const [activeSection, setActiveSection] =
        useState<SettingsSection>('privacy');
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string>();
    const [saveSuccess, setSaveSuccess] = useState<string>();
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [auditEntries, setAuditEntries] = useState<
        readonly {
            field: string;
            oldValue: unknown;
            newValue: unknown;
            timestamp: string;
            actor: string;
        }[]
    >([]);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);
    const [accountActionResult, setAccountActionResult] = useState<string>();

    const dirty = useMemo(
        () => isSettingsDirty(settings, savedSettings),
        [settings, savedSettings],
    );

    useEffect(() => {
        const controller = new AbortController();
        setIsLoadingSettings(true);

        void fetchSettingsFromApi(currentUserDid, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) {
                    return;
                }
                if (result.ok) {
                    setSettings(result.data.settings);
                    setSavedSettings(result.data.settings);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoadingSettings(false);
                }
            });

        return () => {
            controller.abort();
        };
    }, [currentUserDid]);

    const handlePatch = (patch: SettingsPatch) => {
        setSettings((current) => applySettingsPatch(current, patch));
        setSaveSuccess(undefined);
        setSaveError(undefined);
    };

    const handleSave = async () => {
        const validation = validateSettings(settings);
        if (!validation.ok) {
            setSaveError(validation.errors.join('; '));
            return;
        }

        setIsSaving(true);
        setSaveError(undefined);
        setSaveSuccess(undefined);

        const result = await updateSettingsViaApi(currentUserDid, settings);
        setIsSaving(false);

        if (!result.ok) {
            setSaveError(result.error);
            return;
        }

        setSavedSettings(result.data.settings);
        setSettings(result.data.settings);
        setSaveSuccess(
            `Settings saved. ${result.data.changesRecorded} change(s) recorded.`,
        );
    };

    const handleCancel = () => {
        setSettings(savedSettings);
        setSaveError(undefined);
        setSaveSuccess(undefined);
    };

    const handleLoadAudit = async () => {
        setIsLoadingAudit(true);
        const result = await fetchSettingsAuditFromApi(currentUserDid);
        setIsLoadingAudit(false);

        if (result.ok) {
            setAuditEntries(result.data.entries);
        }
    };

    const handleDeactivate = async () => {
        setAccountActionResult(undefined);
        const result = await deactivateAccountViaApi();

        if (result.ok) {
            setAccountActionResult(
                'Account deactivated. Patchwork sessions are revoked and public projections are removed.',
            );
        } else {
            setAccountActionResult(`Error: ${result.error}`);
        }
    };

    const handleExport = async () => {
        setAccountActionResult(undefined);
        const result = await exportDataViaApi();

        if (result.ok) {
            const blob = new Blob([JSON.stringify(result.data, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'patchwork-account-export.json';
            anchor.click();
            URL.revokeObjectURL(url);
            setAccountActionResult('Your Patchwork data export is ready.');
        } else {
            setAccountActionResult(`Error: ${result.error}`);
        }
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>Account settings</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    Privacy controls, contact preferences, notifications, and
                    account management.
                </p>
                {dirty ? (
                    <div className='mt-3'>
                        <Badge tone='info'>Unsaved changes</Badge>
                    </div>
                ) : null}
            </header>

            {/* Section tabs */}
            <div className='flex flex-wrap gap-2'>
                {settingsSections.map((section) => (
                    <ToggleChip
                        key={section}
                        pressed={activeSection === section}
                        onClick={() => setActiveSection(section)}
                    >
                        {settingsSectionLabels[section]}
                    </ToggleChip>
                ))}
            </div>

            <p className='text-sm text-mh-textMuted'>
                {settingsSectionDescriptions[activeSection]}
            </p>

            {isLoadingSettings ? (
                <Panel title='Loading settings'>
                    <div className='space-y-3'>
                        <div className='mh-skeleton h-4 w-3/4' />
                        <div className='mh-skeleton h-4 w-1/2' />
                        <div className='mh-skeleton h-4 w-2/3' />
                    </div>
                </Panel>
            ) : null}

            {/* Privacy section */}
            {!isLoadingSettings && activeSection === 'privacy' ? (
                <Panel title='Privacy controls'>
                    <div className='space-y-4'>
                        <div>
                            <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                                Audience
                            </p>
                            <div className='flex flex-wrap gap-2'>
                                {privacyLevels.map((level) => (
                                    <ToggleChip
                                        key={level}
                                        pressed={settings.privacyLevel === level}
                                        onClick={() =>
                                            handlePatch({
                                                section: 'privacy',
                                                field: 'privacyLevel',
                                                value: level,
                                            })
                                        }
                                    >
                                        {level === 'authenticated' ? 'Signed-in' : formatCategoryLabel(level)}
                                    </ToggleChip>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                                Location
                            </p>
                            <div className='flex flex-wrap gap-2'>
                                {geoSharingPrecisions.map((precision) => (
                                    <ToggleChip
                                        key={precision}
                                        pressed={settings.locationVisibility === precision}
                                        onClick={() =>
                                            handlePatch({
                                                section: 'privacy',
                                                field: 'locationVisibility',
                                                value: precision,
                                            })
                                        }
                                    >
                                        {precision === 'approximate' ? 'Approximate area' : 'Hidden'}
                                    </ToggleChip>
                                ))}
                            </div>
                        </div>
                        <p className='rounded-md border border-mh-border p-3 text-sm text-mh-textMuted'>
                            {privacyExposurePreview(
                                settings.privacyLevel,
                                settings.locationVisibility,
                            )}
                        </p>
                    </div>
                </Panel>
            ) : null}

            {/* Contact section */}
            {!isLoadingSettings && activeSection === 'contact' ? (
                <Panel title='Contact preferences'>
                    <div className='space-y-3'>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.contactPreferences
                                        .allowDirectMessages
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'contact',
                                        field: 'allowDirectMessages',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Allow direct messages
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={settings.contactPreferences.showEmail}
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'contact',
                                        field: 'showEmail',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Show email on profile
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={settings.contactPreferences.showPhone}
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'contact',
                                        field: 'showPhone',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Show phone on profile
                        </label>
                    </div>
                </Panel>
            ) : null}

            {/* Notifications section */}
            {!isLoadingSettings && activeSection === 'notifications' ? (
                <Panel title='Notification preferences'>
                    <div className='space-y-3'>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .aidRequestUpdates
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'aidRequestUpdates',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Aid request updates
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .chatMessages
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'chatMessages',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Chat messages
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .volunteerMatches
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'volunteerMatches',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Volunteer matches
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .systemAnnouncements
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'systemAnnouncements',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            System announcements
                        </label>
                    </div>
                </Panel>
            ) : null}

            {/* Account section */}
            {!isLoadingSettings && activeSection === 'account' ? (
                <Panel title='Account management'>
                    <div className='space-y-4'>
                        <Card title='Data export'>
                            <p className='text-sm text-mh-textMuted'>
                                Download the data Patchwork currently holds
                                about your authenticated account. Credentials,
                                third-party casework, and a complete AT
                                repository archive are excluded.
                            </p>
                            <div className='mt-3'>
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    onClick={handleExport}
                                >
                                    Download data export
                                </Button>
                            </div>
                        </Card>

                        <Card title='Account deactivation'>
                            <p className='text-sm text-mh-textMuted'>
                                Deactivation immediately revokes Patchwork
                                sessions and removes your posts from Patchwork
                                discovery. Records in your independent AT
                                Protocol repository are not deleted.
                                Reactivation requires a controlled support
                                review.
                            </p>
                            <div className='mt-3'>
                                <Button
                                    variant='neutral'
                                    size='sm'
                                    onClick={handleDeactivate}
                                >
                                    Deactivate account
                                </Button>
                            </div>
                        </Card>

                        {accountActionResult ? (
                            <p className='rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold text-mh-success'>
                                {accountActionResult}
                            </p>
                        ) : null}

                        <Card title='Audit trail'>
                            <p className='text-sm text-mh-textMuted'>
                                View a log of all settings changes made to your
                                account.
                            </p>
                            <div className='mt-3'>
                                <Button
                                    variant='neutral'
                                    size='sm'
                                    onClick={handleLoadAudit}
                                    disabled={isLoadingAudit}
                                >
                                    {isLoadingAudit
                                        ? 'Loading...'
                                        : 'Load audit trail'}
                                </Button>
                            </div>

                            {auditEntries.length > 0 ? (
                                <ul className='mt-3 space-y-2'>
                                    {auditEntries.map((entry, index) => (
                                        <li
                                            key={`audit-${index}-${entry.field}`}
                                            className='rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-2 text-xs'
                                        >
                                            <p className='font-bold text-mh-text'>
                                                {entry.field}
                                            </p>
                                            <p className='text-mh-textSoft'>
                                                {String(entry.oldValue)} →{' '}
                                                {String(entry.newValue)}
                                            </p>
                                            <p className='text-mh-textSoft'>
                                                {new Date(
                                                    entry.timestamp,
                                                ).toLocaleString()}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </Card>
                    </div>
                </Panel>
            ) : null}

            {/* Save / Cancel bar */}
            {!isLoadingSettings && activeSection !== 'account' ? (
                <div className='flex flex-wrap items-center gap-3'>
                    <Button onClick={handleSave} disabled={!dirty || isSaving}>
                        {isSaving ? 'Saving...' : 'Save settings'}
                    </Button>
                    <Button
                        variant='neutral'
                        onClick={handleCancel}
                        disabled={!dirty}
                    >
                        Cancel
                    </Button>
                    {saveError ? (
                        <p className='mh-alert text-xs font-bold'>
                            {saveError}
                        </p>
                    ) : null}
                    {saveSuccess ? (
                        <p className='text-xs font-bold text-mh-success'>
                            {saveSuccess}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
};
