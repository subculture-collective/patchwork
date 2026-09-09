import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { FeatureCollection, Geometry } from 'geojson';
import { leafletLayer } from 'protomaps-leaflet';
import { lookupPostalArea } from '@patchwork/at-lexicons';
import type { DiscoveryMapAggregates } from '@patchwork/shared';
import { useLocale } from '../../i18n';
import { resolveMapTileUrl } from '../../config';
import { currentExactPublicAddress, type ResourceDirectoryCard } from '../../resource-directory-ux';

interface Props {
    cells: DiscoveryMapAggregates['cells'];
    resources: readonly ResourceDirectoryCard[];
    center: { lat: number; lng: number };
    selectedPostalCode?: string;
    searchRadiusMeters?: number;
    resourceMode?: boolean;
    selectedResourceUri?: string;
    onSelectPostalCode: (code: string) => void;
    onClearPostalCode: () => void;
    onSelectResource: (uri: string) => void;
    onTilesFailed: (message: string) => void;
    onViewportChange: (area: { center: { lat: number; lng: number }; radiusMeters: number }) => void;
}
type AreaProperties = { id: string; name: string; state?: string; county?: string };
type Boundaries = FeatureCollection<Geometry, AreaProperties>;
const cache = new Map<string, Boundaries>();
async function boundaries(file: string, signal: AbortSignal): Promise<Boundaries> {
    const cached = cache.get(file);
    if (cached) return cached;
    const response = await fetch(`/geography/census2020/${file}.json`, { signal });
    if (!response.ok) throw new Error('Geographic boundaries could not be loaded.');
    const data = await response.json() as Boundaries;
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Geographic boundaries are unavailable.');
    cache.set(file, data);
    return data;
}

