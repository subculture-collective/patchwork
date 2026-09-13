import { SaveSearchButton } from './saved-discovery';
import { haversineDistanceMeters } from '../geo-utils';
import { nearbyResourceIntent, serializeDiscoveryFilterState } from '../discovery-filters';
import { useMapSelection } from './use-map-selection';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DiscoveryMapAggregates } from '@patchwork/shared';
import type { DiscoveryFilterState, AidStatus } from '../discovery-filters';
import type { ChatEntrySurface } from '../chat-ux';
import type { FeedRecordEnvelope } from './discovery-runtime';
import type { ApiDataOrigin } from './api-client';
import { buildMapViewModel, closeMapDetailDrawer, openMapDetailDrawer, type MapAidCard, type MapTriageAction } from '../map-ux';
import { currentExactPublicAddress, buildResourceOverlayViewModel, type ResourceDirectoryCard } from '../resource-directory-ux';
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
        return 'neutral';
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
    renderRequestActions?: (record: FeedRecordEnvelope, position: number, total: number) => ReactNode;
    fixtureMode: boolean;
    originLabel: string;
    aggregates?: DiscoveryMapAggregates;
    resourceTotal?: number;
    resourcesLoading?: boolean;
    resourcesHasNextPage?: boolean;
    onLoadMoreResources?: () => void;
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

const LazyPostalMap = lazy(() =>
    import('../components/map/PostalMap.js').then((module) => ({
        default: module.PostalMap,
    })),
);

