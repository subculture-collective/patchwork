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
import { ToggleChip } from '../components/ToggleChip';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
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
    DiscoveryFiltersPanel,
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

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('resources.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('resources.description')}
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                    <Badge tone={dataOrigin === 'api' ? 'success' : 'info'}>
                        {dataOriginLabel(dataOrigin)}
                    </Badge>
                </div>
                {errorMessage ? (
                    <div
                        role='alert'
                        className='mh-alert mt-3 text-xs font-bold'
                    >
                        <p>
                            {t('map.apiSyncIssue', { message: errorMessage })}
                        </p>
                        {resourceCards.length > 0 ? (
                            <p>{t('resources.staleResults')}</p>
                        ) : null}
                        <Button
                            size='sm'
                            type='button'
                            variant='neutral'
                            className='mt-2'
                            onClick={onRetry}
                        >
                            {t('resources.retryDirectory')}
                        </Button>
                    </div>
                ) : null}
            </header>

            {discoveryState.center ? (
                <DirectoryResourceManager
                    currentUserDid={currentUserDid}
                    center={discoveryState.center}
                    onChanged={onRetry}
                    editUri={manageUri}
                    onEditHandled={() => setManageUri(undefined)}
                />
            ) : (
                <div className='mh-alert p-4' role='status'>
                    {t('discovery.demoAreaHelp')}
                </div>
            )}

            <DiscoveryFiltersPanel
                idPrefix='resources'
                state={discoveryState}
                onPatch={onPatchDiscovery}
            />

            <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='text-sm text-mh-textMuted' role='status'>
                {t('discovery.loadedCount', { loaded: resourceCards.length, total })}
            </p>
            <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
            {hasNextPage ? (
                <Button ref={paginationFocus.loadMoreRef} type='button' variant='neutral' onClick={() => paginationFocus.loadMore(onLoadMore)} disabled={isLoading}>
                    {t('discovery.loadMore')}
                </Button>
            ) : null}

            <Card title={String(t('resources.directoryFiltersTitle'))}>
                <div className='flex flex-wrap gap-2'>
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
                </div>
            </Card>

            <Card title={String(t('resources.overlayCardsTitle'))}>
                <p className='mb-3 text-sm text-mh-textMuted'>
                    {uiState.message}
                </p>
                <div aria-live='polite' className='sr-only'>
                    {uiState.ariaLiveMessage}
                </div>

                {isLoading ? (
                    <ul className='space-y-3' aria-live='polite'>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <li
                                key={`resource-skeleton-${index}`}
                                className='mh-record-card'
                            >
                                <div className='mh-skeleton h-4 w-1/2' />
                                <div className='mh-skeleton mt-2 h-3 w-2/3' />
                                <div className='mh-skeleton mt-2 h-3 w-full' />
                                <div className='mt-3 flex gap-2'>
                                    <div className='mh-skeleton h-8 w-28' />
                                    <div className='mh-skeleton h-8 w-24' />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : viewModel.cards.length === 0 ? (
                    <div className='space-y-3'>
                        <p className='text-xs text-mh-textSoft'>
                            {t('resources.tryBroadening')}
                        </p>
                        <Button
                            variant='neutral'
                            size='sm'
                            onClick={() => setActiveCategory(undefined)}
                        >
                            {t('resources.clearDirectoryCategory')}
                        </Button>
                    </div>
                ) : (
                    <ul className='space-y-3'>
                        {viewModel.cards.map((card) => (
                            <li key={card.uri} className='mh-record-card'>
                                <div className='flex flex-wrap items-start justify-between gap-2'>
                                    <p className='text-sm font-bold text-mh-text'>
                                        {card.name}
                                    </p>
                                    <Badge tone='info'>
                                        {formatLocalizedLabel(t, card.category)}
                                    </Badge>
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
                                <p className='mt-1 text-xs text-mh-textSoft'>
                                    {card.location.areaLabel ??
                                        t('resources.areaPending')}{' '}
                                    ·{' '}
                                    {card.openHours ??
                                        t('resources.hoursUnavailable')}
                                </p>
                                <p className='mt-2 text-sm text-mh-textMuted'>
                                    {card.eligibilityNotes ??
                                        t('resources.eligibilityUnavailable')}
                                </p>
                                <div className='mt-3 flex flex-wrap gap-2'>
                                    <Button
                                        variant='neutral'
                                        size='sm'
                                        aria-label={t(
                                            'resources.openDetailsFor',
                                            { name: card.name },
                                        )}
                                        onClick={() => setSelectedUri(card.uri)}
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
                                        onClick={() => onNavigate('/posting')}
                                    >
                                        {t('resources.startIntake')}
                                    </Button>
                                    {currentUserDid &&
                                    (card.authorDid === currentUserDid ||
                                        card.uri.startsWith(
                                            `at://${currentUserDid}/`,
                                        )) ? (
                                        <Button
                                            variant='neutral'
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
                            </li>
                        ))}
                    </ul>
                )}
            </Card>

            {detailPanel.open ? (
                <Panel title={String(t('resources.resourceDetailTitle'))}>
                    <p className='text-lg font-bold text-mh-text'>
                        {detailPanel.title}
                    </p>
                    <p className='mt-1 text-sm text-mh-textMuted'>
                        {detailPanel.categoryLabel} · {detailPanel.openHours}
                    </p>
                    <p className='mt-2 text-sm text-mh-textSoft'>
                        {detailPanel.eligibilityNotes}
                    </p>
                    {detailPanel.exactPublicAddress ? (
                        <div className='mh-alert mt-3 text-sm'>
                            <p className='font-bold'>
                                {t('resources.approvedAddress')}
                            </p>
                            <p>{detailPanel.exactPublicAddress}</p>
                            <p className='mt-1 text-xs text-mh-textSoft'>
                                {t('resources.approvalExpires', {
                                    date: fmt.longDate(
                                        detailPanel.exactAddressApprovalExpiresAt ??
                                            '',
                                    ),
                                })}
                            </p>
                        </div>
                    ) : null}
                    <div className='mt-4 flex flex-wrap gap-2'>
                        {detailPanel.actions.map((action) => (
                            <Button
                                key={action.id}
                                variant={
                                    action.id === 'request_intake'
                                        ? 'primary'
                                        : 'neutral'
                                }
                                size='sm'
                                onClick={() => {
                                    if (action.id === 'request_intake') {
                                        onNavigate('/posting');
                                        return;
                                    }

                                    if (action.id === 'open_map') {
                                        onNavigate('/map');
                                        return;
                                    }
                                }}
                            >
                                {action.label}
                            </Button>
                        ))}
                        <Button
                            variant='neutral'
                            size='sm'
                            onClick={() => setSelectedUri(undefined)}
                        >
                            {t('resources.close')}
                        </Button>
                    </div>
                </Panel>
            ) : null}
        </section>
    );
};
