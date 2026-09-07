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
        return { states: [...states].sort(), areas };
    }, [props.cells, level]);

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
        map.on('moveend', () => {
            const point = map.getCenter();
            callbacks.current.onViewportChange({ center: { lat: point.lat, lng: point.lng }, radiusMeters: Math.round(map.distance(point, map.getBounds().getNorthEast())) });
        });
        const observer = new ResizeObserver(() => map.invalidateSize());
        observer.observe(container.current);
        return () => { observer.disconnect(); map.remove(); mapRef.current = null; };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        if (map) map.panTo([props.center.lat, props.center.lng]);
    }, [props.center.lat, props.center.lng]);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const abort = new AbortController();
        const group = L.layerGroup().addTo(map);
        setBoundaryError(undefined);
        setLoading(true);
        const files = level === 'state' ? ['states'] : counts.states.map(state => `${state}-${level}`);
        void Promise.all(files.map(file => boundaries(file, abort.signal))).then(collections => {
            if (abort.signal.aborted) return;
            for (const collection of collections) {
                L.geoJSON(collection, {
                    filter: feature => counts.areas.has(feature.properties.id),
                    style: feature => ({
                        color: '#734cba', weight: feature?.properties.id === props.selectedPostalCode ? 2 : 1,
                        fillColor: '#9d7dd3', fillOpacity: feature?.properties.id === props.selectedPostalCode ? .24 : .09,
                        bubblingMouseEvents: false,
                    }),
                    onEachFeature: (feature, layer) => {
                        const count = counts.areas.get(feature.properties.id)!;
                        const label = `${feature.properties.name}: ${count} ${count === 1 ? 'request' : 'requests'}`;
                        const text = document.createElement('span');
                        text.textContent = label;
                        layer.bindTooltip(text, { permanent: level !== 'zip' || zoom >= 13, direction: 'center', pane: 'postalLabels', className: 'mh-postal-area-label' });
                        const activate = () => {
                            const polygon = layer as L.Polygon;
                            if (level === 'zip') callbacks.current.onSelectPostalCode(feature.properties.id);
                            map.fitBounds(polygon.getBounds(), { padding: [32, 32], animate: false, maxZoom: level === 'state' ? 9 : level === 'county' ? 12 : 13 });
                            const detailZoom = level === 'state' ? 7 : level === 'county' ? 10 : 13;
                            if (map.getZoom() < detailZoom) map.setZoom(detailZoom, { animate: false });
                        };
                        layer.on('click', activate);
                        layer.on('add', () => {
                            const element = (layer as L.Path).getElement();
                            element?.setAttribute('tabindex', '0');
                            element?.setAttribute('role', 'button');
                            element?.setAttribute('aria-label', `${level === 'zip' ? 'Show' : 'Explore'} ${label}`);
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
    }, [counts, level, zoom, props.selectedPostalCode, retry]);

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

    return <div>
        <p className='mb-2 text-sm' role='status'>{level === 'zip' ? 'Requests by ZIP area' : level === 'county' ? 'Requests by county' : 'Requests by state'}{loading ? ' · Loading boundaries…' : ''}</p>
        {boundaryError && <p role='alert'>{boundaryError} <button className='mh-button' onClick={() => setRetry(value => value + 1)}>Retry boundaries</button></p>}
        <div ref={container} className='mh-interactive-map h-[60vh] min-h-96 w-full' aria-label='Requests by ZIP area and public resource locations' />
        <p className='mt-2 text-xs text-mh-textMuted'>Shaded areas count requests. Pins show public resources at their street addresses. ZIP areas use 2020 Census boundaries; request locations never become more detailed as you zoom.</p>
    </div>;
}