export const MapRoute = ({
    filters,
    renderRequestActions,
    fixtureMode,
    originLabel,
    aggregates,
    resourceTotal,
    resourcesLoading,
    resourcesHasNextPage,
    onLoadMoreResources,
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
    const resourceIntent = nearbyResourceIntent(discoveryState);
    const [mobileView, setMobileView] = useState<'map' | 'list'>(
        discoveryState.postalCode && !resourceIntent ? 'list' : 'map',
    );
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
    const resourcePaginationFocus = usePaginationFocus({
        itemCount: resourceCards.length,
        isLoading: Boolean(resourcesLoading),
        hasNextPage: Boolean(resourcesHasNextPage),
        announce: useCallback((start: number, end: number) => String(t('discovery.loadedRange', {start, end})), [t]),
    });
    const previousZipArea = useRef<Partial<DiscoveryFilterState> | undefined>(
        undefined,
    );
    useEffect(() => {
        if (discoveryState.postalCode || resourceIntent) setMobileView(resourceIntent ? 'map' : 'list');
    }, [discoveryState.postalCode, resourceIntent]);
    const leaveZip = () => {
        setMobileView('map');
        onPushDiscovery({
            ...previousZipArea.current,
            postalCode: undefined,
            areaLabel: previousZipArea.current?.areaLabel,
        });
    };
    const [viewport, setViewport] = useState<{
        center: { lat: number; lng: number };
        radiusMeters: number;
    }>();
    useEffect(() => {
        setViewport(undefined);
    }, [
        discoveryState.center?.lat,
        discoveryState.center?.lng,
        discoveryState.postalCode,
        discoveryState.radiusMeters,
    ]);
    const selection = useMapSelection(feedRecords, resourceCards, 'all');
    const selectedRecord = selection.request;
    const selectedResource = selection.resource;
    const onSelectPost = selection.selectRequest;
    const setSelectedResourceUri = selection.selectResource;
    const [cameraCenter, setCameraCenter] = useState(
        discoveryState.center ?? { lat: 39.5, lng: -98.35 },
    );
    useEffect(() => {
        if (discoveryState.center) setCameraCenter(discoveryState.center);
    }, [discoveryState.center]);
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
                      postalCode: undefined,
                      areaLabel: undefined,
                      radiusMeters: undefined,
                  };
        setFocusedArea(undefined);
        onSelectPost(undefined);
        onPushDiscovery(patch);
    };

    const drawer = selectedRecord
        ? openMapDetailDrawer(
              [toMapAidCard(selectedRecord)],
              selectedRecord.card.id,
          )
        : closeMapDetailDrawer();

    return (
        <section
            className={`mh-discovery-route mh-nearby-workspace is-${mobileView} ${resourceIntent ? 'is-resource-journey' : ''}`}
        >
            <header className='mh-nearby-header'>
                <h1 className='mh-route-title'>{t('map.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t(resourceIntent ? 'nearby.resourceStory' : 'nearby.requestStory')}
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                    {dataOrigin !== 'api' && (
                        <Badge tone='info'>{originLabel}</Badge>
                    )}
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

            <div className='mh-nearby-intent' role='group' aria-label={t('nearby.intentLabel')}>
                {(['resources', 'requests'] as const).map(intent => <Button key={intent}
                    aria-pressed={resourceIntent === (intent === 'resources')}
                    variant={resourceIntent === (intent === 'resources') ? 'primary' : 'neutral'}
                    onClick={() => { selection.close(); onPushDiscovery({ nearbyIntent: intent }); }}>
                    {t(`nearby.${intent}`)}
                </Button>)}
            </div>
            <div className='mh-nearby-controls'>{filters}</div>
            <div
                className='mh-nearby-view-switch'
                role='group'
                aria-label={t('experience.discoveryView')}
            >
                <Button
                    aria-pressed={mobileView === 'map'}
                    variant={mobileView === 'map' ? 'primary' : 'neutral'}
                    onClick={() => setMobileView('map')}
                >
                    {t('experience.mapView')}
                </Button>
                <Button
                    aria-pressed={mobileView === 'list'}
                    variant={mobileView === 'list' ? 'primary' : 'neutral'}
                    onClick={() => setMobileView('list')}
                >
                    {resourceIntent ? (resourcesLoading ? t('nearby.resourcesLoadingShort') : t('nearby.resourceList', { count: resourceTotal ?? 0 })) : t('experience.listView', { count: total })}
                </Button>
            </div>
            <section
                className='mh-nearby-map'
                aria-label={t('experience.mapView')}
            >
                <a
                    className='mh-map-skip mh-link'
                    href='#map-area-requests'
                    onClick={() => {
                        setMobileView('list');
                        requestAnimationFrame(() =>
                            document
                                .getElementById('map-area-requests')
                                ?.focus(),
                        );
                    }}
                >
                    {t(resourceIntent ? 'nearby.skipToResources' : 'experience.skipMap')}
                </a>
                {(resourceTotal ?? 0) > resourceCards.length && (
                    <p role='status' className='mb-3 text-sm text-mh-textMuted'>
                        {t('map.resourceLimit', { shown: resourceCards.length, total: resourceTotal })}
                    </p>
                )}
                {viewport && (
                    <Button
                        className='mh-search-area'
                        onClick={() => {
                            onPushDiscovery({
                                ...viewport,
                                postalCode: undefined,
                                areaLabel: t('map.selectedArea'),
                                feedTab: 'nearby',
                            });
                            setViewport(undefined);
                        }}
                    >
                        {t(viewport.radiusMeters > 250000 ? 'nearby.searchMaxArea' : 'handoff.searchArea')}
                    </Button>
                )}

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
                        {!resourceIntent && <Badge tone='info'>{t('map.filteredArea')}</Badge>}
                        <p className='mr-auto text-sm text-mh-textMuted'>
                            <strong className='text-mh-text'>
                                {discoveryState.postalCode ? `ZIP ${discoveryState.postalCode}` : discoveryState.areaLabel ?? activeArea.label}
                            </strong>{' '}
                            ·{' '}
                            {t(resourceIntent ? 'nearby.resourceAreaSummary' : 'map.areaSummary', {
                                requests: fmt.number(
                                    aggregates?.requestCount ??
                                        mapView.filteredCards.length,
                                ),
                                places: fmt.number(
                                    resourceTotal ??
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
                                type='button'
                                variant='neutral'
                                className='px-3 py-1 text-xs'
                                onClick={() => leaveFocusedArea('previous')}
                            >
                                {t('map.returnArea')}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
                {
                    <Suspense
                        fallback={<div className='mh-skeleton h-96 w-full' />}
                    >
                        <LazyPostalMap
                            cells={resourceIntent ? [] : aggregates?.cells ?? []}
                            resourceMode={resourceIntent}
                            discoveryState={discoveryState}
                            onShowResourceList={()=>setMobileView('list')}
                            resources={resourceCards}
                            selectedResourceUri={selectedResource?.uri}
                            selectedPostalCode={resourceIntent ? undefined : discoveryState.postalCode}
                            searchRadiusMeters={resourceIntent && discoveryState.center ? (discoveryState.radiusMeters ?? 20000) : undefined}
                            center={cameraCenter}
                            onViewportChange={setViewport}
                            onClearPostalCode={leaveZip}
                            onSelectPostalCode={postalCode => {
                                setViewport(undefined);
                                if (!discoveryState.postalCode)
                                    previousZipArea.current = {
                                        center: discoveryState.center,
                                        radiusMeters:
                                            discoveryState.radiusMeters,
                                        areaLabel: discoveryState.areaLabel,
                                    };
                                setMobileView(resourceIntent ? 'map' : 'list');
                                onPushDiscovery({
                                    postalCode,
                                    center: undefined,
                                    radiusMeters: resourceIntent ? discoveryState.radiusMeters : undefined,
                                    areaLabel: `ZIP ${postalCode}`,
                                });
                            }}
                            onSelectResource={setSelectedResourceUri}
                            onTilesFailed={setTileError}
                        />
                    </Suspense>
                }
            </section>

            {(selection.loading || selection.error) && (
                <MapDetailSheet
                    closeLabel={t('resources.close')}
                    onClose={selection.close}
                >
                    <Panel title={t('handoff.requestDetails')}>
                        {selection.loading ? (
                            <p role='status'>{t('handoff.loadingRequest')}</p>
                        ) : (
                            <>
                                <p role='alert'>{selection.error}</p>
                                <Button onClick={selection.retry}>
                                    {t('common.retry')}
                                </Button>
                            </>
                        )}
                    </Panel>
                </MapDetailSheet>
            )}
            {selectedResource && (
                <MapDetailSheet
                    closeLabel={t('resources.close')}
                    onClose={selection.close}
                >
                    <Panel title={selectedResource.name}>
                        <ResourceActions resource={selectedResource} />
                    </Panel>
                </MapDetailSheet>
            )}
            <div
                id='map-area-requests'
                tabIndex={-1}
                className='mh-nearby-results scroll-mt-24'
            >
                {resourceIntent ? <Card title={t('nearby.resources')}>
                    <p role='status' className='text-sm text-mh-textMuted'>
                        {resourcesLoading ? t('nearby.loadingResources') : t('nearby.resourceCount', {count: resourceTotal ?? 0})}
                    </p>
                    <p className='mt-2 text-sm text-mh-textMuted'>{t(discoveryState.postalCode ? 'nearby.distanceFromZip' : discoveryState.center ? 'nearby.distanceFromArea' : 'nearby.chooseLocation')}</p>
                    {!resourceErrorMessage && !resourcesLoading && !resourceCards.length && <div className='py-4'>
                        <p>{t('nearby.noResources')}</p>
                        {discoveryState.center && (discoveryState.radiusMeters ?? 20000) < 250000 && <Button variant='neutral' onClick={() => onPushDiscovery({radiusMeters: Math.min(250000, (discoveryState.radiusMeters ?? 20000)*2)})}>{t('nearby.expandDistance')}</Button>}
                    </div>}
                    <SaveSearchButton state={discoveryState} />
                    <ul className='mh-nearby-resource-list'>
                        {resourceCards.map(resource => <li key={resource.uri} className='mh-record-card'>
                            <button className='mh-resource-result' onClick={() => setSelectedResourceUri(resource.uri)}>
                                <strong>{resource.name}</strong>
                                {discoveryState.center && <span>{fmt.number(haversineDistanceMeters(discoveryState.center, resource.location) / 1000, {maximumFractionDigits: 1})} km</span>}
                                <span>{resource.exactPublicAddress?.streetAddress ?? resource.location.areaLabel}</span>
                                <span>{resource.openHours ?? t('resources.hoursUnavailable')}</span>
                                <span className='mh-link'>{t('resources.openDetails')}</span>
                            </button>
                            {currentExactPublicAddress(resource) && <button className='mh-text-button px-1 text-sm'
                                aria-label={t('nearby.showPlaceOnMap', {name:resource.name})}
                                onClick={() => {
                                    const address = currentExactPublicAddress(resource)!;
                                    setCameraCenter({lat:address.latitude,lng:address.longitude});
                                    setViewport(undefined);
                                    setMobileView('map');
                                    requestAnimationFrame(() => document.querySelector('.mh-nearby-map')?.scrollIntoView({block:'start'}));
                                }}>{t('nearby.showOnMap')}</button>}
                        </li>)}
                    </ul>
                    <p ref={resourcePaginationFocus.loadedCountRef} tabIndex={-1} className='mt-4' role='status'>{t('discovery.loadedCount', {loaded:resourceCards.length,total:resourceTotal ?? resourceCards.length})}</p>
                    {resourcesHasNextPage && onLoadMoreResources && <Button ref={resourcePaginationFocus.loadMoreRef} variant='neutral' disabled={resourcesLoading} onClick={() => resourcePaginationFocus.loadMore(onLoadMoreResources)}>{t('discovery.loadMore')}</Button>}
                    <p className='sr-only' role='status'>{resourcePaginationFocus.announcement}</p>
                    <a className='mh-link inline-block py-3' href={`/resources?${serializeDiscoveryFilterState(discoveryState)}`}>{t('nearby.fullDirectory')}</a>
                </Card> : <Card
                    title={
                        discoveryState.postalCode
                            ? t('experience.zipRequests', {
                                  zip: discoveryState.postalCode,
                              })
                            : String(t('map.requestMarkersTitle'))
                    }
                >
                    {discoveryState.postalCode && (
                        <Button variant='neutral' onClick={leaveZip}>
                            {t('experience.backToAreas')}
                        </Button>
                    )}
                    <p
                        ref={paginationFocus.loadedCountRef}
                        tabIndex={-1}
                        className='text-sm text-mh-textMuted'
                        role='status'
                    >
                        {t('discovery.loadedCount', {
                            loaded: feedRecords.length,
                            total,
                        })}
                    </p>
                    <span className='sr-only' role='status' aria-live='polite'>
                        {paginationFocus.announcement}
                    </span>
                    {isLoading && mapView.filteredCards.length === 0 ? (
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
                        <div className='space-y-3'>
                            <p>{t('map.noRequests')}</p>
                            <div className='flex flex-wrap gap-2'>
                                <a className='mh-button inline-flex px-3 py-2 text-sm' href={`/resources${window.location.search}`}>
                                    {t('nav.resources')}
                                </a>
                                <a className='mh-button inline-flex px-3 py-2 text-sm' href={`/posting${window.location.search}`}>
                                    {t('nav.ask')}
                                </a>
                            </div>
                        </div>
                    ) : (
                        <ul className='space-y-3'>
                            {mapView.filteredCards.map((card, index) => (
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
                                    {feedRecords.find(
                                        record => record.card.id === card.id,
                                    )?.recordOrigin === 'synthetic' && (
                                        <Badge tone='neutral'>
                                            {t('feed.synthetic')}
                                        </Badge>
                                    )}
                                    <div className='mt-3'>
                                        <Button
                                            variant='neutral'
                                            className='px-3 py-1 text-xs'
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
                                    </div>
                                    {(() => {
                                        const record = feedRecords.find(
                                            item => item.card.id === card.id,
                                        );
                                        return (
                                            record &&
                                            renderRequestActions?.(
                                                record,
                                                index + 1,
                                                mapView.filteredCards.length,
                                            )
                                        );
                                    })()}
                                </li>
                            ))}
                        </ul>
                    )}
                    {hasNextPage ? (
                        <Button
                            ref={paginationFocus.loadMoreRef}
                            type='button'
                            variant='neutral'
                            className='px-3 py-1 text-xs'
                            onClick={() => paginationFocus.loadMore(onLoadMore)}
                            disabled={isLoading}
                        >
                            {t('discovery.loadMore')}
                        </Button>
                    ) : null}
                    <div className='mh-results-note'>
                        {' '}
                        {aggregates &&
                            aggregates.requestCount >
                                mapView.filteredCards.length && (
                                <p role='status'>
                                    {t('map.aggregateHelp', {
                                        count: aggregates.requestCount,
                                    })}
                                    {aggregates.truncated
                                        ? ` ${t('map.aggregateTruncated')}`
                                        : ''}
                                </p>
                            )}
                    </div>{' '}
                </Card>}
            </div>

            {drawer.open && selectedRecord ? (
                <MapDetailSheet
                    closeLabel={t('map.closeDrawer')}
                    onClose={selection.close}
                >
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
                            {selectedRecord.recordOrigin === 'synthetic' && (
                                <Badge tone='info'>{t('feed.synthetic')}</Badge>
                            )}
                        </div>
                        <a
                            className='mh-button inline-flex px-3 py-2'
                            href={`/requests/view?uri=${encodeURIComponent(selectedRecord.aidPostUri)}`}
                        >
                            {t('handoff.requestDetails')}
                        </a>
                        {!fixtureMode && (
                            <RequestLifecycleActions
                                record={selectedRecord}
                                onRefresh={onRetry}
                            />
                        )}
                        <div className='mt-4 flex flex-wrap gap-2'>
                            {drawer.actions
                                .filter(() => fixtureMode)
                                .map(action => (
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
                        </div>
                    </Panel>
                </MapDetailSheet>
            ) : null}
        </section>
    );
};
