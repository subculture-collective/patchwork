import { useMapSelection } from './use-map-selection';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { DiscoveryMapAggregates } from '@patchwork/shared';
import type { DiscoveryFilterState, AidStatus } from '../discovery-filters';
import type { ChatEntrySurface } from '../chat-ux';
import type { FeedRecordEnvelope } from './discovery-runtime';
import type { ApiDataOrigin } from './api-client';
import { buildMapViewModel, closeMapDetailDrawer, openMapDetailDrawer, type MapAidCard, type MapTriageAction } from '../map-ux';
import { buildResourceOverlayViewModel, type ResourceDirectoryCard } from '../resource-directory-ux';
import { useLocale } from '../i18n';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Panel } from '../components/Panel';
import { MapDetailSheet } from './map-detail-sheet';
import { RequestLifecycleActions } from './request-actions';
import { ResourceActions } from './resource-actions';
import { usePaginationFocus } from './use-pagination-focus';

const toSeverityTone = (
    status: AidStatus,
): 'neutral' | 'info' | 'success' | 'danger' => {
    if (status === 'open') {
        return 'danger';
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
    filters: ReactNode;
    fixtureMode: boolean;
    originLabel: string;
    aggregates?: DiscoveryMapAggregates;
    resourceTotal?: number;
    discoveryState: DiscoveryFilterState;
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
    onTriageAction: (postId: string, action: MapTriageAction) => void;
    onOpenChat: (record: FeedRecordEnvelope, surface: ChatEntrySurface) => void;
}

const LazyInteractiveMap = lazy(() =>
    import('../components/map/InteractiveMap.js').then((module) => ({
        default: module.InteractiveMap,
    })),
);

export const MapRoute = ({
    filters,
    fixtureMode,
    originLabel,
    aggregates,
    resourceTotal,
    discoveryState,
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
    const [viewport, setViewport] = useState<{ center: { lat: number; lng: number }; radiusMeters: number }>();
    const selection = useMapSelection(feedRecords, resourceCards, 'all');
    const selectedRecord = selection.request;
    const selectedResource = selection.resource;
    const selectedPostId = selectedRecord?.card.id;
    const onSelectPost = selection.selectRequest;
    const setSelectedResourceUri = selection.selectResource;
    const [tileError, setTileError] = useState<string>();
    const [focusedArea, setFocusedArea] = useState<{
        center: { lat: number; lng: number };
        radiusMeters: number;
        label: string;
        previousCenter?: { lat: number; lng: number };
        previousRadiusMeters?: number;
    }>();

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

    const drawer = selectedRecord ? openMapDetailDrawer([toMapAidCard(selectedRecord)], selectedRecord.card.id) : closeMapDetailDrawer();

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('map.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('map.description')}
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                    {dataOrigin !== 'api' && <Badge tone='info'>{originLabel}</Badge>}
                    <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='text-sm text-mh-textMuted' role='status'>
                        {t('discovery.loadedCount', { loaded: feedRecords.length, total })}
                    </p>
                    <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
                    {hasNextPage ? (
                        <Button ref={paginationFocus.loadMoreRef} type='button' variant='neutral' className='px-3 py-1 text-xs' onClick={() => paginationFocus.loadMore(onLoadMore)} disabled={isLoading}>
                            {t('discovery.loadMore')}
                        </Button>
                    ) : null}
                </div>
                {errorMessage || resourceErrorMessage ? (
                    <div
                        role='alert'
                        className='mh-alert mt-3 text-xs font-bold'
                    >
                        {errorMessage ? (
                            <p>
                                {t('map.apiSyncIssue', {
                                    message: errorMessage,
                                })}
                            </p>
                        ) : null}
                        {errorMessage && feedRecords.length > 0 ? (
                            <p>{t('map.staleResults')}</p>
                        ) : null}
                        {resourceErrorMessage ? (
                            <p>
                                {t('map.publicPlaceIssue', {
                                    message: resourceErrorMessage,
                                })}
                            </p>
                        ) : null}
                        <div className='mt-2 flex flex-wrap gap-2'>
                            {errorMessage ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    className='px-3 py-1 text-xs'
                                    onClick={onRetry}
                                >
                                    {t('map.retryDiscovery')}
                                </Button>
                            ) : null}
                            {resourceErrorMessage ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    className='px-3 py-1 text-xs'
                                    onClick={onRetryResources}
                                >
                                    {t('map.retryPlaces')}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </header>

            <section className='rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-3'>
                {tileError ? (
                    <div
                        role='alert'
                        className='mh-alert mb-3 text-xs font-bold'
                    >
                        <p>{tileError}</p>
                    </div>
                ) : null}
                {activeArea ? (
                    <div
                        className='mb-3 flex flex-wrap items-center gap-2 border-2 border-mh-borderSoft bg-mh-surface p-3'
                        role='status'
                        aria-live='polite'
                    >
                        <Badge tone='info'>{t('map.filteredArea')}</Badge>
                        <p className='mr-auto text-sm text-mh-textMuted'>
                            <strong className='text-mh-text'>
                                {activeArea.label}
                            </strong>{' '}
                            ·{' '}
                            {t('map.areaSummary', {
                                requests: fmt.number(
                                    aggregates?.requestCount ?? mapView.filteredCards.length,
                                ),
                                places: fmt.number(
                                    resourceTotal ?? mapResourceView.cards.length,
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
                                type='button'
                                variant='neutral'
                                className='px-3 py-1 text-xs'
                                onClick={() => leaveFocusedArea('previous')}
                            >
                                {t('map.returnArea')}
                            </Button>
                        ) : null}
                        <Button
                            type='button'
                            variant='neutral'
                            className='px-3 py-1 text-xs'
                            onClick={() => leaveFocusedArea('clear')}
                        >
                            {t('map.clearArea')}
                        </Button>
                    </div>
                ) : null}
                {discoveryState.center ? (
                    <Suspense
                        fallback={<div className='mh-skeleton h-96 w-full' />}
                    >
                        <LazyInteractiveMap
                            cards={mapView.filteredCards}
                            resources={mapResourceView.cards}
                            aggregateCells={aggregates && aggregates.requestCount > mapView.filteredCards.length ? aggregates.cells : undefined}
                            selectedPostId={selectedPostId}
                            center={discoveryState.center}
                            onSelectPostId={onSelectPost}
                            focusedArea={activeArea}
                            onViewportChange={setViewport}
                            onSelectResource={setSelectedResourceUri}
                            onTilesFailed={setTileError}
                        />
                    </Suspense>
                ) : (
                    <div className='mh-alert p-4' role='status'>
                        {t('map.areaRequired')}
                    </div>
                )}
            </section>

            {aggregates && aggregates.requestCount > mapView.filteredCards.length && <p role='status'>{t('map.aggregateHelp', { count: aggregates.requestCount })}{aggregates.truncated ? ` ${t('map.aggregateTruncated')}` : ''}</p>}
            {viewport && <Button onClick={() => { onPushDiscovery({ ...viewport, feedTab: 'nearby' }); setViewport(undefined); }}>{t('handoff.searchArea')}</Button>}
            {(selection.loading || selection.error) && <MapDetailSheet closeLabel={t('resources.close')} onClose={selection.close}>
                <Panel title={t('handoff.requestDetails')}>
                    {selection.loading ? <p role='status'>{t('handoff.loadingRequest')}</p> : <><p role='alert'>{selection.error}</p><Button onClick={selection.retry}>{t('common.retry')}</Button></>}
                </Panel>
            </MapDetailSheet>}
            {selectedResource && <MapDetailSheet closeLabel={t('resources.close')} onClose={selection.close}><Panel title={selectedResource.name}>
                <ResourceActions resource={selectedResource} />
            </Panel></MapDetailSheet>}
            <details className='rounded-xl border border-mh-borderSoft bg-mh-surface p-3'>
                <summary className='cursor-pointer py-2 font-bold'>{t('nav.mapFilters')}{discoveryState.areaLabel ? ` · ${discoveryState.areaLabel}` : ''}</summary>
                {filters}
            </details>

            <div>
                <Card title={String(t('map.requestMarkersTitle'))}>
                    {isLoading ? (
                        <ul className='space-y-3' aria-live='polite'>
                            {Array.from({ length: 3 }).map((_, index) => (
                                <li
                                    key={`marker-skeleton-${index}`}
                                    className='mh-record-card'
                                >
                                    <div className='mh-skeleton h-4 w-2/3' />
                                    <div className='mh-skeleton mt-2 h-3 w-full' />
                                    <div className='mh-skeleton mt-2 h-3 w-4/5' />
                                    <div className='mh-skeleton mt-3 h-8 w-32' />
                                </li>
                            ))}
                        </ul>
                    ) : mapView.filteredCards.length === 0 ? (
                        <p>{t('map.noRequests')}</p>
                    ) : (
                        <ul className='space-y-3'>
                            {mapView.filteredCards.map((card) => (
                                <li key={card.id} className='mh-record-card'>
                                    <div className='flex flex-wrap items-start justify-between gap-2'>
                                        <p className='text-sm font-bold text-mh-text'>
                                            {card.title}
                                        </p>
                                        <div className='flex flex-wrap gap-2'>
                                            <Badge
                                                tone={toUrgencyTone(
                                                    card.urgency,
                                                )}
                                            >
                                                {t('map.urgencyLabel', {
                                                    level: card.urgency,
                                                })}
                                            </Badge>
                                            <Badge
                                                tone={toSeverityTone(
                                                    card.status,
                                                )}
                                            >
                                                {card.status}
                                            </Badge>
                                        </div>
                                    </div>
                                    <p className='mt-2 text-xs text-mh-textSoft'>
                                        {card.summary}
                                    </p>
                                    <div className='mt-3'>
                                        <Button
                                            variant='neutral'
                                            className='px-3 py-1 text-xs'
                                            aria-label={t('map.openTriageDrawerFor', {
                                                title: card.title,
                                                id: card.id,
                                            })}
                                            onClick={() =>
                                                onSelectPost(card.id)
                                            }
                                        >
                                            {t('map.openTriageDrawer')}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            {drawer.open && selectedRecord ? (
                <MapDetailSheet closeLabel={t('map.closeDrawer')} onClose={selection.close}>
                <Panel
                    title={String(t('map.mapDetailDrawerTitle'))}
                    aria-label={String(
                        t('map.detailsFor', {
                            title: drawer.title ?? t('map.selectedRequest'),
                        }),
                    )}
                >
                    <p className='text-lg font-bold text-mh-text'>
                        {drawer.title}
                    </p>
                    <p className='mt-1 text-sm text-mh-textMuted'>
                        {drawer.summary}
                    </p>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {drawer.status ? (
                            <Badge tone={toSeverityTone(drawer.status)}>
                                {drawer.status}
                            </Badge>
                        ) : null}
                        {selectedRecord.recordOrigin === 'synthetic' && <Badge tone='info'>{t('feed.synthetic')}</Badge>}
                    </div>
                    <a className='mh-button inline-flex px-3 py-2' href={`/requests/view?uri=${encodeURIComponent(selectedRecord.aidPostUri)}`}>{t('handoff.requestDetails')}</a>
                    {!fixtureMode && <RequestLifecycleActions record={selectedRecord} onRefresh={onRetry} />}
                    <div className='mt-4 flex flex-wrap gap-2'>
                        {drawer.actions
                            .filter(
                                () =>
                                    fixtureMode,
                            )
                            .map((action) => (
                                <Button
                                    key={action.action}
                                    variant={
                                        action.action === 'contact_helper'
                                            ? 'primary'
                                            : 'neutral'
                                    }
                                    className='px-3 py-1 text-xs'
                                    aria-label={action.ariaLabel}
                                    onClick={() => {
                                        if (
                                            action.action === 'contact_helper'
                                        ) {
                                            onOpenChat(selectedRecord, 'map');
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

                    </div>
                </Panel>
                </MapDetailSheet>
            ) : null}
        </section>
    );
};

