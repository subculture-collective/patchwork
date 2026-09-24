import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { leafletLayer } from 'protomaps-leaflet';
import type { ResourceMapCell } from '@patchwork/shared';
import type { DiscoveryFilterState } from '../../discovery-filters';
import { fetchResourceMapViaApi } from '../../features/api-client';
import { resolveMapTileUrl } from '../../config';
import { useLocale } from '../../i18n';
import { separateResourceClusters } from './resource-clusters';

interface Props {
    state: DiscoveryFilterState;
    selectedUri?: string;
    onSelect: (uri: string) => void;
    onSearchArea: (area: Partial<DiscoveryFilterState>) => void;
    retry: number;
}

export function ResourceMap({ state, selectedUri, onSelect, onSearchArea, retry }: Props) {
    const { t, locale } = useLocale();
    const node = useRef<HTMLDivElement>(null);
    const instance = useRef<L.Map | null>(null);
    const callbacks = useRef({ onSelect, onSearchArea });
    callbacks.current = { onSelect, onSearchArea };
    const [view, setView] = useState(0);
    const [mapRetry, setMapRetry] = useState(0);
    const [cells, setCells] = useState<ResourceMapCell[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [tileError, setTileError] = useState(false);
    const [moved, setMoved] = useState(false);
    const [mapped, setMapped] = useState(0);
    const queryKey = JSON.stringify(state);
    const initialState = useRef(state);

    useEffect(() => {
        if (!node.current) return;
        const map = L.map(node.current, { scrollWheelZoom: false, zoomControl: false });
        instance.current = map;
        const center = initialState.current.center ?? { lat: 41.885, lng: -87.623 };
        map.setView([center.lat, center.lng], 11);
        L.control.zoom({ position: 'bottomright' }).addTo(map);
        const layer = leafletLayer({ url: resolveMapTileUrl(import.meta.env, import.meta.env.PROD), flavor: 'light', lang: locale, maxDataZoom: 10 });
        layer.on('tileerror', () => setTileError(true));
        layer.addTo(map);
        const refresh = () => setView(v => v + 1);
        const markMoved = () => setMoved(true);
        map.on('moveend', refresh);
        map.on('dragend', markMoved);
        const observer = new ResizeObserver(() => { map.invalidateSize({ pan: false }); refresh(); });
        observer.observe(node.current);
        return () => { observer.disconnect(); instance.current = null; map.remove(); };
    }, [locale]);

    useEffect(() => {
        const map = instance.current;
        if (!map || !state.center) return;
        map.invalidateSize({ pan: false });
        map.fitBounds(L.latLng(state.center.lat, state.center.lng).toBounds((state.radiusMeters ?? 20000) * 2), { padding: [28, 28], maxZoom: 15, animate: false });
        setMoved(false);
    }, [state.center?.lat, state.center?.lng, state.radiusMeters, locale]);

    useEffect(() => {
        const map = instance.current;
        if (!map || !state.center) return;
        const controller = new AbortController();
        setLoading(true); setError(false);
        const timer = setTimeout(() => {
            const bounds = map.getBounds();
            void fetchResourceMapViaApi(state, {
                zoom: Math.min(20, Math.max(0, Math.round(map.getZoom()))),
                west: Math.max(-180, bounds.getWest()), east: Math.min(180, bounds.getEast()),
                south: Math.max(-90, bounds.getSouth()), north: Math.min(90, bounds.getNorth()),
            }, controller.signal).then(result => {
                if (controller.signal.aborted) return;
                if (result.ok) { setCells(result.data.cells); setMapped(result.data.mapped); }
                else { setCells([]); setError(true); }
                setLoading(false);
            });
        }, 180);
        return () => { clearTimeout(timer); controller.abort(); };
    // The serialized query prevents callback or object identity from cancelling requests.
    }, [queryKey, view, retry, mapRetry, locale]);

    useEffect(() => { setCells([]); }, [queryKey]);

    useEffect(() => {
        const map = instance.current;
        if (!map) return;
        const group = L.layerGroup().addTo(map);
        const groups = separateResourceClusters(cells, cell => map.latLngToContainerPoint([cell.latitude, cell.longitude]));
        for (const cell of groups) {
            const isCluster = cell.count > 1;
            const content = document.createElement('span');
            content.className = 'pw-map-marker__face';
            content.textContent = isCluster ? String(cell.count) : '';
            const label = isCluster ? t('mapExplorer.cluster', { count: cell.count }) : (cell.members[0]?.name ?? t('mapExplorer.place'));
            const marker = L.marker([cell.latitude, cell.longitude], {
                icon: L.divIcon({ html: content, className: `pw-map-marker ${isCluster ? 'pw-map-marker--cluster' : 'pw-map-marker--place'}${cell.resourceUri === selectedUri ? ' is-selected' : ''}`, iconSize: [44, 44], iconAnchor: [22, 22] }),
                keyboard: true, title: label,
            }).addTo(group);
            marker.getElement()?.setAttribute('aria-label', label);
            if (cell.resourceUri) marker.getElement()?.setAttribute('data-resource-uri', cell.resourceUri);
            marker.getElement()?.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); marker.fire('click'); }
            });
            marker.bindTooltip(label, { direction: 'top', offset: [0, -15] });
            marker.on('click', () => {
                if (cell.resourceUri) { callbacks.current.onSelect(cell.resourceUri); return; }
                if (cell.west !== cell.east || cell.south !== cell.north) {
                    map.fitBounds([[cell.south, cell.west], [cell.north, cell.east]], { padding: [50, 50], maxZoom: 19 });
                } else {
                    const list = document.createElement('div');
                    list.className = 'pw-map-colocated';
                    for (const member of cell.members) {
                        const button = document.createElement('button');
                        button.type = 'button'; button.textContent = member.name;
                        button.onclick = () => callbacks.current.onSelect(member.uri);
                        list.append(button);
                    }
                    if (cell.count > cell.members.length) {
                        const note = document.createElement('p'); note.textContent = t('mapExplorer.moreAtAddress'); list.append(note);
                    }
                    marker.bindPopup(list).openPopup();
                }
            });
        }
        return () => { group.remove(); };
    }, [cells, view, t]);

    useEffect(() => {
        for (const marker of node.current?.querySelectorAll<HTMLElement>('[data-resource-uri]') ?? []) marker.classList.toggle('is-selected', marker.dataset.resourceUri === selectedUri);
    }, [selectedUri, cells, view]);

    return <div className='pw-resource-map'>
        <div ref={node} className='pw-resource-map__canvas' role='region' aria-label={t('mapExplorer.mapLabel')} tabIndex={0} />
        <div className='pw-resource-map__status' role='status' aria-live='polite'>
            {error ? <>{t('mapExplorer.mapError')} <button onClick={() => setMapRetry(value => value + 1)}>{t('common.retry')}</button></> : loading ? t('mapExplorer.loadingMap') : t('mapExplorer.onMap', { count: mapped })}
        </div>
        {tileError && <p className='pw-resource-map__tile-error' role='alert'>{t('mapExplorer.tileError')}</p>}
        {moved && <button className='mh-button pw-resource-map__search' onClick={() => {
            const map = instance.current; if (!map) return;
            const center = map.getCenter();
            callbacks.current.onSearchArea({ postalCode: undefined, center: { lat: Number(center.lat.toFixed(2)), lng: Number(center.lng.toFixed(2)) }, radiusMeters: Math.min(250000, Math.max(1000, Math.round(map.distance(center, map.getBounds().getNorthEast())))), areaLabel: t('mapExplorer.selectedArea'), feedTab: 'nearby' });
            setMoved(false);
        }}>{t('mapExplorer.searchArea')}</button>}
        <div className='pw-resource-map__legend'><span aria-hidden='true' />{t('mapExplorer.legend')}</div>
    </div>;
}
