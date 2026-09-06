import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useId, useState } from 'react';
import L from 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import type { MapAidCard } from '../../map-ux.js';
import {
    clusterExpansionZoom,
    clusterDistanceMetersForZoom,
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
            if (!onConfirmAreaRef.current) return;
            setAreaCandidate({ lat: event.latlng.lat, lng: event.latlng.lng });
        };
        map.on('click', selectMapPoint);
        const container = map.getContainer();
        const selectKeyboardPoint = (event: KeyboardEvent) => {
            if (!onConfirmAreaRef.current || (event.key !== 'Enter' && event.key !== ' ')) return;
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
        for (const cluster of clusters) {
            if (cluster.count <= 1) continue;
            const circle = L.circle([cluster.lat, cluster.lng], {
                radius: cluster.radiusMeters,
                className:
                    (selectedPostId &&
                        cluster.postIds.includes(selectedPostId)) ||
                    (focusedArea &&
                        sameCenter(focusedArea.center, {
                            lat: cluster.lat,
                            lng: cluster.lng,
                        }))
                        ? 'mh-map-cluster is-selected'
                        : 'mh-map-cluster',
            }).addTo(map);
            circle.bindTooltip(`${cluster.count} · U${cluster.urgencyMax}`, {
                permanent: true,
                direction: 'center',
                className: 'mh-map-circle-label mh-map-cluster-label',
            });
            circle.on('click', () => {
                const nextZoom = clusterExpansionZoom(
                    cards,
                    cluster.postIds,
                    map.getZoom(),
                    cluster.lat,
                );
                map.setView([cluster.lat, cluster.lng], nextZoom);

            });
            layers.push(circle);
        }
        for (const marker of markers) {
            if (!marker || clusteredPostIds.has(marker.id)) continue;
            const circle = L.circle([marker.lat, marker.lng], {
                radius: marker.radiusMeters,
                className:
                    marker.id === selectedPostId
                        ? 'mh-map-circle is-selected'
                        : 'mh-map-circle',
            }).addTo(map);
            circle.bindTooltip(`${marker.label} · U${marker.urgency}`, {
                permanent: true,
                direction: 'center',
                className: 'mh-map-circle-label mh-map-request-label',
            });
            circle.on('click', () => {
                map.setView([marker.lat, marker.lng], map.getZoom());
                onFocusAreaRef.current?.({
                    center: { lat: marker.lat, lng: marker.lng },
                    radiusMeters: marker.radiusMeters,
                    label: marker.label,
                });
                onSelectPostIdRef.current(marker.id);
            });
            layers.push(circle);
        }
        for (const { resource, exact } of exactPlaces) {
            const marker = L.circleMarker([exact.latitude, exact.longitude], {
                radius: 7,
                className:
                    focusedArea &&
                    sameCenter(focusedArea.center, {
                        lat: exact.latitude,
                        lng: exact.longitude,
                    })
                        ? 'mh-map-place is-selected'
                        : 'mh-map-place',
            }).addTo(map);
            const resourceLabel = document.createElement('span');
            resourceLabel.textContent = `${resource.name} · ${resource.openHours ?? ''}`;
            marker.bindTooltip(
                resourceLabel,
                {
                    permanent: true,
                    direction: 'right',
                    className: 'mh-map-place-label',
                },
            );
            marker.on('click', () => {
                map.setView([exact.latitude, exact.longitude], 15);
                selectResourceRef.current?.(resource.uri);
            });
            layers.push(marker);
        }
        for (const resource of resources) {
            if (currentExactPublicAddress(resource)) continue;
            const circle = L.circle([resource.location.lat, resource.location.lng], {
                radius: Math.max(1000, resource.location.precisionMeters), className: 'mh-map-place',
            }).addTo(map);
            const label = document.createElement('span');
            label.textContent = resource.name;
            circle.bindTooltip(label, { direction: 'top' });
            circle.on('click', () => selectResourceRef.current?.(resource.uri));
            layers.push(circle);
        }
        return () => layers.forEach((layer) => layer.remove());
    }, [
        cards,
        clusteredPostIds,
        clusters,
        exactPlaces,
        resources,
        focusedArea,
        markers,
        selectedPostId,
    ]);

    const hasItems =
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
