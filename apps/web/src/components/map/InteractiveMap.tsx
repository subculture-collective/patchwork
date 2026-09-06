import { clusterCells, cellExpansionZoom } from './cluster-cells';
import type { DiscoveryMapAggregates } from '@patchwork/shared';
import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useId, useState } from 'react';
import L from 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import type { MapAidCard } from '../../map-ux.js';
import {
    clusterDistanceMetersForZoom,
    clusterExpansionZoom,
    clusterMapCards,
    toApproximateMapMarker,
} from '../../map-ux.js';
import {
    currentExactPublicAddress,
    type ResourceDirectoryCard,
} from '../../resource-directory-ux.js';
import { resolveMapTileUrl } from '../../config.js';
import { useLocale } from '../../i18n';

export interface InteractiveMapProps {
    aggregateCells?: DiscoveryMapAggregates['cells'];
    cards: readonly MapAidCard[];
    resources?: readonly ResourceDirectoryCard[];
    selectedPostId?: string;
    /** Omit the center only while choosing an approximate discovery area. */
    center?: { lat: number; lng: number };
    onSelectPostId: (postId: string | undefined) => void;
    onFocusArea?: (area: {
        center: { lat: number; lng: number };
        radiusMeters: number;
        label: string;
    }) => void;
    focusedArea?: {
        center: { lat: number; lng: number };
        radiusMeters: number;
    };
    onTilesFailed: (message: string) => void;
    onViewportChange?: (area: { center: { lat: number; lng: number }; radiusMeters: number }) => void;
    onSelectResource?: (uri: string) => void;
    /** Uses this Leaflet surface as a deliberate, coarse area picker. */
    onConfirmArea?: (center: { lat: number; lng: number }) => void;
    canConfirmArea?: boolean;
}

type CircleStyle = 'filled' | 'outline' | 'contrast';
const circleStyleStorageKey = 'patchwork.map.circle-style.v1';
const readCircleStyle = (): CircleStyle => {
    if (typeof window === 'undefined') return 'filled';
    try {
        const stored = window.localStorage.getItem(circleStyleStorageKey);
        return stored === 'outline' ||
            stored === 'contrast' ||
            stored === 'filled'
            ? stored
            : 'filled';
    } catch {
        return 'filled';
    }
};

const sameCenter = (
    left: { lat: number; lng: number },
    right: { lat: number; lng: number },
): boolean =>
    Math.abs(left.lat - right.lat) < 0.000001 &&
    Math.abs(left.lng - right.lng) < 0.000001;

