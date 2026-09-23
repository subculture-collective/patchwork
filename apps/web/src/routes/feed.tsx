import {
    useCallback,
    useMemo,
    useState,
    type FormEvent,
} from 'react';
import { type DiscoveryFilterState } from '../discovery-filters';
import {
    buildFeedViewModel,
    type FeedAidCard,
    type FeedStatusTransition,
    type LifecycleStatus,
} from '../feed-ux';
import { type ChatEntrySurface } from '../chat-ux';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import {
    type AidPostReportReason,
    type ApiDataOrigin,
    blockUserViaApi,
    closeAtAidPostViaApi,
    deleteAtAidPostViaApi,
    reportAidPostViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import { type FeedRecordEnvelope } from '../features/discovery-runtime';
import {
    type AppRoute,
} from '../app/routes';
import {
    dataOriginLabel,
    nowIso,
    webDataMode,
} from '../app/runtime';
import {
    DiscoveryFiltersPanel,
    PublicSyncFailure,
    usePaginationFocus,
} from '../features/shell-shared';

const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
    open: 'Open',
    triaged: 'Triaged',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    archived: 'Archived',
};

const LIFECYCLE_STATUS_TONES: Record<
    string,
    'neutral' | 'info' | 'success' | 'danger'
> = {
    open: 'danger',
    triaged: 'info',
    assigned: 'info',
    in_progress: 'info',
    resolved: 'success',
    archived: 'neutral',
};

interface StatusTimelineProps {
    timeline: readonly FeedStatusTransition[];
}

const StatusTimeline = ({ timeline }: StatusTimelineProps) => {
    const { t, fmt } = useLocale();
    if (timeline.length === 0) {
        return (
            <p className='text-xs text-mh-textSoft'>
                {t('safety.noTransitions')}
            </p>
        );
    }

    return (
        <ol className='space-y-2'>
            {timeline.map((entry, index) => (
                <li
                    key={`${entry.timestamp}-${index}`}
                    className='flex items-start gap-3 border-l-2 border-mh-borderSoft pl-3'
                >
                    <div className='flex-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                            <Badge
                                tone={
                                    LIFECYCLE_STATUS_TONES[entry.from] ??
                                    'neutral'
                                }
                            >
                                {LIFECYCLE_STATUS_LABELS[entry.from] ??
                                    entry.from}
                            </Badge>
                            <span className='text-xs text-mh-textSoft'>
                                {'->'}
                            </span>
                            <Badge
                                tone={
                                    LIFECYCLE_STATUS_TONES[entry.to] ??
                                    'neutral'
                                }
                            >
                                {LIFECYCLE_STATUS_LABELS[entry.to] ?? entry.to}
                            </Badge>
                        </div>
                        <p className='mt-1 text-xs text-mh-textSoft'>
                            {t('safety.transitionAt', {
                                role: entry.actorRole,
                                did: entry.actorDid,
                                date: fmt.longDate(entry.timestamp),
                            })}
                        </p>
                        {entry.reason ? (
                            <p className='mt-1 text-xs text-mh-textMuted'>
                                {t('safety.reason', { reason: entry.reason })}
                            </p>
                        ) : null}
                    </div>
                </li>
            ))}
        </ol>
    );
};

interface FeedRouteProps {
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    feedRecords: readonly FeedRecordEnvelope[];
    isLoading: boolean;
    errorMessage?: string;
    dataOrigin: ApiDataOrigin;
    onRetry: () => void;
    hasNextPage: boolean;
    total: number;
    onLoadMore: () => void;
    publicSyncFailure?: PublicSyncFailure;
    publicSyncRetrying: boolean;
    onRetryPublicSync: () => void;
    onNavigate: (route: AppRoute) => void;
    onOpenChat: (record: FeedRecordEnvelope, surface: ChatEntrySurface) => void;
    onUpdateCard: (id: string, patch: Partial<Omit<FeedAidCard, 'id'>>) => void;
    onReplaceRecord: (record: FeedRecordEnvelope) => void;
    onDeleteRecord: (aidPostUri: string) => void;
    onTransition?: (
        id: string,
        postUri: string,
        targetStatus: LifecycleStatus,
    ) => void;
    currentUserDid?: string;
}

