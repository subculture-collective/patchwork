import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type MaintenanceReasonCode,
    type MaintenanceState,
    fetchModeratorMaintenanceViaApi,
    fetchModerationAuditViaApi,
    fetchModerationQueueViaApi,
    applyModerationPolicyViaApi,
    declareMaintenanceViaApi,
    resumeMaintenanceViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import { type ModerationAuditRecord, type ModerationPolicyAction, type ModerationQueueItem } from '@patchwork/shared';
import {
    formatLocalizedLabel,
} from '../features/shell-shared';

const maintenanceReasonOptions: readonly {
    code: MaintenanceReasonCode;
    labelKey: string;
}[] = [
    { code: 'privacy', labelKey: 'moderator.privacyReason' },
    { code: 'authorization', labelKey: 'moderator.authorizationReason' },
    { code: 'abuse', labelKey: 'moderator.abuseReason' },
    { code: 'integrity', labelKey: 'moderator.integrityReason' },
    { code: 'moderation-backlog', labelKey: 'moderator.backlogReason' },
    { code: 'monitoring', labelKey: 'moderator.monitoringReason' },
    { code: 'backup', labelKey: 'moderator.backupReason' },
];

export const ModeratorConsoleRoute = ({
    onMaintenanceChanged,
    currentUserDid,
}: {
    onMaintenanceChanged(state: MaintenanceState): void;
    currentUserDid: string;
}) => {
    const { t, fmt } = useLocale();
    const [items, setItems] = useState<ModerationQueueItem[]>([]);
    const [audit, setAudit] = useState<ModerationAuditRecord[]>([]);
    const [maintenance, setMaintenance] = useState<MaintenanceState>();
    const [selectedUri, setSelectedUri] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [appealFilter, setAppealFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [reason, setReason] = useState(t('moderator.defaultReason'));
    const [maintenanceReasons, setMaintenanceReasons] = useState<
        MaintenanceReasonCode[]
    >(['integrity']);
    const [publicMessage, setPublicMessage] = useState(
        t('moderator.defaultPublicMessage'),
    );
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [accessDenied, setAccessDenied] = useState(false);
    const [notice, setNotice] = useState<string>();
    const [shutdownConfirmed, setShutdownConfirmed] = useState(false);

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setIsLoading(true);
            setError(undefined);
            const [queueResult, maintenanceResult] = await Promise.all([
                fetchModerationQueueViaApi(signal),
                fetchModeratorMaintenanceViaApi(signal),
            ]);
            if (signal?.aborted) return;
            const denied =
                (!queueResult.ok &&
                    (queueResult.code === 'AUTHORIZATION_DENIED' ||
                        queueResult.code === 'AUTHENTICATION_REQUIRED')) ||
                (!maintenanceResult.ok &&
                    (maintenanceResult.code === 'AUTHORIZATION_DENIED' ||
                        maintenanceResult.code === 'AUTHENTICATION_REQUIRED'));
            if (denied) {
                setAccessDenied(true);
                setIsLoading(false);
                return;
            }
            if (!queueResult.ok || !maintenanceResult.ok) {
                setError(
                    !queueResult.ok
                        ? queueResult.error
                        : !maintenanceResult.ok
                          ? maintenanceResult.error
                          : t('moderator.unavailable'),
                );
                setIsLoading(false);
                return;
            }
            setAccessDenied(false);
            setItems(queueResult.data);
            setMaintenance(maintenanceResult.data);
            onMaintenanceChanged(maintenanceResult.data);
            setSelectedUri((current) =>
                queueResult.data.some((item) => item.subjectUri === current)
                    ? current
                    : (queueResult.data[0]?.subjectUri ?? ''),
            );
            setIsLoading(false);
        },
        [onMaintenanceChanged, t],
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const selected = items.find((item) => item.subjectUri === selectedUri);
    const filteredItems = items.filter(
        (item) =>
            (!statusFilter || item.queueStatus === statusFilter) &&
            (!priorityFilter ||
                (item.priority ?? 'normal') === priorityFilter) &&
            (!appealFilter || item.appealState === appealFilter) &&
            (!typeFilter || item.subjectType === typeFilter),
    );

    const loadAudit = async (subjectUri: string) => {
        setSelectedUri(subjectUri);
        const result = await fetchModerationAuditViaApi(subjectUri);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setAudit(result.data);
    };

    const applyAction = async (action: ModerationPolicyAction) => {
        if (!selected || reason.trim().length < 1) return;
        setIsSaving(true);
        setError(undefined);
        const result = await applyModerationPolicyViaApi({
            subjectUri: selected.subjectUri,
            action,
            reason: reason.trim(),
        });
        setIsSaving(false);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setItems((current) =>
            current.map((item) =>
                item.subjectUri === result.data.subjectUri ? result.data : item,
            ),
        );
        setNotice(t('moderator.actionRecorded', {
            action: formatLocalizedLabel(t, action),
        }));
        await loadAudit(result.data.subjectUri);
    };

    const declareMaintenance = async () => {
        if (maintenanceReasons.length === 0) {
            setError(t('moderator.chooseReason'));
            return;
        }
        setIsSaving(true);
        const result = await declareMaintenanceViaApi({
            reasonCodes: maintenanceReasons,
            publicMessage,
        });
        setIsSaving(false);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setMaintenance(result.data);
        onMaintenanceChanged(result.data);
        setShutdownConfirmed(false);
        setNotice(t('moderator.shutdownRecorded'));
    };

    const resume = async () => {
        setIsSaving(true);
        const result = await resumeMaintenanceViaApi();
        setIsSaving(false);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setMaintenance(result.data);
        onMaintenanceChanged(result.data);
        setNotice(t('moderator.resumeRecorded'));
    };

    if (accessDenied) {
        return (
            <Panel title={t('moderator.accessRequired')}>
                <p role='alert'>{t('moderator.accessHelp')}</p>
            </Panel>
        );
    }

    return (
        <div className='space-y-5'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('moderator.title')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('moderator.description')}
                </p>
            </header>
            <Panel title={t('moderator.title')}>
                <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                    <div>
                        <dt className='font-bold'>{t('moderator.actor')}</dt>
                        <dd className='break-all'>{currentUserDid}</dd>
                    </div>
                    <div>
                        <dt className='font-bold'>
                            {t('moderator.capability')}
                        </dt>
                        <dd>{t('moderator.capabilityValue')}</dd>
                    </div>
                    <div>
                        <dt className='font-bold'>
                            {t('moderator.environment')}
                        </dt>
                        <dd>{import.meta.env.MODE}</dd>
                    </div>
                    <div>
                        <dt className='font-bold'>{t('moderator.scope')}</dt>
                        <dd>{t('moderator.scopeValue')}</dd>
                    </div>
                </dl>
                <p className='mt-2 text-sm font-bold'>
                    {t('moderator.reviewTarget')}
                </p>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('moderator.noGo')}
                </p>
                <div className='mt-3 flex flex-wrap gap-3 text-sm'>
                    <a className='font-bold underline' href='/verification'>
                        {t('moderator.verificationControls')}
                    </a>
                    <a className='font-bold underline' href='/verification'>
                        {t('moderator.privateControls')}
                    </a>
                </div>
            </Panel>

            {error ? (
                <p
                    role='alert'
                    className='border-2 border-mh-danger p-3 font-bold'
                >
                    {error}
                </p>
            ) : null}
            {notice ? (
                <p
                    role='status'
                    className='border-2 border-mh-border p-3 font-bold'
                >
                    {notice}
                </p>
            ) : null}

            <Panel title={t('moderator.shutdown')}>
                <p className='text-sm text-mh-textMuted'>
                    {t('moderator.shutdownHelp')}
                </p>
                <p className='mt-2 font-bold'>
                    {t('moderator.currentState', {
                        state: maintenance?.active
                            ? t('moderator.readOnly')
                            : t('moderator.operating'),
                    })}
                    {maintenance?.environmentOverride
                        ? ` (${t('moderator.environmentOverride')})`
                        : ''}
                </p>
                <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                    {maintenanceReasonOptions.map((option) => (
                        <label
                            key={option.code}
                            className='flex items-center gap-2 text-sm'
                        >
                            <input
                                type='checkbox'
                                checked={maintenanceReasons.includes(
                                    option.code,
                                )}
                                onChange={(event) =>
                                    setMaintenanceReasons((current) =>
                                        event.target.checked
                                            ? [...current, option.code]
                                            : current.filter(
                                                  (code) =>
                                                      code !== option.code,
                                              ),
                                    )
                                }
                            />
                            {t(option.labelKey)}
                        </label>
                    ))}
                </div>
                <label className='mt-3 block text-sm font-bold'>
                    {t('moderator.publicMessage')}
                    <Input
                        value={publicMessage}
                        maxLength={300}
                        onChange={(event) =>
                            setPublicMessage(event.target.value)
                        }
                    />
                </label>
                <div className='mt-3 border-2 border-mh-danger p-3 text-sm'>
                    <p className='font-bold'>{t('moderator.blastRadius')}</p>
                    <p className='mt-1 text-mh-textMuted'>
                        {t('moderator.blastRadiusHelp')}
                    </p>
                    <label className='mt-3 flex items-start gap-2 font-bold'>
                        <input
                            type='checkbox'
                            checked={shutdownConfirmed}
                            onChange={(event) =>
                                setShutdownConfirmed(event.target.checked)
                            }
                        />
                        {t('moderator.confirmShutdown')}
                    </label>
                </div>
                <div className='mt-3 flex flex-wrap gap-2'>
                    <Button
                        variant='neutral'
                        disabled={
                            isSaving ||
                            maintenance?.active ||
                            !shutdownConfirmed ||
                            maintenanceReasons.length === 0 ||
                            publicMessage.trim().length === 0
                        }
                        onClick={() => void declareMaintenance()}
                    >
                        {t('moderator.shutDown')}
                    </Button>
                    <Button
                        variant='secondary'
                        disabled={
                            isSaving ||
                            !maintenance?.active ||
                            maintenance.environmentOverride
                        }
                        onClick={() => void resume()}
                    >
                        {t('moderator.resume')}
                    </Button>
                </div>
            </Panel>

            <Panel title={t('moderator.queue')}>
                <div className='grid gap-2 sm:grid-cols-4'>
                    <select
                        aria-label={t('moderator.filterStatus')}
                        value={statusFilter}
                        onChange={(event) =>
                            setStatusFilter(event.target.value)
                        }
                    >
                        <option value=''>{t('moderator.allStatuses')}</option>
                        <option value='queued'>{t('moderator.queued')}</option>
                        <option value='processing'>
                            {t('moderator.processing')}
                        </option>
                        <option value='resolved'>
                            {t('moderator.resolved')}
                        </option>
                    </select>
                    <select
                        aria-label={t('moderator.filterPriority')}
                        value={priorityFilter}
                        onChange={(event) =>
                            setPriorityFilter(event.target.value)
                        }
                    >
                        <option value=''>{t('moderator.allPriorities')}</option>
                        <option value='urgent'>{t('moderator.urgent')}</option>
                        <option value='high'>{t('moderator.high')}</option>
                        <option value='normal'>{t('moderator.normal')}</option>
                        <option value='low'>{t('moderator.low')}</option>
                    </select>
                    <select
                        aria-label={t('moderator.filterAppeal')}
                        value={appealFilter}
                        onChange={(event) =>
                            setAppealFilter(event.target.value)
                        }
                    >
                        <option value=''>{t('moderator.allAppeals')}</option>
                        <option value='none'>{t('moderator.noAppeal')}</option>
                        <option value='pending'>
                            {t('moderator.pending')}
                        </option>
                        <option value='under-review'>
                            {t('moderator.underReview')}
                        </option>
                        <option value='upheld'>{t('moderator.upheld')}</option>
                        <option value='rejected'>
                            {t('moderator.rejected')}
                        </option>
                    </select>
                    <select
                        aria-label={t('moderator.filterType')}
                        value={typeFilter}
                        onChange={(event) => setTypeFilter(event.target.value)}
                    >
                        <option value=''>{t('moderator.allTypes')}</option>
                        <option value='aid-post'>
                            {t('moderator.aidPost')}
                        </option>
                        <option value='directory-resource'>
                            {t('moderator.directoryResource')}
                        </option>
                        <option value='other'>{t('moderator.other')}</option>
                    </select>
                </div>
                {isLoading ? (
                    <p className='mt-4' role='status'>
                        {t('moderator.loading')}
                    </p>
                ) : filteredItems.length === 0 ? (
                    <p className='mt-4'>{t('moderator.empty')}</p>
                ) : (
                    <div className='mt-4 grid gap-3 lg:grid-cols-2'>
                        {filteredItems.map((item) => (
                            <button
                                type='button'
                                key={item.subjectUri}
                                onClick={() => void loadAudit(item.subjectUri)}
                                className='border-2 border-mh-border p-3 text-left'
                                aria-pressed={selectedUri === item.subjectUri}
                            >
                                <span className='font-bold'>
                                    {item.safePreview?.['label'] ??
                                        t('moderator.submitted')}
                                </span>
                                <span className='mt-1 block text-xs uppercase'>
                                    {item.priority ?? 'normal'} ·{' '}
                                    {item.subjectType} · {item.queueStatus} ·{' '}
                                    {item.recordOrigin ??
                                        t('moderator.visitorCreated')}
                                </span>
                                <span className='mt-2 block text-sm'>
                                    {(
                                        item.reasonCodes ?? [item.latestReason]
                                    ).join(', ')}
                                </span>
                                <span className='mt-2 block break-all text-xs text-mh-textMuted'>
                                    {item.subjectUri}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </Panel>

            {selected ? (
                <Panel title={t('moderator.caseActions')}>
                    <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                        {Object.entries(selected.safePreview ?? {}).map(
                            ([key, value]) => (
                                <div key={key}>
                                    <dt className='font-bold'>{key}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ),
                        )}
                    </dl>
                    <label className='mt-3 block text-sm font-bold'>
                        {t('moderator.auditReason')}
                        <Input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </label>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {selected.visibility !== 'suspended' ? (
                            <Button
                                variant='neutral'
                                disabled={isSaving}
                                onClick={() =>
                                    void applyAction('suspend-visibility')
                                }
                            >
                                {t('moderator.quarantine')}
                            </Button>
                        ) : null}
                        {selected.visibility !== 'delisted' ? (
                            <Button
                                variant='neutral'
                                disabled={isSaving}
                                onClick={() => void applyAction('delist')}
                            >
                                {t('moderator.delist')}
                            </Button>
                        ) : null}
                        {selected.visibility !== 'visible' ? (
                            <Button
                                variant='secondary'
                                disabled={isSaving}
                                onClick={() =>
                                    void applyAction('restore-visibility')
                                }
                            >
                                {t('moderator.restore')}
                            </Button>
                        ) : null}
                        {selected.appealState === 'none' ? (
                            <Button
                                variant='secondary'
                                disabled={isSaving}
                                onClick={() => void applyAction('open-appeal')}
                            >
                                {t('moderator.openAppeal')}
                            </Button>
                        ) : selected.appealState === 'pending' ? (
                            <Button
                                variant='secondary'
                                disabled={isSaving}
                                onClick={() =>
                                    void applyAction('start-appeal-review')
                                }
                            >
                                {t('moderator.startAppeal')}
                            </Button>
                        ) : selected.appealState === 'under-review' ? (
                            <>
                                <Button
                                    variant='secondary'
                                    disabled={isSaving}
                                    onClick={() =>
                                        void applyAction(
                                            'resolve-appeal-upheld',
                                        )
                                    }
                                >
                                    {t('moderator.upholdAppeal')}
                                </Button>
                                <Button
                                    variant='neutral'
                                    disabled={isSaving}
                                    onClick={() =>
                                        void applyAction(
                                            'resolve-appeal-rejected',
                                        )
                                    }
                                >
                                    {t('moderator.rejectAppeal')}
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <h3 className='mt-5 font-bold'>
                        {t('moderator.auditTrail')}
                    </h3>
                    {audit.length === 0 ? (
                        <p className='text-sm text-mh-textMuted'>
                            {t('moderator.selectAudit')}
                        </p>
                    ) : (
                        <ol className='mt-2 space-y-2'>
                            {audit.map((entry) => (
                                <li
                                    key={entry.actionId}
                                    className='border-l-4 border-mh-border pl-3 text-sm'
                                >
                                    <strong>
                                        {t('moderator.auditBy', {
                                            action: formatLocalizedLabel(
                                                t,
                                                entry.action,
                                            ),
                                            actor: entry.actorDid,
                                        })}
                                    </strong>
                                    <span className='block'>
                                        {entry.reason}
                                    </span>
                                    <time dateTime={entry.occurredAt}>
                                        {fmt.longDate(entry.occurredAt)}
                                    </time>
                                </li>
                            ))}
                        </ol>
                    )}
                </Panel>
            ) : null}
        </div>
    );
};
