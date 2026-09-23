import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
    aidCategories,
    aidStatuses,
    type DiscoveryFilterState,
} from '../../discovery-filters';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Sheet } from '../../components/Sheet';
import { ChipGroup, ToggleChip } from '../../components/ToggleChip';
import { useLocale } from '../../i18n';
import { formatLocalizedLabel } from '../shell-shared';
import { useApproximateLocation } from './useApproximateLocation';

const urgencyLevels = [1, 2, 3, 4, 5] as const;

interface DiscoveryToolbarProps {
    idPrefix: string;
    state: DiscoveryFilterState;
    onPatch: (patch: Partial<DiscoveryFilterState>) => void;
    /**
     * `requests` exposes the Latest/Nearby switch and request filters;
     * `places` (resources) only needs location and search.
     */
    mode?: 'requests' | 'places';
    /** Extra filter groups rendered in the sheet (e.g. directory categories). */
    extraFilters?: ReactNode;
    /** Number of active extra filters, added to the button badge. */
    extraActiveCount?: number;
    onClearExtra?: () => void;
}

interface ActiveFilter {
    key: string;
    label: string;
    clear: Partial<DiscoveryFilterState>;
}

/**
 * Compact search-and-filter bar for discovery pages. Search and the view
 * switch stay visible; the rest lives in a sheet so results stay above the
 * fold on phones.
 */