const SafetyActions = ({
    record,
    position,
    total,
}: {
    record: FeedRecordEnvelope;
    position: number;
    total: number;
}) => {
    const { t } = useLocale();
    const [mode, setMode] = useState<'report' | 'block'>();
    const [reason, setReason] = useState<AidPostReportReason>('other');
    const [details, setDetails] = useState('');
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState<string>();
    const [error, setError] = useState<string>();

    const submitReport = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPending(true);
        setNotice(undefined);
        setError(undefined);
        const result = await reportAidPostViaApi({
            subjectUri: record.aidPostUri,
            reason,
            ...(details.trim() ? { details: details.trim() } : {}),
        });
        setPending(false);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setNotice(
            result.data.created
                ? t('safety.reportSubmitted')
                : t('safety.reportDuplicate'),
        );
        setMode(undefined);
        setDetails('');
    };

    const confirmBlock = async () => {
        setPending(true);
        setNotice(undefined);
        setError(undefined);
        const result = await blockUserViaApi({
            subjectDid: record.recipientDid,
            reason: t('safety.blockedReason'),
        });
        setPending(false);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setNotice(
            result.data.created
                ? t('safety.authorBlocked')
                : t('safety.authorAlreadyBlocked'),
        );
        setMode(undefined);
    };

    return (
        <div className='mt-3 border-t-2 border-mh-borderSoft pt-3'>
            <div className='flex flex-wrap gap-2'>
                <Button
                    type='button'
                    variant='neutral'
                    size='sm'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.reportLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    onClick={() => setMode('report')}
                >
                    {t('safety.report')}
                </Button>
                <Button
                    type='button'
                    variant='neutral'
                    size='sm'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.blockLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    onClick={() => setMode('block')}
                >
                    {t('safety.block')}
                </Button>
            </div>

            {mode === 'report' ? (
                <form className='mt-3 space-y-3' onSubmit={submitReport}>
                    <label className='block text-xs font-bold'>
                        {t('safety.reportReason')}
                        <select
                            name='reportReason'
                            autoComplete='off'
                            className='mt-1 block w-full border-2 border-mh-border bg-mh-surface p-2'
                            value={reason}
                            onChange={(event) =>
                                setReason(
                                    event.target.value as AidPostReportReason,
                                )
                            }
                        >
                            <option value='spam'>{t('safety.spam')}</option>
                            <option value='abuse'>{t('safety.abuse')}</option>
                            <option value='fraud'>{t('safety.fraud')}</option>
                            <option value='other'>{t('safety.other')}</option>
                        </select>
                    </label>
                    <label className='block text-xs font-bold'>
                        {t('safety.details')}
                        <textarea
                            name='reportDetails'
                            autoComplete='off'
                            className='mt-1 block min-h-24 w-full border-2 border-mh-border bg-mh-surface p-2'
                            maxLength={1000}
                            value={details}
                            onChange={(event) => setDetails(event.target.value)}
                        />
                    </label>
                    <div className='flex flex-wrap gap-2'>
                        <Button type='submit' disabled={pending}>
                            {pending
                                ? t('safety.submitting')
                                : t('safety.submit')}
                        </Button>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => setMode(undefined)}
                            disabled={pending}
                        >
                            {t('safety.cancel')}
                        </Button>
                    </div>
                </form>
            ) : mode === 'block' ? (
                <div
                    role='alertdialog'
                    aria-label={t('safety.confirmBlockLabel')}
                    className='mh-alert mt-3'
                >
                    <p className='text-sm font-bold'>
                        {t('safety.confirmBlock')}
                    </p>
                    <p className='mt-1 text-xs'>{t('safety.blockPrivacy')}</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Button
                            type='button'
                            variant='danger'
                            onClick={() => void confirmBlock()}
                            disabled={pending}
                        >
                            {pending
                                ? t('safety.blocking')
                                : t('safety.confirmBlockLabel')}
                        </Button>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => setMode(undefined)}
                            disabled={pending}
                        >
                            {t('safety.cancel')}
                        </Button>
                    </div>
                </div>
            ) : null}

            {notice ? (
                <p
                    role='status'
                    className='mt-2 text-xs font-bold text-mh-success'
                >
                    {notice}
                </p>
            ) : null}
            {error ? (
                <p role='alert' className='mh-alert mt-2 text-xs font-bold'>
                    {error}
                </p>
            ) : null}
        </div>
    );
};

