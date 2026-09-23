import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type FormEvent,
} from 'react';
import { type DiscoveryFilterState } from '../discovery-filters';
import {
    buildResourceOverlayViewModel,
    closeResourceDetailPanel,
    openResourceDetailPanel,
    resolveResourceDirectoryUiState,
    type DirectoryResourceCategory,
    type ResourceDirectoryCard,
} from '../resource-directory-ux';
import {
    buildDirectoryResourceRecord,
    directoryOperationalStatuses,
    directoryResourceCategories,
    draftFromDirectoryResource,
    type DirectoryResourceDraft,
} from '../directory-resource-form';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ChipGroup, ToggleChip } from '../components/ToggleChip';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Banner } from '../components/Banner';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Sheet } from '../components/Sheet';
import { DiscoveryToolbar } from '../features/discovery/DiscoveryToolbar';
import {
    type ApiDataOrigin,
    type AtDirectoryResourceResult,
    createAtDirectoryResourceViaApi,
    deleteAtDirectoryResourceViaApi,
    getAtDirectoryResourceViaApi,
    updateAtDirectoryResourceViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import {
    type AppRoute,
} from '../app/routes';
import {
    dataOriginLabel,
    nowIso,
} from '../app/runtime';
import {
    formatLocalizedLabel,
    usePaginationFocus,
} from '../features/shell-shared';

const resourceCategoryOptions: readonly DirectoryResourceCategory[] = [
    'food-bank',
    'shelter',
    'clinic',
    'legal-aid',
    'hotline',
    'other',
];

const defaultDirectoryDraft = (center: {
    lat: number;
    lng: number;
}): DirectoryResourceDraft => ({
    name: '',
    category: 'food-bank',
    serviceArea: '',
    contactUrl: '',
    contactPhone: '',
    latitude: center.lat.toFixed(4),
    longitude: center.lng.toFixed(4),
    precisionKm: '1',
    openHours: '',
    eligibilityNotes: '',
    operationalStatus: 'open',
});

interface DirectoryResourceManagerProps {
    currentUserDid: string;
    center: { lat: number; lng: number };
    onChanged: () => void;
    editUri?: string;
    onEditHandled: () => void;
}

const DirectoryResourceManager = ({
    currentUserDid,
    center,
    onChanged,
    editUri,
    onEditHandled,
}: DirectoryResourceManagerProps) => {
    const { t } = useLocale();
    const [isOpen, setIsOpen] = useState(false);
    const [draft, setDraft] = useState<DirectoryResourceDraft>(() =>
        defaultDirectoryDraft(center),
    );
    const [editing, setEditing] = useState<AtDirectoryResourceResult>();
    const [issues, setIssues] = useState<string[]>([]);
    const [notice, setNotice] = useState<string>();
    const [error, setError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingEdit, setIsLoadingEdit] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const reset = () => {
        setDraft(defaultDirectoryDraft(center));
        setEditing(undefined);
        setIssues([]);
        setError(undefined);
        setConfirmDelete(false);
    };

    const beginCreate = () => {
        reset();
        setNotice(undefined);
        setIsOpen(true);
    };

    useEffect(() => {
        if (!editUri) return undefined;
        if (editing?.uri === editUri) {
            setIsOpen(true);
            onEditHandled();
            return undefined;
        }
        let active = true;
        setIsLoadingEdit(true);
        setError(undefined);
        setNotice(undefined);
        void getAtDirectoryResourceViaApi(editUri)
            .then((result) => {
                if (!active) return;
                if (!result.ok) {
                    setError(
                        `${t('common.error')}: ${t('common.requestFailed')}`,
                    );
                    setIsOpen(true);
                    return;
                }
                setEditing(result.data);
                setDraft(draftFromDirectoryResource(result.data.record));
                setIssues([]);
                setConfirmDelete(false);
                setIsOpen(true);
            })
            .finally(() => {
                if (active) {
                    setIsLoadingEdit(false);
                    onEditHandled();
                }
            });
        return () => {
            active = false;
        };
    }, [editUri]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError(undefined);
        setNotice(undefined);
        const built = buildDirectoryResourceRecord(
            draft,
            nowIso(),
            editing?.record,
        );
        setIssues(built.issues);
        if (!built.ok || !built.record) return;

        setIsSubmitting(true);
        try {
            const result = editing
                ? await updateAtDirectoryResourceViaApi({
                      uri: editing.uri,
                      expectedCid: editing.cid,
                      record: built.record,
                  })
                : await createAtDirectoryResourceViaApi(built.record);
            if (!result.ok) {
                setError(`${t('common.error')}: ${t('common.requestFailed')}`);
                return;
            }
            setEditing(result.data);
            setDraft(draftFromDirectoryResource(result.data.record));
            setNotice(
                editing
                    ? t('directoryManager.updated')
                    : t('directoryManager.published'),
            );
            onChanged();
        } finally {
            setIsSubmitting(false);
        }
    };

    const remove = async () => {
        if (!editing) return;
        setIsSubmitting(true);
        setError(undefined);
        try {
            const result = await deleteAtDirectoryResourceViaApi({
                uri: editing.uri,
                expectedCid: editing.cid,
            });
            if (!result.ok) {
                setError(`${t('common.error')}: ${t('common.requestFailed')}`);
                return;
            }
            reset();
            setIsOpen(false);
            setNotice(t('directoryManager.deleted'));
            onChanged();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Card title={t('directoryManager.title')}>
            {currentUserDid ? (
                <>
                    <div className='flex flex-wrap items-center justify-between gap-3'>
                        <div>
                            <p className='text-sm font-bold text-mh-text'>
                                {t('directoryManager.steward')}
                            </p>
                            <p className='mt-1 max-w-2xl text-xs text-mh-textMuted'>
                                {t('directoryManager.description')}
                            </p>
                        </div>
                        <Button
                            size='sm'
                            type='button'
                            variant='secondary'
                            onClick={beginCreate}
                        >
                            {t('directoryManager.add')}
                        </Button>
                    </div>
                    {notice ? (
                        <p
                            role='status'
                            className='mh-alert mt-4 text-xs font-bold'
                        >
                            {notice}
                        </p>
                    ) : null}
                    {error ? (
                        <p
                            role='alert'
                            className='mh-alert mt-4 text-xs font-bold'
                        >
                            {error}
                        </p>
                    ) : null}
                    {isLoadingEdit ? (
                        <p className='mt-5 text-xs font-bold' role='status'>
                            {t('directoryManager.loading')}
                        </p>
                    ) : isOpen ? (
                        <form
                            className='mt-5 space-y-4 border-t-2 border-mh-borderSoft pt-5'
                            onSubmit={submit}
                        >
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                                <h2 className='text-lg font-bold text-mh-text'>
                                    {editing
                                        ? t('directoryManager.edit')
                                        : t('directoryManager.new')}
                                </h2>
                                <Badge tone='info'>
                                    {editing?.record.verificationStatus ??
                                        t('directoryManager.unverified')}
                                </Badge>
                            </div>
                            <div className='grid gap-4 md:grid-cols-2'>
                                <div>
                                    <label
                                        htmlFor='directory-name'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.name')}
                                    </label>
                                    <Input
                                        id='directory-name'
                                        value={draft.name}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                name: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor='directory-category'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.category')}
                                    </label>
                                    <select
                                        id='directory-category'
                                        className='mh-input w-full px-3 py-2 text-base'
                                        value={draft.category}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                category: event.target
                                                    .value as DirectoryResourceDraft['category'],
                                            }))
                                        }
                                    >
                                        {directoryResourceCategories.map(
                                            (category) => (
                                                <option
                                                    key={category}
                                                    value={category}
                                                >
                                                    {formatLocalizedLabel(
                                                        t,
                                                        category,
                                                    )}
                                                </option>
                                            ),
                                        )}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label
                                    htmlFor='directory-service-area'
                                    className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                >
                                    {t('directoryManager.serviceArea')}
                                </label>
                                <Input
                                    id='directory-service-area'
                                    value={draft.serviceArea}
                                    onChange={(event) =>
                                        setDraft((current) => ({
                                            ...current,
                                            serviceArea: event.target.value,
                                        }))
                                    }
                                />
                            </div>
                            <div className='grid gap-4 md:grid-cols-2'>
                                <div>
                                    <label
                                        htmlFor='directory-url'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.website')}
                                    </label>
                                    <Input
                                        id='directory-url'
                                        type='url'
                                        value={draft.contactUrl}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                contactUrl: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor='directory-phone'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.phone')}
                                    </label>
                                    <Input
                                        id='directory-phone'
                                        type='tel'
                                        value={draft.contactPhone}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                contactPhone:
                                                    event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                            <div className='grid gap-4 sm:grid-cols-3'>
                                <div>
                                    <label
                                        htmlFor='directory-latitude'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.latitude')}
                                    </label>
                                    <Input
                                        id='directory-latitude'
                                        type='number'
                                        step='0.0001'
                                        value={draft.latitude}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                latitude: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor='directory-longitude'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.longitude')}
                                    </label>
                                    <Input
                                        id='directory-longitude'
                                        type='number'
                                        step='0.0001'
                                        value={draft.longitude}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                longitude: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor='directory-precision'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.precision')}
                                    </label>
                                    <Input
                                        id='directory-precision'
                                        type='number'
                                        min='1'
                                        max='50'
                                        step='0.5'
                                        value={draft.precisionKm}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                precisionKm: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                            <p className='text-xs text-mh-textSoft'>
                                {t('directoryManager.locationHelp')}
                            </p>
                            <div className='grid gap-4 md:grid-cols-2'>
                                <div>
                                    <label
                                        htmlFor='directory-hours'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.hours')}
                                    </label>
                                    <textarea
                                        id='directory-hours'
                                        className='mh-input min-h-24 w-full px-3 py-2'
                                        value={draft.openHours}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                openHours: event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor='directory-eligibility'
                                        className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                    >
                                        {t('directoryManager.eligibility')}
                                    </label>
                                    <textarea
                                        id='directory-eligibility'
                                        className='mh-input min-h-24 w-full px-3 py-2'
                                        value={draft.eligibilityNotes}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                eligibilityNotes:
                                                    event.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                            <div>
                                <label
                                    htmlFor='directory-operational-status'
                                    className='mb-2 block text-xs font-bold uppercase tracking-[0.12em]'
                                >
                                    {t('directoryManager.operationalStatus')}
                                </label>
                                <select
                                    id='directory-operational-status'
                                    className='mh-input w-full px-3 py-2 text-base md:max-w-xs'
                                    value={draft.operationalStatus}
                                    onChange={(event) =>
                                        setDraft((current) => ({
                                            ...current,
                                            operationalStatus: event.target
                                                .value as DirectoryResourceDraft['operationalStatus'],
                                        }))
                                    }
                                >
                                    {directoryOperationalStatuses.map(
                                        (status) => (
                                            <option key={status} value={status}>
                                                {formatLocalizedLabel(
                                                    t,
                                                    status,
                                                )}
                                            </option>
                                        ),
                                    )}
                                </select>
                            </div>
                            {issues.length > 0 ? (
                                <div role='alert' className='mh-alert text-xs'>
                                    <p className='font-bold'>
                                        {t('directoryManager.check')}
                                    </p>
                                    <ul className='mt-2 list-disc space-y-1 pl-5'>
                                        {issues.map((issue) => (
                                            <li key={issue}>
                                                {issue ===
                                                'Latitude must be between -90 and 90.'
                                                    ? t(
                                                          'directoryManager.latitudeInvalid',
                                                      )
                                                    : issue ===
                                                        'Longitude must be between -180 and 180.'
                                                      ? t(
                                                            'directoryManager.longitudeInvalid',
                                                        )
                                                      : issue ===
                                                          'Public location precision must be between 1 and 50 kilometres.'
                                                        ? t(
                                                              'directoryManager.precisionInvalid',
                                                          )
                                                        : issue ===
                                                            'Add a public website or phone number.'
                                                          ? t(
                                                                'directoryManager.contactInvalid',
                                                            )
                                                          : t(
                                                                'directoryManager.invalid',
                                                            )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ) : null}
                            <div className='flex flex-wrap gap-2'>
                                <Button
                                    type='submit'
                                    variant='primary'
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting
                                        ? t('directoryManager.saving')
                                        : editing
                                          ? t('directoryManager.save')
                                          : t('directoryManager.publish')}
                                </Button>
                                <Button
                                    type='button'
                                    variant='neutral'
                                    disabled={isSubmitting}
                                    onClick={() => {
                                        reset();
                                        setIsOpen(false);
                                    }}
                                >
                                    {t('directoryManager.cancel')}
                                </Button>
                                {editing && !confirmDelete ? (
                                    <Button
                                        type='button'
                                        variant='neutral'
                                        disabled={isSubmitting}
                                        onClick={() => setConfirmDelete(true)}
                                    >
                                        {t('directoryManager.delete')}
                                    </Button>
                                ) : null}
                            </div>
                            {editing && confirmDelete ? (
                                <div
                                    role='alert'
                                    className='mh-alert flex flex-wrap items-center gap-3 text-xs'
                                >
                                    <p className='font-bold'>
                                        {t('directoryManager.confirmDelete')}
                                    </p>
                                    <Button
                                        type='button'
                                        variant='primary'
                                        disabled={isSubmitting}
                                        onClick={() => void remove()}
                                    >
                                        {t('directoryManager.confirm')}
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='neutral'
                                        onClick={() => setConfirmDelete(false)}
                                    >
                                        {t('directoryManager.keep')}
                                    </Button>
                                </div>
                            ) : null}
                        </form>
                    ) : null}
                    <span className='sr-only' data-directory-manager='ready'>
                        {t('directoryManager.ready')}
                    </span>
                </>
            ) : (
                <p className='text-sm text-mh-textMuted'>
                    {t('directoryManager.public')}{' '}
                    <a
                        className='font-bold underline'
                        href='/login?returnTo=%2Fresources'
                    >
                        {t('directoryManager.signIn')}
                    </a>{' '}
                    {t('directoryManager.signInSuffix')}
                </p>
            )}
        </Card>
    );
};

interface ResourceRouteProps {
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    onNavigate: (route: AppRoute) => void;
    isLoading: boolean;
    errorMessage?: string;
    dataOrigin: ApiDataOrigin;
    onRetry: () => void;
    hasNextPage: boolean;
    total: number;
    onLoadMore: () => void;
    resourceCards: readonly ResourceDirectoryCard[];
    currentUserDid: string;
}

export const ResourceRoute = ({
    discoveryState,
    onPatchDiscovery,
    onNavigate,
    isLoading,
    errorMessage,
    dataOrigin,
    onRetry,
    hasNextPage,
    total,
    onLoadMore,
    resourceCards,
    currentUserDid,
}: ResourceRouteProps) => {
    const { t, fmt } = useLocale();
    const paginationFocus = usePaginationFocus({
        itemCount: resourceCards.length,
        isLoading,
        hasNextPage,
        announce: useCallback(
            (start: number, end: number) =>
                String(t('discovery.loadedRange', { start, end })),
            [t],
        ),
    });
    const [activeCategory, setActiveCategory] =
        useState<DirectoryResourceCategory>();
    const [selectedUri, setSelectedUri] = useState<string>();
    const [manageUri, setManageUri] = useState<string>();

    useEffect(() => {
        if (!selectedUri) {
            return undefined;
        }
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                setSelectedUri(undefined);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedUri]);

    const viewModel = useMemo(
        () =>
            buildResourceOverlayViewModel(resourceCards, discoveryState, {
                category: activeCategory,
            }),
        [activeCategory, discoveryState, resourceCards],
    );

    const uiState = useMemo(
        () =>
            resolveResourceDirectoryUiState({
                loading: isLoading,
                errorMessage,
                resources: viewModel.cards,
                activeCategoryFilter: viewModel.activeCategoryFilter,
            }),
        [
            errorMessage,
            isLoading,
            viewModel.cards,
            viewModel.activeCategoryFilter,
        ],
    );

    const detailPanel = selectedUri
        ? openResourceDetailPanel(viewModel.cards, selectedUri)
        : closeResourceDetailPanel();

    const countLabel =
        total > resourceCards.length
            ? t('discovery.showingCount', { loaded: resourceCards.length, total })
            : t('discovery.resultCount', { count: viewModel.cards.length });
    const isOwnListing = (card: ResourceDirectoryCard) =>
        Boolean(currentUserDid) &&
        (card.authorDid === currentUserDid ||
            card.uri.startsWith(`at://${currentUserDid}/`));

    return (
        <section>
            <PageHeader
                title={t('resources.heading')}
                description={t('resources.description')}
                meta={
                    dataOrigin !== 'api' ? (
                        <Badge tone='info'>{dataOriginLabel(dataOrigin)}</Badge>
                    ) : null
                }
            />

            {errorMessage ? (
                <Banner
                    className='mb-6'
                    tone='danger'
                    title={t('map.apiSyncIssue', { message: errorMessage })}
                    actions={
                        <Button size='sm' variant='secondary' onClick={onRetry}>
                            {t('resources.retryDirectory')}
                        </Button>
                    }
                >
                    {resourceCards.length > 0 ? (
                        <p>{t('resources.staleResults')}</p>
                    ) : null}
                </Banner>
            ) : null}

            <DiscoveryToolbar
                idPrefix='resources'
                state={discoveryState}
                onPatch={onPatchDiscovery}
                mode='places'
            />

            <ChipGroup
                legend={t('resources.directoryFiltersTitle')}
                hideLegend
                className='mb-5 -mt-2'
            >
                <ToggleChip
                    pressed={!activeCategory}
                    onClick={() => setActiveCategory(undefined)}
                >
                    {t('resources.allCategories')}
                </ToggleChip>
                {resourceCategoryOptions.map((category) => (
                    <ToggleChip
                        key={category}
                        pressed={activeCategory === category}
                        onClick={() =>
                            setActiveCategory((current) =>
                                current === category ? undefined : category,
                            )
                        }
                    >
                        {formatLocalizedLabel(t, category)}
                    </ToggleChip>
                ))}
            </ChipGroup>

            <section aria-labelledby='resources-results-heading'>
                <div className='mh-results-header'>
                    <h2
                        id='resources-results-heading'
                        className='mh-surface__title'
                    >
                        {t('resources.overlayCardsTitle')}
                    </h2>
                    <p
                        ref={paginationFocus.loadedCountRef}
                        tabIndex={-1}
                        className='mh-results-count'
                        role='status'
                    >
                        {countLabel}
                    </p>
                </div>
                <span className='sr-only' role='status' aria-live='polite'>
                    {paginationFocus.announcement}
                </span>
                <div aria-live='polite' className='sr-only'>
                    {uiState.ariaLiveMessage}
                </div>

                {isLoading && viewModel.cards.length === 0 ? (
                    <ul className='mh-request-list mh-request-list--grid' aria-hidden='true'>
                        {Array.from({ length: 4 }).map((_, index) => (
                            <li
                                key={`resource-skeleton-${index}`}
                                className='mh-request-card'
                            >
                                <div className='mh-skeleton h-3 w-1/4' />
                                <div className='mh-skeleton h-6 w-1/2' />
                                <div className='mh-skeleton h-3 w-full' />
                            </li>
                        ))}
                    </ul>
                ) : viewModel.cards.length === 0 ? (
                    <EmptyState
                        title={t('resources.noResultsTitle')}
                        actions={
                            activeCategory ? (
                                <Button
                                    variant='secondary'
                                    onClick={() => setActiveCategory(undefined)}
                                >
                                    {t('resources.clearDirectoryCategory')}
                                </Button>
                            ) : null
                        }
                    >
                        <p>{uiState.message}</p>
                        <p>{t('resources.tryBroadening')}</p>
                    </EmptyState>
                ) : (
                    <ul className='mh-request-list mh-request-list--grid'>
                        {viewModel.cards.map((card) => (
                            <li key={card.uri}>
                                <article className='mh-place-card'>
                                    <div className='mh-request-card__meta'>
                                        <span className='mh-eyebrow'>
                                            {formatLocalizedLabel(
                                                t,
                                                card.category,
                                            )}
                                        </span>
                                        {card.recordOrigin === 'synthetic' ? (
                                            <Badge tone='info'>
                                                {t('resources.synthetic')}
                                            </Badge>
                                        ) : card.recordOrigin ===
                                          'sourced-public' ? (
                                            <Badge tone='info'>
                                                {t('resources.publicSource')}
                                            </Badge>
                                        ) : null}
                                    </div>
                                    <h3 className='mh-request-card__title'>
                                        {card.name}
                                    </h3>
                                    <dl className='mh-place-card__facts'>
                                        <div>
                                            <dt className='sr-only'>
                                                {t('resources.areaLabel')}
                                            </dt>
                                            <dd>
                                                <Icon name='pin' size={16} />
                                                {card.location.areaLabel ??
                                                    t('resources.areaPending')}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className='sr-only'>
                                                {t('resources.hoursLabel')}
                                            </dt>
                                            <dd>
                                                {card.openHours ??
                                                    t(
                                                        'resources.hoursUnavailable',
                                                    )}
                                            </dd>
                                        </div>
                                    </dl>
                                    <p className='mh-request-card__description'>
                                        {card.eligibilityNotes ??
                                            t(
                                                'resources.eligibilityUnavailable',
                                            )}
                                    </p>
                                    <div className='mh-request-card__actions'>
                                        <Button
                                            variant='secondary'
                                            size='sm'
                                            aria-label={t(
                                                'resources.openDetailsFor',
                                                { name: card.name },
                                            )}
                                            onClick={() =>
                                                setSelectedUri(card.uri)
                                            }
                                        >
                                            {t('resources.openDetails')}
                                        </Button>
                                        <Button
                                            variant='accent'
                                            size='sm'
                                            aria-label={t(
                                                'resources.startIntakeFor',
                                                { name: card.name },
                                            )}
                                            onClick={() =>
                                                onNavigate('/posting')
                                            }
                                        >
                                            {t('resources.startIntake')}
                                        </Button>
                                        {isOwnListing(card) ? (
                                            <Button
                                                variant='ghost'
                                                size='sm'
                                                aria-label={t(
                                                    'resources.manageListingFor',
                                                    { name: card.name },
                                                )}
                                                onClick={() =>
                                                    setManageUri(card.uri)
                                                }
                                            >
                                                {t('resources.manageListing')}
                                            </Button>
                                        ) : null}
                                    </div>
                                </article>
                            </li>
                        ))}
                    </ul>
                )}
                {hasNextPage ? (
                    <div className='mt-6 flex justify-center'>
                        <Button
                            ref={paginationFocus.loadMoreRef}
                            variant='secondary'
                            onClick={() => paginationFocus.loadMore(onLoadMore)}
                            disabled={isLoading}
                        >
                            {t('discovery.loadMore')}
                        </Button>
                    </div>
                ) : null}
            </section>

            <div className='mt-10'>
                {discoveryState.center ? (
                    <DirectoryResourceManager
                        currentUserDid={currentUserDid}
                        center={discoveryState.center}
                        onChanged={onRetry}
                        editUri={manageUri}
                        onEditHandled={() => setManageUri(undefined)}
                    />
                ) : null}
            </div>

            <Sheet
                open={detailPanel.open}
                onClose={() => setSelectedUri(undefined)}
                title={t('resources.resourceDetailTitle')}
                closeLabel={t('resources.close')}
                footer={
                    detailPanel.open ? (
                        <>
                            {detailPanel.actions.map((action) => (
                                <Button
                                    key={action.id}
                                    variant={
                                        action.id === 'request_intake'
                                            ? 'accent'
                                            : 'secondary'
                                    }
                                    size='sm'
                                    onClick={() => {
                                        if (action.id === 'request_intake') {
                                            onNavigate('/posting');
                                            return;
                                        }
                                        if (action.id === 'open_map') {
                                            onNavigate('/map');
                                        }
                                    }}
                                >
                                    {action.label}
                                </Button>
                            ))}
                        </>
                    ) : null
                }
            >
                {detailPanel.open ? (
                    <div className='grid gap-3'>
                        <p className='mh-eyebrow'>{detailPanel.categoryLabel}</p>
                        <p className='mh-request-card__title'>
                            {detailPanel.title}
                        </p>
                        <p className='text-mh-textMuted'>
                            {detailPanel.openHours}
                        </p>
                        <p>{detailPanel.eligibilityNotes}</p>
                        {detailPanel.exactPublicAddress ? (
                            <Banner
                                tone='info'
                                live='none'
                                title={t('resources.approvedAddress')}
                            >
                                <p>{detailPanel.exactPublicAddress}</p>
                                <p className='mt-1 text-sm text-mh-textMuted'>
                                    {t('resources.approvalExpires', {
                                        date: fmt.longDate(
                                            detailPanel.exactAddressApprovalExpiresAt ??
                                                '',
                                        ),
                                    })}
                                </p>
                            </Banner>
                        ) : null}
                    </div>
                ) : null}
            </Sheet>
        </section>
    );
};
