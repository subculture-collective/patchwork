import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { applyDiscoveryFilterPatch, type AidStatus, type DiscoveryFilterState } from '../discovery-filters';
import {
    buildMapViewModel,
    closeMapDetailDrawer,
    openMapDetailDrawer,
    type MapAidCard,
    type MapTriageAction,
} from '../map-ux';
import { buildResourceOverlayViewModel, type ResourceDirectoryCard } from '../resource-directory-ux';
import { type ChatEntrySurface } from '../chat-ux';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Sheet } from '../components/Sheet';
import { DiscoveryToolbar } from '../features/discovery/DiscoveryToolbar';
import { RequestCard } from '../features/discovery/RequestCard';
import { type ApiDataOrigin } from '../features/api-client';
import { useLocale } from '../i18n';
import { type FeedRecordEnvelope } from '../features/discovery-runtime';
import {
    dataOriginLabel,
    webDataMode,
} from '../app/runtime';
import {
    formatLocalizedLabel,
    usePaginationFocus,
} from '../features/shell-shared';

const toSeverityTone = (
    status: AidStatus,
): 'default' | 'neutral' | 'info' | 'success' | 'danger' => {
    if (status === 'open') {
        return 'default';
    }
    if (status === 'in-progress') {
        return 'info';
    }
    if (status === 'resolved') {
        return 'success';
    }
    return 'neutral';
};

const toUrgencyTone = (
    urgency: 1 | 2 | 3 | 4 | 5,
): 'neutral' | 'info' | 'success' | 'danger' => {
    if (urgency >= 4) {
        return 'danger';
    }
    if (urgency >= 3) {
        return 'info';
    }
    return 'neutral';
};

const toMapAidCard = (record: FeedRecordEnvelope): MapAidCard => {
    return {
        id: record.card.id,
        title: record.card.title,
        summary: record.card.description,
        category: record.card.category,
        status: record.card.status,
        urgency: record.card.urgency,
        updatedAt: record.card.updatedAt,
        location: record.card.location,
    };
};

interface MapRouteProps {
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    onPushDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    feedRecords: readonly FeedRecordEnvelope[];
    resourceCards: readonly ResourceDirectoryCard[];
    resourceErrorMessage?: string;
    isLoading: boolean;
    errorMessage?: string;
    dataOrigin: ApiDataOrigin;
    onRetry: () => void;
    hasNextPage: boolean;
    total: number;
    onLoadMore: () => void;
    onRetryResources: () => void;
    selectedPostId?: string;
    onSelectPost: (id: string | undefined) => void;
    onTriageAction: (postId: string, action: MapTriageAction) => void;
    onOpenChat: (record: FeedRecordEnvelope, surface: ChatEntrySurface) => void;
}

const LazyInteractiveMap = lazy(() =>
    import('../components/map/InteractiveMap.js').then((module) => ({
        default: module.InteractiveMap,
    })),
);