const OwnerRecordActions = ({
    record,
    position,
    total,
    onReplaceRecord,
    onDeleteRecord,
}: {
    record: FeedRecordEnvelope;
    position: number;
    total: number;
    onReplaceRecord: (record: FeedRecordEnvelope) => void;
    onDeleteRecord: (aidPostUri: string) => void;
}) => {
    const { t } = useLocale();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [pending, setPending] = useState<'close' | 'delete'>();
    const [notice, setNotice] = useState<string>();
    const [error, setError] = useState<string>();

    const closeRecord = async () => {
        if (!record.cid) return;
        setPending('close');
        setError(undefined);
        const result = await closeAtAidPostViaApi({
            uri: record.aidPostUri,
            expectedCid: record.cid,
            updatedAt: nowIso(),
        });
        setPending(undefined);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        onReplaceRecord({
            ...record,
            cid: result.data.cid,
            card: {
                ...record.card,
                status: 'closed',
                updatedAt:
                    result.data.record.updatedAt ??
                    result.data.record.createdAt,
            },
        });
        setNotice(t('safety.requestClosed'));
    };

    const deleteRecord = async () => {
        if (!record.cid) return;
        setPending('delete');
        setError(undefined);
        const result = await deleteAtAidPostViaApi({
            uri: record.aidPostUri,
            expectedCid: record.cid,
        });
        setPending(undefined);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        onDeleteRecord(record.aidPostUri);
    };

    return (
        <div className='mt-3 border-t-2 border-mh-borderSoft pt-3'>
            <div className='flex flex-wrap gap-2'>
                <Button
                    type='button'
                    variant='neutral'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.closeLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    disabled={
                        !record.cid ||
                        record.card.status === 'closed' ||
                        pending !== undefined
                    }
                    onClick={() => void closeRecord()}
                >
                    {pending === 'close'
                        ? t('safety.closing')
                        : t('safety.close')}
                </Button>
                <Button
                    type='button'
                    variant='neutral'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.deleteLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    disabled={!record.cid || pending !== undefined}
                    onClick={() => setConfirmDelete(true)}
                >
                    {t('safety.delete')}
                </Button>
            </div>
            {!record.cid ? (
                <p className='mt-2 text-xs text-mh-textMuted'>
                    {t('safety.waitingRevision')}
                </p>
            ) : null}
            {confirmDelete ? (
                <div
                    role='alertdialog'
                    aria-label={t('safety.confirmDeleteLabel')}
                    className='mh-alert mt-3'
                >
                    <p className='text-sm font-bold'>
                        {t('safety.confirmDelete')}
                    </p>
                    <p className='mt-1 text-xs'>{t('safety.deletePrivacy')}</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Button
                            type='button'
                            variant='danger'
                            onClick={() => void deleteRecord()}
                            disabled={pending !== undefined}
                        >
                            {pending === 'delete'
                                ? t('safety.deleting')
                                : t('safety.confirmDeleteLabel')}
                        </Button>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => setConfirmDelete(false)}
                            disabled={pending !== undefined}
                        >
                            {t('safety.cancel')}
                        </Button>
                    </div>
                </div>
            ) : null}
            {notice ? (
                <p
                    role='status'
                    className='mt-2 text-xs font-bold text-mh-success'
                >
                    {notice}
                </p>
            ) : null}
            {error ? (
                <p role='alert' className='mh-alert mt-2 text-xs font-bold'>
                    {error}
                </p>
            ) : null}
        </div>
    );
};

