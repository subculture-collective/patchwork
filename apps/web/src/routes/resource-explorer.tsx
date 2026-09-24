import { SaveSearchButton } from '../features/saved-discovery';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { lookupPostalArea } from '@patchwork/at-lexicons';
import { resourceServices, resourcePrograms, type ResourceService } from '@patchwork/shared';
import { directoryCategories, type DiscoveryFilterState } from '../discovery-filters';
import { currentExactPublicAddress, type ResourceDetail, type ResourceDirectoryCard } from '../resource-directory-ux';
import { appendDedupedPage, fetchMapResourcePageFromApi, fetchResourceViaApi } from '../features/api-client';
import { ResourceActions } from '../features/resource-actions';
import { useApproximateLocation } from '../features/discovery/useApproximateLocation';
import { Button } from '../components/Button';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/Icon';
import { useLocale } from '../i18n';
import '../styles/resource-explorer.css';

const ResourceMap = lazy(() => import('../components/map/ResourceMap').then(m => ({ default: m.ResourceMap })));

export function ResourceExplorer({ state, onPatch }: { state: DiscoveryFilterState; onPatch: (patch: Partial<DiscoveryFilterState>) => void }) {
    const { t, fmt } = useLocale();
    const { access, request } = useApproximateLocation(state, onPatch, { auto: false, fallbackToDemo: false });
    const [zip, setZip] = useState(state.postalCode ?? '');
    const [zipError, setZipError] = useState(false);
    const [search, setSearch] = useState(state.text ?? '');
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
    const [cards, setCards] = useState<ResourceDirectoryCard[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    const [selectedUri, setSelectedUri] = useState<string>();
    const [detail, setDetail] = useState<ResourceDetail>();
    const [detailError, setDetailError] = useState(false);
    const list = useRef<HTMLUListElement>(null);
    const count = useRef<HTMLParagraphElement>(null);
    const pendingMore = useRef(false);
    const patch = useRef(onPatch); patch.current = onPatch;
    const queryKey = JSON.stringify(state);
    const lastQuery = useRef(queryKey);

    useEffect(() => {
        if (!state.center) patch.current({ center: { lat: 41.885, lng: -87.623 }, radiusMeters: 20000, areaLabel: t('mapExplorer.chicago'), feedTab: 'nearby' });
    }, [state.center, t]);
    useEffect(() => { setZip(state.postalCode ?? ''); }, [state.postalCode]);
    useEffect(() => { setSearch(current => current.trim() === (state.text ?? '') ? current : state.text ?? ''); }, [state.text]);
    useEffect(() => {
        if (search.trim() === (state.text ?? '')) return;
        const timer = setTimeout(() => patch.current({ text: search.trim() || undefined }), 300);
        return () => clearTimeout(timer);
    }, [search, state.text]);

    useEffect(() => {
        if (!state.center) return;
        const changed = lastQuery.current !== queryKey;
        lastQuery.current = queryKey;
        if (changed) { setPage(1); setCards([]); setSelectedUri(undefined); pendingMore.current = false; if (list.current) list.current.scrollTop = 0; }
        const requestedPage = changed ? 1 : page;
        if (changed && page !== 1) return;
        const controller = new AbortController();
        setLoading(true); setError(false);
        void fetchMapResourcePageFromApi(state, controller.signal, requestedPage).then(result => {
            if (controller.signal.aborted) return;
            if (result.ok) {
                setCards(current => appendDedupedPage(requestedPage === 1 ? [] : current, result.data.items, item => item.uri));
                setTotal(result.data.total); setHasMore(result.data.hasNextPage);
            } else { setError(true); }
            setLoading(false);
            if (pendingMore.current) { count.current?.focus({ preventScroll: true }); pendingMore.current = false; }
        });
        return () => controller.abort();
    }, [queryKey, page, retry]);

    useEffect(() => {
        setDetail(undefined); setDetailError(false);
        if (!selectedUri) return;
        const controller = new AbortController();
        void fetchResourceViaApi(selectedUri, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (result.ok) setDetail(result.data); else setDetailError(true);
        });
        return () => controller.abort();
    }, [selectedUri, retry]);

    const selectedArea = state.postalCode ? t('mapExplorer.zipArea', { zip: state.postalCode }) : state.areaLabel ?? t('mapExplorer.chicago');
    return <section className={`pw-explorer pw-explorer--${mobileView}`} aria-label={t('mapExplorer.heading')}>
        <header className='pw-explorer__heading'>
            <div><p className='mh-eyebrow'>{t('mapExplorer.eyebrow')}</p><h1>{t('mapExplorer.heading')}</h1></div>
            <p>{t('mapExplorer.intro')}</p>
        </header>
        <form className='pw-explorer__toolbar' onSubmit={event => {
            event.preventDefault(); const area = lookupPostalArea(zip.trim());
            if (!area) { setZipError(true); return; }
            setZipError(false); onPatch({ postalCode: zip.trim(), areaLabel: t('mapExplorer.zipArea', { zip: zip.trim() }), radiusMeters: state.radiusMeters ?? 20000, feedTab: 'nearby' });
        }}>
            <div className='pw-explorer__zip'>
                <label htmlFor='map-zip'>{t('mapExplorer.zipLabel')}</label>
                <div><input id='map-zip' className='mh-input' inputMode='numeric' autoComplete='postal-code' maxLength={5} value={zip} placeholder={t('mapExplorer.zipPlaceholder')} aria-invalid={zipError} aria-describedby={zipError ? 'map-zip-error' : undefined} onChange={e => { setZip(e.target.value); setZipError(false); }} /><Button size='sm' type='submit'>{t('mapExplorer.find')}</Button></div>
            </div>
            <div className='pw-explorer__search'>
                <label htmlFor='map-search'>{t('mapExplorer.searchLabel')}</label>
                <div><Icon name='search' size={18} /><input id='map-search' className='mh-input' type='search' value={search} placeholder={t('mapExplorer.searchPlaceholder')} onChange={e => setSearch(e.target.value)} /></div>
            </div>
            <Button type='button' variant='secondary' aria-label={t('mapExplorer.filters')} aria-expanded={filtersOpen} aria-controls='map-refine' onClick={() => setFiltersOpen(!filtersOpen)}><Icon name='filter' size={18} />{t('mapExplorer.filters')}{state.resourceService || state.resourceCategory || state.resourceProgram || state.includeLibraries ? <span aria-label={t('mapExplorer.activeFilters')}> · </span> : null}</Button>
            <Button className='pw-explorer__locate' aria-label={t('mapExplorer.useLocation')} title={t('mapExplorer.useLocation')} type='button' variant='ghost' disabled={access === 'requesting'} onClick={request}><Icon name='pin' size={18} /><span>{t('mapExplorer.useLocation')}</span></Button>
            {zipError && <p id='map-zip-error' className='pw-explorer__error' role='alert'>{t('mapExplorer.zipError')}</p>}
            {access === 'denied' && <p role='status' className='pw-explorer__error'>{t('mapExplorer.locationDenied')}</p>}
            {filtersOpen && <div className='pw-explorer__filters' id='map-refine'>
                <label>{t('mapExplorer.service')}<select className='mh-input' value={state.resourceService ?? ''} onChange={e => onPatch({ resourceService: (e.target.value || undefined) as ResourceService | undefined })}><option value=''>{t('mapExplorer.allServices')}</option>{resourceServices.map(service => <option key={service} value={service}>{t(`resourceServices.${service}`)}</option>)}</select></label>
                <label>{t('resources.programLabel')}<select className='mh-input' value={state.resourceProgram ?? ''} onChange={e => onPatch({ resourceProgram: (e.target.value || undefined) as DiscoveryFilterState['resourceProgram'] })}><option value=''>{t('resources.allPrograms')}</option>{resourcePrograms.map(program => <option key={program} value={program}>{t(`resourcePrograms.${program}`)}</option>)}</select></label>
                <label>{t('resources.directoryFiltersTitle')}<select className='mh-input' value={state.resourceCategory ?? ''} onChange={e => onPatch({ resourceCategory: (e.target.value || undefined) as DiscoveryFilterState['resourceCategory'] })}><option value=''>{t('resources.allCategories')}</option>{directoryCategories.map(category => <option key={category} value={category}>{t(`categories.${category}`)}</option>)}</select></label>
                <label>{t('mapExplorer.distance')}<select className='mh-input' value={state.radiusMeters ?? 20000} onChange={e => onPatch({ radiusMeters: Number(e.target.value) })}>{![5000, 10000, 20000, 50000, 100000].includes(state.radiusMeters ?? 20000) && <option value={state.radiusMeters}>{t('mapExplorer.km', { km: Math.round((state.radiusMeters ?? 20000) / 1000) })}</option>}{[5000, 10000, 20000, 50000, 100000].map(radius => <option key={radius} value={radius}>{t('mapExplorer.km', { km: radius / 1000 })}</option>)}</select></label>
                <label className='pw-explorer__check'><input type='checkbox' checked={Boolean(state.includeLibraries)} onChange={e => onPatch({ includeLibraries: e.target.checked || undefined })} />{t('mapExplorer.libraries')}</label>
                <Button variant='ghost' size='sm' onClick={() => { setSearch(''); onPatch({ text: undefined, resourceService: undefined, resourceCategory: undefined, resourceProgram: undefined, includeLibraries: undefined, radiusMeters: 20000 }); }}>{t('mapExplorer.clear')}</Button>
            </div>}
        </form>
        <div className='pw-explorer__context'><p><strong>{selectedArea}</strong><span>{t('mapExplorer.within', { km: Math.round((state.radiusMeters ?? 20000) / 1000) })}</span></p><p>{t('mapExplorer.privacy')}</p></div>
        <div className='pw-explorer__mobile-switch' role='group' aria-label={t('mapExplorer.view')}><Button variant={mobileView === 'map' ? 'primary' : 'secondary'} aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}>{t('mapExplorer.map')}</Button><Button variant={mobileView === 'list' ? 'primary' : 'secondary'} aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}>{t('mapExplorer.list')}</Button></div>
        <div className='pw-explorer__workspace'>
            <div className='pw-explorer__map'><Suspense fallback={<div className='pw-explorer__map-loading' role='status'>{t('mapExplorer.loadingMap')}</div>}><ResourceMap state={state} selectedUri={selectedUri} onSelect={setSelectedUri} onSearchArea={onPatch} retry={retry} /></Suspense></div>
            <section className='pw-explorer__results' aria-label={t('mapExplorer.results')} aria-busy={loading}>
                <header><div><p className='mh-eyebrow'>{t('mapExplorer.results')}</p><p ref={count} tabIndex={-1} role='status' className='pw-explorer__count'>{error ? t('mapExplorer.listError') : loading && cards.length === 0 ? t('mapExplorer.loading') : t('mapExplorer.count', { count: total })}</p></div><span>{t('mapExplorer.nearest')}</span></header>
                {error ? <div className='pw-explorer__empty' role='alert'><h2>{t('mapExplorer.listError')}</h2><Button onClick={() => setRetry(n => n + 1)}>{t('common.retry')}</Button></div> : !loading && cards.length === 0 ? <div className='pw-explorer__empty'><h2>{t('mapExplorer.empty')}</h2><p>{t('mapExplorer.emptyHelp')}</p><Button variant='secondary' onClick={() => onPatch({ text: undefined, resourceService: undefined, resourceCategory: undefined, resourceProgram: undefined, radiusMeters: 50000 })}>{t('mapExplorer.widen')}</Button></div> : null}
                <ul ref={list} className='pw-explorer__list'>{cards.map(resource => {
                    const exact = currentExactPublicAddress(resource);
                    return <li key={resource.uri}><button className={`pw-explorer__result${selectedUri === resource.uri ? ' is-selected' : ''}`} onClick={() => setSelectedUri(resource.uri)}>
                        <span className='pw-explorer__result-meta'><span>{t(`categories.${resource.category}`, { defaultValue: resource.category.replaceAll('-', ' ') })}</span>{resource.distanceMeters !== undefined && <span>{t('mapExplorer.km', { km: fmt.number(resource.distanceMeters / 1000, { maximumFractionDigits: 1 }) })}</span>}</span>
                        <strong>{resource.name}</strong><span>{exact?.streetAddress ?? resource.serviceArea}</span><span className='pw-explorer__result-action'>{t('mapExplorer.details')}<Icon name='arrow-right' size={15} /></span>
                    </button></li>;
                })}</ul>
                {hasMore && <footer><span>{t('mapExplorer.loaded', { loaded: cards.length, total })}</span><Button size='sm' variant='secondary' disabled={loading} onClick={() => { pendingMore.current = true; setPage(n => n + 1); }}>{t('discovery.loadMore')}</Button></footer>}
            </section>
        </div>
        <div className='pw-explorer__footer'><p>{t('mapExplorer.availability')}</p><SaveSearchButton state={state} /></div>
        <Sheet open={Boolean(selectedUri)} onClose={() => setSelectedUri(undefined)} title={detail?.name ?? t('mapExplorer.details')} closeLabel={t('common.close')} placement='side'>
            {detailError ? <div role='alert'><p>{t('mapExplorer.detailError')}</p><Button onClick={() => setRetry(n => n + 1)}>{t('common.retry')}</Button></div> : !detail ? <p role='status'>{t('mapExplorer.loading')}</p> : <div className='pw-explorer__detail'>
                <ResourceActions resource={detail} />
            </div>}
        </Sheet>
    </section>;
}