export const DiscoveryToolbar = ({
    idPrefix,
    state,
    onPatch,
    mode = 'requests',
    extraFilters,
    extraActiveCount = 0,
    onClearExtra,
}: DiscoveryToolbarProps) => {
    const { t } = useLocale();
    const { access, request } = useApproximateLocation(state, onPatch);
    const [isSheetOpen, setIsSheetOpen] = useState(false);
    const filtersButtonRef = useRef<HTMLButtonElement>(null);
    // Keep the raw input so spaces survive typing; publish the trimmed value.
    const [searchDraft, setSearchDraft] = useState(state.text ?? '');
    useEffect(() => {
        setSearchDraft((draft) =>
            draft.trim() === (state.text ?? '') ? draft : (state.text ?? ''),
        );
    }, [state.text]);

    const activeFilters = useMemo<ActiveFilter[]>(() => {
        if (mode !== 'requests') return [];
        const active: ActiveFilter[] = [];
        if (state.category) {
            active.push({
                key: 'category',
                label: formatLocalizedLabel(t, state.category),
                clear: { category: undefined },
            });
        }
        if (state.status) {
            active.push({
                key: 'status',
                label: formatLocalizedLabel(t, state.status),
                clear: { status: undefined },
            });
        }
        if (state.minUrgency) {
            active.push({
                key: 'urgency',
                label: String(
                    t('discovery.urgencyAtLeast', { level: state.minUrgency }),
                ),
                clear: { minUrgency: undefined },
            });
        }
        return active;
    }, [mode, state.category, state.minUrgency, state.status, t]);

    const activeCount = activeFilters.length + extraActiveCount;
    const clearAll = () => {
        onPatch({
            category: undefined,
            status: undefined,
            minUrgency: undefined,
            since: undefined,
        });
        onClearExtra?.();
    };

    const areaKm = state.radiusMeters
        ? Math.round(state.radiusMeters / 1000)
        : undefined;
    const hasSheetFilters = mode === 'requests' || Boolean(extraFilters);

    return (
        <section
            className='mh-toolbar'
            aria-label={t('discovery.searchResultsLabel')}
        >
            {!state.center ? (
                <Banner
                    tone='warning'
                    title={t('discovery.locationPermissionTitle')}
                    actions={
                        <Button
                            size='sm'
                            disabled={access === 'requesting'}
                            onClick={request}
                        >
                            {access === 'requesting'
                                ? t('discovery.locationRequestingButton')
                                : t('discovery.locationButton')}
                        </Button>
                    }
                >
                    {access === 'requesting'
                        ? t('discovery.locationRequesting')
                        : t('discovery.locationPermissionHelp')}
                </Banner>
            ) : (
                <div className='mh-toolbar__location' role='status'>
                    <Icon name='pin' size={18} />
                    <p className='min-w-0 flex-1'>
                        <strong>
                            {areaKm
                                ? t('discovery.areaSummary', {
                                      area:
                                          state.areaLabel ??
                                          t('discovery.areaUnknown'),
                                      km: areaKm,
                                  })
                                : (state.areaLabel ??
                                  t('discovery.areaUnknown'))}
                        </strong>
                        <span className='mh-toolbar__location-note'>
                            {access === 'fallback'
                                ? t('discovery.locationFallback')
                                : t('discovery.locationActive')}
                        </span>
                    </p>
                    <Button
                        variant='ghost'
                        size='sm'
                        disabled={access === 'requesting'}
                        onClick={request}
                    >
                        {t('discovery.updateLocation')}
                    </Button>
                </div>
            )}

            <div className='mh-toolbar__row'>
                <div className='mh-toolbar__search'>
                    <label htmlFor={`${idPrefix}-search`} className='sr-only'>
                        {t('discovery.searchLabel')}
                    </label>
                    <Icon name='search' size={18} />
                    <input
                        id={`${idPrefix}-search`}
                        name={`${idPrefix}-search`}
                        type='search'
                        autoComplete='off'
                        className='mh-input'
                        placeholder={String(t('discovery.searchPlaceholder'))}
                        value={searchDraft}
                        onChange={(event) => {
                            setSearchDraft(event.target.value);
                            const next = event.target.value.trim();
                            onPatch({ text: next.length > 0 ? next : undefined });
                        }}
                    />
                </div>
                {mode === 'requests' ? (
                    <SegmentedControl
                        label={t('discovery.showLabel')}
                        value={state.feedTab ?? 'latest'}
                        options={[
                            { value: 'latest', label: t('discovery.latest') },
                            { value: 'nearby', label: t('discovery.nearby') },
                        ]}
                        onChange={(feedTab) => onPatch({ feedTab })}
                    />
                ) : null}
                {hasSheetFilters ? (
                    <Button
                        ref={filtersButtonRef}
                        variant='secondary'
                        aria-haspopup='dialog'
                        aria-expanded={isSheetOpen}
                        onClick={() => setIsSheetOpen(true)}
                    >
                        <Icon name='filter' size={18} />
                        {activeCount > 0
                            ? t('discovery.filtersWithCount', {
                                  count: activeCount,
                              })
                            : t('discovery.filters')}
                    </Button>
                ) : null}
            </div>

            {activeFilters.length > 0 ? (
                <ul className='mh-toolbar__active'>
                    {activeFilters.map((filter) => (
                        <li key={filter.key}>
                            <button
                                type='button'
                                className='mh-chip mh-chip--removable'
                                aria-label={String(
                                    t('discovery.removeFilter', {
                                        label: filter.label,
                                    }),
                                )}
                                onClick={() => onPatch(filter.clear)}
                            >
                                {filter.label}
                                <Icon name='close' size={14} />
                            </button>
                        </li>
                    ))}
                    <li>
                        <Button variant='ghost' size='sm' onClick={clearAll}>
                            {t('discovery.clearAll')}
                        </Button>
                    </li>
                </ul>
            ) : null}

            {hasSheetFilters ? (
                <Sheet
                    open={isSheetOpen}
                    onClose={() => setIsSheetOpen(false)}
                    title={t('discovery.filters')}
                    closeLabel={t('common.close')}
                    returnFocusRef={filtersButtonRef}
                    footer={
                        <>
                            <Button variant='secondary' onClick={clearAll}>
                                {t('discovery.resetFilters')}
                            </Button>
                            <Button
                                className='ml-auto'
                                onClick={() => setIsSheetOpen(false)}
                            >
                                {t('discovery.showResults')}
                            </Button>
                        </>
                    }
                >
                    {isSheetOpen ? (
                        <div className='grid gap-6'>
                            {mode === 'requests' ? (
                                <>
                                    <ChipGroup legend={t('discovery.category')}>
                                        {aidCategories.map((category) => (
                                            <ToggleChip
                                                key={category}
                                                pressed={
                                                    state.category === category
                                                }
                                                onClick={() =>
                                                    onPatch({
                                                        category:
                                                            state.category ===
                                                            category
                                                                ? undefined
                                                                : category,
                                                    })
                                                }
                                            >
                                                {formatLocalizedLabel(
                                                    t,
                                                    category,
                                                )}
                                            </ToggleChip>
                                        ))}
                                    </ChipGroup>
                                    <ChipGroup legend={t('discovery.status')}>
                                        {aidStatuses.map((status) => (
                                            <ToggleChip
                                                key={status}
                                                pressed={state.status === status}
                                                onClick={() =>
                                                    onPatch({
                                                        status:
                                                            state.status ===
                                                            status
                                                                ? undefined
                                                                : status,
                                                    })
                                                }
                                            >
                                                {formatLocalizedLabel(t, status)}
                                            </ToggleChip>
                                        ))}
                                    </ChipGroup>
                                    <ChipGroup
                                        legend={t('discovery.minimumUrgency')}
                                    >
                                        {urgencyLevels.map((level) => (
                                            <ToggleChip
                                                key={level}
                                                pressed={
                                                    state.minUrgency === level
                                                }
                                                onClick={() =>
                                                    onPatch({
                                                        minUrgency:
                                                            state.minUrgency ===
                                                            level
                                                                ? undefined
                                                                : level,
                                                    })
                                                }
                                            >
                                                {t('discovery.urgencyAtLeast', {
                                                    level,
                                                })}
                                            </ToggleChip>
                                        ))}
                                    </ChipGroup>
                                </>
                            ) : null}
                            {extraFilters}
                        </div>
                    ) : null}
                </Sheet>
            ) : null}
        </section>
    );
};
