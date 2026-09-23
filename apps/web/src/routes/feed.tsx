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
import { Banner } from '../components/Banner';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { DiscoveryToolbar } from '../features/discovery/DiscoveryToolbar';
import { RequestCard } from '../features/discovery/RequestCard';
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
    onReplaceRecord,
    onDeleteRecord,
    onTransition,
    currentUserDid,
}: FeedRouteProps) => {
    const { t } = useLocale();
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

    const countLabel =
        total > feedRecords.length
            ? t('discovery.showingCount', {
                  loaded: feedRecords.length,
                  total,
              })
            : t('discovery.resultCount', { count: feedView.cards.length });

    return (
        <section>
            <PageHeader
                title={t('feed.heading')}
                description={t('feed.description')}
                meta={
                    dataOrigin !== 'api' ? (
                        <Badge tone='info'>{dataOriginLabel(dataOrigin, t)}</Badge>
                    ) : null
                }
                actions={
                    <Button
                        variant='accent'
                        onClick={() => onNavigate('/posting')}
                    >
                        {t('dashboard.askForHelp')}
                    </Button>
                }
            />

            {errorMessage || publicSyncFailure ? (
                <div className='mb-6 grid gap-3'>
                    {errorMessage ? (
                        <Banner
                            tone='danger'
                            title={t('map.apiSyncIssue', {
                                message: errorMessage,
                            })}
                            actions={
                                <Button
                                    size='sm'
                                    variant='secondary'
                                    onClick={onRetry}
                                >
                                    {t('feed.retryDiscovery')}
                                </Button>
                            }
                        >
                            {feedRecords.length > 0 ? (
                                <p>{t('feed.staleResults')}</p>
                            ) : null}
                        </Banner>
                    ) : null}
                    {publicSyncFailure ? (
                        <Banner
                            tone='danger'
                            title={t('feed.privateSyncIssue', {
                                message: publicSyncFailure.message,
                            })}
                            actions={
                                <Button
                                    size='sm'
                                    variant='secondary'
                                    disabled={publicSyncRetrying}
                                    onClick={onRetryPublicSync}
                                >
                                    {publicSyncRetrying
                                        ? t('feed.retryingSync')
                                        : t('feed.retrySync')}
                                </Button>
                            }
                        />
                    ) : null}
                </div>
            ) : null}

            <DiscoveryToolbar
                idPrefix='feed'
                state={discoveryState}
                onPatch={onPatchDiscovery}
            />

            <section aria-labelledby='feed-results-heading'>
                <div className='mh-results-header'>
                    <h2 id='feed-results-heading' className='sr-only'>
                        {t('feed.liveRequestFeedTitle')}
                    </h2>
                    <p
                        ref={paginationFocus.loadedCountRef}
                        tabIndex={-1}
                        className='mh-results-count'
                        role='status'
                    >
                        {isLoading && feedRecords.length === 0
                            ? t('a11y.loadingContent')
                            : countLabel}
                    </p>
                </div>
                <span className='sr-only' role='status' aria-live='polite'>
                    {paginationFocus.announcement}
                </span>
                {isLoading && feedView.cards.length === 0 ? (
                    <ul className='mh-request-list mh-request-list--grid' aria-hidden='true'>
                        {Array.from({ length: 4 }).map((_, index) => (
                            <li
                                key={`feed-skeleton-${index}`}
                                className='mh-request-card'
                            >
                                <div className='mh-skeleton h-3 w-1/4' />
                                <div className='mh-skeleton h-6 w-2/3' />
                                <div className='mh-skeleton h-3 w-full' />
                                <div className='mh-skeleton h-3 w-5/6' />
                            </li>
                        ))}
                    </ul>
                ) : feedView.cards.length === 0 ? (
                    <EmptyState
                        title={t('feed.noRequestsTitle')}
                        actions={
                            <>
                                <Button
                                    variant='secondary'
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
                                    variant='accent'
                                    onClick={() => onNavigate('/posting')}
                                >
                                    {t('feed.createRequest')}
                                </Button>
                            </>
                        }
                    >
                        <p>{t('feed.noRequestsMatch')}</p>
                    </EmptyState>
                ) : (
                    <ul className='mh-request-list mh-request-list--grid'>
                        {feedView.cards.map((card, index) => {
                            const record = feedRecords.find(
                                (candidate) => candidate.card.id === card.id,
                            );
                            const presentation = presentationById.get(card.id);
                            const isOwner =
                                Boolean(record) &&
                                currentUserDid === record?.recipientDid;
                            const canTransition =
                                presentation &&
                                presentation.transitionActions.length > 0 &&
                                onTransition &&
                                record &&
                                isOwner;

                            return (
                                <li key={card.id}>
                                    <RequestCard
                                        title={card.title}
                                        description={card.description}
                                        category={card.category}
                                        updatedAt={card.updatedAt}
                                        urgency={card.urgency}
                                        badges={
                                            presentation
                                                ? [
                                                      presentation.statusBadge,
                                                      presentation.urgencyBadge,
                                                      presentation.lifecycleBadge,
                                                  ]
                                                : []
                                        }
                                        extraBadges={
                                            record?.recordOrigin ===
                                            'synthetic' ? (
                                                <Badge tone='info'>
                                                    {t('feed.synthetic')}
                                                </Badge>
                                            ) : record?.recordOrigin ===
                                              'sourced-public' ? (
                                                <Badge tone='info'>
                                                    {t('feed.publicSource')}
                                                </Badge>
                                            ) : null
                                        }
                                        actions={
                                            (record &&
                                                webDataMode === 'fixture') ||
                                            canTransition ||
                                            (card.timeline &&
                                                card.timeline.length > 0) ? (
                                                <>
                                                    {record &&
                                                    webDataMode ===
                                                        'fixture' &&
                                                    !isOwner &&
                                                    (card.status === 'open' ||
                                                        card.status ===
                                                            'in-progress') ? (
                                                        <Button
                                                            size='sm'
                                                            onClick={() =>
                                                                onOpenChat(
                                                                    record,
                                                                    'feed',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'feed.contactHelper',
                                                            )}
                                                        </Button>
                                                    ) : null}
                                                    {canTransition
                                                        ? presentation.transitionActions.map(
                                                              (action) => (
                                                                  <Button
                                                                      key={
                                                                          action.targetStatus
                                                                      }
                                                                      variant='secondary'
                                                                      size='sm'
                                                                      aria-label={t(
                                                                          'safety.positionedAction',
                                                                          {
                                                                              action: action.ariaLabel,
                                                                              position:
                                                                                  index +
                                                                                  1,
                                                                              total: feedView
                                                                                  .cards
                                                                                  .length,
                                                                          },
                                                                      )}
                                                                      onClick={() =>
                                                                          onTransition(
                                                                              card.id,
                                                                              record.aidPostUri,
                                                                              action.targetStatus,
                                                                          )
                                                                      }
                                                                  >
                                                                      {
                                                                          action.label
                                                                      }
                                                                  </Button>
                                                              ),
                                                          )
                                                        : null}
                                                    {card.timeline &&
                                                    card.timeline.length > 0 ? (
                                                        <Button
                                                            variant='ghost'
                                                            size='sm'
                                                            aria-expanded={
                                                                expandedTimelineId ===
                                                                card.id
                                                            }
                                                            aria-label={t(
                                                                'safety.positionedAction',
                                                                {
                                                                    action: t(
                                                                        'feed.timelineFor',
                                                                        {
                                                                            title: card.title,
                                                                            count: card
                                                                                .timeline
                                                                                .length,
                                                                        },
                                                                    ),
                                                                    position:
                                                                        index + 1,
                                                                    total: feedView
                                                                        .cards
                                                                        .length,
                                                                },
                                                            )}
                                                            onClick={() =>
                                                                setExpandedTimelineId(
                                                                    (current) =>
                                                                        current ===
                                                                        card.id
                                                                            ? undefined
                                                                            : card.id,
                                                                )
                                                            }
                                                        >
                                                            {expandedTimelineId ===
                                                            card.id
                                                                ? t(
                                                                      'feed.hideTimeline',
                                                                  )
                                                                : t(
                                                                      'feed.timeline',
                                                                      {
                                                                          count: card
                                                                              .timeline
                                                                              .length,
                                                                      },
                                                                  )}
                                                        </Button>
                                                    ) : null}
                                                </>
                                            ) : null
                                        }
                                    >
                                        {record &&
                                        currentUserDid &&
                                        !isOwner ? (
                                            <SafetyActions
                                                record={record}
                                                position={index + 1}
                                                total={feedView.cards.length}
                                            />
                                        ) : null}
                                        {record && isOwner ? (
                                            <OwnerRecordActions
                                                record={record}
                                                position={index + 1}
                                                total={feedView.cards.length}
                                                onReplaceRecord={
                                                    onReplaceRecord
                                                }
                                                onDeleteRecord={onDeleteRecord}
                                            />
                                        ) : null}
                                        {expandedTimelineId === card.id &&
                                        card.timeline ? (
                                            <div className='mt-2 border-t border-mh-borderSubtle pt-3'>
                                                <p className='mh-eyebrow mb-3'>
                                                    {t('feed.auditTimeline')}
                                                </p>
                                                <StatusTimeline
                                                    timeline={card.timeline}
                                                />
                                            </div>
                                        ) : null}
                                    </RequestCard>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {hasNextPage ? (
                    <div className='mt-6 flex justify-center'>
                        <Button
                            ref={paginationFocus.loadMoreRef}
                            variant='secondary'
                            onClick={() => paginationFocus.loadMore(onLoadMore)}
                            disabled={isLoading}
                        >
                            {t('discovery.loadMore')}
                        </Button>
                    </div>
                ) : null}
            </section>
        </section>
    );
};