export function PostalMap(props: Props) {
    const { t } = useLocale();
    const [mapSize, setMapSize] = useState('');
    const [boundaryView, setBoundaryView] = useState(0);
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const callbacks = useRef(props);
    callbacks.current = props;
    const [visibleStates, setVisibleStates] = useState<string[]>([]);
    const [selectedCounty, setSelectedCounty] = useState<{
        id: string;
        name: string;
    }>();
    const ignoreNextCenter = useRef(false);
    const interactiveMove = useRef(false);
    const browseZoom = useRef(11);
    const previousPostalCode = useRef(props.selectedPostalCode);
    const fittedZip = useRef<string | undefined>(undefined);
    const [zoom, setZoom] = useState(props.selectedPostalCode ? 13 : 9);
    const [boundaryError, setBoundaryError] = useState<string>();
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(false);
    const level = props.selectedPostalCode ? 'zip' : zoom < 7 ? 'state' : zoom < 10 ? 'county' : 'zip';
    const counts = useMemo(() => {
        const states = new Set<string>();
        const areas = new Map<string, number>();
        for (const cell of props.cells) {
            const area = cell.postalCode
                ? lookupPostalArea(cell.postalCode)
                : undefined;
            if (!area) continue;
            states.add(area.stateId);
            const id =
                level === 'state'
                    ? area.stateId
                    : level === 'county'
                      ? area.countyId
                      : area.postalCode;
            areas.set(id, (areas.get(id) ?? 0) + cell.count);
        }
        return {
            states: [...new Set([...states, ...visibleStates])].sort(),
            areas,
        };
    }, [props.cells, level, visibleStates]);

    useEffect(() => {
        if (!container.current) return;
        const initial = callbacks.current.center;
        const reducedMotion = window.matchMedia(
            '(prefers-reduced-motion: reduce)',
        ).matches;
        const map = L.map(container.current, {
            maxZoom: 18,
            zoomAnimation: !reducedMotion,
            fadeAnimation: !reducedMotion,
        }).setView(
            [initial.lat, initial.lng],
            callbacks.current.selectedPostalCode ? 13 : 9,
        );
        mapRef.current = map;
        map.createPane('postalLabels').style.zIndex = '450';
        leafletLayer({
            url: resolveMapTileUrl(import.meta.env, import.meta.env.PROD),
            flavor: 'light',
            lang: 'en',
            maxDataZoom: 10,
        })
            .on('tileerror', () =>
                callbacks.current.onTilesFailed(t('postal.tileError')),
            )
            .addTo(map);
        map.attributionControl.addAttribution(
            '© OpenStreetMap contributors · Boundaries: US Census Bureau, 2020',
        );
        map.on('zoomend', () => setZoom(map.getZoom()));
        let stateBounds: { id: string; bounds: L.LatLngBounds }[] = [];
        const abort = new AbortController();
        const updateStates = () => {
            const next = stateBounds
                .filter(state => state.bounds.intersects(map.getBounds()))
                .map(state => state.id)
                .sort();
            setVisibleStates(previous =>
                previous.join(',') === next.join(',') ? previous : next,
            );
        };
        void boundaries('states', abort.signal)
            .then(data => {
                if (abort.signal.aborted) return;
                stateBounds = data.features.map(feature => ({
                    id: feature.properties.id,
                    bounds: L.geoJSON(feature).getBounds(),
                }));
                updateStates();
            })
            .catch(() => {});
        map.on('dragstart', () => {
            interactiveMove.current = true;
        });
        const markWheel = () => {
            interactiveMove.current = true;
        };
        const markKey = (event: KeyboardEvent) => {
            if (
                [
                    'ArrowUp',
                    'ArrowDown',
                    'ArrowLeft',
                    'ArrowRight',
                    '+',
                    '-',
                    '=',
                ].includes(event.key)
            )
                interactiveMove.current = true;
        };
        const markZoom = (event: MouseEvent) => {
            if ((event.target as Element).closest('.leaflet-control-zoom'))
                interactiveMove.current = true;
        };
        const node = container.current;
        node.addEventListener('wheel', markWheel, { passive: true });
        node.addEventListener('keydown', markKey);
        node.addEventListener('click', markZoom, true);
        let previousView = {
            lat: initial.lat,
            lng: initial.lng,
            zoom: map.getZoom(),
        };
        map.on('moveend', () => {
            updateStates();
            if (callbacks.current.resourceMode) setBoundaryView(value => value + 1);
            const point = map.getCenter();
            if (
                Math.abs(point.lat - previousView.lat) < 0.00001 &&
                Math.abs(point.lng - previousView.lng) < 0.00001 &&
                map.getZoom() === previousView.zoom
            )
                return;
            previousView = {
                lat: point.lat,
                lng: point.lng,
                zoom: map.getZoom(),
            };
            if (!interactiveMove.current) return;
            interactiveMove.current = false;
            callbacks.current.onViewportChange({
                center: { lat: point.lat, lng: point.lng },
                radiusMeters: Math.round(
                    map.distance(point, map.getBounds().getNorthEast()),
                ),
            });
        });
        const observer = new ResizeObserver(() => {
            if (!container.current?.clientWidth) return;
            map.invalidateSize({ pan: false });
            setMapSize(
                `${container.current.clientWidth}:${container.current.clientHeight}`,
            );
        });
        observer.observe(container.current);
        return () => {
            node.removeEventListener('wheel', markWheel);
            node.removeEventListener('keydown', markKey);
            node.removeEventListener('click', markZoom, true);
            abort.abort();
            observer.disconnect();
            map.remove();
            mapRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (ignoreNextCenter.current) {
            ignoreNextCenter.current = false;
            return;
        }
        if (!map) return;
        interactiveMove.current = false;
        // A list-to-map transition reveals the container before ResizeObserver runs.
        // Refresh Leaflet dimensions before centering the selected public place.
        map.invalidateSize({ pan: false });
        if (props.searchRadiusMeters) {
            map.fitBounds(L.latLng(props.center.lat, props.center.lng).toBounds(props.searchRadiusMeters * 2), {padding:[24,24], animate:false, maxZoom:15});
        } else map.panTo([props.center.lat, props.center.lng]);
    }, [props.center.lat, props.center.lng, props.searchRadiusMeters]);

    useEffect(() => {
        if (previousPostalCode.current && !props.selectedPostalCode) {
            fittedZip.current = undefined;
            mapRef.current?.setZoom(browseZoom.current, { animate: false });
            browseZoom.current = 11;
        }
        previousPostalCode.current = props.selectedPostalCode;
    }, [props.selectedPostalCode]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const abort = new AbortController();
        const group = L.layerGroup().addTo(map);
        setBoundaryError(undefined);
        setLoading(true);
        const files =
            level === 'state'
                ? ['states']
                : counts.states.flatMap(state =>
                      level === 'zip'
                          ? [`${state}-county`, `${state}-zip`]
                          : [`${state}-county`],
                  );
        void Promise.all(files.map(file => boundaries(file, abort.signal)))
            .then(collections => {
                if (abort.signal.aborted) return;
                for (const [
                    collectionIndex,
                    collection,
                ] of collections.entries()) {
                    const isCounty =
                        files[collectionIndex]!.endsWith('-county');
                    const isZip = files[collectionIndex]!.endsWith('-zip');
                    const selectedCountyId =
                        (props.selectedPostalCode
                            ? lookupPostalArea(props.selectedPostalCode)
                                  ?.countyId
                            : undefined) ?? selectedCounty?.id;
                    L.geoJSON(collection, {
                        filter: feature =>
                            !isZip ||
                            (props.resourceMode && L.geoJSON(feature).getBounds().intersects(map.getBounds())) ||
                            counts.areas.has(feature.properties.id) ||
                            feature.properties.id === props.selectedPostalCode,
                        style: feature => ({
                            color: isCounty ? '#78877c' : '#12664f',
                            weight:
                                feature?.properties.id ===
                                    props.selectedPostalCode ||
                                (isCounty &&
                                    feature?.properties.id === selectedCountyId)
                                    ? 2
                                    : 1,
                            fillColor: isCounty ? '#9ec5ad' : '#12664f',
                            fillOpacity: isCounty
                                ? feature?.properties.id === selectedCountyId
                                    ? 0.15
                                    : 0.025
                                : feature?.properties.id ===
                                    props.selectedPostalCode
                                  ? 0.24
                                  : 0.09,
                            bubblingMouseEvents: false,
                        }),
                        onEachFeature: (feature, layer) => {
                            const count =
                                isCounty && level === 'zip'
                                    ? props.cells.reduce(
                                          (sum, cell) =>
                                              sum +
                                              (cell.postalCode &&
                                              lookupPostalArea(cell.postalCode)
                                                  ?.countyId ===
                                                  feature.properties.id
                                                  ? cell.count
                                                  : 0),
                                          0,
                                      )
                                    : (counts.areas.get(
                                          feature.properties.id,
                                      ) ?? 0);
                            const label = props.resourceMode ? feature.properties.name : t('postal.areaCount', {
                                area: feature.properties.name,
                                count,
                            });
                            const text = document.createElement('span');
                            text.textContent = isZip && !props.resourceMode ? String(count) : label;
                            text.title = label;
                            layer.bindTooltip(text, {
                                permanent:
                                    !props.resourceMode && (isZip || (!isCounty && level === 'state')),
                                direction: 'center',
                                pane: 'postalLabels',
                                className: isZip
                                    ? 'mh-postal-count'
                                    : 'mh-postal-area-label',
                            });
                            const activate = () => {
                                interactiveMove.current = !isZip;
                                const polygon = layer as L.Polygon;
                                if (isCounty) {
                                    setSelectedCounty({
                                        id: feature.properties.id,
                                        name: feature.properties.name,
                                    });
                                    if (callbacks.current.selectedPostalCode) {
                                        ignoreNextCenter.current = true;
                                        callbacks.current.onClearPostalCode();
                                    }
                                }
                                if (isZip) {
                                    callbacks.current.onSelectPostalCode(
                                        feature.properties.id,
                                    );
                                    if (window.innerWidth < 768)
                                        container.current?.scrollIntoView({
                                            block: 'start',
                                        });
                                }
                                map.fitBounds(polygon.getBounds(), {
                                    padding: [32, 32],
                                    animate: false,
                                    maxZoom:
                                        level === 'state'
                                            ? 9
                                            : isCounty
                                              ? 12
                                              : 14,
                                });
                                const detailZoom =
                                    level === 'state' ? 7 : isCounty ? 10 : 13;
                                if (map.getZoom() < detailZoom)
                                    map.setZoom(detailZoom, { animate: false });
                            };
                            if (
                                container.current?.clientWidth &&
                                isZip &&
                                feature.properties.id ===
                                    props.selectedPostalCode &&
                                fittedZip.current !== props.selectedPostalCode
                            ) {
                                interactiveMove.current = false;
                                fittedZip.current = props.selectedPostalCode;
                                if (window.innerWidth < 768)
                                    container.current?.scrollIntoView({
                                        block: 'start',
                                    });
                                map.fitBounds(
                                    (layer as L.Polygon).getBounds(),
                                    {
                                        padding: [28, 28],
                                        maxZoom: 14,
                                        animate: false,
                                    },
                                );
                            }
                            layer.on('click', activate);
                            layer.on('add', () => {
                                const element = (layer as L.Path).getElement();
                                const updateAccess = () => {
                                    const visible = map
                                        .getBounds()
                                        .intersects(
                                            (layer as L.Polygon).getBounds(),
                                        );
                                    element?.setAttribute(
                                        'tabindex',
                                        visible ? '0' : '-1',
                                    );
                                    element?.setAttribute(
                                        'aria-hidden',
                                        String(!visible),
                                    );
                                };
                                updateAccess();
                                map.on('moveend', updateAccess);
                                layer.once('remove', () =>
                                    map.off('moveend', updateAccess),
                                );
                                element?.setAttribute('role', 'button');
                                element?.setAttribute(
                                    'aria-pressed',
                                    String(
                                        isCounty
                                            ? feature.properties.id ===
                                                  selectedCountyId
                                            : feature.properties.id ===
                                                  props.selectedPostalCode,
                                    ),
                                );
                                element?.setAttribute(
                                    'aria-label',
                                    t(
                                        isZip
                                            ? 'postal.showArea'
                                            : 'postal.exploreArea',
                                        { label },
                                    ),
                                );
                                element?.addEventListener('keydown', event => {
                                    if (
                                        ['Enter', ' '].includes(
                                            (event as KeyboardEvent).key,
                                        )
                                    ) {
                                        event.preventDefault();
                                        activate();
                                    }
                                });
                            });
                        },
                    }).addTo(group);
                }
            })
            .catch(() => {
                if (!abort.signal.aborted)
                    setBoundaryError(t('postal.boundaryError'));
            })
            .finally(() => {
                if (!abort.signal.aborted) setLoading(false);
            });
        return () => {
            abort.abort();
            group.remove();
        };
    }, [
        boundaryView, props.resourceMode,
        counts,
        level,
        zoom,
        props.selectedPostalCode,
        selectedCounty,
        retry,
        mapSize,
        t,
    ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const group = L.layerGroup().addTo(map);
        const markers: L.Marker[] = [];
        const places = new Map<
            string,
            { lat: number; lng: number; resources: ResourceDirectoryCard[] }
        >();
        for (const resource of props.resources) {
            const address = currentExactPublicAddress(resource);
            if (!address) continue;
            const key = `${address.latitude},${address.longitude}`;
            const place = places.get(key) ?? {
                lat: address.latitude,
                lng: address.longitude,
                resources: [],
            };
            place.resources.push(resource);
            places.set(key, place);
        }
        const size = Math.max(5, Math.min(18, 5 + (zoom - 5) * 1.1));
        // Keep small visual pins while preserving a usable pointer target.
        const hitSize = Math.max(24, size + 8);
        for (const place of places.values()) {
            const dot = document.createElement('span');
            dot.className = 'mh-exact-resource-pin-dot';
            dot.style.width = `${size}px`;
            dot.style.height = `${size}px`;
            const marker = L.marker([place.lat, place.lng], {
                icon: L.divIcon({
                    html: dot,
                    className: `mh-exact-resource-pin ${place.resources.some(resource => resource.uri === props.selectedResourceUri) ? 'is-selected' : ''}`,
                    iconSize: [hitSize, hitSize],
                    iconAnchor: [hitSize / 2, hitSize / 2],
                }),
                keyboard: true,
                title: place.resources
                    .map(resource => resource.name)
                    .join('; '),
                riseOnHover: true,
            }).addTo(group);
            markers.push(marker);
            if (place.resources.length === 1)
                marker.on('click', () =>
                    callbacks.current.onSelectResource(place.resources[0]!.uri),
                );
            else {
                const list = document.createElement('div');
                for (const resource of place.resources) {
                    const button = document.createElement('button');
                    button.textContent = resource.name;
                    button.className = 'mh-button block my-1';
                    button.onclick = () =>
                        callbacks.current.onSelectResource(resource.uri);
                    list.append(button);
                }
                marker.bindPopup(list);
            }
        }
        // A pin clipped by the map edge has no usable target. Reveal it when
        // panning brings its full target into view, without moving its address.
        const updateMarkerVisibility = () => {
            const viewport = map.getSize();
            const inset = hitSize / 2 + 2;
            for (const marker of markers) {
                const node = marker.getElement();
                if (!node) continue;
                const point = map.latLngToContainerPoint(marker.getLatLng());
                const visible = point.x >= inset && point.y >= inset &&
                    point.x <= viewport.x - inset && point.y <= viewport.y - inset;
                node.style.visibility = visible ? 'visible' : 'hidden';
                node.tabIndex = visible ? 0 : -1;
                node.setAttribute('aria-hidden', String(!visible));
            }
        };
        updateMarkerVisibility();
        map.on('moveend resize', updateMarkerVisibility);
        return () => {
            map.off('moveend resize', updateMarkerVisibility);
            group.remove();
        };
    }, [props.resources, props.selectedResourceUri, zoom]);

    const selectedZipArea = props.selectedPostalCode
        ? lookupPostalArea(props.selectedPostalCode)
        : undefined;
    const activeCounty = selectedZipArea
        ? {
              id: selectedZipArea.countyId,
              name: `${selectedZipArea.countyName}, ${selectedZipArea.stateName}`,
          }
        : selectedCounty;
    const navigateLevel = (target: number) => {
        interactiveMove.current = true;
        fittedZip.current = undefined;
        browseZoom.current = target;
        if (props.selectedPostalCode) callbacks.current.onClearPostalCode();
        if (target < 10) setSelectedCounty(undefined);
        mapRef.current?.setZoom(target, { animate: false });
    };
    return (
        <div>
            <nav
                hidden={props.resourceMode}
                aria-label={t('postal.levels')}
                className='mb-3 flex flex-wrap items-center gap-2 text-sm'
            >
                <button
                    className='mh-nav-chip'
                    aria-current={level === 'state' ? 'step' : undefined}
                    onClick={() => navigateLevel(5)}
                >
                    {t('postal.states')}
                </button>
                <span aria-hidden='true'>›</span>
                <button
                    className='mh-nav-chip'
                    aria-current={level === 'county' ? 'step' : undefined}
                    onClick={() => navigateLevel(8)}
                >
                    {t('postal.counties')}
                </button>
                <span aria-hidden='true'>›</span>
                <button
                    className='mh-nav-chip'
                    aria-current={
                        level === 'zip' && !props.selectedPostalCode
                            ? 'step'
                            : undefined
                    }
                    onClick={() => navigateLevel(11)}
                >
                    {t('postal.zips')}
                </button>
                {props.selectedPostalCode && (
                    <>
                        <span aria-hidden='true'>›</span>
                        <button
                            className='mh-nav-chip'
                            aria-current='step'
                            onClick={() =>
                                callbacks.current.onSelectPostalCode(
                                    props.selectedPostalCode!,
                                )
                            }
                        >
                            {t('postal.viewZip', {
                                zip: props.selectedPostalCode,
                            })}
                        </button>
                    </>
                )}
            </nav>
            {activeCounty && !props.resourceMode && (
                <p className='mb-2 text-sm'>
                    <strong>{activeCounty.name}</strong> ·{' '}
                    {t('postal.searchCount', {
                        count: props.cells.reduce(
                            (sum, cell) =>
                                sum +
                                (cell.postalCode &&
                                lookupPostalArea(cell.postalCode)?.countyId ===
                                    activeCounty.id
                                    ? cell.count
                                    : 0),
                            0,
                        ),
                    })}
                </p>
            )}
            <p className={props.resourceMode ? 'sr-only' : 'mb-2 text-sm'} role='status'>
                {props.resourceMode ? t('nearby.resourceMapHelp') : props.selectedPostalCode
                    ? t('postal.zipDetail', { zip: props.selectedPostalCode })
                    : t(`postal.by${level}`)}
                {loading ? ` · ${t('postal.loading')}` : ''}
            </p>
            {boundaryError && (
                <p role='alert'>
                    {boundaryError}{' '}
                    <button
                        className='mh-button'
                        onClick={() => setRetry(value => value + 1)}
                    >
                        {t('postal.retry')}
                    </button>
                </p>
            )}
            <div
                ref={container}
                className='mh-interactive-map h-[60vh] min-h-96 w-full'
                aria-label={t('postal.mapLabel')}
            />
            <p className='mt-2 text-xs text-mh-textMuted'>
                {t(props.resourceMode ? 'nearby.resourceMapLegend' : 'postal.legend')}
            </p>
        </div>
    );
}
