import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { FeatureCollection, Geometry } from 'geojson';
import { leafletLayer } from 'protomaps-leaflet';
import { lookupPostalArea } from '@patchwork/at-lexicons';
import type { DiscoveryMapAggregates } from '@patchwork/shared';
import { resolveMapTileUrl } from '../../config';
import { currentExactPublicAddress, type ResourceDirectoryCard } from '../../resource-directory-ux';

interface Props {
    cells: DiscoveryMapAggregates['cells'];
    resources: readonly ResourceDirectoryCard[];
    center: { lat: number; lng: number };
    selectedPostalCode?: string;
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
    const container = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const callbacks = useRef(props);
    callbacks.current = props;
    const [visibleStates, setVisibleStates] = useState<string[]>([]);
    const [selectedCounty, setSelectedCounty] = useState<{ id: string; name: string }>();
    const ignoreNextCenter = useRef(false);
    const browseZoom = useRef(11);
    const previousPostalCode = useRef(props.selectedPostalCode);
    const fittedZip = useRef<string | undefined>(undefined);
    const [zoom, setZoom] = useState(props.selectedPostalCode ? 13 : 9);
    const [boundaryError, setBoundaryError] = useState<string>();
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(false);
    const level = zoom < 7 ? 'state' : zoom < 10 ? 'county' : 'zip';
    const counts = useMemo(() => {
        const states = new Set<string>();
        const areas = new Map<string, number>();
        for (const cell of props.cells) {
            const area = cell.postalCode ? lookupPostalArea(cell.postalCode) : undefined;
            if (!area) continue;
            states.add(area.stateId);
            const id = level === 'state' ? area.stateId : level === 'county' ? area.countyId : area.postalCode;
            areas.set(id, (areas.get(id) ?? 0) + cell.count);
        }
        return { states: [...new Set([...states, ...visibleStates])].sort(), areas };
    }, [props.cells, level, visibleStates]);

