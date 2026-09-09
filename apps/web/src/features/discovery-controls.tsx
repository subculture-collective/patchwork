import { resourceServices, resourceServiceLabels, resourcePrograms, resourceProgramLabels } from '@patchwork/shared';
import { directoryCategories } from '../discovery-filters';
import { useEffect, useState } from 'react';
import { lookupPostalArea } from '@patchwork/at-lexicons';
import type { DiscoveryFilterState } from '../discovery-filters';
import { buildDiscoveryFilterChipModel } from '../discovery-primitives';
import { useLocale } from '../i18n';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useDiscoveryLocation } from './discovery-location';

/** Search and place are primary; less frequent refinements are disclosed. */
export function DiscoveryControls({
    idPrefix,
    state,
    onPatch,
    resourceMode = false,
    resourceFilters = false,
}: {
    idPrefix: string;
    state: DiscoveryFilterState;
    onPatch: (patch: Partial<DiscoveryFilterState>) => void;
    resourceMode?: boolean;
    resourceFilters?: boolean;
}) {
    const { t } = useLocale();
    const location = useDiscoveryLocation();
    const chips = buildDiscoveryFilterChipModel(state);
    const [search, setSearch] = useState(state.text ?? '');
    const [zip, setZip] = useState(state.postalCode ?? '');
    const [zipError, setZipError] = useState(false);
    // Preserve a trailing space while typing; external navigation/reset still wins.
    useEffect(() => {
        setSearch((current) =>
            current.trim() === (state.text ?? '') ?
                current
            :   (state.text ?? ''),
        );
    }, [state.text]);
    useEffect(() => {
        setZip(state.postalCode ?? '');
        setZipError(false);
    }, [state.postalCode]);
    const applySearch = (value: string) => {
        setSearch(value);
        onPatch({ text: value.trim() || undefined });
    };
    const filtersActive = Boolean(
        state.category || state.status || state.minUrgency || state.since,
    );
    const clearPlace = () => {
        location.cancel();
        setZip('');
        onPatch({
            postalCode: undefined,
            center: undefined,
            radiusMeters: undefined,
            areaLabel: undefined,
            feedTab: 'latest',
        });
    };
    return (
        <section
            className='mh-discovery-controls'
            aria-label={t('discovery.title')}
        >
            <div className='mh-search-row'>
                <div className='mh-search-field'>
                    <label htmlFor={`${idPrefix}-search`}>
                        {resourceMode ? t('resources.searchLabel') : t('discovery.searchText')}
                    </label>
                    <Input
                        id={`${idPrefix}-search`}
                        value={search}
                        type={resourceMode ? 'search' : 'text'}
                        maxLength={120}
                        placeholder={t(resourceMode ? 'resources.searchPlaceholder' : 'discovery.searchPlaceholder')}
                        onChange={(event) => applySearch(event.target.value)}
                    />
                </div>
                <form
                    className='mh-place-search'
                    onSubmit={(event) => {
                        event.preventDefault();
                        const area = lookupPostalArea(zip);
                        if (!area) {
                            setZipError(true);
                            return;
                        }
                        location.cancel();
                        setZipError(false);
                        onPatch({
                            postalCode: zip,
                            center: undefined,
                            radiusMeters: undefined,
                            areaLabel: `ZIP ${zip}`,
                            feedTab: 'nearby',
                        });
                    }}
                >
                    <label htmlFor={`${idPrefix}-zip`}>
                        {t('experience.zipLabel')}
                    </label>
                    <div>
                        <Input
                            id={`${idPrefix}-zip`}
                            inputMode='numeric'
                            autoComplete='postal-code'
                            maxLength={5}
                            pattern='[0-9]{5}'
                            required
                            value={zip}
                            onChange={(event) => {
                                setZip(event.target.value);
                                setZipError(false);
                            }}
                            aria-invalid={zipError || undefined}
                            aria-describedby={
                                zipError ? `${idPrefix}-zip-error` : undefined
                            }
                        />
                        <Button type='submit' variant='neutral'>
                            {t('experience.findArea')}
                        </Button>
                    </div>
                </form>
            </div>
            {(resourceMode || resourceFilters) && (
                <fieldset className='grid gap-3 sm:grid-cols-2'>
                    <legend className='mb-2 font-semibold'>{t('resources.filtersLegend')}</legend>
                    <div>
                        <label htmlFor={`${idPrefix}-service`}>{t('resources.serviceLabel')}</label>
                        <select id={`${idPrefix}-service`} className='mh-input w-full px-3 py-2 text-base'
                            value={state.resourceService ?? ''}
                            onChange={event => onPatch({ resourceService: (event.target.value || undefined) as DiscoveryFilterState['resourceService'] })}>
                            <option value=''>{t('resources.allServices')}</option>
                            {resourceServices.map(service => <option key={service} value={service}>{t(`resourceServices.${service}`, { defaultValue: resourceServiceLabels[service] })}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor={`${idPrefix}-program`}>{t('resources.programLabel')}</label>
                        <select id={`${idPrefix}-program`} className='mh-input w-full px-3 py-2 text-base'
                            value={state.resourceProgram ?? ''}
                            onChange={event => onPatch({ resourceProgram: (event.target.value || undefined) as DiscoveryFilterState['resourceProgram'] })}>
                            <option value=''>{t('resources.allPrograms')}</option>
                            {resourcePrograms.map(program => <option key={program} value={program}>{t(`resourcePrograms.${program}`, { defaultValue: resourceProgramLabels[program] })}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor={`${idPrefix}-type`}>{t('resources.directoryFiltersTitle')}</label>
                        <select id={`${idPrefix}-type`} className='mh-input w-full px-3 py-2 text-base'
                            value={state.resourceCategory ?? ''}
                            onChange={event => onPatch({ resourceCategory: (event.target.value || undefined) as DiscoveryFilterState['resourceCategory'] })}>
                            <option value=''>{t('resources.allCategories')}</option>
                            {directoryCategories.map(category => <option key={category} value={category}>{t(`labels.${category}`)}</option>)}
                        </select>
                    </div>
                    {state.center && <div>
                        <label htmlFor={`${idPrefix}-radius`}>{t('resources.distanceLabel')}</label>
                        <select id={`${idPrefix}-radius`} className='mh-input w-full px-3 py-2 text-base'
                            value={state.radiusMeters ?? 20000}
                            onChange={event => onPatch({ radiusMeters: Number(event.target.value) })}>
                            {[...new Set([5000, 10000, 20000, 50000, 100000, 250000, state.radiusMeters ?? 20000])].sort((a,b)=>a-b)
                                .map(radius => <option key={radius} value={radius}>{radius / 1000} km</option>)}
                        </select>
                    </div>}
                    <p className='text-sm text-mh-textMuted sm:col-span-2'>{t(state.resourceProgram ? 'resources.programHelp' : 'resources.searchHelp')}</p>
                    {(state.text || state.resourceService || state.resourceProgram || state.resourceCategory || state.radiusMeters) && <button className='mh-text-button justify-self-start'
                        onClick={() => { setSearch(''); onPatch({ text: undefined, resourceService: undefined, resourceProgram: undefined, resourceCategory: undefined, radiusMeters: undefined }); }}>
                        {t('discovery.resetFilters')}
                    </button>}
                </fieldset>
            )}
            {zipError && (
                <p role='alert' id={`${idPrefix}-zip-error`}>
                    {t('experience.zipError')}
                </p>
            )}
            <div className='mh-search-context'>
                <button
                    className='mh-text-button'
                    disabled={location.status === 'requesting'}
                    onClick={location.request}
                >
                    {t('discovery.updateLocation')}
                </button>
                <p
                    role='status'
                    className={state.postalCode ? 'sr-only' : undefined}
                >
                    {location.status === 'requesting' ?
                        t('discovery.locationRequesting')
                    : state.postalCode ?
                        `ZIP ${state.postalCode}`
                    :   (state.areaLabel ??
                        t(
                            state.center ?
                                'discovery.areaUnknown'
                            :   'discovery.allAreas',
                        ))
                    }
                </p>
                {(state.center || state.postalCode) && (
                    <button className='mh-text-button' onClick={clearPlace}>
                        {t('map.clearArea')}
                    </button>
                )}
            </div>
            {['denied', 'timeout', 'unavailable'].includes(location.status) && (
                <p className='text-sm text-mh-textMuted' role='status'>
                    {t(
                        location.status === 'denied' ?
                            'discovery.locationDenied'
                        : location.status === 'timeout' ?
                            'discovery.locationTimedOut'
                        :   'discovery.locationNotFound',
                    )}
                </p>
            )}
            {!resourceMode && (
                <details className='mh-filter-disclosure'>
                    <summary>
                        {t('nav.mapFilters')}
                        {filtersActive ?
                            ` · ${t('experience.filtersActive')}`
                        :   ''}
                    </summary>
                    <div className='mh-filter-grid'>
                        {(
                            [
                                [
                                    'discovery.category',
                                    chips.categories,
                                    'category',
                                ],
                                ['discovery.status', chips.statuses, 'status'],
                                [
                                    'discovery.minimumUrgency',
                                    chips.urgency,
                                    'minUrgency',
                                ],
                            ] as const
                        ).map(([label, items, field]) => (
                            <fieldset key={field}>
                                <legend>{t(label)}</legend>
                                <div className='flex flex-wrap gap-2'>
                                    {items.map((item) => (
                                        <Button
                                            key={item.id}
                                            aria-pressed={item.active}
                                            variant={
                                                item.active ? 'primary' : (
                                                    'neutral'
                                                )
                                            }
                                            onClick={() =>
                                                onPatch({
                                                    [field]:
                                                        item.active ? undefined
                                                        :   item.value,
                                                })
                                            }
                                        >
                                            {typeof item.value === 'number' ?
                                                t('map.urgencyLabel', {
                                                    level: `${item.value}+`,
                                                })
                                            :   t(`labels.${item.value}`, {
                                                    defaultValue: item.label,
                                                })
                                            }
                                        </Button>
                                    ))}
                                </div>
                            </fieldset>
                        ))}
                        <Button
                            variant='neutral'
                            onClick={() => {
                                setSearch('');
                                onPatch({
                                    text: undefined,
                                    category: undefined,
                                    status: undefined,
                                    minUrgency: undefined,
                                    since: undefined,
                                });
                            }}
                        >
                            {t('discovery.resetFilters')}
                        </Button>
                    </div>
                </details>
            )}
        </section>
    );
}
