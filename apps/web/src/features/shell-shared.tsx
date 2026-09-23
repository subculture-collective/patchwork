import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { type DiscoveryFilterState } from '../discovery-filters';
import { buildDiscoveryFilterChipModel } from '../discovery-primitives';
import { Button } from '../components/Button';
import { ToggleChip } from '../components/ToggleChip';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import { useLocale } from '../i18n';
import { resolvePaginationFocus } from './pagination-focus';

const nearbyDefaultRadiusMeters = 20000;

const locationCoordinatePrecision = 100;

const demoAreaPresets = {
    chicagoland: {
        center: { lat: 41.85, lng: -87.93 },
        areaLabel: 'Cook & DuPage demo',
        radiusMeters: 65000,
        feedTab: 'nearby' as const,
    },
} as const;

export const parseCommaList = (value: string): string[] => {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
};

export const formatCategoryLabel = (value: string): string => {
    return value
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

export const formatLocalizedLabel = (
    t: ReturnType<typeof useLocale>['t'],
    value: string,
): string => t(`labels.${value}`, { defaultValue: formatCategoryLabel(value) });

export const readPaginationPageFromUrl = (): number => {
    if (typeof window === 'undefined') return 1;
    const page = Number.parseInt(new URLSearchParams(window.location.search).get('page') ?? '1', 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
};

interface DiscoveryFiltersPanelProps {
    idPrefix: string;
    state: DiscoveryFilterState;
    onPatch: (patch: Partial<DiscoveryFilterState>) => void;
}

export const DiscoveryFiltersPanel = ({
    idPrefix,
    state,
    onPatch,
}: DiscoveryFiltersPanelProps) => {
    const { t } = useLocale();
    const [locationAccess, setLocationAccess] = useState<
        'idle' | 'requesting' | 'granted' | 'fallback'
    >('idle');
    const requestedLocationRef = useRef(false);
    const chipModel = useMemo(
        () => buildDiscoveryFilterChipModel(state),
        [state],
    );

    const requestLocation = useCallback(() => {
        setLocationAccess('requesting');

        if (!navigator.geolocation) {
            setLocationAccess('fallback');
            onPatch(demoAreaPresets.chicagoland);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            position => {
                const approximateCenter = {
                    lat:
                        Math.round(
                            position.coords.latitude * locationCoordinatePrecision,
                        ) / locationCoordinatePrecision,
                    lng:
                        Math.round(
                            position.coords.longitude * locationCoordinatePrecision,
                        ) / locationCoordinatePrecision,
                };
                setLocationAccess('granted');
                onPatch({
                    center: approximateCenter,
                    areaLabel: String(t('discovery.nearYou')),
                    radiusMeters: nearbyDefaultRadiusMeters,
                    feedTab: 'nearby',
                });
            },
            () => {
                setLocationAccess('fallback');
                onPatch(demoAreaPresets.chicagoland);
            },
            {
                enableHighAccuracy: false,
                maximumAge: 300000,
                timeout: 5000,
            },
        );
    }, [onPatch, t]);

    useEffect(() => {
        if (state.center || requestedLocationRef.current) return;
        requestedLocationRef.current = true;
        requestLocation();
    }, [requestLocation, state.center]);

    return (
        <Panel title={String(t('discovery.title'))}>
            {!state.center ? (
                <div className='mh-alert mb-4 text-sm' role='status'>
                    <strong>{t('discovery.locationPermissionTitle')}</strong>{' '}
                    {locationAccess === 'requesting'
                        ? t('discovery.locationRequesting')
                        : t('discovery.locationPermissionHelp')}
                    <div>
                        <Button
                            size='sm'
                            type='button'
                            className='mt-3'
                            disabled={locationAccess === 'requesting'}
                            onClick={requestLocation}
                        >
                            {locationAccess === 'requesting'
                                ? t('discovery.locationRequestingButton')
                                : t('discovery.locationButton')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div
                    className='mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-mh-textMuted'
                    role='status'
                >
                    <span>
                        {locationAccess === 'fallback'
                            ? t('discovery.locationFallback')
                            : t('discovery.locationActive')}
                    </span>
                    <Button
                        type='button'
                        variant='neutral'
                        size='sm'
                        disabled={locationAccess === 'requesting'}
                        onClick={requestLocation}
                    >
                        {t('discovery.updateLocation')}
                    </Button>
                </div>
            )}
            <label
                htmlFor={`${idPrefix}-search`}
                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
            >
                {t('discovery.searchText')}
            </label>
            <Input
                id={`${idPrefix}-search`}
                name={`${idPrefix}-search`}
                autoComplete='off'
                placeholder={String(t('discovery.searchPlaceholder'))}
                value={state.text ?? ''}
                onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    onPatch({
                        text: nextValue.length > 0 ? nextValue : undefined,
                    });
                }}
            />

            <div className='mt-4 grid gap-4'>
                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.feedTab')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.tabs.map((tab) => (
                            <ToggleChip
                                key={tab.id}
                                pressed={tab.active}
                                onClick={() => onPatch({ feedTab: tab.value })}
                            >
                                {tab.label}
                            </ToggleChip>
                        ))}
                    </div>
                </div>

                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.category')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.categories.map((category) => (
                            <ToggleChip
                                key={category.id}
                                pressed={category.active}
                                onClick={() => {
                                    onPatch({
                                        category: category.active
                                            ? undefined
                                            : category.value,
                                    });
                                }}
                            >
                                {category.label}
                            </ToggleChip>
                        ))}
                    </div>
                </div>

                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.status')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.statuses.map((status) => (
                            <ToggleChip
                                key={status.id}
                                pressed={status.active}
                                onClick={() => {
                                    onPatch({
                                        status: status.active
                                            ? undefined
                                            : status.value,
                                    });
                                }}
                            >
                                {status.label}
                            </ToggleChip>
                        ))}
                    </div>
                </div>

                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.minimumUrgency')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.urgency.map((level) => (
                            <ToggleChip
                                key={level.id}
                                pressed={level.active}
                                onClick={() => {
                                    onPatch({
                                        minUrgency: level.active
                                            ? undefined
                                            : level.value,
                                    });
                                }}
                            >
                                {level.label}
                            </ToggleChip>
                        ))}
                    </div>
                </div>

                <div className='flex flex-wrap items-center justify-between gap-3 border-t-2 border-mh-borderSoft pt-4'>
                    <Button
                        variant='neutral'
                        size='sm'
                        onClick={() => {
                            onPatch({
                                feedTab: state.center ? 'nearby' : 'latest',
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
                    <p className='text-xs text-mh-textSoft'>
                        {t('discovery.filtersPersist')}
                    </p>
                </div>
            </div>
        </Panel>
    );
};

export const usePaginationFocus = ({
    itemCount,
    isLoading,
    hasNextPage,
    announce,
}: {
    itemCount: number;
    isLoading: boolean;
    hasNextPage: boolean;
    announce: (start: number, end: number) => string;
}) => {
    const [pendingFrom, setPendingFrom] = useState<number>();
    const [announcement, setAnnouncement] = useState('');
    const loadMoreRef = useRef<HTMLButtonElement>(null);
    const loadedCountRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        if (pendingFrom === undefined) return;
        const focusTarget = resolvePaginationFocus({
            previousCount: pendingFrom,
            itemCount,
            isLoading,
            hasNextPage,
        });
        if (!focusTarget) return;

        if (itemCount > pendingFrom) {
            setAnnouncement(announce(pendingFrom + 1, itemCount));
        }
        if (focusTarget === 'load-more') loadMoreRef.current?.focus();
        else loadedCountRef.current?.focus();
        setPendingFrom(undefined);
    }, [announce, hasNextPage, isLoading, itemCount, pendingFrom]);

    return {
        announcement,
        loadedCountRef,
        loadMoreRef,
        loadMore: (callback: () => void) => {
            setPendingFrom(itemCount);
            callback();
        },
    };
};

export interface PublicSyncFailure {
    postUri: string;
    expectedCid: string;
    updatedAt: string;
    message: string;
}