export const MapRoute = ({
    discoveryState,
    onPatchDiscovery,
    onPushDiscovery,
    feedRecords,
    resourceCards,
    resourceErrorMessage,
    isLoading,
    errorMessage,
    dataOrigin,
    onRetry,
    hasNextPage,
    total,
    onLoadMore,
    onRetryResources,
    selectedPostId,
    onSelectPost,
    onTriageAction,
    onOpenChat,
}: MapRouteProps) => {
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
    const [tileError, setTileError] = useState<string>();
    const [focusedArea, setFocusedArea] = useState<{
        center: { lat: number; lng: number };
        radiusMeters: number;
        label: string;
        previousCenter?: { lat: number; lng: number };
        previousRadiusMeters?: number;
    }>();
    useEffect(() => {
        if (!selectedPostId) {
            return undefined;
        }
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                onSelectPost(undefined);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedPostId, onSelectPost]);

    const mapCards = useMemo(
        () => feedRecords.map(toMapAidCard),
        [feedRecords],
    );

    const mapView = useMemo(
        () => buildMapViewModel(mapCards, discoveryState),
        [mapCards, discoveryState],
    );
    const mapResourceView = useMemo(
        () => buildResourceOverlayViewModel(resourceCards, discoveryState),
        [discoveryState, resourceCards],
    );
    const activeArea =
        focusedArea ??
        (discoveryState.center && discoveryState.radiusMeters
            ? {
                  center: discoveryState.center,
                  radiusMeters: discoveryState.radiusMeters,
                  label: String(t('map.selectedArea')),
              }
            : undefined);

    useEffect(() => {
        if (!focusedArea) return;
        if (
            !discoveryState.center ||
            discoveryState.radiusMeters !== focusedArea.radiusMeters ||
            discoveryState.center.lat !== focusedArea.center.lat ||
            discoveryState.center.lng !== focusedArea.center.lng
        ) {
            setFocusedArea(undefined);
        }
    }, [discoveryState.center, discoveryState.radiusMeters, focusedArea]);

    const focusMapArea = (area: {
        center: { lat: number; lng: number };
        radiusMeters: number;
        label: string;
    }) => {
        const normalized = applyDiscoveryFilterPatch(discoveryState, area);
        if (!normalized.center || !normalized.radiusMeters) return;
        setFocusedArea({
            center: normalized.center,
            radiusMeters: normalized.radiusMeters,
            label: area.label,
            ...(discoveryState.center
                ? { previousCenter: discoveryState.center }
                : {}),
            ...(discoveryState.radiusMeters
                ? { previousRadiusMeters: discoveryState.radiusMeters }
                : {}),
        });
        onPushDiscovery({
            center: normalized.center,
            radiusMeters: normalized.radiusMeters,
        });
    };

    const leaveFocusedArea = (target: 'previous' | 'clear') => {
        const patch =
            target === 'previous' && focusedArea
                ? {
                      center: focusedArea.previousCenter,
                      radiusMeters: focusedArea.previousRadiusMeters,
                  }
                : {
                      center: undefined,
                      areaLabel: undefined,
                      radiusMeters: undefined,
                  };
        setFocusedArea(undefined);
        onSelectPost(undefined);
        onPushDiscovery(patch);
    };

    const selectedRecord = selectedPostId
        ? feedRecords.find((record) => record.card.id === selectedPostId)
        : undefined;

    const drawer = selectedPostId
        ? openMapDetailDrawer(mapView.filteredCards, selectedPostId)
        : closeMapDetailDrawer();

    const statusLabel = (status: string) => formatLocalizedLabel(t, status);
    const countLabel =
        total > feedRecords.length
            ? t('discovery.showingCount', { loaded: feedRecords.length, total })
            : t('discovery.resultCount', { count: mapView.filteredCards.length });

    return (
        <section>
            <PageHeader
                title={t('map.heading')}
                description={t('map.description')}
                meta={
                    dataOrigin !== 'api' ? (
                        <Badge tone='info'>{dataOriginLabel(dataOrigin, t)}</Badge>
                    ) : null
                }
            />

            {errorMessage || resourceErrorMessage || tileError ? (
                <div className='mb-6 grid gap-3'>
                    {errorMessage || resourceErrorMessage ? (
                        <Banner
                            tone='danger'
                            actions={
                                <>
                                    {errorMessage ? (
                                        <Button
                                            size='sm'
                                            variant='secondary'
                                            onClick={onRetry}
                                        >
                                            {t('map.retryDiscovery')}
                                        </Button>
                                    ) : null}
                                    {resourceErrorMessage ? (
                                        <Button
                                            size='sm'
                                            variant='secondary'
                                            onClick={onRetryResources}
                                        >
                                            {t('map.retryPlaces')}
                                        </Button>
                                    ) : null}
                                </>
                            }
                        >
                            {errorMessage ? (
                                <p className='font-bold'>
                                    {t('map.apiSyncIssue', {
                                        message: errorMessage,
                                    })}
                                </p>
                            ) : null}
                            {errorMessage && feedRecords.length > 0 ? (
                                <p>{t('map.staleResults')}</p>
                            ) : null}
                            {resourceErrorMessage ? (
                                <p className='font-bold'>
                                    {t('map.publicPlaceIssue', {
                                        message: resourceErrorMessage,
                                    })}
                                </p>
                            ) : null}
                        </Banner>
                    ) : null}
                    {tileError ? (
                        <Banner tone='warning' live='alert'>
                            {tileError}
                        </Banner>
                    ) : null}
                </div>
            ) : null}

            <DiscoveryToolbar
                idPrefix='map'
                state={discoveryState}
                onPatch={onPatchDiscovery}
                hideAreaSummary
            />

            <div className='mh-map-layout'>
                <div className='mh-map-layout__map'>
                    {activeArea ? (
                        <div
                            className='mh-map-areabar'
                            role='status'
                            aria-live='polite'
                        >
                            <Badge tone='info'>
                                {t('map.filteredArea')}
                            </Badge>
                            <p className='min-w-0 flex-1 text-sm text-mh-textMuted'>
                                <strong className='text-mh-text'>
                                    {activeArea.label}
                                </strong>{' '}
                                ·{' '}
                                {t('map.areaSummary', {
                                    requests: fmt.number(
                                        mapView.filteredCards.length,
                                    ),
                                    places: fmt.number(
                                        mapResourceView.cards.length,
                                    ),
                                    distance: fmt.number(
                                        activeArea.radiusMeters / 1000,
                                        {
                                            maximumFractionDigits: 1,
                                        },
                                    ),
                                })}
                            </p>
                            {focusedArea ? (
                                <Button
                                    variant='secondary'
                                    size='sm'
                                    onClick={() => leaveFocusedArea('previous')}
                                >
                                    {t('map.returnArea')}
                                </Button>
                            ) : null}
                            <Button
                                variant='ghost'
                                size='sm'
                                onClick={() => leaveFocusedArea('clear')}
                            >
                                {t('map.clearArea')}
                            </Button>
                        </div>
                    ) : null}
                    {discoveryState.center ? (
                        <Suspense
                            fallback={
                                <div className='mh-skeleton h-96 w-full' />
                            }
                        >
                            <LazyInteractiveMap
                                cards={mapView.filteredCards}
                                resources={mapResourceView.cards}
                                selectedPostId={selectedPostId}
                                center={discoveryState.center}
                                onSelectPostId={onSelectPost}
                                focusedArea={activeArea}
                                onFocusArea={focusMapArea}
                                onTilesFailed={setTileError}
                            />
                        </Suspense>
                    ) : (
                        <EmptyState title={t('discovery.areaRequiredTitle')}>
                            <p>{t('map.areaRequired')}</p>
                        </EmptyState>
                    )}
                </div>

                <section
                    className='mh-map-layout__list'
                    aria-labelledby='map-results-heading'
                >
                    <div className='mh-results-header'>
                        <h2
                            id='map-results-heading'
                            className='mh-surface__title'
                        >
                            {t('map.requestMarkersTitle')}
                        </h2>
                        <p
                            ref={paginationFocus.loadedCountRef}
                            tabIndex={-1}
                            className='mh-results-count'
                            role='status'
                        >
                            {countLabel}
                        </p>
                    </div>
                    <span className='sr-only' role='status' aria-live='polite'>
                        {paginationFocus.announcement}
                    </span>
                    {isLoading && mapView.filteredCards.length === 0 ? (
                        <ul className='mh-request-list' aria-hidden='true'>
                            {Array.from({ length: 3 }).map((_, index) => (
                                <li
                                    key={`marker-skeleton-${index}`}
                                    className='mh-request-card'
                                >
                                    <div className='mh-skeleton h-3 w-1/4' />
                                    <div className='mh-skeleton h-5 w-2/3' />
                                    <div className='mh-skeleton h-3 w-full' />
                                </li>
                            ))}
                        </ul>
                    ) : mapView.filteredCards.length === 0 ? (
                        <EmptyState title={t('feed.noRequestsTitle')}>
                            <p>{t('map.noRequests')}</p>
                        </EmptyState>
                    ) : (
                        <ul className='mh-request-list'>
                            {mapView.filteredCards.map((card) => (
                                <li key={card.id}>
                                    <RequestCard
                                        title={card.title}
                                        description={card.summary}
                                        category={card.category}
                                        updatedAt={card.updatedAt}
                                        urgency={card.urgency}
                                        selected={selectedPostId === card.id}
                                        badges={[
                                            {
                                                label: card.status,
                                                tone: toSeverityTone(
                                                    card.status,
                                                ),
                                            },
                                            {
                                                label: String(
                                                    t('map.urgencyLabel', {
                                                        level: card.urgency,
                                                    }),
                                                ),
                                                tone: toUrgencyTone(
                                                    card.urgency,
                                                ),
                                            },
                                        ]}
                                        actions={
                                            <Button
                                                variant='secondary'
                                                size='sm'
                                                aria-label={t(
                                                    'map.openTriageDrawerFor',
                                                    {
                                                        title: card.title,
                                                        id: card.id,
                                                    },
                                                )}
                                                onClick={() =>
                                                    onSelectPost(card.id)
                                                }
                                            >
                                                {t('map.openTriageDrawer')}
                                            </Button>
                                        }
                                    />
                                </li>
                            ))}
                        </ul>
                    )}
                    {hasNextPage ? (
                        <div className='mt-4 flex justify-center'>
                            <Button
                                ref={paginationFocus.loadMoreRef}
                                variant='secondary'
                                onClick={() =>
                                    paginationFocus.loadMore(onLoadMore)
                                }
                                disabled={isLoading}
                            >
                                {t('discovery.loadMore')}
                            </Button>
                        </div>
                    ) : null}
                </section>
            </div>

            <Sheet
                open={Boolean(drawer.open && selectedRecord)}
                onClose={() => onSelectPost(undefined)}
                title={t('map.mapDetailDrawerTitle')}
                closeLabel={t('map.closeDrawer')}
                footer={
                    drawer.open && selectedRecord ? (
                        <>
                            {drawer.actions
                                .filter(
                                    (action) =>
                                        webDataMode === 'fixture' ||
                                        action.action !== 'contact_helper',
                                )
                                .map((action) => (
                                    <Button
                                        key={action.action}
                                        variant={
                                            action.action === 'contact_helper'
                                                ? 'primary'
                                                : 'secondary'
                                        }
                                        size='sm'
                                        aria-label={action.ariaLabel}
                                        onClick={() => {
                                            if (
                                                action.action ===
                                                'contact_helper'
                                            ) {
                                                onOpenChat(
                                                    selectedRecord,
                                                    'map',
                                                );
                                                return;
                                            }
                                            onTriageAction(
                                                selectedRecord.card.id,
                                                action.action,
                                            );
                                        }}
                                    >
                                        {action.label}
                                    </Button>
                                ))}
                        </>
                    ) : null
                }
            >
                {drawer.open && selectedRecord ? (
                    <div
                        className='grid gap-3'
                        aria-label={String(
                            t('map.detailsFor', {
                                title:
                                    drawer.title ?? t('map.selectedRequest'),
                            }),
                        )}
                        role='region'
                    >
                        <p className='mh-eyebrow'>
                            {formatLocalizedLabel(t, selectedRecord.card.category)}
                        </p>
                        <p className='mh-request-card__title'>{drawer.title}</p>
                        <p className='text-mh-textMuted'>{drawer.summary}</p>
                        {drawer.status ? (
                            <div>
                                <Badge tone={toSeverityTone(drawer.status)}>
                                    {statusLabel(drawer.status)}
                                </Badge>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </Sheet>
        </section>
    );
};