    useEffect(() => {
        if (!container.current) return;
        const initial = callbacks.current.center;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const map = L.map(container.current, { maxZoom: 18, zoomAnimation: !reducedMotion, fadeAnimation: !reducedMotion })
            .setView([initial.lat, initial.lng], callbacks.current.selectedPostalCode ? 13 : 9);
        mapRef.current = map;
        map.createPane('postalLabels').style.zIndex = '450';
        leafletLayer({ url: resolveMapTileUrl(import.meta.env, import.meta.env.PROD), flavor: 'light', lang: 'en', maxDataZoom: 10 })
            .on('tileerror', () => callbacks.current.onTilesFailed('The base map could not load. Resource and request lists are still available.'))
            .addTo(map);
        map.attributionControl.addAttribution('© OpenStreetMap contributors · Boundaries: US Census Bureau, 2020');
        map.on('zoomend', () => setZoom(map.getZoom()));
        let stateBounds: { id: string; bounds: L.LatLngBounds }[] = [];
        const abort = new AbortController();
        const updateStates = () => {
            const next = stateBounds.filter(state => state.bounds.intersects(map.getBounds())).map(state => state.id).sort();
            setVisibleStates(previous => previous.join(',') === next.join(',') ? previous : next);
        };
        void boundaries('states', abort.signal).then(data => {
            if (abort.signal.aborted) return;
            stateBounds = data.features.map(feature => ({ id: feature.properties.id, bounds: L.geoJSON(feature).getBounds() }));
            updateStates();
        }).catch(() => {});
        map.on('moveend', () => {
            updateStates();
            const point = map.getCenter();
            callbacks.current.onViewportChange({ center: { lat: point.lat, lng: point.lng }, radiusMeters: Math.round(map.distance(point, map.getBounds().getNorthEast())) });
        });
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(container.current);
        return () => { abort.abort(); observer.disconnect(); map.remove(); mapRef.current = null; };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (ignoreNextCenter.current) { ignoreNextCenter.current = false; return; }
        if (map) map.panTo([props.center.lat, props.center.lng]);
    }, [props.center.lat, props.center.lng]);

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
        const files = level === 'state' ? ['states'] : counts.states.flatMap(state => level === 'zip' ? [`${state}-county`, `${state}-zip`] : [`${state}-county`]);
        void Promise.all(files.map(file => boundaries(file, abort.signal))).then(collections => {
            if (abort.signal.aborted) return;
            for (const [collectionIndex, collection] of collections.entries()) {
                const isCounty = files[collectionIndex]!.endsWith('-county');
                const isZip = files[collectionIndex]!.endsWith('-zip');
                const selectedCountyId = (props.selectedPostalCode ? lookupPostalArea(props.selectedPostalCode)?.countyId : undefined) ?? selectedCounty?.id;
                L.geoJSON(collection, {
                    filter: feature => !isZip || counts.areas.has(feature.properties.id),
                    style: feature => ({
                        color: isCounty ? '#536977' : '#734cba', weight: feature?.properties.id === props.selectedPostalCode || (isCounty && feature?.properties.id === selectedCountyId) ? 2 : 1,
                        fillColor: isCounty ? '#73a8ba' : '#9d7dd3', fillOpacity: isCounty ? (feature?.properties.id === selectedCountyId ? .15 : .025) : feature?.properties.id === props.selectedPostalCode ? .24 : .09,
                        bubblingMouseEvents: false,
                    }),
                    onEachFeature: (feature, layer) => {
                        const count = isCounty && level === 'zip' ? props.cells.reduce((sum, cell) => sum + (cell.postalCode && lookupPostalArea(cell.postalCode)?.countyId === feature.properties.id ? cell.count : 0), 0) : counts.areas.get(feature.properties.id) ?? 0;
                        const label = `${feature.properties.name}: ${count} ${count === 1 ? 'request' : 'requests'}`;
                        const text = document.createElement('span');
                        text.textContent = isZip ? String(count) : label;
                        text.title = label;
                        layer.bindTooltip(text, { permanent: isZip || (!isCounty && level === 'state'), direction: 'center', pane: 'postalLabels', className: isZip ? 'mh-postal-count' : 'mh-postal-area-label' });
                        const activate = () => {
                            const polygon = layer as L.Polygon;
                            if (isCounty) {
                                setSelectedCounty({ id: feature.properties.id, name: feature.properties.name });
                                if (callbacks.current.selectedPostalCode) { ignoreNextCenter.current = true; callbacks.current.onClearPostalCode(); }
                            }
                            if (isZip) {
                                callbacks.current.onSelectPostalCode(feature.properties.id);
                                if (window.innerWidth < 768) container.current?.scrollIntoView({ block: 'start' });
                            }
                            map.fitBounds(polygon.getBounds(), { padding: [32, 32], animate: false, maxZoom: level === 'state' ? 9 : isCounty ? 12 : 14 });
                            const detailZoom = level === 'state' ? 7 : isCounty ? 10 : 13;
                            if (map.getZoom() < detailZoom) map.setZoom(detailZoom, { animate: false });
                        };
                        if (isZip && feature.properties.id === props.selectedPostalCode && fittedZip.current !== props.selectedPostalCode) {
                            fittedZip.current = props.selectedPostalCode;
                            if (window.innerWidth < 768) container.current?.scrollIntoView({ block: 'start' });
                            map.fitBounds((layer as L.Polygon).getBounds(), { padding: [28, 28], maxZoom: 14, animate: false });
                        }
                        layer.on('click', activate);
                        layer.on('add', () => {
                            const element = (layer as L.Path).getElement();
                            element?.setAttribute('tabindex', '0');
                            element?.setAttribute('role', 'button');
                            element?.setAttribute('aria-pressed', String(isCounty ? feature.properties.id === selectedCountyId : feature.properties.id === props.selectedPostalCode));
                            element?.setAttribute('aria-label', `${isZip ? 'Show' : 'Explore'} ${label}`);
                            element?.addEventListener('keydown', event => {
                                if (['Enter', ' '].includes((event as KeyboardEvent).key)) { event.preventDefault(); activate(); }
                            });
                        });
                    },
                }).addTo(group);
            }
        }).catch(() => {
            if (!abort.signal.aborted) setBoundaryError('Geographic boundaries could not load. You can still use the request list.');
        }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
        return () => { abort.abort(); group.remove(); };
    }, [counts, level, zoom, props.selectedPostalCode, selectedCounty, retry]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const group = L.layerGroup().addTo(map);
        const places = new Map<string, { lat: number; lng: number; resources: ResourceDirectoryCard[] }>();
        for (const resource of props.resources) {
            const address = currentExactPublicAddress(resource);
            if (!address) continue;
            const key = `${address.latitude},${address.longitude}`;
            const place = places.get(key) ?? { lat: address.latitude, lng: address.longitude, resources: [] };
            place.resources.push(resource);
            places.set(key, place);
        }
        const size = Math.max(5, Math.min(18, 5 + (zoom - 5) * 1.1));
        const hitSize = Math.min(32, Math.max(16, size + 8));
        for (const place of places.values()) {
            const dot = document.createElement('span');
            dot.className = 'mh-exact-resource-pin-dot';
            dot.style.width = `${size}px`; dot.style.height = `${size}px`;
            const marker = L.marker([place.lat, place.lng], {
                icon: L.divIcon({ html: dot, className: 'mh-exact-resource-pin', iconSize: [hitSize, hitSize], iconAnchor: [hitSize / 2, hitSize / 2] }),
                keyboard: true, title: place.resources.map(resource => resource.name).join('; '),
                riseOnHover: true,
            }).addTo(group);
            if (place.resources.length === 1) marker.on('click', () => callbacks.current.onSelectResource(place.resources[0]!.uri));
            else {
                const list = document.createElement('div');
                for (const resource of place.resources) {
                    const button = document.createElement('button');
                    button.textContent = resource.name;
                    button.className = 'mh-button block my-1';
                    button.onclick = () => callbacks.current.onSelectResource(resource.uri);
                    list.append(button);
                }
                marker.bindPopup(list);
            }
        }
        return () => { group.remove(); };
    }, [props.resources, zoom]);

    const selectedZipArea = props.selectedPostalCode ? lookupPostalArea(props.selectedPostalCode) : undefined;
    const activeCounty = selectedZipArea ? { id: selectedZipArea.countyId, name: `${selectedZipArea.countyName}, ${selectedZipArea.stateName}` } : selectedCounty;
    const navigateLevel = (target: number) => {
        fittedZip.current = undefined;
        browseZoom.current = target;
        if (props.selectedPostalCode) callbacks.current.onClearPostalCode();
        if (target < 10) setSelectedCounty(undefined);
        mapRef.current?.setZoom(target, { animate: false });
    };
    return <div>
        <nav aria-label='Map detail levels' className='mb-3 flex flex-wrap items-center gap-2 text-sm'>
            <button className='mh-nav-chip' aria-current={level === 'state' ? 'step' : undefined} onClick={() => navigateLevel(5)}>States</button>
            <span aria-hidden='true'>›</span><button className='mh-nav-chip' aria-current={level === 'county' ? 'step' : undefined} onClick={() => navigateLevel(8)}>Counties</button>
            <span aria-hidden='true'>›</span><button className='mh-nav-chip' aria-current={level === 'zip' && !props.selectedPostalCode ? 'step' : undefined} onClick={() => navigateLevel(11)}>ZIP areas</button>
            {props.selectedPostalCode && <><span aria-hidden='true'>›</span><button className='mh-nav-chip' aria-current='step' onClick={() => callbacks.current.onSelectPostalCode(props.selectedPostalCode!)}>ZIP {props.selectedPostalCode} · View requests</button></>}
        </nav>
        {activeCounty && <p className='mb-2 text-sm'><strong>{activeCounty.name}</strong> selected · {props.cells.reduce((sum, cell) => sum + (cell.postalCode && lookupPostalArea(cell.postalCode)?.countyId === activeCounty.id ? cell.count : 0), 0)} requests in the current search</p>}
        <p className='mb-2 text-sm' role='status'>{props.selectedPostalCode ? `ZIP ${props.selectedPostalCode} detail` : level === 'zip' ? 'Requests by ZIP area' : level === 'county' ? 'Requests by county' : 'Requests by state'}{loading ? ' · Loading boundaries…' : ''}</p>
        {boundaryError && <p role='alert'>{boundaryError} <button className='mh-button' onClick={() => setRetry(value => value + 1)}>Retry boundaries</button></p>}
        <div ref={container} className='mh-interactive-map h-[60vh] min-h-96 w-full' aria-label='Requests by ZIP area and public resource locations' />
        <p className='mt-2 text-xs text-mh-textMuted'>Shaded areas count requests. Pins show public resources at their street addresses. ZIP areas use 2020 Census boundaries; request locations never become more detailed as you zoom.</p>
    </div>;
}