export const FeedRoute = ({
    discoveryState,
    onPatchDiscovery,
    feedRecords,
    isLoading,
    errorMessage,
    dataOrigin,
    onRetry,
    hasNextPage,
    total,
    onLoadMore,
    publicSyncFailure,
    publicSyncRetrying,
    onRetryPublicSync,
    onNavigate,
    onOpenChat,
    onUpdateCard,
    onReplaceRecord,
    onDeleteRecord,
    onTransition,
    currentUserDid,
}: FeedRouteProps) => {
    const { t, fmt } = useLocale();
    const paginationFocus = usePaginationFocus({
        itemCount: feedRecords.length,
        isLoading,
        hasNextPage,
        announce: useCallback(
            (start: number, end: number) =>
                String(t('discovery.loadedRange', { start, end })),
            [t],
        ),
    });
    const [expandedTimelineId, setExpandedTimelineId] = useState<
        string | undefined
    >();
    const cards = useMemo(
        () => feedRecords.map((record) => record.card),
        [feedRecords],
    );
    const feedView = useMemo(
        () => buildFeedViewModel(cards, discoveryState),
        [cards, discoveryState],
    );

    const presentationById = useMemo(
        () =>
            new Map(
                feedView.presentations.map((presentation) => [
                    presentation.id,
                    presentation,
                ]),
            ),
        [feedView.presentations],
    );

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('feed.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('feed.description')}
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                    <Badge tone={dataOrigin === 'api' ? 'success' : 'info'}>
                        {dataOriginLabel(dataOrigin)}
                    </Badge>
                </div>
                {errorMessage ? (
                    <div
                        role='alert'
                        className='mh-alert mt-3 text-xs font-bold'
                    >
                        <p>
                            {t('map.apiSyncIssue', { message: errorMessage })}
                        </p>
                        {feedRecords.length > 0 ? (
                            <p>{t('feed.staleResults')}</p>
                        ) : null}
                        <Button
                            size='sm'
                            type='button'
                            variant='neutral'
                            className='mt-2'
                            onClick={onRetry}
                        >
                            {t('feed.retryDiscovery')}
                        </Button>
                    </div>
                ) : null}
                {publicSyncFailure ? (
                    <div
                        role='alert'
                        className='mh-alert mt-3 text-xs font-bold'
                    >
                        <p>
                            {t('feed.privateSyncIssue', {
                                message: publicSyncFailure.message,
                            })}
                        </p>
                        <Button
                            size='sm'
                            type='button'
                            variant='neutral'
                            className='mt-2'
                            disabled={publicSyncRetrying}
                            onClick={onRetryPublicSync}
                        >
                            {publicSyncRetrying
                                ? t('feed.retryingSync')
                                : t('feed.retrySync')}
                        </Button>
                    </div>
                ) : null}
            </header>

            <DiscoveryFiltersPanel
                idPrefix='feed'
                state={discoveryState}
                onPatch={onPatchDiscovery}
            />

            <Card title={String(t('feed.liveRequestFeedTitle'))}>
                {isLoading ? (
                    <ul className='space-y-4' aria-live='polite'>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <li
                                key={`feed-skeleton-${index}`}
                                className='mh-record-card p-4'
                            >
                                <div className='mh-skeleton h-5 w-2/3' />
                                <div className='mh-skeleton mt-2 h-3 w-full' />
                                <div className='mh-skeleton mt-2 h-3 w-5/6' />
                                <div className='mt-4 flex gap-2'>
                                    <div className='mh-skeleton h-8 w-28' />
                                    <div className='mh-skeleton h-8 w-32' />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : feedView.cards.length === 0 ? (
                    <div className='space-y-3'>
                        <p>{t('feed.noRequestsMatch')}</p>
                        <div className='flex flex-wrap gap-2'>
                            <Button
                                variant='neutral'
                                size='sm'
                                onClick={() => {
                                    onPatchDiscovery({
                                        feedTab: 'latest',
                                        text: undefined,
                                        category: undefined,
                                        status: undefined,
                                        minUrgency: undefined,
                                        center: undefined,
                                        radiusMeters: undefined,
                                        since: undefined,
                                    });
                                }}
                            >
                                {t('feed.resetFeedFilters')}
                            </Button>
                            <Button
                                size='sm'
                                onClick={() => onNavigate('/posting')}
                            >
                                {t('feed.createRequest')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <ul className='space-y-4'>
                        {feedView.cards.map((card, index) => {
                            const record = feedRecords.find(
                                (candidate) => candidate.card.id === card.id,
                            );
                            const presentation = presentationById.get(card.id);

                            return (
                                <li
                                    key={card.id}
                                    className='mh-record-card p-4'
                                >
                                    <div className='flex flex-wrap items-start justify-between gap-2'>
                                        <p className='text-base font-bold text-mh-text'>
                                            {card.title}
                                        </p>
                                        <div className='flex flex-wrap gap-2'>
                                            {presentation ? (
                                                <>
                                                    <Badge
                                                        tone={
                                                            presentation
                                                                .statusBadge
                                                                .tone
                                                        }
                                                    >
                                                        {
                                                            presentation
                                                                .statusBadge
                                                                .label
                                                        }
                                                    </Badge>
                                                    <Badge
                                                        tone={
                                                            presentation
                                                                .urgencyBadge
                                                                .tone
                                                        }
                                                    >
                                                        {
                                                            presentation
                                                                .urgencyBadge
                                                                .label
                                                        }
                                                    </Badge>
                                                    {presentation.lifecycleBadge ? (
                                                        <Badge
                                                            tone={
                                                                presentation
                                                                    .lifecycleBadge
                                                                    .tone
                                                            }
                                                        >
                                                            {
                                                                presentation
                                                                    .lifecycleBadge
                                                                    .label
                                                            }
                                                        </Badge>
                                                    ) : null}
                                                    {record?.recordOrigin ===
                                                    'synthetic' ? (
                                                        <Badge tone='info'>
                                                            {t(
                                                                'feed.synthetic',
                                                            )}
                                                        </Badge>
                                                    ) : record?.recordOrigin ===
                                                      'sourced-public' ? (
                                                        <Badge tone='info'>
                                                            {t(
                                                                'feed.publicSource',
                                                            )}
                                                        </Badge>
                                                    ) : null}
                                                </>
                                            ) : null}
                                        </div>
                                    </div>

                                    <p className='mt-2 text-sm text-mh-textMuted'>
                                        {card.description}
                                    </p>
                                    <p className='mt-1 text-xs text-mh-textSoft'>
                                        {t('feed.updatedAt', {
                                            date: fmt.longDate(card.updatedAt),
                                        })}
                                    </p>

                                    {/* Lifecycle transition actions */}
                                    {presentation &&
                                    presentation.transitionActions.length > 0 &&
                                    onTransition &&
                                    record &&
                                    currentUserDid === record.recipientDid ? (
                                        <div className='mt-3 flex flex-wrap gap-2'>
                                            <span className='text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                                                {t('feed.lifecycle')}
                                            </span>
                                            {presentation.transitionActions.map(
                                                (action) => (
                                                    <Button
                                                        key={
                                                            action.targetStatus
                                                        }
                                                        variant='neutral'
                                                        size='sm'
                                                        aria-label={t('safety.positionedAction', {
                                                            action: action.ariaLabel,
                                                            position: index + 1,
                                                            total: feedView.cards.length,
                                                        })}
                                                        onClick={() =>
                                                            onTransition(
                                                                card.id,
                                                                record.aidPostUri,
                                                                action.targetStatus,
                                                            )
                                                        }
                                                    >
                                                        {action.label}
                                                    </Button>
                                                ),
                                            )}
                                        </div>
                                    ) : null}

                                    <div className='mt-4 flex flex-wrap gap-2'>
                                        {record && webDataMode === 'fixture' ? (
                                            <Button
                                                size='sm'
                                                onClick={() =>
                                                    onOpenChat(record, 'feed')
                                                }
                                            >
                                                {t('feed.contactHelper')}
                                            </Button>
                                        ) : null}

                                        {dataOrigin === 'fixture' ? (
                                            <Button
                                                variant='secondary'
                                                size='sm'
                                                onClick={() =>
                                                    onUpdateCard(card.id, {
                                                        urgency: Math.min(
                                                            5,
                                                            card.urgency + 1,
                                                        ) as 1 | 2 | 3 | 4 | 5,
                                                        updatedAt: nowIso(),
                                                    })
                                                }
                                                disabled={card.urgency >= 5}
                                            >
                                                {t('feed.escalateUrgency')}
                                            </Button>
                                        ) : null}

                                        {/* Timeline toggle */}
                                        {card.timeline &&
                                        card.timeline.length > 0 ? (
                                            <Button
                                                variant='neutral'
                                                size='sm'
                                                aria-label={t('safety.positionedAction', {
                                                    action: t('feed.timelineFor', {
                                                        title: card.title,
                                                        count: card.timeline.length,
                                                    }),
                                                    position: index + 1,
                                                    total: feedView.cards.length,
                                                })}
                                                onClick={() =>
                                                    setExpandedTimelineId(
                                                        (current) =>
                                                            current === card.id
                                                                ? undefined
                                                                : card.id,
                                                    )
                                                }
                                            >
                                                {expandedTimelineId === card.id
                                                    ? t('feed.hideTimeline')
                                                    : t('feed.timeline', {
                                                          count: card.timeline
                                                              .length,
                                                      })}
                                            </Button>
                                        ) : null}
                                    </div>

                                    {record &&
                                    currentUserDid &&
                                    currentUserDid !== record.recipientDid ? (
                                        <SafetyActions
                                            record={record}
                                            position={index + 1}
                                            total={feedView.cards.length}
                                        />
                                    ) : null}
                                    {record &&
                                    currentUserDid === record.recipientDid ? (
                                        <OwnerRecordActions
                                            record={record}
                                            position={index + 1}
                                            total={feedView.cards.length}
                                            onReplaceRecord={onReplaceRecord}
                                            onDeleteRecord={onDeleteRecord}
                                        />
                                    ) : null}

                                    {/* Expanded timeline panel */}
                                    {expandedTimelineId === card.id &&
                                    card.timeline ? (
                                        <div className='mt-4 border-t-2 border-mh-borderSoft pt-4'>
                                            <p className='mb-3 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                                                {t('feed.auditTimeline')}
                                            </p>
                                            <StatusTimeline
                                                timeline={card.timeline}
                                            />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='mt-3 text-sm text-mh-textMuted' role='status'>
                    {t('discovery.loadedCount', { loaded: feedRecords.length, total })}
                </p>
                <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
                {hasNextPage ? (
                    <Button ref={paginationFocus.loadMoreRef} className='mt-3' onClick={() => paginationFocus.loadMore(onLoadMore)} disabled={isLoading}>
                        {t('discovery.loadMore')}
                    </Button>
                ) : null}
            </Card>
        </section>
    );
};