export const InteractiveMap = ({
    aggregateCells,
    cards,
    resources = [],
    selectedPostId,
    center,
    onSelectPostId,
    onFocusArea,
    focusedArea,
    onTilesFailed,
    onViewportChange,
    onSelectResource,
    onConfirmArea,
    canConfirmArea = true,
}: InteractiveMapProps) => {
    const { t } = useLocale();
    const mapRef = useRef<HTMLDivElement | null>(null);
    const groupRef = useRef<HTMLElement | null>(null);
    const mapInstance = useRef<L.Map | null>(null);
    const onTilesFailedRef = useRef(onTilesFailed);
    const onSelectPostIdRef = useRef(onSelectPostId);
    const onFocusAreaRef = useRef(onFocusArea);
    const viewportRef = useRef(onViewportChange);
    viewportRef.current = onViewportChange;
    const selectResourceRef = useRef(onSelectResource);
    selectResourceRef.current = onSelectResource;
    const onConfirmAreaRef = useRef(onConfirmArea);
    const initialCenterRef = useRef(center ?? { lat: 0, lng: 0 });
    const [zoom, setZoom] = useState(9);
    const [groupPostIds, setGroupPostIds] = useState<readonly string[]>([]);
    useEffect(() => { if (groupPostIds.length) groupRef.current?.querySelector<HTMLButtonElement>('li button')?.focus(); }, [groupPostIds]);
    const [focusedKeys,setFocusedKeys] = useState<readonly string[]>([]);
    const cellClusters = useMemo(() => clusterCells(aggregateCells ?? [], zoom), [aggregateCells,zoom]);
    const [circleStyle, setCircleStyle] =
        useState<CircleStyle>(readCircleStyle);
    const [areaCandidate, setAreaCandidate] = useState<{
        lat: number;
        lng: number;
    }>();
    const mapId = useId();
    const instructionsId = `map-instructions-${mapId.replace(/:/g, '')}`;

    // Check for reduced motion preference
    const prefersReducedMotion = useRef(
        typeof window !== 'undefined' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );

    useEffect(() => {
        onTilesFailedRef.current = onTilesFailed;
    }, [onTilesFailed]);

    useEffect(() => {
        onSelectPostIdRef.current = onSelectPostId;
    }, [onSelectPostId]);

    useEffect(() => {
        onFocusAreaRef.current = onFocusArea;
    }, [onFocusArea]);
    useEffect(() => {
        onConfirmAreaRef.current = onConfirmArea;
    }, [onConfirmArea]);

    const markers = useMemo(
        () =>
            cards
                .map(toApproximateMapMarker)
                .filter((value): value is NonNullable<typeof value> =>
                    Boolean(value),
                ),
        [cards],
    );
    const mapCenter = center ?? { lat: 0, lng: 0 };
    const clusters = useMemo(
        () =>
            clusterMapCards(
                cards,
                clusterDistanceMetersForZoom(zoom, mapCenter.lat),
            ),
        [cards, mapCenter.lat, zoom],
    );
    const clusteredPostIds = useMemo(
        () =>
            new Set(
                clusters
                    .filter((cluster) => cluster.count > 1)
                    .flatMap((cluster) => cluster.postIds),
            ),
        [clusters],
    );
    const exactPlaces = useMemo(
        () =>
            resources.flatMap((resource) => {
                const exact = currentExactPublicAddress(resource);
                if (!exact) {
                    return [];
                }
                return [{ resource, exact }];
            }),
        [resources],
    );
    const tileUrl = resolveMapTileUrl(import.meta.env, import.meta.env.PROD);

    useEffect(() => {
        if (!mapRef.current || mapInstance.current) return;
        const map = L.map(mapRef.current, {
            zoomControl: true,
            maxZoom: 18,
            zoomAnimation: !prefersReducedMotion.current,
            fadeAnimation: !prefersReducedMotion.current,
        }).setView(
            [initialCenterRef.current.lat, initialCenterRef.current.lng],
            center ? 9 : 2,
        );
        const onZoomEnd = () => setZoom(map.getZoom());
        map.on('zoomend', onZoomEnd);
        const onMoveEnd = () => {
            const point = map.getCenter();
            viewportRef.current?.({ center: { lat: Number(point.lat.toFixed(2)), lng: Number(point.lng.toFixed(2)) },
                radiusMeters: Math.round(map.distance(point, map.getBounds().getNorthEast())) });
        };
        map.on('moveend', onMoveEnd);
        const selectMapPoint = (event: L.LeafletMouseEvent) => {
            if (!event.originalEvent?.defaultPrevented) setFocusedKeys([]);
            if (!onConfirmAreaRef.current) return;
            setAreaCandidate({ lat: event.latlng.lat, lng: event.latlng.lng });
        };
        map.on('click', selectMapPoint);
        const container = map.getContainer();
        const selectKeyboardPoint = (event: KeyboardEvent) => {
            if (event.target !== container || !onConfirmAreaRef.current || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            const current = map.getCenter();
            setAreaCandidate({ lat: current.lat, lng: current.lng });
        };
        container.addEventListener('keydown', selectKeyboardPoint);
        const layer = leafletLayer({
            url: tileUrl,
            flavor: 'light',
            lang: 'en',
            maxDataZoom: 10,
        });
        layer.on('tileerror', (event: unknown) => {
            onTilesFailedRef.current(
                `Tile layer failed to load${event ? '.' : ''}`,
            );
        });
        layer.addTo(map);
        L.control.attribution({ prefix: false }).addTo(map);
        map.attributionControl.addAttribution('© OpenStreetMap contributors');
        mapInstance.current = map;
        return () => {
            map.off('zoomend', onZoomEnd);
            map.off('moveend', onMoveEnd);
            map.off('click', selectMapPoint);
            container.removeEventListener('keydown', selectKeyboardPoint);
            mapInstance.current = null;
            map.remove();
        };
    }, [tileUrl]);

    useEffect(() => {
        if (!mapInstance.current || !center) return;
        mapInstance.current.setView(
            [center.lat, center.lng],
            mapInstance.current.getZoom(),
        );
    }, [center?.lat, center?.lng]);

    useEffect(() => {
        if (!mapInstance.current) return;
        const map = mapInstance.current;
        const layers: L.Layer[] = [];
        const focus = (_lat:number,_lng:number,keys:readonly string[]) => {
            setFocusedKeys(keys);
            setGroupPostIds([]);
        };
        const isDimmed = (keys:readonly string[]) => focusedKeys.length > 0 && !keys.some(key=>focusedKeys.includes(key));
        const keyboard = (circle:L.Path,label:string,activate:()=>void) => {
            const element=circle.getElement?.();
            if(!element)return;
            element.setAttribute('tabindex','0');element.setAttribute('role','button');element.setAttribute('aria-label',label);
            element.addEventListener('keydown',event=>{const key=(event as KeyboardEvent).key;if(key==='Enter'||key===' '){event.preventDefault();event.stopPropagation();activate();}});
        };
        for (const cell of cellClusters) {
            const dimmed = isDimmed(cell.keys);
            // Geographic coverage is measured in metres; count badges remain legible in pixels.
            const area = L.circle([cell.latitude, cell.longitude], {
                radius: cell.radiusKm * 1000, interactive: false,
                className: `mh-map-coverage ${dimmed ? 'is-dimmed' : ''}`,
            }).addTo(map);
            layers.push(area);
            const nextZoom = cellExpansionZoom(aggregateCells ?? [], cell.keys, zoom);
            const circle = L.circleMarker([cell.latitude, cell.longitude], {
                radius: cell.count < 10 ? 13 : cell.count < 100 ? 16 : 19,
                bubblingMouseEvents: false,
                className: `mh-map-cluster ${dimmed ? 'is-dimmed' : focusedKeys.length ? 'is-selected' : ''}`,
            }).addTo(map);
            circle.bindTooltip(String(cell.count), { permanent: true, direction: 'center', className: 'mh-map-circle-label mh-map-cluster-label' });
            const activate = () => {
                focus(cell.latitude, cell.longitude, cell.keys);
                if (nextZoom !== null) map.setView([cell.latitude, cell.longitude], nextZoom);
                else {
                    map.fitBounds(area.getBounds(), { padding: [24, 24], maxZoom: 14 });
                    onFocusAreaRef.current?.({
                    center: { lat: cell.latitude, lng: cell.longitude },
                    radiusMeters: Math.max(1000, cell.radiusKm * 1000),
                    label: String(t('map.requestsInArea', { count: cell.count })),
                    });
                }
            };
            circle.on('click', activate);
            keyboard(circle, String(t(nextZoom === null ? 'map.showAreaRequests' : 'map.zoomCluster', { count: cell.count })), activate);
            layers.push(circle);
        }
        for (const cluster of aggregateCells ? [] : clusters) {
            if (cluster.count <= 1) continue;
            const circle = L.circleMarker([cluster.lat, cluster.lng], {
                radius: cluster.count < 10 ? 13 : cluster.count < 100 ? 16 : 19,
                bubblingMouseEvents: false,
                className:
                    (selectedPostId &&
                        cluster.postIds.includes(selectedPostId)) ||
                    (focusedArea &&
                        sameCenter(focusedArea.center, {
                            lat: cluster.lat,
                            lng: cluster.lng,
                        }))
                        ? 'mh-map-cluster is-selected'
                        : `mh-map-cluster ${isDimmed(cluster.postIds)?'is-dimmed':''}`.trim(),
            }).addTo(map);
            circle.bindTooltip(String(cluster.count), {
                permanent: true,
                direction: 'center',
                className: `mh-map-circle-label mh-map-cluster-label ${isDimmed(cluster.postIds) ? 'is-dimmed' : ''}`,
            });
            const next = clusterExpansionZoom(cards, cluster.postIds, zoom, cluster.lat);
            const split = clusterMapCards(cards.filter(card => cluster.postIds.includes(card.id)), clusterDistanceMetersForZoom(next, cluster.lat)).length > 1;
            const activate = () => {
                focus(cluster.lat, cluster.lng, cluster.postIds);
                if (split) map.setView([cluster.lat, cluster.lng], next);
                else setGroupPostIds(cluster.postIds);
            };
            circle.on('click', activate);
            keyboard(circle, String(t(split ? 'map.zoomCluster' : 'map.showAreaRequests', { count: cluster.count })), activate);
            layers.push(circle);
        }
        for (const marker of aggregateCells ? [] : markers) {
            if (!marker || clusteredPostIds.has(marker.id)) continue;
            const coverage = L.circle([marker.lat, marker.lng], {
                radius: marker.radiusMeters, interactive: false,
                className: marker.id === selectedPostId ? 'mh-map-circle mh-map-coverage is-selected' : 'mh-map-circle mh-map-coverage',
            }).addTo(map);
            const point = L.circleMarker([marker.lat, marker.lng], {
                radius: 7, bubblingMouseEvents: false,
                className: `mh-map-request-point ${marker.id === selectedPostId ? 'is-selected' : ''} ${isDimmed([marker.id]) ? 'is-dimmed' : ''}`,
            }).addTo(map);
            const title = cards.find(card => card.id === marker.id)?.title ?? marker.label;
            const label = document.createElement('span');
            label.textContent = title;
            point.bindTooltip(label, { direction: 'top' });
            const activate = () => {
                focus(marker.lat, marker.lng, [marker.id]);
                onSelectPostIdRef.current(marker.id);
            };
            point.on('click', activate);
            keyboard(point, title, activate);
            layers.push(coverage, point);
        }
        for (const { resource, exact } of exactPlaces) {
            const marker = L.circleMarker([exact.latitude, exact.longitude], {
                radius: 7,
                bubblingMouseEvents: false,
                className:
                    focusedArea &&
                    sameCenter(focusedArea.center, {
                        lat: exact.latitude,
                        lng: exact.longitude,
                    })
                        ? 'mh-map-place is-selected'
                        : `mh-map-place ${isDimmed([resource.uri]) ? 'is-dimmed' : ''}`.trim(),
            }).addTo(map);
            const resourceLabel = document.createElement('span');
            resourceLabel.textContent = `${resource.name} · ${resource.openHours ?? ''}`;
            marker.bindTooltip(
                resourceLabel,
                {
                    permanent: true,
                    direction: 'right',
                    className: `mh-map-place-label ${isDimmed([resource.uri]) ? 'is-dimmed' : ''}`,
                },
            );
            marker.on('click', () => {
                focus(exact.latitude, exact.longitude, [resource.uri]);
                selectResourceRef.current?.(resource.uri);
            });
            keyboard(marker, resource.name, () => selectResourceRef.current?.(resource.uri));
            layers.push(marker);
        }
        for (const resource of resources) {
            if (currentExactPublicAddress(resource)) continue;
            const circle = L.circle([resource.location.lat, resource.location.lng], {
                radius: resource.location.precisionMeters, interactive: false, bubblingMouseEvents: false, className: `mh-map-coverage mh-map-resource-area ${isDimmed([resource.uri]) ? 'is-dimmed' : ''}`.trim(),
            }).addTo(map);
            const label = document.createElement('span');
            label.textContent = resource.name;
            circle.bindTooltip(label, { direction: 'top' });
            const point = L.circleMarker([resource.location.lat, resource.location.lng], {
                radius: 6, bubblingMouseEvents: false, className: 'mh-map-place',
            }).addTo(map);
            point.bindTooltip(label, { direction: 'top' });
            const activate = () => { focus(resource.location.lat, resource.location.lng, [resource.uri]); selectResourceRef.current?.(resource.uri); };
            point.on('click', activate);
            keyboard(point, resource.name, activate);
            layers.push(circle, point);
        }
        // Keep count badges above resource points and passive coverage shapes.
        for (const layer of layers) {
            const path = layer as L.Path;
            if (path.options?.className?.includes('mh-map-cluster')) path.bringToFront();
        }
        return () => layers.forEach((layer) => { layer.unbindTooltip?.(); layer.remove(); });
    }, [aggregateCells, cellClusters, focusedKeys, zoom, t,
        cards,
        clusteredPostIds,
        clusters,
        exactPlaces,
        resources,
        focusedArea,
        markers,
        selectedPostId,
    ]);

    const hasItems = Boolean(aggregateCells?.length) ||
        markers.length > 0 || clusters.length > 0 || resources.length > 0;

    return (
        <div className={`mh-map-container mh-map-style-${circleStyle}`}>
            <fieldset className='mh-map-style-control'>
                <legend>{t('map.circleStyle')}</legend>
                {(
                    [
                        ['filled', t('map.filled')],
                        ['outline', t('map.outline')],
                        ['contrast', t('map.highContrast')],
                    ] as const
                ).map(([value, label]) => (
                    <label key={value}>
                        <input
                            type='radio'
                            name={`circle-style-${mapId}`}
                            value={value}
                            checked={circleStyle === value}
                            onChange={() => {
                                setCircleStyle(value);
                                try {
                                    window.localStorage.setItem(
                                        circleStyleStorageKey,
                                        value,
                                    );
                                } catch {
                                    // Style choice remains usable for this page
                                    // even when storage is unavailable.
                                }
                            }}
                        />
                        <span>{label}</span>
                    </label>
                ))}
            </fieldset>
            {groupPostIds.length > 0 && (
                <section ref={groupRef} className='mh-map-group' aria-label={t('map.sharedArea')}>
                    <div className='flex items-center justify-between gap-2'>
                        <p>{t('map.sharedArea')}</p>
                        <button type='button' className='mh-button' onClick={() => setGroupPostIds([])}>{t('map.closeDrawer')}</button>
                    </div>
                    <ul>{cards.filter(card => groupPostIds.includes(card.id)).map(card => (
                        <li key={card.id}><button type='button' className='mh-button' onClick={() => { setGroupPostIds([]); onSelectPostIdRef.current(card.id); }}>{card.title}</button></li>
                    ))}</ul>
                </section>
            )}
            {!hasItems && (
                <p id={instructionsId} className='mh-map-empty-message'>
                    {t('map.emptyInteractive')}
                </p>
            )}
            {hasItems && (
                <p id={instructionsId} className='mh-map-instructions'>
                    {t('handoff.mapInstructions')}
                </p>
            )}
            {onConfirmArea ? (
                <div className='mh-map-area-confirm' role='status' aria-live='polite'>
                    <p>
                        {areaCandidate
                            ? t('discovery.areaPointSelected', {
                                  lat: areaCandidate.lat.toFixed(3),
                                  lng: areaCandidate.lng.toFixed(3),
                              })
                            : t('discovery.areaPickerHelp')}
                    </p>
                    {areaCandidate ? <p>{t('discovery.areaRadiusPreview')}</p> : null}
                    <button
                        type='button'
                        className='mh-button mh-button-secondary'
                        disabled={!areaCandidate || !canConfirmArea}
                        onClick={() => areaCandidate && onConfirmAreaRef.current?.(areaCandidate)}
                    >
                        {t('discovery.confirmArea')}
                    </button>
                </div>
            ) : null}
            <div
                ref={mapRef}
                className='mh-interactive-map'
                role='region'
                aria-label={t('map.interactiveLabel')}
                aria-describedby={instructionsId}
                tabIndex={0}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        setFocusedKeys([]);
                        onSelectPostIdRef.current(undefined);
                    }
                }}
            />
            <div className='mh-map-legend'>
                <div className='mh-map-legend-item'>
                    <span
                        className='mh-map-legend-circle mh-map-legend-aid'
                        aria-hidden='true'
                    />
                    <span>{t('map.singleRequest')}</span>
                </div>
                <div className='mh-map-legend-item'>
                    <span
                        className='mh-map-legend-circle mh-map-legend-cluster'
                        aria-hidden='true'
                    />
                    <span>{t('map.cluster')}</span>
                </div>
                <div className='mh-map-legend-item'>
                    <span className='mh-map-legend-place' aria-hidden='true' />
                    <span>{t('handoff.resourceMapLegend')}</span>
                </div>
                <div className='mh-map-legend-note'>{t('map.legendNote')}</div>
            </div>
        </div>
    );
};
