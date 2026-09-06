import type { ResourceDetail } from '../resource-directory-ux';
import { fetchResourceViaApi } from './api-client';
import { useVisiblePoll } from './use-visible-poll';
import { loadPostingDraft, savePostingDraft, clearPostingDraft } from './posting-draft';
import { ResourceActions } from './resource-actions';
import {
    lazy,
    Suspense,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
    type MouseEvent,
} from 'react';
import { ariaLive } from '../a11y';
import {
    aidCategories,
    applyDiscoveryFilterPatch,
    defaultDiscoveryFilterState,
    parseDiscoveryFilterState,
    serializeDiscoveryFilterState,
    type AidStatus,
    type DiscoveryFilterState,
} from '../discovery-filters';
import { buildDiscoveryFilterChipModel } from '../discovery-primitives';
import {
    applyFeedLifecycleAction,
    buildFeedViewModel,
    type FeedAidCard,
    type FeedLifecycleAction,
    type FeedStatusTransition,
    type LifecycleStatus,
} from '../feed-ux';
import {
    buildMapViewModel,
    closeMapDetailDrawer,
    openMapDetailDrawer,
    type MapAidCard,
    type MapTriageAction,
} from '../map-ux';
import {
    validatePostingDraft,
    type AidPostingCategory,
    type NormalizedAidPostingDraft,
    type PostingValidationIssue,
} from '../posting-form';
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
import {
    buildVolunteerProfileCreatePayload,
    isVolunteerFullyVerified,
    summarizeCheckpoints,
    validateVolunteerOnboardingDraft,
    type VolunteerOnboardingDraft,
    type VolunteerOnboardingValidationIssue,
} from '../volunteer-onboarding';
import {
    buildChatInitiationRequest,
    defaultChatLaunchState,
    reduceChatLaunchState,
    toChatStatusNotice,
    type ChatEntrySurface,
    type ChatInitiationIntent,
    type ChatLaunchState,
} from '../chat-ux';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import { TextLink } from '../components/TextLink';
import {
    type AidPostReportReason,
    type ApiDataOrigin,
    type AtAidPostResult,
    type AtDirectoryResourceResult,
    type AtVolunteerProfileResult,
    type MyOrganization,
    type OrganizationMember,
    type OrganizationStewardship,
    type PublicOrganization,
    type ExactAddressRequest,
    type ActivityInboxItem,
    type CoordinationConnection,
    type CoordinationWindow,
    type CoordinationOffer,
    type MatchCandidate,
    type NotificationChannelState,
    type MaintenanceReasonCode,
    type MaintenanceState,
    type OutcomeFeedback,
    type PrivateAttachment,
    type VerificationApplication,
    type VerificationAppeal,
    type VerificationReviewQueue,
    type VerificationSubjectType,
    type VerificationWorkspace,
    type VolunteerDiscoveryProfile,
    type VolunteerProfileCommandInput,
    acceptCurrentPoliciesViaApi,
    acceptOrganizationInvitationViaApi,
    assignOrganizationStewardshipViaApi,
    blockUserViaApi,
    closeAtAidPostViaApi,
    createAidPostViaApi,
    createAtDirectoryResourceViaApi,
    createAtVolunteerProfileViaApi,
    createOrganizationViaApi,
    createCoordinationOfferViaApi,
    deactivateAccountViaApi,
    deleteAtDirectoryResourceViaApi,
    deleteAtVolunteerProfileViaApi,
    deleteAtAidPostViaApi,
    exportDataViaApi,
    fetchAccountOnboardingViaApi,
    fetchAccountPreferencesViaApi,
    fetchActivityInboxViaApi,
    fetchCoordinationViaApi,
    fetchCoordinationWindowsViaApi,
    fetchDirectoryCardPageFromApi,
    fetchFeedRecordPageFromApi,
    fetchFeedRecordsFromApi,
    appendDedupedPage,
    fetchMyOrganizationsViaApi,
    fetchOrganizationMembersViaApi,
    fetchOrganizationsViaApi,
    fetchMyOutcomeFeedbackViaApi,
    fetchNotificationChannelsViaApi,
    fetchModeratorMaintenanceViaApi,
    fetchModerationAuditViaApi,
    fetchModerationQueueViaApi,
    fetchNotificationsViaApi,
    fetchPublicMaintenanceStatusViaApi,
    fetchOrganizationStewardshipsViaApi,
    fetchPrivateAttachmentsViaApi,
    fetchExactAddressReviewQueueViaApi,
    fetchVerificationReviewQueueViaApi,
    fetchVerificationWorkspaceViaApi,
    fetchSettingsAuditFromApi,
    fetchSettingsFromApi,
    fetchVolunteerProfilePageViaApi,
    getAtDirectoryResourceViaApi,
    getAtVolunteerProfileViaApi,
    initiateChatViaApi,
    inviteOrganizationMemberViaApi,
    decideCoordinationOfferViaApi,
    decideExactAddressViaApi,
    decideVerificationAppealViaApi,
    decideVerificationViaApi,
    queryAidPostLifecycleViaApi,
    markActivityInboxReadViaApi,
    markAllNotificationsReadViaApi,
    markNotificationReadViaApi,
    matchRequestViaApi,
    reportAidPostViaApi,
    requestNotificationEmailVerificationViaApi,
    reconcileAidPostStatusViaApi,
    reconfirmOrganizationStewardshipViaApi,
    requestExactPublicAddressViaApi,
    requestPrivateAttachmentAccessViaApi,
    removeOrganizationMemberViaApi,
    updateSettingsViaApi,
    transitionAidPostViaApi,
    transitionCoordinationConnectionViaApi,
    proposeCoordinationWindowViaApi,
    decideCoordinationWindowViaApi,
    submitOutcomeFeedbackViaApi,
    submitVerificationAppealViaApi,
    submitVerificationApplicationViaApi,
    confirmNotificationEmailViaApi,
    disableNotificationEmailViaApi,
    archiveNotificationViaApi,
    registerPushSubscriptionViaApi,
    revokePushSubscriptionViaApi,
    uploadPrivateAttachmentViaApi,
    deletePrivateAttachmentViaApi,
    reviewPrivateAttachmentViaApi,
    updateAccountPreferencesViaApi,
    updateOrganizationMemberRoleViaApi,
    updateAtDirectoryResourceViaApi,
    updateAtVolunteerProfileViaApi,
    applyModerationPolicyViaApi,
    declareMaintenanceViaApi,
    resumeMaintenanceViaApi,
} from './api-client';
import { useLocale } from '../i18n';
import { ExactLocationExchange } from './exact-location-exchange';
import { RequestLifecycleActions } from './request-actions';
import {
    type SettingsPatch,
    type SettingsSection,
    applySettingsPatch,
    defaultSettingsViewModel,
    isSettingsDirty,
    settingsSectionDescriptions,
    settingsSectionLabels,
    settingsSections,
    validateSettings,
} from '../settings-ux';
import {
    CURRENT_POLICY_VERSION,
    defaultAccountPreferences,
    type Notification as DurableNotification,
    type NotificationFilter,
    type ModerationAuditRecord,
    type ModerationPolicyAction,
    type ModerationQueueItem,
    requiredPolicyDocuments,
    type AccountPreferences,
    type UserSettings,
    geoSharingPrecisions,
    PUBLIC_MIN_PRECISION_KM,
    privacyExposurePreview,
    privacyLevels,
} from '@patchwork/shared';
import { type FeedRecordEnvelope } from './discovery-runtime';
import { resolvePaginationFocus } from './pagination-focus';
import { useAuth } from '../auth/AuthProvider';
import { resolveWebDataMode } from './data-mode';

const webDataMode = resolveWebDataMode(import.meta.env, {
    command: import.meta.env.PROD ? 'build' : 'serve',
    mode: import.meta.env.MODE,
});

const dataOriginLabel = (origin: ApiDataOrigin): string =>
    origin === 'api'
        ? 'DB-backed API'
        : origin === 'fixture'
          ? 'Local fixture demo'
          : origin === 'idle'
            ? 'Requesting location'
            : 'API unavailable';

const LazyMyRequests = lazy(() => import('./my-requests').then(module => ({ default: module.MyRequests })));
const LazyProductionChat = lazy(() => import('./production-chat').then(module => ({ default: module.ProductionChat })));
const LazyProductionGroups = lazy(() => import('./production-groups').then(module => ({ default: module.ProductionGroups })));
const LazyRequestDetail = lazy(() => import('./request-detail').then(module => ({ default: module.RequestDetail })));

const appRoutes = [
    '/',
    '/requests/view',
    '/map',
    '/feed',
    '/resources',
    '/volunteer',
    '/organizations',
    '/verification',
    '/posting',
    '/chat',
    '/settings',
    '/moderation',
    '/inbox',
    '/notifications',
    '/scheduling',
    '/feedback',
    '/groups',
    '/legal/terms',
    '/legal/privacy',
    '/legal/community-guidelines',
] as const;

const deferredFixtureRoutes = new Set<AppRoute>([
    '/feedback',
]);

type AppRoute = (typeof appRoutes)[number];

interface FrontendShellProps {
    appTitle: string;
}

const routeLabelKeys: Readonly<Record<AppRoute, string>> = {
    '/': 'route.home',
    '/requests/view': 'handoff.requestDetails',
    '/map': 'route.map',
    '/feed': 'route.feed',
    '/resources': 'route.resources',
    '/volunteer': 'route.volunteer',
    '/organizations': 'route.organizations',
    '/verification': 'route.verification',
    '/posting': 'route.posting',
    '/chat': 'route.chat',
    '/settings': 'route.settings',
    '/moderation': 'route.moderation',
    '/inbox': 'route.inbox',
    '/notifications': 'route.notifications',
    '/scheduling': 'route.scheduling',
    '/feedback': 'route.feedback',
    '/groups': 'route.groups',
    '/legal/terms': 'route.terms',
    '/legal/privacy': 'route.privacy',
    '/legal/community-guidelines': 'route.guidelines',
};

const primaryRoutes: readonly AppRoute[] = [
    '/',
    '/map',
    '/feed',
    '/resources',
];

const accountRoutes: readonly AppRoute[] = ['/volunteer', '/chat', '/settings'];
const productionAccountRoutes: readonly AppRoute[] = [
    '/inbox',
    '/notifications',
    '/moderation',
    '/settings',
];

const secondaryRoutes = appRoutes.filter(
    (route) =>
        !primaryRoutes.includes(route) &&
        !accountRoutes.includes(route) &&
        !route.startsWith('/legal/') && route !== '/requests/view',
);
const resourceCategoryOptions: readonly DirectoryResourceCategory[] = [
    'food-bank',
    'shelter',
    'clinic',
    'legal-aid',
    'hotline',
    'other',
];

const volunteerCapabilityOptions: readonly VolunteerOnboardingDraft['capabilities'][number][] =
    [
        'transport',
        'food-delivery',
        'translation',
        'first-aid',
        'childcare',
        'other',
    ];

const volunteerAvailabilityOptions: readonly VolunteerOnboardingDraft['availability'][] =
    ['immediate', 'within-24h', 'scheduled', 'unavailable'];

const volunteerContactOptions: readonly VolunteerOnboardingDraft['contactPreference'][] =
    ['chat-only', 'chat-or-call'];

const checkpointStatusOptions: readonly VolunteerOnboardingDraft['checkpoints']['identityCheck'][] =
    ['pending', 'approved', 'rejected'];

const urgencyPreferenceOptions: readonly VolunteerOnboardingDraft['preferredUrgencies'][number][] =
    ['low', 'medium', 'high', 'critical'];

const nowIso = (): string => new Date().toISOString();

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

const defaultShellDiscoveryState = applyDiscoveryFilterPatch(
    defaultDiscoveryFilterState,
    {
        status: undefined,
    },
);

const buildNearbyPatch = (): Partial<DiscoveryFilterState> => ({
    center: undefined,
    areaLabel: undefined,
    radiusMeters: undefined,
    feedTab: 'nearby',
});

const toSeverityTone = (
    status: AidStatus,
): 'neutral' | 'info' | 'success' | 'danger' => {
    if (status === 'open') {
        return 'danger';
    }
    if (status === 'in-progress') {
        return 'info';
    }
    if (status === 'resolved') {
        return 'success';
    }
    return 'neutral';
};

const toUrgencyTone = (
    urgency: 1 | 2 | 3 | 4 | 5,
): 'neutral' | 'info' | 'success' | 'danger' => {
    if (urgency >= 4) {
        return 'danger';
    }
    if (urgency >= 3) {
        return 'info';
    }
    return 'neutral';
};

const toMapAidCard = (record: FeedRecordEnvelope): MapAidCard => {
    return {
        id: record.card.id,
        title: record.card.title,
        summary: record.card.description,
        category: record.card.category,
        status: record.card.status,
        urgency: record.card.urgency,
        updatedAt: record.card.updatedAt,
        location: record.card.location,
    };
};

const parseCommaList = (value: string): string[] => {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
};

const formatCategoryLabel = (value: string): string => {
    return value
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

const formatLocalizedLabel = (
    t: ReturnType<typeof useLocale>['t'],
    value: string,
): string => t(`labels.${value}`, { defaultValue: formatCategoryLabel(value) });

const normalizeRoute = (pathname: string): AppRoute => {
    return appRoutes.find((route) => route === pathname) ?? '/';
};

const readCurrentRoute = (): AppRoute => {
    if (typeof window === 'undefined') {
        return '/';
    }

    return normalizeRoute(window.location.pathname);
};

const readDiscoveryStateFromUrl = (
    fallback: DiscoveryFilterState,
): DiscoveryFilterState => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    return parseDiscoveryFilterState(window.location.search, fallback);
};

const readPaginationPageFromUrl = (): number => {
    if (typeof window === 'undefined') return 1;
    const page = Number.parseInt(new URLSearchParams(window.location.search).get('page') ?? '1', 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
};

interface DiscoveryFiltersPanelProps {
    idPrefix: string;
    state: DiscoveryFilterState;
    onPatch: (patch: Partial<DiscoveryFilterState>) => void;
}

const DiscoveryFiltersPanel = ({
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
                            type='button'
                            className='mt-3 px-3 py-2 text-xs'
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
                        className='px-3 py-1 text-xs'
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
                            <Button
                                key={tab.id}
                                variant={tab.active ? 'secondary' : 'neutral'}
                                className='px-3 py-1 text-xs'
                                onClick={() => onPatch({ feedTab: tab.value })}
                            >
                                {tab.label}
                            </Button>
                        ))}
                    </div>
                </div>

                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.category')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.categories.map((category) => (
                            <Button
                                key={category.id}
                                variant={
                                    category.active ? 'secondary' : 'neutral'
                                }
                                className='px-3 py-1 text-xs'
                                onClick={() => {
                                    onPatch({
                                        category: category.active
                                            ? undefined
                                            : category.value,
                                    });
                                }}
                            >
                                {category.label}
                            </Button>
                        ))}
                    </div>
                </div>

                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.status')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.statuses.map((status) => (
                            <Button
                                key={status.id}
                                variant={
                                    status.active ? 'secondary' : 'neutral'
                                }
                                className='px-3 py-1 text-xs'
                                onClick={() => {
                                    onPatch({
                                        status: status.active
                                            ? undefined
                                            : status.value,
                                    });
                                }}
                            >
                                {status.label}
                            </Button>
                        ))}
                    </div>
                </div>

                <div>
                    <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                        {t('discovery.minimumUrgency')}
                    </p>
                    <div className='flex flex-wrap gap-2'>
                        {chipModel.urgency.map((level) => (
                            <Button
                                key={level.id}
                                variant={level.active ? 'secondary' : 'neutral'}
                                className='px-3 py-1 text-xs'
                                onClick={() => {
                                    onPatch({
                                        minUrgency: level.active
                                            ? undefined
                                            : level.value,
                                    });
                                }}
                            >
                                {level.label}
                            </Button>
                        ))}
                    </div>
                </div>

                <div className='flex flex-wrap items-center justify-between gap-3 border-t-2 border-mh-borderSoft pt-4'>
                    <Button
                        variant='neutral'
                        className='px-3 py-1 text-xs'
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

interface DashboardRouteProps {
    onNavigate: (route: AppRoute) => void;
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
}

const LegalPolicyRoute = ({
    route,
}: {
    route: '/legal/terms' | '/legal/privacy' | '/legal/community-guidelines';
}) => {
    const { t } = useLocale();
    const content =
        route === '/legal/terms'
            ? {
                  title: t('legal.termsTitle'),
                  summary: t('legal.termsSummary'),
                  points: [
                      t('legal.terms1'),
                      t('legal.terms2'),
                      t('legal.terms3'),
                      t('legal.terms4'),
                  ],
              }
            : route === '/legal/privacy'
              ? {
                    title: t('legal.privacyTitle'),
                    summary: t('legal.privacySummary'),
                    points: [
                        t('legal.privacy1'),
                        t('legal.privacy2'),
                        t('legal.privacy3'),
                        t('legal.privacy4'),
                        t('legal.privacy5'),
                    ],
                }
              : {
                    title: t('legal.guidelinesTitle'),
                    summary: t('legal.guidelinesSummary'),
                    points: [
                        t('legal.guidelines1'),
                        t('legal.guidelines2'),
                        t('legal.guidelines3'),
                        t('legal.guidelines4'),
                    ],
                };
    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <p className='mh-kicker'>{t('legal.draft')}</p>
                <h1 className='mh-route-title'>{content.title}</h1>
                <p className='mt-2 max-w-3xl text-mh-textMuted'>
                    {content.summary}
                </p>
            </header>
            <Panel title={t('legal.summaryTitle')}>
                <ul className='list-disc space-y-2 pl-5'>
                    {content.points.map((point) => (
                        <li key={point}>{point}</li>
                    ))}
                </ul>
                <p className='mt-4 text-sm font-bold'>{t('legal.noGo')}</p>
            </Panel>
            <nav
                aria-label={t('legal.navLabel')}
                className='flex flex-wrap gap-4'
            >
                <a className='mh-link' href='/legal/terms'>
                    {t('legal.termsNav')}
                </a>
                <a className='mh-link' href='/legal/privacy'>
                    {t('legal.privacyNav')}
                </a>
                <a className='mh-link' href='/legal/community-guidelines'>
                    {t('legal.guidelinesNav')}
                </a>
            </nav>
        </section>
    );
};

const DashboardRoute = ({
    onNavigate,
    discoveryState,
    onPatchDiscovery,
}: DashboardRouteProps) => {
    const { t } = useLocale();
    return (
        <>
            <header className='mh-landing-hero'>
                <div className='mh-landing-hero__copy'>
                    <p className='mh-kicker'>{t('dashboard.eyebrow')}</p>
                    <h1 className='mh-landing-title'>
                        {t('dashboard.heading')}
                    </h1>
                    <p className='mh-landing-deck'>
                        {t('dashboard.description')}
                    </p>
                    <div className='mt-7 flex flex-wrap gap-3'>
                        <Button
                            onClick={() => {
                                onPatchDiscovery(buildNearbyPatch());
                                onNavigate('/map');
                            }}
                        >
                            {t('dashboard.browseNeeds')}
                        </Button>
                        <Button
                            variant='secondary'
                            onClick={() => onNavigate('/posting')}
                        >
                            {t('dashboard.askForHelp')}
                        </Button>
                        <Button
                            variant='neutral'
                            onClick={() => onNavigate('/resources')}
                        >
                            {t('dashboard.findResources')}
                        </Button>
                    </div>
                    <p className='mh-landing-note'>
                        <span aria-hidden='true' />{' '}
                        {t('dashboard.locationPromise')}
                    </p>
                </div>

                <aside
                    className='mh-how-card'
                    aria-labelledby='how-patchwork-works'
                >
                    <div className='mh-how-card__patches' aria-hidden='true'>
                        <span />
                        <span />
                        <span />
                        <span />
                    </div>
                    <p className='mh-kicker'>{t('dashboard.howEyebrow')}</p>
                    <h2 id='how-patchwork-works' className='mh-how-card__title'>
                        {t('dashboard.howTitle')}
                    </h2>
                    <ol className='mt-5 grid gap-4'>
                        {(['discover', 'connect', 'coordinate'] as const).map(
                            (step, index) => (
                                <li key={step} className='mh-how-step'>
                                    <span
                                        className='mh-how-step__number'
                                        aria-hidden='true'
                                    >
                                        {index + 1}
                                    </span>
                                    <div>
                                        <h3 className='font-bold text-mh-text'>
                                            {t(`dashboard.${step}Title`)}
                                        </h3>
                                        <p className='mt-1 text-sm text-mh-textMuted'>
                                            {t(`dashboard.${step}Description`)}
                                        </p>
                                    </div>
                                </li>
                            ),
                        )}
                    </ol>
                </aside>
            </header>

            <section
                className='mh-landing-section'
                aria-labelledby='start-heading'
            >
                <div className='mh-landing-section__header'>
                    <div>
                        <p className='mh-kicker'>
                            {t('dashboard.startEyebrow')}
                        </p>
                        <h2
                            id='start-heading'
                            className='mh-landing-section__title'
                        >
                            {t('dashboard.startTitle')}
                        </h2>
                    </div>
                    <p>{t('dashboard.startDescription')}</p>
                </div>

                <div className='grid gap-4 md:grid-cols-3'>
                    <button
                        type='button'
                        className='mh-path-card mh-path-card--needs'
                        onClick={() => {
                            onPatchDiscovery(buildNearbyPatch());
                            onNavigate('/feed');
                        }}
                    >
                        <span
                            className='mh-path-card__index'
                            aria-hidden='true'
                        >
                            {t('dashboard.needsIndex')}
                        </span>
                        <span className='mh-path-card__title'>
                            {t('dashboard.needsTitle')}
                        </span>
                        <span className='mh-path-card__description'>
                            {t('dashboard.needsDescription')}
                        </span>
                        <span className='mh-path-card__link'>
                            {t('dashboard.needsAction')}{' '}
                            <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                    <button
                        type='button'
                        className='mh-path-card mh-path-card--offer'
                        onClick={() => onNavigate('/volunteer')}
                    >
                        <span
                            className='mh-path-card__index'
                            aria-hidden='true'
                        >
                            {t('dashboard.offerIndex')}
                        </span>
                        <span className='mh-path-card__title'>
                            {t('dashboard.offerTitle')}
                        </span>
                        <span className='mh-path-card__description'>
                            {t('dashboard.offerDescription')}
                        </span>
                        <span className='mh-path-card__link'>
                            {t('dashboard.offerAction')}{' '}
                            <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                    <button
                        type='button'
                        className='mh-path-card mh-path-card--resources'
                        onClick={() => onNavigate('/resources')}
                    >
                        <span
                            className='mh-path-card__index'
                            aria-hidden='true'
                        >
                            {t('dashboard.resourcesIndex')}
                        </span>
                        <span className='mh-path-card__title'>
                            {t('dashboard.resourcesTitle')}
                        </span>
                        <span className='mh-path-card__description'>
                            {t('dashboard.resourcesDescription')}
                        </span>
                        <span className='mh-path-card__link'>
                            {t('dashboard.resourcesAction')}{' '}
                            <span aria-hidden='true'>→</span>
                        </span>
                    </button>
                </div>
            </section>

            <section
                className='mh-nearby-band'
                aria-labelledby='nearby-heading'
            >
                <div>
                    <p className='mh-kicker'>{t('dashboard.nearbyEyebrow')}</p>
                    <h2 id='nearby-heading' className='mh-nearby-band__title'>
                        {t('dashboard.nearbyTitle')}
                    </h2>
                    <p className='mt-2 max-w-xl text-sm text-mh-textMuted sm:text-base'>
                        {t('dashboard.nearbyDescription')}
                    </p>
                </div>
                <div className='mh-nearby-band__search'>
                    <label htmlFor='search-requests' className='sr-only'>
                        {t('dashboard.searchRequests')}
                    </label>
                    <Input
                        id='search-requests'
                        name='searchRequests'
                        autoComplete='off'
                        placeholder={String(t('discovery.searchPlaceholder'))}
                        value={discoveryState.text ?? ''}
                        onChange={(event) => {
                            const nextValue = event.target.value.trim();
                            onPatchDiscovery({
                                text:
                                    nextValue.length > 0
                                        ? nextValue
                                        : undefined,
                            });
                        }}
                    />
                    <Button
                        onClick={() => {
                            onPatchDiscovery(buildNearbyPatch());
                            onNavigate('/map');
                        }}
                    >
                        {t('dashboard.exploreMap')}
                    </Button>
                </div>
            </section>

            <section
                className='mh-trust-section'
                aria-labelledby='trust-heading'
            >
                <div className='mh-trust-section__intro'>
                    <p className='mh-kicker'>{t('dashboard.trustEyebrow')}</p>
                    <h2
                        id='trust-heading'
                        className='mh-landing-section__title'
                    >
                        {t('dashboard.trustTitle')}
                    </h2>
                    <p>{t('dashboard.trustDescription')}</p>
                </div>
                <ul className='mh-trust-list'>
                    <li>
                        <strong>{t('dashboard.approximateTitle')}</strong>
                        <span>{t('dashboard.approximateDescription')}</span>
                    </li>
                    <li>
                        <strong>{t('dashboard.privateTitle')}</strong>
                        <span>{t('dashboard.privateDescription')}</span>
                    </li>
                    <li>
                        <strong>{t('dashboard.controlTitle')}</strong>
                        <span>{t('dashboard.controlDescription')}</span>
                    </li>
                </ul>
            </section>

            <aside className='mh-safety-note' aria-labelledby='safety-heading'>
                <div>
                    <p className='mh-kicker'>{t('dashboard.safetyEyebrow')}</p>
                    <h2
                        id='safety-heading'
                        className='font-heading text-xl font-bold'
                    >
                        {t('dashboard.notEmergency')}
                    </h2>
                </div>
                <p>
                    {t('dashboard.safetyDescription')}{' '}
                    <TextLink href='/legal/community-guidelines'>
                        {t('dashboard.communityGuidelines')}
                    </TextLink>
                    {t('dashboard.safetySuffix')}
                </p>
            </aside>
        </>
    );
};

interface MapRouteProps {
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    onPushDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    feedRecords: readonly FeedRecordEnvelope[];
    resourceCards: readonly ResourceDirectoryCard[];
    resourceErrorMessage?: string;
    isLoading: boolean;
    errorMessage?: string;
    dataOrigin: ApiDataOrigin;
    onRetry: () => void;
    hasNextPage: boolean;
    total: number;
    onLoadMore: () => void;
    onRetryResources: () => void;
    selectedPostId?: string;
    onSelectPost: (id: string | undefined) => void;
    onTriageAction: (postId: string, action: MapTriageAction) => void;
    onOpenChat: (record: FeedRecordEnvelope, surface: ChatEntrySurface) => void;
}

const LazyInteractiveMap = lazy(() =>
    import('../components/map/InteractiveMap.js').then((module) => ({
        default: module.InteractiveMap,
    })),
);

const usePaginationFocus = ({
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

const MapRoute = ({
    discoveryState,
    onPatchDiscovery,
    onPushDiscovery,
    feedRecords,
    resourceCards,
    resourceErrorMessage,
    isLoading,
    errorMessage,
    dataOrigin,
    onRetry,
    hasNextPage,
    total,
    onLoadMore,
    onRetryResources,
    selectedPostId,
    onSelectPost,
    onTriageAction,
    onOpenChat,
}: MapRouteProps) => {
    const { t, fmt } = useLocale();
    const paginationFocus = usePaginationFocus({
        itemCount: feedRecords.length,
        isLoading,
        hasNextPage,
        announce: useCallback(
            (start: number, end: number) =>
                String(t('discovery.loadedRange', { start, end })),
            [t],
        ),
    });
    const [viewport, setViewport] = useState<{ center: { lat: number; lng: number }; radiusMeters: number }>();
    const [selectedResourceUri, setSelectedResourceUri] = useState<string>();
    const [tileError, setTileError] = useState<string>();
    const [focusedArea, setFocusedArea] = useState<{
        center: { lat: number; lng: number };
        radiusMeters: number;
        label: string;
        previousCenter?: { lat: number; lng: number };
        previousRadiusMeters?: number;
    }>();
    useEffect(() => {
        if (!selectedPostId) {
            return undefined;
        }
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                onSelectPost(undefined);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [selectedPostId, onSelectPost]);

    const mapCards = useMemo(
        () => feedRecords.map(toMapAidCard),
        [feedRecords],
    );

    const mapView = useMemo(
        () => buildMapViewModel(mapCards, discoveryState),
        [mapCards, discoveryState],
    );
    const mapResourceView = useMemo(
        () => buildResourceOverlayViewModel(resourceCards, discoveryState),
        [discoveryState, resourceCards],
    );
    const activeArea =
        focusedArea ??
        (discoveryState.center && discoveryState.radiusMeters
            ? {
                  center: discoveryState.center,
                  radiusMeters: discoveryState.radiusMeters,
                  label: String(t('map.selectedArea')),
              }
            : undefined);

    useEffect(() => {
        if (!focusedArea) return;
        if (
            !discoveryState.center ||
            discoveryState.radiusMeters !== focusedArea.radiusMeters ||
            discoveryState.center.lat !== focusedArea.center.lat ||
            discoveryState.center.lng !== focusedArea.center.lng
        ) {
            setFocusedArea(undefined);
        }
    }, [discoveryState.center, discoveryState.radiusMeters, focusedArea]);

    const leaveFocusedArea = (target: 'previous' | 'clear') => {
        const patch =
            target === 'previous' && focusedArea
                ? {
                      center: focusedArea.previousCenter,
                      radiusMeters: focusedArea.previousRadiusMeters,
                  }
                : {
                      center: undefined,
                      areaLabel: undefined,
                      radiusMeters: undefined,
                  };
        setFocusedArea(undefined);
        onSelectPost(undefined);
        onPushDiscovery(patch);
    };

    const selectedRecord = selectedPostId
        ? feedRecords.find((record) => record.card.id === selectedPostId)
        : undefined;

    const drawer = selectedPostId
        ? openMapDetailDrawer(mapView.filteredCards, selectedPostId)
        : closeMapDetailDrawer();

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('map.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('map.description')}
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                    <Badge tone={dataOrigin === 'api' ? 'success' : 'info'}>
                        {dataOriginLabel(dataOrigin)}
                    </Badge>
                    <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='text-sm text-mh-textMuted' role='status'>
                        {t('discovery.loadedCount', { loaded: feedRecords.length, total })}
                    </p>
                    <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
                    {hasNextPage ? (
                        <Button ref={paginationFocus.loadMoreRef} type='button' variant='neutral' className='px-3 py-1 text-xs' onClick={() => paginationFocus.loadMore(onLoadMore)} disabled={isLoading}>
                            {t('discovery.loadMore')}
                        </Button>
                    ) : null}
                </div>
                {errorMessage || resourceErrorMessage ? (
                    <div
                        role='alert'
                        className='mh-alert mt-3 text-xs font-bold'
                    >
                        {errorMessage ? (
                            <p>
                                {t('map.apiSyncIssue', {
                                    message: errorMessage,
                                })}
                            </p>
                        ) : null}
                        {errorMessage && feedRecords.length > 0 ? (
                            <p>{t('map.staleResults')}</p>
                        ) : null}
                        {resourceErrorMessage ? (
                            <p>
                                {t('map.publicPlaceIssue', {
                                    message: resourceErrorMessage,
                                })}
                            </p>
                        ) : null}
                        <div className='mt-2 flex flex-wrap gap-2'>
                            {errorMessage ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    className='px-3 py-1 text-xs'
                                    onClick={onRetry}
                                >
                                    {t('map.retryDiscovery')}
                                </Button>
                            ) : null}
                            {resourceErrorMessage ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    className='px-3 py-1 text-xs'
                                    onClick={onRetryResources}
                                >
                                    {t('map.retryPlaces')}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </header>

            <section className='rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-3'>
                {tileError ? (
                    <div
                        role='alert'
                        className='mh-alert mb-3 text-xs font-bold'
                    >
                        <p>{tileError}</p>
                    </div>
                ) : null}
                {activeArea ? (
                    <div
                        className='mb-3 flex flex-wrap items-center gap-2 border-2 border-mh-borderSoft bg-mh-surface p-3'
                        role='status'
                        aria-live='polite'
                    >
                        <Badge tone='info'>{t('map.filteredArea')}</Badge>
                        <p className='mr-auto text-sm text-mh-textMuted'>
                            <strong className='text-mh-text'>
                                {activeArea.label}
                            </strong>{' '}
                            ·{' '}
                            {t('map.areaSummary', {
                                requests: fmt.number(
                                    mapView.filteredCards.length,
                                ),
                                places: fmt.number(
                                    mapResourceView.cards.length,
                                ),
                                distance: fmt.number(
                                    activeArea.radiusMeters / 1000,
                                    {
                                        maximumFractionDigits: 1,
                                    },
                                ),
                            })}
                        </p>
                        {focusedArea ? (
                            <Button
                                type='button'
                                variant='neutral'
                                className='px-3 py-1 text-xs'
                                onClick={() => leaveFocusedArea('previous')}
                            >
                                {t('map.returnArea')}
                            </Button>
                        ) : null}
                        <Button
                            type='button'
                            variant='neutral'
                            className='px-3 py-1 text-xs'
                            onClick={() => leaveFocusedArea('clear')}
                        >
                            {t('map.clearArea')}
                        </Button>
                    </div>
                ) : null}
                {discoveryState.center ? (
                    <Suspense
                        fallback={<div className='mh-skeleton h-96 w-full' />}
                    >
                        <LazyInteractiveMap
                            cards={mapView.filteredCards}
                            resources={mapResourceView.cards}
                            selectedPostId={selectedPostId}
                            center={discoveryState.center}
                            onSelectPostId={onSelectPost}
                            focusedArea={activeArea}
                            onViewportChange={setViewport}
                            onSelectResource={setSelectedResourceUri}
                            onTilesFailed={setTileError}
                        />
                    </Suspense>
                ) : (
                    <div className='mh-alert p-4' role='status'>
                        {t('map.areaRequired')}
                    </div>
                )}
            </section>

            {viewport && <Button onClick={() => { onPushDiscovery({ ...viewport, feedTab: 'nearby' }); setViewport(undefined); }}>{t('handoff.searchArea')}</Button>}
            {selectedResourceUri && resourceCards.find(card => card.uri === selectedResourceUri) && <Panel title={resourceCards.find(card => card.uri === selectedResourceUri)!.name}>
                <ResourceActions resource={resourceCards.find(card => card.uri === selectedResourceUri)!} />
                <Button onClick={() => setSelectedResourceUri(undefined)}>{t('resources.close')}</Button>
            </Panel>}
            <DiscoveryFiltersPanel
                idPrefix='map'
                state={discoveryState}
                onPatch={onPatchDiscovery}
            />

            <div className='grid gap-6 xl:grid-cols-2'>
                <Card title={String(t('map.clusterOverviewTitle'))}>
                    {isLoading ? (
                        <ul className='space-y-3' aria-live='polite'>
                            {Array.from({ length: 3 }).map((_, index) => (
                                <li
                                    key={`cluster-skeleton-${index}`}
                                    className='mh-record-card'
                                >
                                    <div className='mh-skeleton h-4 w-3/4' />
                                    <div className='mh-skeleton mt-2 h-3 w-1/2' />
                                    <div className='mh-skeleton mt-3 h-6 w-24' />
                                </li>
                            ))}
                        </ul>
                    ) : mapView.clusters.length === 0 ? (
                        <p>{t('map.noClusters')}</p>
                    ) : (
                        <ul className='space-y-3'>
                            {mapView.clusters.map((cluster) => (
                                <li key={cluster.id} className='mh-record-card'>
                                    <p className='text-sm font-bold text-mh-text'>
                                        {t('map.requestsInArea', {
                                            count: cluster.count,
                                        })}
                                    </p>
                                    <p className='mt-1 text-xs text-mh-textSoft'>
                                        {t('map.clusterRequests', {
                                            count: cluster.count,
                                            urgency: cluster.urgencyMax,
                                        })}
                                    </p>
                                    <div className='mt-2'>
                                        <Badge
                                            tone={toSeverityTone(
                                                cluster.status,
                                            )}
                                        >
                                            {cluster.status}
                                        </Badge>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>

                <Card title={String(t('map.requestMarkersTitle'))}>
                    {isLoading ? (
                        <ul className='space-y-3' aria-live='polite'>
                            {Array.from({ length: 3 }).map((_, index) => (
                                <li
                                    key={`marker-skeleton-${index}`}
                                    className='mh-record-card'
                                >
                                    <div className='mh-skeleton h-4 w-2/3' />
                                    <div className='mh-skeleton mt-2 h-3 w-full' />
                                    <div className='mh-skeleton mt-2 h-3 w-4/5' />
                                    <div className='mh-skeleton mt-3 h-8 w-32' />
                                </li>
                            ))}
                        </ul>
                    ) : mapView.filteredCards.length === 0 ? (
                        <p>{t('map.noRequests')}</p>
                    ) : (
                        <ul className='space-y-3'>
                            {mapView.filteredCards.map((card) => (
                                <li key={card.id} className='mh-record-card'>
                                    <div className='flex flex-wrap items-start justify-between gap-2'>
                                        <p className='text-sm font-bold text-mh-text'>
                                            {card.title}
                                        </p>
                                        <div className='flex flex-wrap gap-2'>
                                            <Badge
                                                tone={toUrgencyTone(
                                                    card.urgency,
                                                )}
                                            >
                                                {t('map.urgencyLabel', {
                                                    level: card.urgency,
                                                })}
                                            </Badge>
                                            <Badge
                                                tone={toSeverityTone(
                                                    card.status,
                                                )}
                                            >
                                                {card.status}
                                            </Badge>
                                        </div>
                                    </div>
                                    <p className='mt-2 text-xs text-mh-textSoft'>
                                        {card.summary}
                                    </p>
                                    <div className='mt-3'>
                                        <Button
                                            variant='neutral'
                                            className='px-3 py-1 text-xs'
                                            aria-label={t('map.openTriageDrawerFor', {
                                                title: card.title,
                                                id: card.id,
                                            })}
                                            onClick={() =>
                                                onSelectPost(card.id)
                                            }
                                        >
                                            {t('map.openTriageDrawer')}
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            {drawer.open && selectedRecord ? (
                <Panel
                    title={String(t('map.mapDetailDrawerTitle'))}
                    aria-label={String(
                        t('map.detailsFor', {
                            title: drawer.title ?? t('map.selectedRequest'),
                        }),
                    )}
                >
                    <p className='text-lg font-bold text-mh-text'>
                        {drawer.title}
                    </p>
                    <p className='mt-1 text-sm text-mh-textMuted'>
                        {drawer.summary}
                    </p>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {drawer.status ? (
                            <Badge tone={toSeverityTone(drawer.status)}>
                                {drawer.status}
                            </Badge>
                        ) : null}
                        {selectedRecord.recordOrigin === 'synthetic' && <Badge tone='info'>{t('feed.synthetic')}</Badge>}
                    </div>
                    <a className='mh-button inline-flex px-3 py-2' href={`/requests/view?uri=${encodeURIComponent(selectedRecord.aidPostUri)}`}>{t('handoff.requestDetails')}</a>
                    {webDataMode !== 'fixture' && <RequestLifecycleActions record={selectedRecord} onRefresh={onRetry} />}
                    <div className='mt-4 flex flex-wrap gap-2'>
                        {drawer.actions
                            .filter(
                                () =>
                                    webDataMode === 'fixture',
                            )
                            .map((action) => (
                                <Button
                                    key={action.action}
                                    variant={
                                        action.action === 'contact_helper'
                                            ? 'primary'
                                            : 'neutral'
                                    }
                                    className='px-3 py-1 text-xs'
                                    aria-label={action.ariaLabel}
                                    onClick={() => {
                                        if (
                                            action.action === 'contact_helper'
                                        ) {
                                            onOpenChat(selectedRecord, 'map');
                                            return;
                                        }

                                        onTriageAction(
                                            selectedRecord.card.id,
                                            action.action,
                                        );
                                    }}
                                >
                                    {action.label}
                                </Button>
                            ))}
                        <Button
                            variant='neutral'
                            className='px-3 py-1 text-xs'
                            onClick={() => onSelectPost(undefined)}
                        >
                            {t('map.closeDrawer')}
                        </Button>
                    </div>
                </Panel>
            ) : null}
        </section>
    );
};

const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
    open: 'Open',
    triaged: 'Triaged',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    archived: 'Archived',
};

const lifecycleStatusFromValue = (
    value: string,
): LifecycleStatus | undefined => {
    const normalized = value === 'in-progress' ? 'in_progress' : value;
    return [
        'open',
        'triaged',
        'assigned',
        'in_progress',
        'resolved',
        'archived',
    ].includes(normalized)
        ? (normalized as LifecycleStatus)
        : undefined;
};

const LIFECYCLE_STATUS_TONES: Record<
    string,
    'neutral' | 'info' | 'success' | 'danger'
> = {
    open: 'danger',
    triaged: 'info',
    assigned: 'info',
    in_progress: 'info',
    resolved: 'success',
    archived: 'neutral',
};

interface StatusTimelineProps {
    timeline: readonly FeedStatusTransition[];
}

const StatusTimeline = ({ timeline }: StatusTimelineProps) => {
    const { t, fmt } = useLocale();
    if (timeline.length === 0) {
        return (
            <p className='text-xs text-mh-textSoft'>
                {t('safety.noTransitions')}
            </p>
        );
    }

    return (
        <ol className='space-y-2'>
            {timeline.map((entry, index) => (
                <li
                    key={`${entry.timestamp}-${index}`}
                    className='flex items-start gap-3 border-l-2 border-mh-borderSoft pl-3'
                >
                    <div className='flex-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                            <Badge
                                tone={
                                    LIFECYCLE_STATUS_TONES[entry.from] ??
                                    'neutral'
                                }
                            >
                                {LIFECYCLE_STATUS_LABELS[entry.from] ??
                                    entry.from}
                            </Badge>
                            <span className='text-xs text-mh-textSoft'>
                                {'->'}
                            </span>
                            <Badge
                                tone={
                                    LIFECYCLE_STATUS_TONES[entry.to] ??
                                    'neutral'
                                }
                            >
                                {LIFECYCLE_STATUS_LABELS[entry.to] ?? entry.to}
                            </Badge>
                        </div>
                        <p className='mt-1 text-xs text-mh-textSoft'>
                            {t('safety.transitionAt', {
                                role: entry.actorRole,
                                did: entry.actorDid,
                                date: fmt.longDate(entry.timestamp),
                            })}
                        </p>
                        {entry.reason ? (
                            <p className='mt-1 text-xs text-mh-textMuted'>
                                {t('safety.reason', { reason: entry.reason })}
                            </p>
                        ) : null}
                    </div>
                </li>
            ))}
        </ol>
    );
};

interface FeedRouteProps {
    discoveryState: DiscoveryFilterState;
    onPatchDiscovery: (patch: Partial<DiscoveryFilterState>) => void;
    feedRecords: readonly FeedRecordEnvelope[];
    isLoading: boolean;
    errorMessage?: string;
    dataOrigin: ApiDataOrigin;
    onRetry: () => void;
    hasNextPage: boolean;
    total: number;
    onLoadMore: () => void;
    publicSyncFailure?: PublicSyncFailure;
    publicSyncRetrying: boolean;
    onRetryPublicSync: () => void;
    onNavigate: (route: AppRoute) => void;
    onOpenChat: (record: FeedRecordEnvelope, surface: ChatEntrySurface) => void;
    onUpdateCard: (id: string, patch: Partial<Omit<FeedAidCard, 'id'>>) => void;
    onReplaceRecord: (record: FeedRecordEnvelope) => void;
    onDeleteRecord: (aidPostUri: string) => void;
    onTransition?: (
        id: string,
        postUri: string,
        targetStatus: LifecycleStatus,
    ) => void;
    currentUserDid?: string;
}

interface PublicSyncFailure {
    postUri: string;
    expectedCid: string;
    updatedAt: string;
    message: string;
}

const replaceRecordFromAtResult = (
    records: readonly FeedRecordEnvelope[],
    result: AtAidPostResult,
): FeedRecordEnvelope[] =>
    records.map((record) =>
        record.aidPostUri === result.uri
            ? {
                  ...record,
                  cid: result.cid,
                  card: {
                      ...record.card,
                      status: result.record.status,
                      updatedAt:
                          result.record.updatedAt ?? result.record.createdAt,
                  },
              }
            : record,
    );

const SafetyActions = ({
    record,
    position,
    total,
}: {
    record: FeedRecordEnvelope;
    position: number;
    total: number;
}) => {
    const { t } = useLocale();
    const [mode, setMode] = useState<'report' | 'block'>();
    const [reason, setReason] = useState<AidPostReportReason>('other');
    const [details, setDetails] = useState('');
    const [pending, setPending] = useState(false);
    const [notice, setNotice] = useState<string>();
    const [error, setError] = useState<string>();

    const submitReport = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPending(true);
        setNotice(undefined);
        setError(undefined);
        const result = await reportAidPostViaApi({
            subjectUri: record.aidPostUri,
            reason,
            ...(details.trim() ? { details: details.trim() } : {}),
        });
        setPending(false);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setNotice(
            result.data.created
                ? t('safety.reportSubmitted')
                : t('safety.reportDuplicate'),
        );
        setMode(undefined);
        setDetails('');
    };

    const confirmBlock = async () => {
        setPending(true);
        setNotice(undefined);
        setError(undefined);
        const result = await blockUserViaApi({
            subjectDid: record.recipientDid,
            reason: t('safety.blockedReason'),
        });
        setPending(false);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setNotice(
            result.data.created
                ? t('safety.authorBlocked')
                : t('safety.authorAlreadyBlocked'),
        );
        setMode(undefined);
    };

    return (
        <div className='mt-3 border-t-2 border-mh-borderSoft pt-3'>
            <div className='flex flex-wrap gap-2'>
                <Button
                    type='button'
                    variant='neutral'
                    className='px-3 py-1 text-xs'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.reportLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    onClick={() => setMode('report')}
                >
                    {t('safety.report')}
                </Button>
                <Button
                    type='button'
                    variant='neutral'
                    className='px-3 py-1 text-xs'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.blockLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    onClick={() => setMode('block')}
                >
                    {t('safety.block')}
                </Button>
            </div>

            {mode === 'report' ? (
                <form className='mt-3 space-y-3' onSubmit={submitReport}>
                    <label className='block text-xs font-bold'>
                        {t('safety.reportReason')}
                        <select
                            name='reportReason'
                            autoComplete='off'
                            className='mt-1 block w-full border-2 border-mh-border bg-mh-surface p-2'
                            value={reason}
                            onChange={(event) =>
                                setReason(
                                    event.target.value as AidPostReportReason,
                                )
                            }
                        >
                            <option value='spam'>{t('safety.spam')}</option>
                            <option value='abuse'>{t('safety.abuse')}</option>
                            <option value='fraud'>{t('safety.fraud')}</option>
                            <option value='other'>{t('safety.other')}</option>
                        </select>
                    </label>
                    <label className='block text-xs font-bold'>
                        {t('safety.details')}
                        <textarea
                            name='reportDetails'
                            autoComplete='off'
                            className='mt-1 block min-h-24 w-full border-2 border-mh-border bg-mh-surface p-2'
                            maxLength={1000}
                            value={details}
                            onChange={(event) => setDetails(event.target.value)}
                        />
                    </label>
                    <div className='flex flex-wrap gap-2'>
                        <Button type='submit' disabled={pending}>
                            {pending
                                ? t('safety.submitting')
                                : t('safety.submit')}
                        </Button>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => setMode(undefined)}
                            disabled={pending}
                        >
                            {t('safety.cancel')}
                        </Button>
                    </div>
                </form>
            ) : mode === 'block' ? (
                <div
                    role='alertdialog'
                    aria-label={t('safety.confirmBlockLabel')}
                    className='mh-alert mt-3'
                >
                    <p className='text-sm font-bold'>
                        {t('safety.confirmBlock')}
                    </p>
                    <p className='mt-1 text-xs'>{t('safety.blockPrivacy')}</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Button
                            type='button'
                            onClick={() => void confirmBlock()}
                            disabled={pending}
                        >
                            {pending
                                ? t('safety.blocking')
                                : t('safety.confirmBlockLabel')}
                        </Button>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => setMode(undefined)}
                            disabled={pending}
                        >
                            {t('safety.cancel')}
                        </Button>
                    </div>
                </div>
            ) : null}

            {notice ? (
                <p
                    role='status'
                    className='mt-2 text-xs font-bold text-mh-success'
                >
                    {notice}
                </p>
            ) : null}
            {error ? (
                <p role='alert' className='mh-alert mt-2 text-xs font-bold'>
                    {error}
                </p>
            ) : null}
        </div>
    );
};

const OwnerRecordActions = ({
    record,
    position,
    total,
    onReplaceRecord,
    onDeleteRecord,
}: {
    record: FeedRecordEnvelope;
    position: number;
    total: number;
    onReplaceRecord: (record: FeedRecordEnvelope) => void;
    onDeleteRecord: (aidPostUri: string) => void;
}) => {
    const { t } = useLocale();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [pending, setPending] = useState<'close' | 'delete'>();
    const [notice, setNotice] = useState<string>();
    const [error, setError] = useState<string>();

    const closeRecord = async () => {
        if (!record.cid) return;
        setPending('close');
        setError(undefined);
        const result = await closeAtAidPostViaApi({
            uri: record.aidPostUri,
            expectedCid: record.cid,
            updatedAt: nowIso(),
        });
        setPending(undefined);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        onReplaceRecord({
            ...record,
            cid: result.data.cid,
            card: {
                ...record.card,
                status: 'closed',
                updatedAt:
                    result.data.record.updatedAt ??
                    result.data.record.createdAt,
            },
        });
        setNotice(t('safety.requestClosed'));
    };

    const deleteRecord = async () => {
        if (!record.cid) return;
        setPending('delete');
        setError(undefined);
        const result = await deleteAtAidPostViaApi({
            uri: record.aidPostUri,
            expectedCid: record.cid,
        });
        setPending(undefined);
        if (!result.ok) {
            setError(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        onDeleteRecord(record.aidPostUri);
    };

    return (
        <div className='mt-3 border-t-2 border-mh-borderSoft pt-3'>
            <div className='flex flex-wrap gap-2'>
                <Button
                    type='button'
                    variant='neutral'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.closeLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    disabled={
                        !record.cid ||
                        record.card.status === 'closed' ||
                        pending !== undefined
                    }
                    onClick={() => void closeRecord()}
                >
                    {pending === 'close'
                        ? t('safety.closing')
                        : t('safety.close')}
                </Button>
                <Button
                    type='button'
                    variant='neutral'
                    aria-label={t('safety.positionedAction', {
                        action: t('safety.deleteLabel', { title: record.card.title }),
                        position,
                        total,
                    })}
                    disabled={!record.cid || pending !== undefined}
                    onClick={() => setConfirmDelete(true)}
                >
                    {t('safety.delete')}
                </Button>
            </div>
            {!record.cid ? (
                <p className='mt-2 text-xs text-mh-textMuted'>
                    {t('safety.waitingRevision')}
                </p>
            ) : null}
            {confirmDelete ? (
                <div
                    role='alertdialog'
                    aria-label={t('safety.confirmDeleteLabel')}
                    className='mh-alert mt-3'
                >
                    <p className='text-sm font-bold'>
                        {t('safety.confirmDelete')}
                    </p>
                    <p className='mt-1 text-xs'>{t('safety.deletePrivacy')}</p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                        <Button
                            type='button'
                            onClick={() => void deleteRecord()}
                            disabled={pending !== undefined}
                        >
                            {pending === 'delete'
                                ? t('safety.deleting')
                                : t('safety.confirmDeleteLabel')}
                        </Button>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => setConfirmDelete(false)}
                            disabled={pending !== undefined}
                        >
                            {t('safety.cancel')}
                        </Button>
                    </div>
                </div>
            ) : null}
            {notice ? (
                <p
                    role='status'
                    className='mt-2 text-xs font-bold text-mh-success'
                >
                    {notice}
                </p>
            ) : null}
            {error ? (
                <p role='alert' className='mh-alert mt-2 text-xs font-bold'>
                    {error}
                </p>
            ) : null}
        </div>
    );
};

const FeedRoute = ({
    discoveryState,
    onPatchDiscovery,
    feedRecords,
    isLoading,
    errorMessage,
    dataOrigin,
    onRetry,
    hasNextPage,
    total,
    onLoadMore,
    publicSyncFailure,
    publicSyncRetrying,
    onRetryPublicSync,
    onNavigate,
    onOpenChat,
    onUpdateCard,
    onReplaceRecord,
    onDeleteRecord,
    currentUserDid,
}: FeedRouteProps) => {
    const { t, fmt } = useLocale();
    const paginationFocus = usePaginationFocus({
        itemCount: feedRecords.length,
        isLoading,
        hasNextPage,
        announce: useCallback(
            (start: number, end: number) =>
                String(t('discovery.loadedRange', { start, end })),
            [t],
        ),
    });
    const [expandedTimelineId, setExpandedTimelineId] = useState<
        string | undefined
    >();
    const cards = useMemo(
        () => feedRecords.map((record) => record.card),
        [feedRecords],
    );
    const feedView = useMemo(
        () => buildFeedViewModel(cards, discoveryState),
        [cards, discoveryState],
    );

    const presentationById = useMemo(
        () =>
            new Map(
                feedView.presentations.map((presentation) => [
                    presentation.id,
                    presentation,
                ]),
            ),
        [feedView.presentations],
    );

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('feed.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('feed.description')}
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
                        {feedRecords.length > 0 ? (
                            <p>{t('feed.staleResults')}</p>
                        ) : null}
                        <Button
                            type='button'
                            variant='neutral'
                            className='mt-2 px-3 py-1 text-xs'
                            onClick={onRetry}
                        >
                            {t('feed.retryDiscovery')}
                        </Button>
                    </div>
                ) : null}
                {publicSyncFailure ? (
                    <div
                        role='alert'
                        className='mh-alert mt-3 text-xs font-bold'
                    >
                        <p>
                            {t('feed.privateSyncIssue', {
                                message: publicSyncFailure.message,
                            })}
                        </p>
                        <Button
                            type='button'
                            variant='neutral'
                            className='mt-2 px-3 py-1 text-xs'
                            disabled={publicSyncRetrying}
                            onClick={onRetryPublicSync}
                        >
                            {publicSyncRetrying
                                ? t('feed.retryingSync')
                                : t('feed.retrySync')}
                        </Button>
                    </div>
                ) : null}
            </header>

            <DiscoveryFiltersPanel
                idPrefix='feed'
                state={discoveryState}
                onPatch={onPatchDiscovery}
            />

            <Card title={String(t('feed.liveRequestFeedTitle'))}>
                {isLoading && feedRecords.length === 0 ? (
                    <ul className='space-y-4' aria-live='polite'>
                        {Array.from({ length: 3 }).map((_, index) => (
                            <li
                                key={`feed-skeleton-${index}`}
                                className='mh-record-card p-4'
                            >
                                <div className='mh-skeleton h-5 w-2/3' />
                                <div className='mh-skeleton mt-2 h-3 w-full' />
                                <div className='mh-skeleton mt-2 h-3 w-5/6' />
                                <div className='mt-4 flex gap-2'>
                                    <div className='mh-skeleton h-8 w-28' />
                                    <div className='mh-skeleton h-8 w-32' />
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : feedView.cards.length === 0 ? (
                    <div className='space-y-3'>
                        <p>{t('feed.noRequestsMatch')}</p>
                        <div className='flex flex-wrap gap-2'>
                            <Button
                                variant='neutral'
                                className='px-3 py-1 text-xs'
                                onClick={() => {
                                    onPatchDiscovery({
                                        feedTab: 'latest',
                                        text: undefined,
                                        category: undefined,
                                        status: undefined,
                                        minUrgency: undefined,
                                        center: undefined,
                                        radiusMeters: undefined,
                                        since: undefined,
                                    });
                                }}
                            >
                                {t('feed.resetFeedFilters')}
                            </Button>
                            <Button
                                className='px-3 py-1 text-xs'
                                onClick={() => onNavigate('/posting')}
                            >
                                {t('feed.createRequest')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <ul className='space-y-4'>
                        {feedView.cards.map((card, index) => {
                            const record = feedRecords.find(
                                (candidate) => candidate.card.id === card.id,
                            );
                            const presentation = presentationById.get(card.id);

                            return (
                                <li
                                    key={card.id}
                                    className='mh-record-card p-4'
                                >
                                    <div className='flex flex-wrap items-start justify-between gap-2'>
                                        <p className='text-base font-bold text-mh-text'>
                                            {record ? <a className='underline' href={`/requests/view?uri=${encodeURIComponent(record.aidPostUri)}`}>{card.title}</a> : card.title}
                                        </p>
                                        <div className='flex flex-wrap gap-2'>
                                            {presentation ? (
                                                <>
                                                    <Badge
                                                        tone={
                                                            presentation
                                                                .statusBadge
                                                                .tone
                                                        }
                                                    >
                                                        {
                                                            presentation
                                                                .statusBadge
                                                                .label
                                                        }
                                                    </Badge>
                                                    <Badge
                                                        tone={
                                                            presentation
                                                                .urgencyBadge
                                                                .tone
                                                        }
                                                    >
                                                        {
                                                            presentation
                                                                .urgencyBadge
                                                                .label
                                                        }
                                                    </Badge>
                                                    {presentation.lifecycleBadge ? (
                                                        <Badge
                                                            tone={
                                                                presentation
                                                                    .lifecycleBadge
                                                                    .tone
                                                            }
                                                        >
                                                            {
                                                                presentation
                                                                    .lifecycleBadge
                                                                    .label
                                                            }
                                                        </Badge>
                                                    ) : null}
                                                    {record?.recordOrigin ===
                                                    'synthetic' ? (
                                                        <Badge tone='info'>
                                                            {t(
                                                                'feed.synthetic',
                                                            )}
                                                        </Badge>
                                                    ) : record?.recordOrigin ===
                                                      'sourced-public' ? (
                                                        <Badge tone='info'>
                                                            {t(
                                                                'feed.publicSource',
                                                            )}
                                                        </Badge>
                                                    ) : null}
                                                </>
                                            ) : null}
                                        </div>
                                    </div>

                                    <p className='mt-2 text-sm text-mh-textMuted'>
                                        {card.description}
                                    </p>
                                    <p className='mt-1 text-xs text-mh-textSoft'>
                                        {t('feed.updatedAt', {
                                            date: fmt.longDate(card.updatedAt),
                                        })}
                                    </p>

                                    {webDataMode !== 'fixture' && record && <RequestLifecycleActions record={record} onRefresh={onRetry} />}

                                    <div className='mt-4 flex flex-wrap gap-2'>
                                        {record && webDataMode === 'fixture' ? (
                                            <Button
                                                className='px-3 py-1 text-xs'
                                                onClick={() =>
                                                    onOpenChat(record, 'feed')
                                                }
                                            >
                                                {t('feed.contactHelper')}
                                            </Button>
                                        ) : null}

                                        {dataOrigin === 'fixture' ? (
                                            <Button
                                                variant='secondary'
                                                className='px-3 py-1 text-xs'
                                                onClick={() =>
                                                    onUpdateCard(card.id, {
                                                        urgency: Math.min(
                                                            5,
                                                            card.urgency + 1,
                                                        ) as 1 | 2 | 3 | 4 | 5,
                                                        updatedAt: nowIso(),
                                                    })
                                                }
                                                disabled={card.urgency >= 5}
                                            >
                                                {t('feed.escalateUrgency')}
                                            </Button>
                                        ) : null}

                                        {/* Timeline toggle */}
                                        {card.timeline &&
                                        card.timeline.length > 0 ? (
                                            <Button
                                                variant='neutral'
                                                className='px-3 py-1 text-xs'
                                                aria-label={t('safety.positionedAction', {
                                                    action: t('feed.timelineFor', {
                                                        title: card.title,
                                                        count: card.timeline.length,
                                                    }),
                                                    position: index + 1,
                                                    total: feedView.cards.length,
                                                })}
                                                onClick={() =>
                                                    setExpandedTimelineId(
                                                        (current) =>
                                                            current === card.id
                                                                ? undefined
                                                                : card.id,
                                                    )
                                                }
                                            >
                                                {expandedTimelineId === card.id
                                                    ? t('feed.hideTimeline')
                                                    : t('feed.timeline', {
                                                          count: card.timeline
                                                              .length,
                                                      })}
                                            </Button>
                                        ) : null}
                                    </div>

                                    {record &&
                                    currentUserDid &&
                                    currentUserDid !== record.recipientDid ? (
                                        <SafetyActions
                                            record={record}
                                            position={index + 1}
                                            total={feedView.cards.length}
                                        />
                                    ) : null}
                                    {record &&
                                    currentUserDid === record.recipientDid ? (
                                        <OwnerRecordActions
                                            record={record}
                                            position={index + 1}
                                            total={feedView.cards.length}
                                            onReplaceRecord={onReplaceRecord}
                                            onDeleteRecord={onDeleteRecord}
                                        />
                                    ) : null}

                                    {/* Expanded timeline panel */}
                                    {expandedTimelineId === card.id &&
                                    card.timeline ? (
                                        <div className='mt-4 border-t-2 border-mh-borderSoft pt-4'>
                                            <p className='mb-3 text-xs font-bold uppercase tracking-[0.12em] text-mh-textMuted'>
                                                {t('feed.auditTimeline')}
                                            </p>
                                            <StatusTimeline
                                                timeline={card.timeline}
                                            />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
                <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='mt-3 text-sm text-mh-textMuted' role='status'>
                    {t('discovery.loadedCount', { loaded: feedRecords.length, total })}
                </p>
                <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
                {hasNextPage ? (
                    <Button ref={paginationFocus.loadMoreRef} className='mt-3' onClick={() => paginationFocus.loadMore(onLoadMore)} disabled={isLoading}>
                        {t('discovery.loadMore')}
                    </Button>
                ) : null}
            </Card>
        </section>
    );
};

interface PostingRouteProps {
    location: {
        center: { lat: number; lng: number };
        areaLabel: string;
    };
    onCreateRecord: (record: FeedRecordEnvelope) => void;
    onNavigate: (route: AppRoute) => void;
    onCreateViaApi: (input: {
        draft: NormalizedAidPostingDraft;
        rkey: string;
        now: string;
    }) => Promise<
        { ok: true; data: FeedRecordEnvelope } | { ok: false; error: string }
    >;
}

const PostingRoute = ({
    location,
    onCreateRecord,
    onNavigate,
    onCreateViaApi,
}: PostingRouteProps) => {
    const { t } = useLocale();
    const [savedDraft] = useState(() => { try { return loadPostingDraft(window.sessionStorage); } catch { return undefined; } });
    const [title, setTitle] = useState(savedDraft?.title ?? '');
    const [description, setDescription] = useState(() => {
        const name = new URLSearchParams(window.location.search).get('resourceName');
        return savedDraft?.description ?? (name ? t('handoff.resourceRequestContext', { name: name.slice(0, 200) }) : '');
    });
    const [category, setCategory] = useState<AidPostingCategory>(savedDraft?.category ?? 'food');
    const [urgency, setUrgency] = useState<1 | 2 | 3 | 4 | 5>(savedDraft?.urgency ?? 4);
    const [tagsText, setTagsText] = useState(savedDraft?.tagsText ?? '');
    const [startAt, setStartAt] = useState(savedDraft?.startAt ?? '');
    const [endAt, setEndAt] = useState(savedDraft?.endAt ?? '');
    const [errors, setErrors] = useState<readonly PostingValidationIssue[]>([]);
    const [successMessage, setSuccessMessage] = useState<string>();
    const [apiError, setApiError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
    const [attachmentStatus, setAttachmentStatus] = useState<string>();
    const [projectionNotice, setProjectionNotice] = useState<string>();
    const [projectionFailed, setProjectionFailed] = useState(false);
    const [projectionPostUri, setProjectionPostUri] = useState<string>();
    const submissionRef = useRef<{ signature: string; rkey: string; now: string; record?: FeedRecordEnvelope; uploaded: number } | undefined>(undefined);
    useEffect(() => {
        try { savePostingDraft(window.sessionStorage, { title, description, category, urgency, tagsText, startAt, endAt }); } catch { /* Optional browser storage. */ }
    }, [title, description, category, urgency, tagsText, startAt, endAt]);
    const projectionTimerRef = useRef<number | undefined>(undefined);

    useEffect(
        () => () => {
            if (projectionTimerRef.current !== undefined) {
                window.clearTimeout(projectionTimerRef.current);
            }
        },
        [],
    );

    const pollProjection = async (postUri: string, attempts = 0) => {
        if (projectionTimerRef.current !== undefined) {
            window.clearTimeout(projectionTimerRef.current);
            projectionTimerRef.current = undefined;
        }
        const lifecycle = await queryAidPostLifecycleViaApi(postUri);
        const receipt = lifecycle.ok ? lifecycle.data.projectionReceipt : undefined;
        if (receipt?.state === 'projected') {
            setProjectionNotice(t('handoff.projectionConfirmed'));
            setProjectionFailed(false);
            return;
        }
        if (receipt?.state === 'failed') {
            setProjectionNotice(t('handoff.projectionFailed'));
            setProjectionFailed(true);
            return;
        }
        setProjectionNotice(t('handoff.projectionPending'));
        setProjectionFailed(attempts >= 4);
        if (attempts < 4) {
            const seconds = Math.max(1, Math.min(receipt?.retryAfterSeconds ?? 5, 30));
            projectionTimerRef.current = window.setTimeout(() => {
                void pollProjection(postUri, attempts + 1);
            }, seconds * 1000);
        }
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setApiError(undefined);
        setProjectionNotice(undefined);
        setProjectionFailed(false);

        const draft = {
            title,
            description,
            category,
            urgency,
            accessibilityTags: parseCommaList(tagsText),
            location: {
                lat: location.center.lat,
                lng: location.center.lng,
                precisionMeters: PUBLIC_MIN_PRECISION_KM * 1000,
            },
            timeWindow:
                startAt.length > 0 && endAt.length > 0
                    ? {
                          startAt: new Date(startAt).toISOString(),
                          endAt: new Date(endAt).toISOString(),
                      }
                    : undefined,
            attachments: attachmentFiles.map((file) => ({
                filename: file.name,
                mimeType: file.type,
                sizeBytes: file.size,
                previewUrl: '',
            })),
        };

        const validation = validatePostingDraft(draft);
        setErrors(validation.errors);

        if (!validation.ok || !validation.normalizedDraft) {
            setSuccessMessage(undefined);
            return;
        }

        const signature = JSON.stringify(validation.normalizedDraft);
        if (submissionRef.current?.signature !== signature) {
            submissionRef.current = { signature, rkey: crypto.randomUUID(), now: nowIso(), uploaded: 0 };
        }
        const submission = submissionRef.current;
        const localId = submission.rkey;
        setIsSubmitting(true);

        try {
            const createResult = submission.record ? { ok: true as const, data: submission.record } : await onCreateViaApi({
                draft: validation.normalizedDraft,
                rkey: localId,
                now: submission.now,
            });

            if (!createResult.ok) {
                setSuccessMessage(undefined);
                setApiError(createResult.error);
                return;
            }

            submission.record = createResult.data;
            try { clearPostingDraft(window.sessionStorage); } catch { /* Optional browser storage. */ }
            onCreateRecord(createResult.data);
            setProjectionPostUri(createResult.data.aidPostUri);
            void pollProjection(createResult.data.aidPostUri);

            let uploaded = submission.uploaded;
            for (const file of attachmentFiles.slice(uploaded)) {
                setAttachmentStatus(
                    `Uploading private attachment ${uploaded + 1} of ${attachmentFiles.length}…`,
                );
                const attachment = await uploadPrivateAttachmentViaApi(
                    file,
                    'aid-post',
                    createResult.data.aidPostUri,
                );
                if (!attachment.ok) {
                    setSuccessMessage(
                        `Created post ${localId}. ${uploaded} attachment(s) were accepted.`,
                    );
                    setApiError(
                        `The request was accepted, but a private attachment upload failed: ${attachment.error}`,
                    );
                    setAttachmentStatus(
                        'Attachment upload stopped. Submit again to retry the remaining files on this request.',
                    );
                    return;
                }
                uploaded += 1;
                submission.uploaded = uploaded;
            }
            setAttachmentFiles([]);
            setAttachmentStatus(
                uploaded > 0
                    ? `${uploaded} private attachment(s) uploaded and queued for malware scanning.`
                    : undefined,
            );
            setSuccessMessage(
                t('posting.publicationPending', { id: localId }),
            );
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('posting.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('posting.description')}
                </p>
            </header>

            <Panel title={String(t('posting.formTitle'))}>
                <form className='space-y-4' onSubmit={handleSubmit}>
                    <div>
                        <label
                            htmlFor='posting-title'
                            className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                        >
                            {t('posting.titleLabel')}
                        </label>
                        <Input
                            id='posting-title'
                            name='title'
                            autoComplete='off'
                            required
                            minLength={1}
                            maxLength={140}
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </div>

                    <div>
                        <label
                            htmlFor='posting-description'
                            className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                        >
                            {t('posting.descriptionLabel')}
                        </label>
                        <textarea
                            id='posting-description'
                            name='description'
                            autoComplete='off'
                            required
                            minLength={1}
                            maxLength={5000}
                            className='mh-input min-h-35 w-full px-3 py-2 text-base'
                            value={description}
                            onChange={(event) =>
                                setDescription(event.target.value)
                            }
                        />
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='posting-category'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                {t('posting.categoryLabel')}
                            </label>
                            <select
                                id='posting-category'
                                name='category'
                                autoComplete='off'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={category}
                                onChange={(event) =>
                                    setCategory(
                                        event.target
                                            .value as AidPostingCategory,
                                    )
                                }
                            >
                                {aidCategories.map((option) => (
                                    <option key={option} value={option}>
                                        {formatLocalizedLabel(t, option)}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label
                                htmlFor='posting-urgency'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                {t('posting.urgencyLabel')}
                            </label>
                            <Input
                                id='posting-urgency'
                                name='urgency'
                                autoComplete='off'
                                type='number'
                                min={1}
                                max={5}
                                value={urgency}
                                onChange={(event) => {
                                    const nextUrgency = Number.parseInt(
                                        event.target.value,
                                        10,
                                    );
                                    if (Number.isNaN(nextUrgency)) {
                                        return;
                                    }
                                    setUrgency(
                                        Math.min(
                                            5,
                                            Math.max(1, nextUrgency),
                                        ) as 1 | 2 | 3 | 4 | 5,
                                    );
                                }}
                            />
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor='posting-tags'
                            className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                        >
                            {t('posting.accessibilityTags')}
                        </label>
                        <Input
                            id='posting-tags'
                            name='accessibilityTags'
                            autoComplete='off'
                            value={tagsText}
                            onChange={(event) =>
                                setTagsText(event.target.value)
                            }
                        />
                    </div>

                    <div className='border-2 border-mh-borderSoft p-3'>
                        <h3 className='font-bold'>{t('posting.approximateArea')}</h3>
                        <p className='mt-2 text-sm text-mh-textMuted'>
                            {t('posting.selectedArea', { area: location.areaLabel })}
                        </p>
                        <p className='mt-1 text-sm text-mh-textMuted'>
                            {t('posting.publicPrecisionSummary')}
                        </p>
                        <Button
                            className='mt-3'
                            type='button'
                            onClick={() => onNavigate('/map')}
                        >
                            {t('posting.changeArea')}
                        </Button>
                    </div>

                    <div className='border-2 border-mh-border bg-mh-surfaceElev p-4'>
                        <h3 className='font-bold'>
                            {t('posting.privacySummary')}
                        </h3>
                        <ul className='mt-2 list-disc space-y-1 pl-5 text-sm text-mh-textMuted'>
                            <li>{t('posting.publicSummary')}</li>
                            <li>{t('posting.privateSummary')}</li>
                            <li>{t('posting.neverSummary')}</li>
                        </ul>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='posting-start-at'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                {t('posting.timeWindowStart')}
                            </label>
                            <Input
                                id='posting-start-at'
                                name='startAt'
                                autoComplete='off'
                                type='datetime-local'
                                value={startAt}
                                onChange={(event) =>
                                    setStartAt(event.target.value)
                                }
                            />
                        </div>
                        <div>
                            <label
                                htmlFor='posting-end-at'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                {t('posting.timeWindowEnd')}
                            </label>
                            <Input
                                id='posting-end-at'
                                name='endAt'
                                autoComplete='off'
                                type='datetime-local'
                                value={endAt}
                                onChange={(event) =>
                                    setEndAt(event.target.value)
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor='posting-attachments'
                            className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                        >
                            {t('posting.attachments')}
                        </label>
                        <Input
                            id='posting-attachments'
                            type='file'
                            multiple
                            accept='image/jpeg,image/png,image/gif,image/webp,application/pdf'
                            onChange={(event) =>
                                setAttachmentFiles(
                                    Array.from(event.target.files ?? []),
                                )
                            }
                        />
                        <p className='mt-1 text-xs text-mh-textSoft'>
                            {t('posting.attachmentHelp')}
                        </p>
                        {attachmentFiles.length ? (
                            <ul className='mt-2 text-xs'>
                                {attachmentFiles.map((file) => (
                                    <li key={`${file.name}-${file.size}`}>
                                        {file.name} ·{' '}
                                        {Math.ceil(file.size / 1024)}{' '}
                                        {t('posting.kilobytes')}
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        {attachmentStatus ? (
                            <p className='mt-2 text-xs font-bold' role='status'>
                                {attachmentStatus}
                            </p>
                        ) : null}
                    </div>

                    {errors.length > 0 ? (
                        <div className='space-y-1'>
                            {errors.map((issue) => (
                                <p
                                    key={`${issue.field}-${issue.message}`}
                                    className='mh-alert text-xs font-bold'
                                >
                                    {issue.field}: {issue.message}
                                </p>
                            ))}
                        </div>
                    ) : null}

                    {successMessage ? (
                        <p className='rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold text-mh-success'>
                            {successMessage}
                        </p>
                    ) : null}

                    {projectionNotice ? (
                        <div
                            className={projectionFailed ? 'mh-alert text-xs font-bold' : 'rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold'}
                            role={projectionFailed ? 'alert' : 'status'}
                            aria-live='polite'
                        >
                            <p>{projectionNotice}</p>
                            <a href='/inbox' className='mt-2 inline-block underline'>{t('myRequests.heading')}</a>
                            {projectionFailed ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    className='mt-2 px-3 py-1 text-xs'
                                    onClick={() => projectionPostUri && void pollProjection(projectionPostUri)}
                                >
                                    {t('discovery.retryProjection')}
                                </Button>
                            ) : null}
                        </div>
                    ) : null}

                    {apiError ? (
                        <p className='mh-alert text-xs font-bold'>
                            {t('posting.unableToPresist', { error: apiError })}
                        </p>
                    ) : null}

                    <div className='flex flex-wrap gap-2'>
                        <Button type='submit' disabled={isSubmitting || Boolean(successMessage && !apiError)}>
                            {isSubmitting
                                ? t('posting.publishing')
                                : t('posting.publishRequest')}
                        </Button>
                        <Button
                            variant='secondary'
                            type='button'
                            onClick={() => onNavigate('/feed')}
                        >
                            {t('posting.openFeed')}
                        </Button>
                    </div>
                </form>
            </Panel>
        </section>
    );
};

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
                            type='button'
                            variant='secondary'
                            className='px-3 py-2 text-xs'
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

const ResourceRoute = ({
    discoveryState,
    onPatchDiscovery,
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
    const [selectedUri, setSelectedUri] = useState<string | undefined>(() => new URLSearchParams(window.location.search).get('resource') ?? undefined);
    const [manageUri, setManageUri] = useState<string>();
    const [selectedResource, setSelectedResource] = useState<ResourceDetail>();
    const [detailError, setDetailError] = useState(false);
    const [detailReload, setDetailReload] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setSelectedResource(undefined); setDetailError(false);
        if (selectedUri) void fetchResourceViaApi(selectedUri, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (result.ok) setSelectedResource(result.data);
            else setDetailError(true);
        });
        return () => controller.abort();
    }, [selectedUri, detailReload]);


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
        ? openResourceDetailPanel(selectedResource ? [selectedResource] : [], selectedUri)
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
                            type='button'
                            variant='neutral'
                            className='mt-2 px-3 py-1 text-xs'
                            onClick={onRetry}
                        >
                            {t('resources.retryDirectory')}
                        </Button>
                    </div>
                ) : null}
            </header>
            {selectedUri && !selectedResource && <Panel title={t('resources.resourceDetailTitle')}>
                <p role={detailError ? 'alert' : 'status'}>{t(detailError ? 'myRequests.resourceUnavailable' : 'myRequests.resourceLoading')}</p>
                {detailError && <Button onClick={() => setDetailReload(value => value + 1)}>{t('handoff.retry')}</Button>}
                <Button variant='neutral' onClick={() => setSelectedUri(undefined)}>{t('resources.close')}</Button>
            </Panel>}
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
                        {selectedResource && <ResourceActions resource={selectedResource} />}
                        <Button
                            variant='neutral'
                            className='px-3 py-1 text-xs'
                            onClick={() => setSelectedUri(undefined)}
                        >
                            {t('resources.close')}
                        </Button>
                    </div>
                </Panel>
            ) : null}

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
                    <Button
                        variant={activeCategory ? 'neutral' : 'secondary'}
                        className='px-3 py-1 text-xs'
                        onClick={() => setActiveCategory(undefined)}
                    >
                        {t('resources.allCategories')}
                    </Button>
                    {resourceCategoryOptions.map((category) => (
                        <Button
                            key={category}
                            variant={
                                activeCategory === category
                                    ? 'secondary'
                                    : 'neutral'
                            }
                            className='px-3 py-1 text-xs'
                            onClick={() =>
                                setActiveCategory((current) =>
                                    current === category ? undefined : category,
                                )
                            }
                        >
                            {formatLocalizedLabel(t, category)}
                        </Button>
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
                            className='px-3 py-1 text-xs'
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
                                        className='px-3 py-1 text-xs'
                                        aria-label={t(
                                            'resources.openDetailsFor',
                                            { name: card.name },
                                        )}
                                        onClick={() => setSelectedUri(card.uri)}
                                    >
                                        {t('resources.openDetails')}
                                    </Button>
                                    {currentUserDid &&
                                    (card.authorDid === currentUserDid ||
                                        card.uri.startsWith(
                                            `at://${currentUserDid}/`,
                                        )) ? (
                                        <Button
                                            variant='neutral'
                                            className='px-3 py-1 text-xs'
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


        </section>
    );
};

const toggleInList = <TValue extends string>(
    list: readonly TValue[],
    value: TValue,
): TValue[] => {
    if (list.includes(value)) {
        return list.filter((item) => item !== value);
    }

    return [...list, value];
};

const LegacyFixtureVolunteerRoute = ({ did }: { did: string }) => {
    const [draft, setDraft] = useState<VolunteerOnboardingDraft>(() => ({
        did,
        displayName: '',
        capabilities: [],
        availability: 'within-24h',
        contactPreference: 'chat-only',
        skills: [],
        availabilityWindows: [],
        preferredCategories: [],
        preferredUrgencies: [],
        maxDistanceKm: 5,
        acceptsLateNight: false,
        checkpoints: {
            identityCheck: 'pending',
            safetyTraining: 'pending',
            communityReference: 'pending',
        },
        notes: '',
    }));
    const [skillsText, setSkillsText] = useState('');
    const [windowsText, setWindowsText] = useState('');
    const [errors, setErrors] = useState<
        readonly VolunteerOnboardingValidationIssue[]
    >([]);
    const [savedSummary, setSavedSummary] =
        useState<ReturnType<typeof summarizeCheckpoints>>();
    const [isVerified, setIsVerified] = useState<boolean>();

    const candidateDraft = useMemo(
        () => ({
            ...draft,
            skills: parseCommaList(skillsText),
            availabilityWindows: parseCommaList(windowsText),
        }),
        [draft, skillsText, windowsText],
    );

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const validation = validateVolunteerOnboardingDraft(candidateDraft);
        setErrors(validation.errors);

        if (!validation.ok) {
            setSavedSummary(undefined);
            setIsVerified(undefined);
            return;
        }

        const payload = buildVolunteerProfileCreatePayload(candidateDraft, {
            now: nowIso(),
        });

        setSavedSummary(payload.checkpointSummary);
        setIsVerified(isVolunteerFullyVerified(candidateDraft.checkpoints));
        setDraft(candidateDraft);
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>Volunteer onboarding</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    Capture capabilities, availability, and verification
                    checkpoints for safe matching.
                </p>
            </header>

            <Panel title='Volunteer profile draft'>
                <form className='space-y-4' onSubmit={handleSubmit}>
                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-did'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                DID
                            </label>
                            <Input
                                id='volunteer-did'
                                value={draft.did}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        did: event.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div>
                            <label
                                htmlFor='volunteer-display-name'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Display name
                            </label>
                            <Input
                                id='volunteer-display-name'
                                value={draft.displayName}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        displayName: event.target.value,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-availability'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Availability
                            </label>
                            <select
                                id='volunteer-availability'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.availability}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        availability: event.target
                                            .value as VolunteerOnboardingDraft['availability'],
                                    }))
                                }
                            >
                                {volunteerAvailabilityOptions.map((option) => (
                                    <option key={option} value={option}>
                                        {formatCategoryLabel(option)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor='volunteer-contact-preference'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Contact preference
                            </label>
                            <select
                                id='volunteer-contact-preference'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.contactPreference}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        contactPreference: event.target
                                            .value as VolunteerOnboardingDraft['contactPreference'],
                                    }))
                                }
                            >
                                {volunteerContactOptions.map((option) => (
                                    <option key={option} value={option}>
                                        {formatCategoryLabel(option)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                            Capabilities
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            {volunteerCapabilityOptions.map((capability) => (
                                <Button
                                    key={capability}
                                    variant={
                                        draft.capabilities.includes(capability)
                                            ? 'secondary'
                                            : 'neutral'
                                    }
                                    className='px-3 py-1 text-xs'
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            capabilities: toggleInList(
                                                current.capabilities,
                                                capability,
                                            ) as VolunteerOnboardingDraft['capabilities'],
                                        }))
                                    }
                                >
                                    {formatCategoryLabel(capability)}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-skills'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Skills (comma-separated)
                            </label>
                            <Input
                                id='volunteer-skills'
                                value={skillsText}
                                onChange={(event) =>
                                    setSkillsText(event.target.value)
                                }
                            />
                        </div>
                        <div>
                            <label
                                htmlFor='volunteer-windows'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Availability windows
                            </label>
                            <Input
                                id='volunteer-windows'
                                value={windowsText}
                                onChange={(event) =>
                                    setWindowsText(event.target.value)
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                            Preferred categories
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            {aidCategories.map((category) => (
                                <Button
                                    key={category}
                                    variant={
                                        draft.preferredCategories.includes(
                                            category,
                                        )
                                            ? 'secondary'
                                            : 'neutral'
                                    }
                                    className='px-3 py-1 text-xs'
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            preferredCategories: toggleInList(
                                                current.preferredCategories,
                                                category,
                                            ) as VolunteerOnboardingDraft['preferredCategories'],
                                        }))
                                    }
                                >
                                    {formatCategoryLabel(category)}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                            Preferred urgencies
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            {urgencyPreferenceOptions.map((urgency) => (
                                <Button
                                    key={urgency}
                                    variant={
                                        draft.preferredUrgencies.includes(
                                            urgency,
                                        )
                                            ? 'secondary'
                                            : 'neutral'
                                    }
                                    className='px-3 py-1 text-xs'
                                    onClick={() =>
                                        setDraft((current) => ({
                                            ...current,
                                            preferredUrgencies: toggleInList(
                                                current.preferredUrgencies,
                                                urgency,
                                            ) as VolunteerOnboardingDraft['preferredUrgencies'],
                                        }))
                                    }
                                >
                                    {formatCategoryLabel(urgency)}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-2'>
                        <div>
                            <label
                                htmlFor='volunteer-distance'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Max distance (km)
                            </label>
                            <Input
                                id='volunteer-distance'
                                type='number'
                                min={1}
                                max={250}
                                value={draft.maxDistanceKm}
                                onChange={(event) => {
                                    const value = Number.parseInt(
                                        event.target.value,
                                        10,
                                    );
                                    if (Number.isNaN(value)) {
                                        return;
                                    }
                                    setDraft((current) => ({
                                        ...current,
                                        maxDistanceKm: value,
                                    }));
                                }}
                            />
                        </div>
                        <div className='flex items-end'>
                            <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                                <input
                                    type='checkbox'
                                    className='h-4 w-4'
                                    checked={draft.acceptsLateNight}
                                    onChange={(event) =>
                                        setDraft((current) => ({
                                            ...current,
                                            acceptsLateNight:
                                                event.target.checked,
                                        }))
                                    }
                                />
                                Accept late-night handoffs
                            </label>
                        </div>
                    </div>

                    <div className='grid gap-4 sm:grid-cols-3'>
                        <div>
                            <label
                                htmlFor='checkpoint-identity'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Identity check
                            </label>
                            <select
                                id='checkpoint-identity'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.checkpoints.identityCheck}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        checkpoints: {
                                            ...current.checkpoints,
                                            identityCheck: event.target
                                                .value as VolunteerOnboardingDraft['checkpoints']['identityCheck'],
                                        },
                                    }))
                                }
                            >
                                {checkpointStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {formatCategoryLabel(status)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor='checkpoint-safety'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Safety training
                            </label>
                            <select
                                id='checkpoint-safety'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.checkpoints.safetyTraining}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        checkpoints: {
                                            ...current.checkpoints,
                                            safetyTraining: event.target
                                                .value as VolunteerOnboardingDraft['checkpoints']['safetyTraining'],
                                        },
                                    }))
                                }
                            >
                                {checkpointStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {formatCategoryLabel(status)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label
                                htmlFor='checkpoint-reference'
                                className='mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-mh-text'
                            >
                                Community reference
                            </label>
                            <select
                                id='checkpoint-reference'
                                className='mh-input w-full px-3 py-2 text-base'
                                value={draft.checkpoints.communityReference}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        checkpoints: {
                                            ...current.checkpoints,
                                            communityReference: event.target
                                                .value as VolunteerOnboardingDraft['checkpoints']['communityReference'],
                                        },
                                    }))
                                }
                            >
                                {checkpointStatusOptions.map((status) => (
                                    <option key={status} value={status}>
                                        {formatCategoryLabel(status)}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {errors.length > 0 ? (
                        <div className='space-y-1'>
                            {errors.map((issue) => (
                                <p
                                    key={`${issue.field}-${issue.message}`}
                                    className='mh-alert text-xs font-bold'
                                >
                                    {issue.field}: {issue.message}
                                </p>
                            ))}
                        </div>
                    ) : null}

                    {savedSummary ? (
                        <div className='rounded-none border-2 border-mh-border bg-mh-surfaceElev p-3'>
                            <div className='flex flex-wrap gap-2'>
                                <Badge tone='success'>
                                    Approved {savedSummary.approved}
                                </Badge>
                                <Badge tone='info'>
                                    Pending {savedSummary.pending}
                                </Badge>
                                <Badge tone='danger'>
                                    Rejected {savedSummary.rejected}
                                </Badge>
                                {isVerified ? (
                                    <Badge tone='success'>Fully verified</Badge>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    <Button type='submit'>Save volunteer profile</Button>
                </form>
            </Panel>
        </section>
    );
};

const emptyVolunteerCommand = (): VolunteerProfileCommandInput => ({
    profile: {
        displayName: '',
        bio: '',
        capabilities: [],
        availability: 'within-24h',
        contactPreference: 'chat-only',
        skills: [],
        languages: ['en'],
    },
    privateProfile: {
        contactEmail: null,
        contactPhone: null,
        availabilityWindows: [],
        matchingPreferences: {
            preferredCategories: ['other'],
            preferredUrgencies: ['medium'],
            maxDistanceKm: 10,
            acceptsLateNight: false,
        },
    },
});

const VolunteerRoute = ({
    did,
    historyVersion,
}: {
    did: string;
    historyVersion: number;
}) => {
    const { t } = useLocale();
    const [profiles, setProfiles] = useState<VolunteerDiscoveryProfile[]>([]);
    const [discoveryStatus, setDiscoveryStatus] = useState(
        t('volunteer.loading'),
    );
    const [searchText, setSearchText] = useState('');
    const [command, setCommand] = useState<VolunteerProfileCommandInput>(
        emptyVolunteerCommand,
    );
    const [owned, setOwned] = useState<AtVolunteerProfileResult>();
    const [skillsText, setSkillsText] = useState('');
    const [languagesText, setLanguagesText] = useState('en');
    const [windowsText, setWindowsText] = useState('');
    const [formStatus, setFormStatus] = useState<string>();
    const [volunteerPage, setVolunteerPage] = useState(() => readPaginationPageFromUrl());
    const volunteerPageRef = useRef(volunteerPage);
    const restoringVolunteerPageRef = useRef(false);
    const lastVolunteerRequestKeyRef = useRef<string | undefined>(undefined);
    const [volunteerHasNextPage, setVolunteerHasNextPage] = useState(false);
    const [volunteerTotal, setVolunteerTotal] = useState(0);
    const [isVolunteerLoading, setIsVolunteerLoading] = useState(false);
    const paginationFocus = usePaginationFocus({
        itemCount: profiles.length,
        isLoading: isVolunteerLoading,
        hasNextPage: volunteerHasNextPage,
        announce: useCallback(
            (start: number, end: number) =>
                String(t('discovery.loadedRange', { start, end })),
            [t],
        ),
    });

    const loadProfiles = useCallback(async (page = 1, force = false) => {
        const requestKey = `${page}\u0000${searchText.trim()}`;
        if (!force && lastVolunteerRequestKeyRef.current === requestKey) return;
        lastVolunteerRequestKeyRef.current = requestKey;
        const previousPage = volunteerPageRef.current;
        if (typeof window !== 'undefined' && page !== previousPage) {
            const params = new URLSearchParams(window.location.search);
            if (page > 1) params.set('page', String(page));
            else params.delete('page');
            const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
            if (!restoringVolunteerPageRef.current) {
                window.history.pushState({}, '', next);
            }
        }
        restoringVolunteerPageRef.current = false;
        volunteerPageRef.current = page;
        setIsVolunteerLoading(true);
        setDiscoveryStatus(t('volunteer.loading'));
        const result = await fetchVolunteerProfilePageViaApi({ searchText }, page);
        if (!result.ok) {
            lastVolunteerRequestKeyRef.current = undefined;
            setIsVolunteerLoading(false);
            setDiscoveryStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setProfiles((current) =>
            page === 1
                ? appendDedupedPage([], result.data.items, (profile) => profile.uri)
                : appendDedupedPage(current, result.data.items, (profile) => profile.uri),
        );
        setVolunteerPage(page);
        setVolunteerHasNextPage(result.data.hasNextPage);
        setVolunteerTotal(result.data.total);
        setIsVolunteerLoading(false);
        setDiscoveryStatus(
            result.data.items.length === 0 && page === 1
                ? t('volunteer.noneFound')
                : t('volunteer.results', { count: result.data.total }),
        );
        const mine = result.data.items.find((profile) => profile.authorDid === did);
        if (!mine || !did) return;
        const ownedResult = await getAtVolunteerProfileViaApi(mine.uri);
        if (!ownedResult.ok) return;
        setOwned(ownedResult.data);
        const record = ownedResult.data.record;
        setCommand({
            profile: {
                displayName: record.displayName,
                bio: record.bio ?? '',
                capabilities: [...record.capabilities],
                availability: record.availability,
                contactPreference: record.contactPreference,
                skills: [...(record.skills ?? [])],
                languages: [...(record.languages ?? [])],
                serviceArea: record.serviceArea,
            },
            privateProfile:
                ownedResult.data.privateProfile ??
                emptyVolunteerCommand().privateProfile,
        });
        setSkillsText((record.skills ?? []).join(', '));
        setLanguagesText((record.languages ?? []).join(', '));
        setWindowsText(
            (ownedResult.data.privateProfile?.availabilityWindows ?? []).join(
                ', ',
            ),
        );
    }, [did, searchText, t]);

    useEffect(() => {
        if (historyVersion > 0) restoringVolunteerPageRef.current = true;
        void loadProfiles(readPaginationPageFromUrl());
    }, [historyVersion, loadProfiles]);

    const updateProfile = (
        patch: Partial<VolunteerProfileCommandInput['profile']>,
    ) =>
        setCommand((current) => ({
            ...current,
            profile: { ...current.profile, ...patch },
        }));

    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const next: VolunteerProfileCommandInput = {
            ...command,
            profile: {
                ...command.profile,
                skills: parseCommaList(skillsText),
                languages: parseCommaList(languagesText),
                serviceArea: command.profile.serviceArea?.areaLabel.trim()
                    ? command.profile.serviceArea
                    : undefined,
            },
            privateProfile: {
                ...command.privateProfile,
                availabilityWindows: parseCommaList(windowsText),
            },
        };
        setFormStatus(t('volunteer.saving'));
        const result = owned
            ? await updateAtVolunteerProfileViaApi({
                  ...next,
                  uri: owned.uri,
                  expectedCid: owned.cid,
              })
            : await createAtVolunteerProfileViaApi(next);
        if (!result.ok) {
            setFormStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setOwned(result.data);
        setCommand(next);
        setFormStatus(
            owned ? t('volunteer.updated') : t('volunteer.published'),
        );
        await loadProfiles(1, true);
    };

    const remove = async () => {
        if (!owned) return;
        setFormStatus(t('volunteer.deleting'));
        const result = await deleteAtVolunteerProfileViaApi({
            uri: owned.uri,
            expectedCid: owned.cid,
        });
        if (!result.ok) {
            setFormStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setOwned(undefined);
        setCommand(emptyVolunteerCommand());
        setSkillsText('');
        setLanguagesText('en');
        setWindowsText('');
        setFormStatus(t('volunteer.deleted'));
        await loadProfiles(1, true);
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>
                    {t('volunteer.profilesHeading')}
                </h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('volunteer.profilesDescription')}
                </p>
            </header>

            <Panel title={t('volunteer.find')}>
                <form
                    className='flex flex-wrap gap-2'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void loadProfiles(1, true);
                    }}
                >
                    <label className='grow text-sm font-bold'>
                        {t('volunteer.searchPublic')}
                        <Input
                            value={searchText}
                            onChange={(event) =>
                                setSearchText(event.target.value)
                            }
                        />
                    </label>
                    <Button type='submit'>{t('volunteer.search')}</Button>
                </form>
                <p
                    className='mt-3 text-sm text-mh-textMuted'
                    role={
                        discoveryStatus.startsWith('Error:')
                            ? 'alert'
                            : 'status'
                    }
                >
                    {discoveryStatus}
                </p>
                <p ref={paginationFocus.loadedCountRef} tabIndex={-1} className='mt-2 text-xs text-mh-textMuted' role='status'>
                    {t('discovery.loadedCount', { loaded: profiles.length, total: volunteerTotal })}
                </p>
                <span className='sr-only' role='status' aria-live='polite'>{paginationFocus.announcement}</span>
                <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                    {profiles.map((profile) => (
                        <Card key={profile.uri} title={profile.displayName}>
                            {profile.recordOrigin === 'synthetic' ? (
                                <Badge tone='info'>
                                    {t('volunteer.synthetic')}
                                </Badge>
                            ) : profile.recordOrigin === 'sourced-public' ? (
                                <Badge tone='info'>
                                    {t('volunteer.publicSource')}
                                </Badge>
                            ) : null}
                            <p className='text-sm'>{profile.bio}</p>
                            <p className='mt-2 text-xs text-mh-textMuted'>
                                {profile.capabilities.join(', ')} ·{' '}
                                {profile.availability}
                            </p>
                            <p className='mt-1 text-xs text-mh-textMuted'>
                                {t('volunteer.languages', {
                                    languages:
                                        profile.languages.join(', ') ||
                                        t('volunteer.notListed'),
                                })}
                            </p>
                            {profile.serviceArea ? (
                                <p className='mt-1 text-xs text-mh-textMuted'>
                                    {t('volunteer.serviceArea', {
                                        area: profile.serviceArea.areaLabel,
                                    })}
                                    {profile.serviceArea.noPermanentAddress
                                        ? ` · ${t('volunteer.noPermanentAddressShort')}`
                                        : ''}
                                </p>
                            ) : null}
                        </Card>
                    ))}
                </div>
                {volunteerHasNextPage ? (
                    <Button
                        ref={paginationFocus.loadMoreRef}
                        type='button'
                        variant='neutral'
                        className='mt-4'
                        disabled={isVolunteerLoading}
                        onClick={() =>
                            paginationFocus.loadMore(() => {
                                void loadProfiles(volunteerPage + 1);
                            })
                        }
                    >
                        {t('discovery.loadMore')}
                    </Button>
                ) : null}
            </Panel>

            {did ? (
                <Panel
                    title={
                        owned ? t('volunteer.manage') : t('volunteer.create')
                    }
                >
                    <form className='space-y-4' onSubmit={save}>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('volunteer.displayNameLabel')}
                                <Input
                                    value={command.profile.displayName}
                                    onChange={(event) =>
                                        updateProfile({
                                            displayName: event.target.value,
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.availabilityLabel')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={command.profile.availability}
                                    onChange={(event) =>
                                        updateProfile({
                                            availability: event.target
                                                .value as VolunteerProfileCommandInput['profile']['availability'],
                                        })
                                    }
                                >
                                    {volunteerAvailabilityOptions.map(
                                        (value) => (
                                            <option key={value} value={value}>
                                                {formatLocalizedLabel(t, value)}
                                            </option>
                                        ),
                                    )}
                                </select>
                            </label>
                        </div>
                        <label className='block text-sm font-bold'>
                            {t('volunteer.publicBio')}
                            <textarea
                                className='mh-input mt-1 min-h-24 w-full px-3 py-2'
                                value={command.profile.bio ?? ''}
                                onChange={(event) =>
                                    updateProfile({ bio: event.target.value })
                                }
                            />
                        </label>
                        <fieldset>
                            <legend className='text-sm font-bold'>
                                {t('volunteer.publicCapabilities')}
                            </legend>
                            <div className='mt-2 flex flex-wrap gap-2'>
                                {volunteerCapabilityOptions.map((value) => (
                                    <label key={value} className='text-sm'>
                                        <input
                                            type='checkbox'
                                            checked={command.profile.capabilities.includes(
                                                value,
                                            )}
                                            onChange={() =>
                                                updateProfile({
                                                    capabilities: toggleInList(
                                                        command.profile
                                                            .capabilities,
                                                        value,
                                                    ) as VolunteerProfileCommandInput['profile']['capabilities'],
                                                })
                                            }
                                        />{' '}
                                        {formatLocalizedLabel(t, value)}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('volunteer.publicSkills')}
                                <Input
                                    value={skillsText}
                                    onChange={(event) =>
                                        setSkillsText(event.target.value)
                                    }
                                    placeholder={t(
                                        'volunteer.skillsPlaceholder',
                                    )}
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.publicLanguages')}
                                <Input
                                    value={languagesText}
                                    onChange={(event) =>
                                        setLanguagesText(event.target.value)
                                    }
                                    placeholder={t(
                                        'volunteer.languagesPlaceholder',
                                    )}
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.serviceAreaLabel')}
                                <Input
                                    value={
                                        command.profile.serviceArea
                                            ?.areaLabel ?? ''
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    noPermanentAddress: false,
                                                }),
                                                areaLabel: event.target.value,
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.precision')}
                                <Input
                                    type='number'
                                    min={1}
                                    value={
                                        command.profile.serviceArea
                                            ?.precisionKm ?? 2
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    areaLabel: '',
                                                    noPermanentAddress: false,
                                                }),
                                                precisionKm: Number(
                                                    event.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.latitude')}
                                <Input
                                    type='number'
                                    step='0.01'
                                    value={
                                        command.profile.serviceArea?.latitude ??
                                        ''
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    areaLabel: '',
                                                    noPermanentAddress: false,
                                                }),
                                                precisionKm:
                                                    command.profile.serviceArea
                                                        ?.precisionKm ?? 2,
                                                latitude: Number(
                                                    event.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('volunteer.longitude')}
                                <Input
                                    type='number'
                                    step='0.01'
                                    value={
                                        command.profile.serviceArea
                                            ?.longitude ?? ''
                                    }
                                    onChange={(event) =>
                                        updateProfile({
                                            serviceArea: {
                                                ...(command.profile
                                                    .serviceArea ?? {
                                                    areaLabel: '',
                                                    noPermanentAddress: false,
                                                }),
                                                precisionKm:
                                                    command.profile.serviceArea
                                                        ?.precisionKm ?? 2,
                                                longitude: Number(
                                                    event.target.value,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </label>
                        </div>
                        <label className='block text-sm'>
                            <input
                                type='checkbox'
                                checked={
                                    command.profile.serviceArea
                                        ?.noPermanentAddress ?? false
                                }
                                onChange={(event) =>
                                    updateProfile({
                                        serviceArea: {
                                            ...(command.profile.serviceArea ?? {
                                                areaLabel: '',
                                            }),
                                            noPermanentAddress:
                                                event.target.checked,
                                        },
                                    })
                                }
                            />{' '}
                            {t('volunteer.noPermanentAddress')}
                        </label>
                        <Card title={t('volunteer.privateDetails')}>
                            <div className='grid gap-3 sm:grid-cols-2'>
                                <label className='text-sm font-bold'>
                                    {t('volunteer.privateEmail')}
                                    <Input
                                        type='email'
                                        value={
                                            command.privateProfile
                                                .contactEmail ?? ''
                                        }
                                        onChange={(event) =>
                                            setCommand((current) => ({
                                                ...current,
                                                privateProfile: {
                                                    ...current.privateProfile,
                                                    contactEmail:
                                                        event.target.value ||
                                                        null,
                                                },
                                            }))
                                        }
                                    />
                                </label>
                                <label className='text-sm font-bold'>
                                    {t('volunteer.privateWindows')}
                                    <Input
                                        value={windowsText}
                                        onChange={(event) =>
                                            setWindowsText(event.target.value)
                                        }
                                    />
                                </label>
                            </div>
                        </Card>
                        <div className='flex flex-wrap items-center gap-2'>
                            <Button type='submit'>
                                {owned
                                    ? t('volunteer.save')
                                    : t('volunteer.publish')}
                            </Button>
                            {owned ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    onClick={() => void remove()}
                                >
                                    {t('volunteer.delete')}
                                </Button>
                            ) : null}
                            {formStatus ? (
                                <span
                                    role={
                                        formStatus.startsWith('Error:')
                                            ? 'alert'
                                            : 'status'
                                    }
                                    className='text-sm'
                                >
                                    {formStatus}
                                </span>
                            ) : null}
                        </div>
                    </form>
                </Panel>
            ) : (
                <Panel title={t('volunteer.signIn')}>
                    <p>{t('volunteer.signInHelp')}</p>
                </Panel>
            )}
        </section>
    );
};

const VerificationRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [workspace, setWorkspace] = useState<VerificationWorkspace>();
    const [review, setReview] = useState<VerificationReviewQueue>();
    const [attachments, setAttachments] = useState<PrivateAttachment[]>([]);
    const evidenceFileRef = useRef<HTMLInputElement>(null);
    const [accessUrls, setAccessUrls] = useState<Record<string, string>>({});
    const [exactReview, setExactReview] = useState<ExactAddressRequest[]>();
    const [status, setStatus] = useState(t('verification.loading'));
    const [subjectType, setSubjectType] =
        useState<VerificationSubjectType>('volunteer');
    const [organizationId, setOrganizationId] = useState('');
    const [resourceUri, setResourceUri] = useState('');
    const [evidenceLabel, setEvidenceLabel] = useState('');
    const [evidenceIssuer, setEvidenceIssuer] = useState('');
    const [privateNotes, setPrivateNotes] = useState('');
    const [attachmentId, setAttachmentId] = useState('');
    const [appealApplicationId, setAppealApplicationId] = useState('');
    const [appealReason, setAppealReason] = useState('');
    const [streetAddress, setStreetAddress] = useState('');
    const [latitude, setLatitude] = useState('');
    const [longitude, setLongitude] = useState('');
    const [confidentialFacility, setConfidentialFacility] = useState(false);
    const [reviewReason, setReviewReason] = useState(
        'Evidence reviewed against the verification policy.',
    );
    const loadSequence = useRef(0);

    const load = useCallback(async () => {
        if (!did) return;
        const sequence = ++loadSequence.current;
        setStatus(t('verification.loading'));
        const [mine, privateFiles] = await Promise.all([
            fetchVerificationWorkspaceViaApi(),
            fetchPrivateAttachmentsViaApi(),
        ]);
        if (sequence !== loadSequence.current) return;
        if (!mine.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setWorkspace(mine.data);
        if (privateFiles.ok) {
            setAttachments(privateFiles.data);
        } else {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setStatus(t('verification.loaded'));

        const [verificationQueue, exactQueue] = await Promise.all([
            fetchVerificationReviewQueueViaApi(),
            fetchExactAddressReviewQueueViaApi(),
        ]);
        if (sequence !== loadSequence.current) return;
        setReview(verificationQueue.ok ? verificationQueue.data : undefined);
        setExactReview(exactQueue.ok ? exactQueue.data : undefined);
    }, [did, t]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!did) {
        return (
            <Panel title={t('verification.signIn')}>
                <p className='text-sm text-mh-textMuted'>
                    {t('verification.signInHelp')}
                </p>
                <a className='mh-text-link mt-3 inline-block' href='/login'>
                    {t('verification.signInAction')}
                </a>
            </Panel>
        );
    }

    const submitApplication = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatus(t('verification.submittingApplication'));
        const result = await submitVerificationApplicationViaApi({
            subjectType,
            ...(subjectType !== 'volunteer' ? { organizationId } : {}),
            ...(subjectType === 'resource' ? { resourceUri } : {}),
            evidence: [
                {
                    kind:
                        subjectType === 'volunteer'
                            ? 'identity'
                            : subjectType === 'organization'
                              ? 'organization-registration'
                              : 'service-authorization',
                    label: evidenceLabel,
                    issuer: evidenceIssuer || null,
                    issuedAt: null,
                    attachmentId: attachmentId || null,
                    privateNotes: privateNotes || null,
                },
            ],
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setEvidenceLabel('');
        setEvidenceIssuer('');
        setPrivateNotes('');
        setAttachmentId('');
        await load();
        setStatus(t('verification.applicationSubmitted'));
    };

    const uploadEvidence = async () => {
        const evidenceFile = evidenceFileRef.current?.files?.[0];
        if (!evidenceFile) {
            setStatus(
                `${t('common.error')}: ${t('verification.chooseFileError')}`,
            );
            return;
        }
        setStatus(t('verification.uploading'));
        const result = await uploadPrivateAttachmentViaApi(
            evidenceFile,
            'verification-evidence',
            null,
        );
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        if (evidenceFileRef.current) {
            evidenceFileRef.current.value = '';
        }
        await load();
        setStatus(t('verification.uploaded'));
    };

    const deleteAttachment = async (attachmentIdToDelete: string) => {
        const result =
            await deletePrivateAttachmentViaApi(attachmentIdToDelete);
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        if (attachmentId === attachmentIdToDelete) {
            setAttachmentId('');
        }
        await load();
        setStatus(t('verification.deletionQueued'));
    };

    const prepareAccess = async (attachmentIdToOpen: string) => {
        const result =
            await requestPrivateAttachmentAccessViaApi(attachmentIdToOpen);
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setAccessUrls((current) => ({
            ...current,
            [attachmentIdToOpen]: result.data.url,
        }));
        setStatus(t('verification.accessReady'));
    };

    const moderateAttachment = async (
        attachmentIdToReview: string,
        action: 'quarantine' | 'release-for-rescan' | 'delete',
    ) => {
        const result = await reviewPrivateAttachmentViaApi(
            attachmentIdToReview,
            action,
            reviewReason,
        );
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setAccessUrls((current) => {
            const next = { ...current };
            delete next[attachmentIdToReview];
            return next;
        });
        await load();
        setStatus(t('verification.attachmentAction', { action }));
    };

    const submitAppeal = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatus(t('verification.submittingAppeal'));
        const result = await submitVerificationAppealViaApi({
            applicationId: appealApplicationId,
            reason: appealReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setAppealReason('');
        await load();
        setStatus(t('verification.appealSubmitted'));
    };

    const submitExactAddress = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setStatus(t('verification.submittingAddress'));
        const result = await requestExactPublicAddressViaApi({
            organizationId,
            resourceUri,
            streetAddress,
            latitude: Number(latitude),
            longitude: Number(longitude),
            confidentialFacility,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setStreetAddress('');
        await load();
        setStatus(
            confidentialFacility
                ? t('verification.confidentialQuarantined')
                : t('verification.addressSubmitted'),
        );
    };

    const decideApplication = async (
        application: VerificationApplication,
        action: 'approve' | 'deny' | 'revoke' | 'renew',
    ) => {
        setStatus(t('verification.recordingDecision', { action }));
        const result = await decideVerificationViaApi({
            applicationId: application.id,
            action,
            reason: reviewReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        await load();
        setStatus(t('verification.verificationDecision', { action }));
    };

    const decideAppeal = async (
        appeal: VerificationAppeal,
        decision: 'upheld' | 'denied',
    ) => {
        const result = await decideVerificationAppealViaApi({
            appealId: appeal.id,
            decision,
            resolutionNote: reviewReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        await load();
        setStatus(t('verification.appealDecision', { decision }));
    };

    const decideExact = async (
        request: ExactAddressRequest,
        decision: 'approve' | 'reject' | 'revoke',
    ) => {
        const result = await decideExactAddressViaApi({
            requestId: request.id,
            decision,
            reason: reviewReason,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        await load();
        setStatus(t('verification.addressDecision', { decision }));
    };

    const appealable =
        workspace?.applications.filter((application) =>
            ['denied', 'revoked', 'expired'].includes(application.status),
        ) ?? [];

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('verification.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('verification.description')}
                </p>
                <p
                    role={status.startsWith('Error:') ? 'alert' : 'status'}
                    className='mt-3 text-sm font-bold'
                >
                    {status}
                </p>
            </header>

            <Panel title={t('verification.apply')}>
                <form className='space-y-3' onSubmit={submitApplication}>
                    <label className='block text-sm font-bold'>
                        {t('verification.subject')}
                        <select
                            className='mh-input mt-1 w-full px-3 py-2'
                            value={subjectType}
                            onChange={(event) =>
                                setSubjectType(
                                    event.target
                                        .value as VerificationSubjectType,
                                )
                            }
                        >
                            <option value='volunteer'>
                                {t('verification.volunteer')}
                            </option>
                            <option value='organization'>
                                {t('verification.organization')}
                            </option>
                            <option value='resource'>
                                {t('verification.resource')}
                            </option>
                        </select>
                    </label>
                    {subjectType !== 'volunteer' ? (
                        <label className='block text-sm font-bold'>
                            {t('verification.organizationId')}
                            <Input
                                className='mt-1'
                                required
                                value={organizationId}
                                onChange={(event) =>
                                    setOrganizationId(event.target.value)
                                }
                            />
                        </label>
                    ) : null}
                    {subjectType === 'resource' ? (
                        <label className='block text-sm font-bold'>
                            {t('verification.resourceUri')}
                            <Input
                                className='mt-1'
                                required
                                value={resourceUri}
                                onChange={(event) =>
                                    setResourceUri(event.target.value)
                                }
                            />
                        </label>
                    ) : null}
                    <label className='block text-sm font-bold'>
                        {t('verification.evidenceLabel')}
                        <Input
                            className='mt-1'
                            required
                            value={evidenceLabel}
                            onChange={(event) =>
                                setEvidenceLabel(event.target.value)
                            }
                        />
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.issuer')}
                        <Input
                            className='mt-1'
                            value={evidenceIssuer}
                            onChange={(event) =>
                                setEvidenceIssuer(event.target.value)
                            }
                        />
                    </label>
                    <Card title={t('verification.privateFile')}>
                        <p className='mb-2 text-xs text-mh-textMuted'>
                            {t('verification.fileHelp')}
                        </p>
                        <div className='flex flex-wrap items-end gap-2'>
                            <label className='min-w-64 flex-1 text-sm font-bold'>
                                {t('verification.imagePdf')}
                                <input
                                    className='mt-1'
                                    type='file'
                                    ref={evidenceFileRef}
                                    accept='image/jpeg,image/png,image/gif,image/webp,application/pdf'
                                />
                            </label>
                            <Button
                                type='button'
                                variant='secondary'
                                onClick={() => void uploadEvidence()}
                            >
                                {t('verification.upload')}
                            </Button>
                            <Button
                                type='button'
                                variant='neutral'
                                onClick={() => void load()}
                            >
                                {t('verification.refresh')}
                            </Button>
                        </div>
                        {attachments.length ? (
                            <ul className='mt-3 space-y-2'>
                                {attachments.map((attachment) => (
                                    <li
                                        className='mh-record-card text-xs'
                                        key={attachment.id}
                                    >
                                        <div className='flex flex-wrap items-center justify-between gap-2'>
                                            <span>
                                                <strong>
                                                    {attachment.filename}
                                                </strong>{' '}
                                                · {attachment.status} ·{' '}
                                                {Math.ceil(
                                                    attachment.byteSize / 1024,
                                                )}{' '}
                                                {t('verification.kilobytes')}
                                            </span>
                                            <div className='flex flex-wrap gap-2'>
                                                {attachment.status ===
                                                'clean' ? (
                                                    <Button
                                                        type='button'
                                                        variant='neutral'
                                                        className='px-2 py-1 text-xs'
                                                        onClick={() =>
                                                            void prepareAccess(
                                                                attachment.id,
                                                            )
                                                        }
                                                    >
                                                        {t(
                                                            'verification.preview',
                                                        )}
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    type='button'
                                                    variant='neutral'
                                                    className='px-2 py-1 text-xs'
                                                    onClick={() =>
                                                        void deleteAttachment(
                                                            attachment.id,
                                                        )
                                                    }
                                                >
                                                    {t('verification.delete')}
                                                </Button>
                                            </div>
                                        </div>
                                        {accessUrls[attachment.id] ? (
                                            <a
                                                className='mh-text-link mt-2 inline-block'
                                                href={accessUrls[attachment.id]}
                                                target='_blank'
                                                rel='noreferrer'
                                            >
                                                {t('verification.openFile')}
                                            </a>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className='mt-2 text-xs text-mh-textMuted'>
                                {t('verification.noFiles')}
                            </p>
                        )}
                    </Card>
                    <label className='block text-sm font-bold'>
                        {t('verification.cleanFile')}
                        <select
                            className='mh-input mt-1 w-full px-3 py-2'
                            value={attachmentId}
                            onChange={(event) =>
                                setAttachmentId(event.target.value)
                            }
                        >
                            <option value=''>{t('verification.noFile')}</option>
                            {attachments
                                .filter(
                                    (attachment) =>
                                        attachment.status === 'clean' &&
                                        attachment.purpose ===
                                            'verification-evidence',
                                )
                                .map((attachment) => (
                                    <option
                                        key={attachment.id}
                                        value={attachment.id}
                                    >
                                        {attachment.filename}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.notes')}
                        <Input
                            className='mt-1'
                            value={privateNotes}
                            onChange={(event) =>
                                setPrivateNotes(event.target.value)
                            }
                        />
                    </label>
                    <Button type='submit'>{t('verification.submit')}</Button>
                </form>
            </Panel>

            <Panel title={t('verification.status')}>
                {workspace?.applications.length ? (
                    <ul className='space-y-3'>
                        {workspace.applications.map((application) => (
                            <li className='mh-record-card' key={application.id}>
                                <div className='flex flex-wrap justify-between gap-2'>
                                    <strong>
                                        {formatLocalizedLabel(
                                            t,
                                            application.subjectType,
                                        )}
                                    </strong>
                                    <Badge
                                        tone={
                                            application.status === 'approved'
                                                ? 'success'
                                                : application.status ===
                                                    'pending'
                                                  ? 'info'
                                                  : 'danger'
                                        }
                                    >
                                        {formatLocalizedLabel(
                                            t,
                                            application.status,
                                        )}
                                    </Badge>
                                </div>
                                <p className='mt-2 text-xs text-mh-textMuted'>
                                    {t('verification.application', {
                                        id: application.id,
                                    })}
                                </p>
                                {application.expiresAt ? (
                                    <p className='mt-1 text-xs'>
                                        {t('verification.expires', {
                                            date: fmt.longDate(
                                                application.expiresAt,
                                            ),
                                        })}
                                    </p>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className='text-sm text-mh-textMuted'>
                        {t('verification.noApplications')}
                    </p>
                )}
            </Panel>

            {appealable.length ? (
                <Panel title={t('verification.appeal')}>
                    <form className='space-y-3' onSubmit={submitAppeal}>
                        <label className='block text-sm font-bold'>
                            {t('verification.application', { id: '' })}
                            <select
                                className='mh-input mt-1 w-full px-3 py-2'
                                required
                                value={appealApplicationId}
                                onChange={(event) =>
                                    setAppealApplicationId(event.target.value)
                                }
                            >
                                <option value=''>
                                    {t('verification.choose')}
                                </option>
                                {appealable.map((application) => (
                                    <option
                                        key={application.id}
                                        value={application.id}
                                    >
                                        {application.subjectType} —{' '}
                                        {application.status}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className='block text-sm font-bold'>
                            {t('verification.appealReason')}
                            <Input
                                className='mt-1'
                                required
                                value={appealReason}
                                onChange={(event) =>
                                    setAppealReason(event.target.value)
                                }
                            />
                        </label>
                        <Button type='submit'>
                            {t('verification.submitAppeal')}
                        </Button>
                    </form>
                </Panel>
            ) : null}

            <Panel title={t('verification.exactAddress')}>
                <p className='mb-3 text-sm text-mh-textMuted'>
                    {t('verification.exactHelp')}
                </p>
                <form className='space-y-3' onSubmit={submitExactAddress}>
                    <label className='block text-sm font-bold'>
                        {t('verification.organizationId')}
                        <Input
                            className='mt-1'
                            required
                            value={organizationId}
                            onChange={(event) =>
                                setOrganizationId(event.target.value)
                            }
                        />
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.resourceUri')}
                        <Input
                            className='mt-1'
                            required
                            value={resourceUri}
                            onChange={(event) =>
                                setResourceUri(event.target.value)
                            }
                        />
                    </label>
                    <label className='block text-sm font-bold'>
                        {t('verification.street')}
                        <Input
                            className='mt-1'
                            required
                            value={streetAddress}
                            onChange={(event) =>
                                setStreetAddress(event.target.value)
                            }
                        />
                    </label>
                    <div className='grid gap-3 sm:grid-cols-2'>
                        <label className='block text-sm font-bold'>
                            {t('verification.latitude')}
                            <Input
                                className='mt-1'
                                type='number'
                                step='any'
                                required
                                value={latitude}
                                onChange={(event) =>
                                    setLatitude(event.target.value)
                                }
                            />
                        </label>
                        <label className='block text-sm font-bold'>
                            {t('verification.longitude')}
                            <Input
                                className='mt-1'
                                type='number'
                                step='any'
                                required
                                value={longitude}
                                onChange={(event) =>
                                    setLongitude(event.target.value)
                                }
                            />
                        </label>
                    </div>
                    <label className='flex items-center gap-2 text-sm font-bold'>
                        <input
                            type='checkbox'
                            checked={confidentialFacility}
                            onChange={(event) =>
                                setConfidentialFacility(event.target.checked)
                            }
                        />
                        {t('verification.confidential')}
                    </label>
                    <Button type='submit'>
                        {t('verification.requestApproval')}
                    </Button>
                </form>
                {workspace?.exactAddressRequests.length ? (
                    <ul className='mt-4 space-y-2'>
                        {workspace.exactAddressRequests.map((request) => (
                            <li className='mh-record-card' key={request.id}>
                                {request.resourceUri} —{' '}
                                <strong>{request.status}</strong>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </Panel>

            {review || exactReview ? (
                <Panel title={t('verification.moderator')}>
                    <p className='mb-3 text-sm text-mh-textMuted'>
                        {t('verification.moderatorHelp')}
                    </p>
                    <label className='block text-sm font-bold'>
                        {t('verification.rationale')}
                        <Input
                            className='mt-1'
                            required
                            value={reviewReason}
                            onChange={(event) =>
                                setReviewReason(event.target.value)
                            }
                        />
                    </label>
                    <div className='mt-4 space-y-3'>
                        {review?.applications.map((application) => (
                            <Card
                                key={application.id}
                                title={`${application.subjectType} verification`}
                            >
                                <p className='text-xs'>
                                    {application.applicantDid} ·{' '}
                                    {application.status}
                                </p>
                                <ul className='my-2 text-xs'>
                                    {review.evidence
                                        .filter(
                                            (item) =>
                                                item.applicationId ===
                                                application.id,
                                        )
                                        .map((item) => (
                                            <li key={item.id}>
                                                {item.label}
                                                {item.attachment
                                                    ? ` — attachment ${item.attachment.status}`
                                                    : ''}
                                                {item.attachment ? (
                                                    <div className='mt-1 flex flex-wrap gap-2'>
                                                        {item.attachment
                                                            .status ===
                                                        'clean' ? (
                                                            <Button
                                                                type='button'
                                                                variant='neutral'
                                                                className='px-2 py-1 text-xs'
                                                                onClick={() =>
                                                                    void prepareAccess(
                                                                        item
                                                                            .attachment!
                                                                            .id,
                                                                    )
                                                                }
                                                            >
                                                                {t(
                                                                    'verification.prepareFile',
                                                                )}
                                                            </Button>
                                                        ) : null}
                                                        <Button
                                                            type='button'
                                                            variant='neutral'
                                                            className='px-2 py-1 text-xs'
                                                            onClick={() =>
                                                                void moderateAttachment(
                                                                    item
                                                                        .attachment!
                                                                        .id,
                                                                    'quarantine',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'verification.quarantine',
                                                            )}
                                                        </Button>
                                                        <Button
                                                            type='button'
                                                            variant='neutral'
                                                            className='px-2 py-1 text-xs'
                                                            onClick={() =>
                                                                void moderateAttachment(
                                                                    item
                                                                        .attachment!
                                                                        .id,
                                                                    'release-for-rescan',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'verification.rescan',
                                                            )}
                                                        </Button>
                                                        <Button
                                                            type='button'
                                                            variant='neutral'
                                                            className='px-2 py-1 text-xs'
                                                            onClick={() =>
                                                                void moderateAttachment(
                                                                    item
                                                                        .attachment!
                                                                        .id,
                                                                    'delete',
                                                                )
                                                            }
                                                        >
                                                            {t(
                                                                'verification.deleteFile',
                                                            )}
                                                        </Button>
                                                    </div>
                                                ) : null}
                                                {item.attachment &&
                                                accessUrls[
                                                    item.attachment.id
                                                ] ? (
                                                    <a
                                                        className='mh-text-link mt-1 inline-block'
                                                        href={
                                                            accessUrls[
                                                                item.attachment
                                                                    .id
                                                            ]
                                                        }
                                                        target='_blank'
                                                        rel='noreferrer'
                                                    >
                                                        {t(
                                                            'verification.openFile',
                                                        )}
                                                    </a>
                                                ) : null}
                                            </li>
                                        ))}
                                </ul>
                                <div className='flex flex-wrap gap-2'>
                                    {application.status === 'approved' ? (
                                        <>
                                            <Button
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'renew',
                                                    )
                                                }
                                            >
                                                {t('verification.renew')}
                                            </Button>
                                            <Button
                                                variant='neutral'
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'revoke',
                                                    )
                                                }
                                            >
                                                {t('verification.revoke')}
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'approve',
                                                    )
                                                }
                                            >
                                                {t('verification.approve')}
                                            </Button>
                                            <Button
                                                variant='neutral'
                                                onClick={() =>
                                                    void decideApplication(
                                                        application,
                                                        'deny',
                                                    )
                                                }
                                            >
                                                {t('verification.deny')}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </Card>
                        ))}
                        {review?.appeals.map((appeal) => (
                            <Card
                                key={appeal.id}
                                title={t('verification.appealReview')}
                            >
                                <p className='text-sm'>{appeal.reason}</p>
                                <div className='mt-2 flex gap-2'>
                                    <Button
                                        onClick={() =>
                                            void decideAppeal(appeal, 'upheld')
                                        }
                                    >
                                        {t('verification.uphold')}
                                    </Button>
                                    <Button
                                        variant='neutral'
                                        onClick={() =>
                                            void decideAppeal(appeal, 'denied')
                                        }
                                    >
                                        {t('verification.denyAppeal')}
                                    </Button>
                                </div>
                            </Card>
                        ))}
                        {exactReview?.map((request) => (
                            <Card
                                key={request.id}
                                title={t('verification.addressReview')}
                            >
                                <p className='text-sm'>
                                    {request.streetAddress} ·{' '}
                                    {request.resourceUri}
                                </p>
                                {request.confidentialFacility ? (
                                    <p className='mh-alert mt-2 text-xs font-bold'>
                                        {t(
                                            'verification.confidentialProhibited',
                                        )}
                                    </p>
                                ) : null}
                                <div className='mt-2 flex gap-2'>
                                    <Button
                                        disabled={request.confidentialFacility}
                                        onClick={() =>
                                            void decideExact(request, 'approve')
                                        }
                                    >
                                        {t('verification.approveAddress')}
                                    </Button>
                                    <Button
                                        variant='neutral'
                                        onClick={() =>
                                            void decideExact(request, 'reject')
                                        }
                                    >
                                        {t('verification.reject')}
                                    </Button>
                                </div>
                            </Card>
                        ))}
                    </div>
                </Panel>
            ) : null}
        </section>
    );
};

const organizationAdminRoles = new Set(['owner', 'admin']);

const OrganizationsRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [organizations, setOrganizations] = useState<PublicOrganization[]>(
        [],
    );
    const [mine, setMine] = useState<MyOrganization[]>([]);
    const [members, setMembers] = useState<OrganizationMember[]>([]);
    const [stewardships, setStewardships] = useState<OrganizationStewardship[]>(
        [],
    );
    const [selectedId, setSelectedId] = useState('');
    const [searchText, setSearchText] = useState('');
    const [status, setStatus] = useState(t('organizations.loading'));
    const [actionStatus, setActionStatus] = useState<string>();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [inviteeDid, setInviteeDid] = useState('');
    const [inviteRole, setInviteRole] = useState<
        'admin' | 'steward' | 'member'
    >('steward');
    const [invitationToken, setInvitationToken] = useState('');
    const [acceptToken, setAcceptToken] = useState('');
    const [resourceUri, setResourceUri] = useState('');
    const [stewardDid, setStewardDid] = useState('');

    const loadPublic = useCallback(async () => {
        setStatus(t('organizations.loading'));
        const result = await fetchOrganizationsViaApi(searchText);
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setOrganizations(result.data);
        setStatus(
            result.data.length
                ? t('organizations.results', { count: result.data.length })
                : t('organizations.noResults'),
        );
    }, [searchText, t]);

    const loadPrivate = useCallback(async () => {
        if (!did) {
            setMine([]);
            setMembers([]);
            setStewardships([]);
            return;
        }
        const result = await fetchMyOrganizationsViaApi();
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setMine(result.data);
        const nextSelected = result.data.some((item) => item.id === selectedId)
            ? selectedId
            : (result.data[0]?.id ?? '');
        setSelectedId(nextSelected);
        if (!nextSelected) {
            setMembers([]);
            setStewardships([]);
            return;
        }
        const [memberResult, stewardshipResult] = await Promise.all([
            fetchOrganizationMembersViaApi(nextSelected),
            fetchOrganizationStewardshipsViaApi(nextSelected),
        ]);
        if (memberResult.ok) setMembers(memberResult.data);
        if (stewardshipResult.ok) setStewardships(stewardshipResult.data);
    }, [did, selectedId, t]);

    useEffect(() => {
        void loadPublic();
    }, [loadPublic]);

    useEffect(() => {
        void loadPrivate();
    }, [loadPrivate]);

    const selected = mine.find((item) => item.id === selectedId);
    const canAdmin = selected
        ? organizationAdminRoles.has(selected.membership.role)
        : false;

    const createOrganization = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setActionStatus(t('organizations.creating'));
        const result = await createOrganizationViaApi({ name, description });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setName('');
        setDescription('');
        setSelectedId(result.data.organization.id);
        setActionStatus(t('organizations.created'));
        await Promise.all([loadPublic(), loadPrivate()]);
    };

    const invite = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        setActionStatus(t('organizations.creatingInvitation'));
        const result = await inviteOrganizationMemberViaApi({
            organizationId: selected.id,
            inviteeDid,
            role: inviteRole,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setInvitationToken(result.data.token);
        setInviteeDid('');
        setActionStatus(t('organizations.invitationCreated'));
    };

    const acceptInvitation = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setActionStatus(t('organizations.accepting'));
        const result = await acceptOrganizationInvitationViaApi(acceptToken);
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setAcceptToken('');
        setSelectedId(result.data.organizationId);
        setActionStatus(t('organizations.accepted'));
        await loadPrivate();
    };

    const assignStewardship = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!selected) return;
        setActionStatus(t('organizations.assigning'));
        const result = await assignOrganizationStewardshipViaApi({
            organizationId: selected.id,
            resourceUri,
            stewardDid,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setResourceUri('');
        setStewardDid('');
        setActionStatus(t('organizations.assigned'));
        await loadPrivate();
    };

    const reconfirm = async (item: OrganizationStewardship) => {
        setActionStatus(t('organizations.reconfirming'));
        const result = await reconfirmOrganizationStewardshipViaApi({
            organizationId: item.organizationId,
            stewardshipId: item.id,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setActionStatus(t('organizations.reconfirmed'));
        await loadPrivate();
    };

    const updateMemberRole = async (
        member: OrganizationMember,
        role: 'admin' | 'steward' | 'member',
    ) => {
        setActionStatus(t('organizations.updatingRole'));
        const result = await updateOrganizationMemberRoleViaApi({
            organizationId: member.organizationId,
            memberDid: member.memberDid,
            role,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setActionStatus(t('organizations.roleUpdated'));
        await loadPrivate();
    };

    const removeMember = async (member: OrganizationMember) => {
        setActionStatus(t('organizations.removingMember'));
        const result = await removeOrganizationMemberViaApi({
            organizationId: member.organizationId,
            memberDid: member.memberDid,
        });
        if (!result.ok) {
            setActionStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setActionStatus(t('organizations.memberRemoved'));
        await loadPrivate();
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('organizations.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('organizations.description')}
                </p>
            </header>

            <Panel title={String(t('organizations.find'))}>
                <form
                    className='flex flex-wrap gap-2'
                    onSubmit={(event) => {
                        event.preventDefault();
                        void loadPublic();
                    }}
                >
                    <label className='grow text-sm font-bold'>
                        {t('organizations.search')}
                        <Input
                            value={searchText}
                            onChange={(event) =>
                                setSearchText(event.target.value)
                            }
                        />
                    </label>
                    <Button type='submit'>
                        {t('organizations.submitSearch')}
                    </Button>
                </form>
                <p
                    className='mt-3 text-sm text-mh-textMuted'
                    role={status.startsWith('Error:') ? 'alert' : 'status'}
                >
                    {status}
                </p>
                <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                    {organizations.map((organization) => (
                        <Card key={organization.id} title={organization.name}>
                            <p className='text-sm'>
                                {organization.description}
                            </p>
                            <p className='mt-2 text-xs font-bold text-mh-textMuted'>
                                {t('organizations.origin', {
                                    origin: formatLocalizedLabel(
                                        t,
                                        organization.origin,
                                    ),
                                })}
                            </p>
                            {organization.provenance ? (
                                <p className='mt-1 text-xs text-mh-textMuted'>
                                    {t('organizations.source')}{' '}
                                    <a
                                        className='mh-link'
                                        href={organization.provenance.sourceUrl}
                                        rel='noreferrer'
                                        target='_blank'
                                    >
                                        {t('organizations.authoritative')}
                                    </a>{' '}
                                    ·{' '}
                                    {fmt.shortDate(
                                        organization.provenance.lastVerifiedAt,
                                    )}
                                </p>
                            ) : null}
                            <p className='mt-2 text-xs text-mh-textMuted'>
                                {organization.nonEndorsementLabel}
                            </p>
                        </Card>
                    ))}
                </div>
            </Panel>

            {did ? (
                <>
                    <Panel title={String(t('organizations.join'))}>
                        <form
                            className='flex flex-wrap gap-2'
                            onSubmit={acceptInvitation}
                        >
                            <label className='grow text-sm font-bold'>
                                {t('organizations.token')}
                                <Input
                                    value={acceptToken}
                                    onChange={(event) =>
                                        setAcceptToken(event.target.value)
                                    }
                                />
                            </label>
                            <Button type='submit'>
                                {t('organizations.accept')}
                            </Button>
                        </form>
                    </Panel>

                    <Panel title={String(t('organizations.create'))}>
                        <form
                            className='space-y-3'
                            onSubmit={createOrganization}
                        >
                            <label className='block text-sm font-bold'>
                                {t('organizations.name')}
                                <Input
                                    value={name}
                                    onChange={(event) =>
                                        setName(event.target.value)
                                    }
                                />
                            </label>
                            <label className='block text-sm font-bold'>
                                {t('organizations.descriptionLabel')}
                                <textarea
                                    className='mh-input mt-1 min-h-24 w-full px-3 py-2'
                                    value={description}
                                    onChange={(event) =>
                                        setDescription(event.target.value)
                                    }
                                />
                            </label>
                            <Button type='submit'>
                                {t('organizations.createAction')}
                            </Button>
                        </form>
                    </Panel>

                    {mine.length ? (
                        <Panel title={String(t('organizations.manage'))}>
                            <label className='block text-sm font-bold'>
                                {t('organizations.organization')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={selectedId}
                                    onChange={(event) =>
                                        setSelectedId(event.target.value)
                                    }
                                >
                                    {mine.map((item) => (
                                        <option key={item.id} value={item.id}>
                                            {item.name} · {item.membership.role}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {selected ? (
                                <>
                                    <p className='mt-3 text-sm'>
                                        {t('organizations.role', {
                                            role: formatLocalizedLabel(
                                                t,
                                                selected.membership.role,
                                            ),
                                        })}
                                    </p>
                                    <ul className='mt-3 space-y-2 text-sm'>
                                        {members.map((member) => {
                                            const canManageMember =
                                                canAdmin &&
                                                member.role !== 'owner' &&
                                                (selected.membership.role ===
                                                    'owner' ||
                                                    member.role !== 'admin');
                                            return (
                                                <li
                                                    key={member.memberDid}
                                                    className='flex flex-wrap items-center gap-2'
                                                >
                                                    <span>
                                                        {member.memberDid} ·{' '}
                                                        {member.role}
                                                    </span>
                                                    {canManageMember ? (
                                                        <>
                                                            <label className='text-xs font-bold'>
                                                                {t(
                                                                    'organizations.roleFor',
                                                                    {
                                                                        did: member.memberDid,
                                                                    },
                                                                )}
                                                                <select
                                                                    className='mh-input ml-2 px-2 py-1'
                                                                    value={
                                                                        member.role
                                                                    }
                                                                    onChange={(
                                                                        event,
                                                                    ) =>
                                                                        void updateMemberRole(
                                                                            member,
                                                                            event
                                                                                .target
                                                                                .value as
                                                                                | 'admin'
                                                                                | 'steward'
                                                                                | 'member',
                                                                        )
                                                                    }
                                                                >
                                                                    <option value='admin'>
                                                                        {t(
                                                                            'organizations.admin',
                                                                        )}
                                                                    </option>
                                                                    <option value='steward'>
                                                                        {t(
                                                                            'organizations.steward',
                                                                        )}
                                                                    </option>
                                                                    <option value='member'>
                                                                        {t(
                                                                            'organizations.member',
                                                                        )}
                                                                    </option>
                                                                </select>
                                                            </label>
                                                            <Button
                                                                type='button'
                                                                variant='neutral'
                                                                onClick={() =>
                                                                    void removeMember(
                                                                        member,
                                                                    )
                                                                }
                                                            >
                                                                {t(
                                                                    'organizations.remove',
                                                                )}{' '}
                                                                {
                                                                    member.memberDid
                                                                }
                                                            </Button>
                                                        </>
                                                    ) : null}
                                                </li>
                                            );
                                        })}
                                    </ul>

                                    {canAdmin ? (
                                        <div className='mt-5 grid gap-5 lg:grid-cols-2'>
                                            <form
                                                className='space-y-3'
                                                onSubmit={invite}
                                            >
                                                <h3 className='font-bold'>
                                                    {t('organizations.invite')}
                                                </h3>
                                                <label className='block text-sm font-bold'>
                                                    {t('organizations.invitee')}
                                                    <Input
                                                        value={inviteeDid}
                                                        onChange={(event) =>
                                                            setInviteeDid(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <label className='block text-sm font-bold'>
                                                    {t(
                                                        'organizations.organizationRole',
                                                    )}
                                                    <select
                                                        className='mh-input mt-1 w-full px-3 py-2'
                                                        value={inviteRole}
                                                        onChange={(event) =>
                                                            setInviteRole(
                                                                event.target
                                                                    .value as typeof inviteRole,
                                                            )
                                                        }
                                                    >
                                                        <option value='admin'>
                                                            {t(
                                                                'organizations.admin',
                                                            )}
                                                        </option>
                                                        <option value='steward'>
                                                            {t(
                                                                'organizations.steward',
                                                            )}
                                                        </option>
                                                        <option value='member'>
                                                            {t(
                                                                'organizations.member',
                                                            )}
                                                        </option>
                                                    </select>
                                                </label>
                                                <Button type='submit'>
                                                    {t(
                                                        'organizations.createInvitation',
                                                    )}
                                                </Button>
                                                {invitationToken ? (
                                                    <label className='block text-sm font-bold'>
                                                        {t(
                                                            'organizations.oneTimeToken',
                                                        )}
                                                        <Input
                                                            readOnly
                                                            value={
                                                                invitationToken
                                                            }
                                                        />
                                                    </label>
                                                ) : null}
                                            </form>

                                            <form
                                                className='space-y-3'
                                                onSubmit={assignStewardship}
                                            >
                                                <h3 className='font-bold'>
                                                    {t('organizations.assign')}
                                                </h3>
                                                <label className='block text-sm font-bold'>
                                                    {t(
                                                        'organizations.resourceUri',
                                                    )}
                                                    <Input
                                                        value={resourceUri}
                                                        onChange={(event) =>
                                                            setResourceUri(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <label className='block text-sm font-bold'>
                                                    {t(
                                                        'organizations.stewardDid',
                                                    )}
                                                    <Input
                                                        value={stewardDid}
                                                        onChange={(event) =>
                                                            setStewardDid(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <Button type='submit'>
                                                    {t(
                                                        'organizations.assignAction',
                                                    )}
                                                </Button>
                                            </form>
                                        </div>
                                    ) : null}

                                    <div className='mt-5 space-y-2'>
                                        <h3 className='font-bold'>
                                            {t('organizations.stewarded')}
                                        </h3>
                                        {stewardships.length ? (
                                            stewardships.map((item) => {
                                                const mayReconfirm =
                                                    canAdmin ||
                                                    (selected.membership
                                                        .role === 'steward' &&
                                                        item.stewardDid ===
                                                            did);
                                                return (
                                                    <Card
                                                        key={item.id}
                                                        title={item.resourceUri}
                                                    >
                                                        <p className='text-xs'>
                                                            {item.status} ·{' '}
                                                            {t(
                                                                'organizations.due',
                                                                {
                                                                    date: fmt.shortDate(
                                                                        item.reconfirmDueAt,
                                                                    ),
                                                                },
                                                            )}
                                                        </p>
                                                        {mayReconfirm ? (
                                                            <p className='mt-2'>
                                                                <Button
                                                                    type='button'
                                                                    variant='neutral'
                                                                    onClick={() =>
                                                                        void reconfirm(
                                                                            item,
                                                                        )
                                                                    }
                                                                >
                                                                    {t(
                                                                        'organizations.reconfirm',
                                                                    )}
                                                                </Button>
                                                            </p>
                                                        ) : null}
                                                    </Card>
                                                );
                                            })
                                        ) : (
                                            <p className='text-sm text-mh-textMuted'>
                                                {t('organizations.none')}
                                            </p>
                                        )}
                                    </div>
                                </>
                            ) : null}
                        </Panel>
                    ) : null}
                    {actionStatus ? (
                        <p
                            role={
                                actionStatus.startsWith('Error:')
                                    ? 'alert'
                                    : 'status'
                            }
                            className='text-sm'
                        >
                            {actionStatus}
                        </p>
                    ) : null}
                </>
            ) : (
                <Panel title={String(t('organizations.signIn'))}>
                    <p>{t('organizations.signInHelp')}</p>
                </Panel>
            )}
        </section>
    );
};

interface ChatRouteProps {
    currentUserDid: string;
    hasPermission: boolean;
    onTogglePermission: (enabled: boolean) => void;
    forceFallback: boolean;
    onToggleFallback: (enabled: boolean) => void;
    intent?: ChatInitiationIntent;
    state: ChatLaunchState;
    requestPreview?: string;
    onLaunch: () => void;
    onReset: () => void;
}

const outcomeOptions = [
    'successful',
    'partially-successful',
    'unsuccessful',
    'no-response',
    'cancelled',
] as const;

const applicationServerKey = (value: string): ArrayBuffer => {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
    const decoded = window.atob(base64);
    const buffer = new ArrayBuffer(decoded.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
    }
    return buffer;
};

const NotificationCenterRoute = () => {
    const { t, fmt } = useLocale();
    const [notifications, setNotifications] = useState<DurableNotification[]>(
        [],
    );
    const [filter, setFilter] = useState<NotificationFilter>('all');
    const [total, setTotal] = useState(0);
    const [unread, setUnread] = useState(0);
    const [nextCursor, setNextCursor] = useState<string>();
    const [channels, setChannels] = useState<NotificationChannelState>();
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState(t('notifications.loading'));
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        setIsLoading(true);
        const [items, channelState] = await Promise.all([
            fetchNotificationsViaApi({ filter }),
            fetchNotificationChannelsViaApi(),
        ]);
        if (!items.ok || !channelState.ok) {
            setStatus(
                `${t('common.error')}: ${t('notifications.unavailable')}`,
            );
            setIsLoading(false);
            return;
        }
        setNotifications(items.data.items);
        setTotal(items.data.total);
        setUnread(items.data.unread);
        setNextCursor(items.data.nextCursor);
        setChannels(channelState.data);
        setEmail(channelState.data.email?.address ?? '');
        setStatus(t('notifications.unreadCount', { count: items.data.unread }));
        setIsLoading(false);
    }, [filter, t]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const token = new URLSearchParams(window.location.search).get(
            'emailToken',
        );
        if (!token) return;
        void confirmNotificationEmailViaApi(token).then((result) => {
            setStatus(
                result.ok
                    ? t('notifications.emailConfirmed')
                    : `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            window.history.replaceState({}, '', '/notifications');
            if (result.ok) void load();
        });
    }, [load]);

    const updateChannelPreference = async (
        channel: 'inApp' | 'email' | 'push',
        enabled: boolean,
    ) => {
        const current = await fetchAccountPreferencesViaApi();
        if (!current.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return false;
        }
        const updated = await updateAccountPreferencesViaApi({
            ...current.data,
            notifications: {
                ...current.data.notifications,
                [channel]: enabled,
            },
        });
        if (!updated.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return false;
        }
        return true;
    };

    const markRead = async (
        notification: DurableNotification,
        read: boolean,
    ) => {
        const result = await markNotificationReadViaApi(notification.id, read);
        if (result.ok) await load();
        setStatus(
            result.ok
                ? read
                    ? t('notifications.markedRead')
                    : t('notifications.markedUnread')
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const markAllRead = async () => {
        const result = await markAllNotificationsReadViaApi();
        if (result.ok) await load();
        setStatus(
            result.ok
                ? t('notifications.markedAll', { count: result.data.updated })
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const archive = async (notification: DurableNotification) => {
        const result = await archiveNotificationViaApi(notification.id);
        if (result.ok) await load();
        setStatus(
            result.ok
                ? t('notifications.archived')
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const result = await requestNotificationEmailVerificationViaApi(email);
        const preferenceEnabled = result.ok
            ? await updateChannelPreference('email', true)
            : false;
        setStatus(
            result.ok && preferenceEnabled
                ? t('notifications.emailSent')
                : !result.ok
                  ? `${t('common.error')}: ${t('common.requestFailed')}`
                  : `${t('common.error')}: ${t('notifications.emailPreferenceFailed')}`,
        );
    };

    const disableEmail = async () => {
        const result = await disableNotificationEmailViaApi();
        if (result.ok) {
            await updateChannelPreference('email', false);
            await load();
        }
        setStatus(
            result.ok
                ? t('notifications.emailDisabled')
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const enablePush = async () => {
        try {
            if (
                !channels?.push.supported ||
                !channels.push.publicKey ||
                !('serviceWorker' in navigator) ||
                !('PushManager' in window)
            ) {
                setStatus(
                    `${t('common.error')}: ${t('notifications.pushUnavailable')}`,
                );
                return;
            }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                setStatus(t('notifications.pushDenied'));
                return;
            }
            if (!(await updateChannelPreference('push', true))) return;
            await navigator.serviceWorker.register('/push-service-worker.js', {
                scope: '/',
            });
            const registration = await navigator.serviceWorker.ready;
            const existing = await registration.pushManager.getSubscription();
            const subscription =
                existing ??
                (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: applicationServerKey(
                        channels.push.publicKey,
                    ),
                }));
            const serialized = subscription.toJSON();
            if (
                !serialized.endpoint ||
                !serialized.keys?.p256dh ||
                !serialized.keys.auth
            ) {
                throw new Error(t('notifications.pushIncomplete'));
            }
            const result = await registerPushSubscriptionViaApi({
                endpoint: serialized.endpoint,
                keys: {
                    p256dh: serialized.keys.p256dh,
                    auth: serialized.keys.auth,
                },
            });
            if (!result.ok) throw new Error(result.error);
            await load();
            setStatus(t('notifications.pushEnabled'));
        } catch (error) {
            await updateChannelPreference('push', false);
            setStatus(
                `${t('common.error')}: ${error instanceof Error && error.message === t('notifications.pushIncomplete') ? error.message : t('notifications.pushEnableFailed')}`,
            );
        }
    };

    const disablePush = async () => {
        try {
            const registration =
                'serviceWorker' in navigator
                    ? await navigator.serviceWorker.getRegistration('/')
                    : undefined;
            const subscription =
                await registration?.pushManager.getSubscription();
            const result = await revokePushSubscriptionViaApi(
                subscription?.endpoint,
            );
            if (!result.ok) throw new Error(result.error);
            await subscription?.unsubscribe();
            await updateChannelPreference('push', false);
            await load();
            setStatus(t('notifications.pushRevoked'));
        } catch (error) {
            setStatus(
                `${t('common.error')}: ${t('notifications.pushRevokeFailed')}`,
            );
        }
    };

    const loadMore = async () => {
        if (!nextCursor) return;
        const result = await fetchNotificationsViaApi({
            filter,
            cursor: nextCursor,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setNotifications((current) => [...current, ...result.data.items]);
        setNextCursor(result.data.nextCursor);
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('notifications.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('notifications.description')}
                </p>
            </header>
            <Panel title={String(t('notifications.delivery'))}>
                <p className='text-sm'>{t('notifications.privacy')}</p>
                <div className='mt-4 grid gap-4 md:grid-cols-2'>
                    <form className='space-y-2' onSubmit={verifyEmail}>
                        <label
                            htmlFor='notification-email'
                            className='block text-sm font-bold'
                        >
                            {t('notifications.email')}
                        </label>
                        <Input
                            id='notification-email'
                            type='email'
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            required
                        />
                        <p className='text-xs text-mh-textMuted'>
                            {channels?.email?.verified
                                ? t('notifications.verified')
                                : t('notifications.unverified')}
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            <Button type='submit'>
                                {t('notifications.confirm')}
                            </Button>
                            {channels?.email ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    onClick={() => void disableEmail()}
                                >
                                    {t('notifications.disableEmail')}
                                </Button>
                            ) : null}
                        </div>
                    </form>
                    <div className='space-y-2'>
                        <h3 className='text-sm font-bold'>
                            {t('notifications.push')}
                        </h3>
                        <p className='text-xs text-mh-textMuted'>
                            {t('notifications.pushCount', {
                                count: channels?.push.activeSubscriptions ?? 0,
                            })}
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            <Button
                                type='button'
                                onClick={() => void enablePush()}
                                disabled={!channels?.push.supported}
                            >
                                {t('notifications.enablePush')}
                            </Button>
                            <Button
                                type='button'
                                variant='neutral'
                                onClick={() => void disablePush()}
                                disabled={
                                    (channels?.push.activeSubscriptions ?? 0) ===
                                    0
                                }
                            >
                                {t('notifications.revokePush')}
                            </Button>
                        </div>
                    </div>
                </div>
            </Panel>
            <Panel title={String(t('notifications.updates'))}>
                <div className='mb-4 flex flex-wrap items-end gap-3'>
                    <label className='text-sm font-bold'>
                        {t('notifications.show')}
                        <select
                            className='mh-input ml-2 px-3 py-2'
                            aria-label={String(t('notifications.filter'))}
                            value={filter}
                            onChange={(event) =>
                                setFilter(
                                    event.target.value as NotificationFilter,
                                )
                            }
                        >
                            <option value='all'>
                                {t('notifications.active')}
                            </option>
                            <option value='unread'>
                                {t('notifications.unread')}
                            </option>
                            <option value='read'>
                                {t('notifications.read')}
                            </option>
                            <option value='archived'>
                                {t('notifications.archived')}
                            </option>
                        </select>
                    </label>
                    <Badge tone={unread ? 'info' : 'neutral'}>
                        {t('notifications.counts', { unread, total })}
                    </Badge>
                    <Button
                        type='button'
                        variant='neutral'
                        onClick={() => void markAllRead()}
                        disabled={unread === 0}
                    >
                        {t('notifications.markAll')}
                    </Button>
                    <Button
                        type='button'
                        variant='neutral'
                        onClick={() => void load()}
                    >
                        {t('notifications.refresh')}
                    </Button>
                </div>
                {isLoading ? (
                    <p role='status'>{t('notifications.loading')}</p>
                ) : notifications.length === 0 ? (
                    <p>{t('notifications.empty')}</p>
                ) : (
                    <div className='space-y-3'>
                        {notifications.map((notification) => (
                            <Card
                                key={notification.id}
                                title={notification.title}
                            >
                                <p>{notification.body}</p>
                                <p className='mt-2 text-xs text-mh-textMuted'>
                                    {notification.type.replaceAll('_', ' ')} ·{' '}
                                    {notification.priority} ·{' '}
                                    {fmt.longDate(notification.createdAt)}
                                </p>
                                <div className='mt-3 flex flex-wrap gap-2'>
                                    <Button
                                        type='button'
                                        variant='neutral'
                                        onClick={() =>
                                            void markRead(
                                                notification,
                                                !notification.read,
                                            )
                                        }
                                    >
                                        {notification.read
                                            ? t('notifications.markUnread')
                                            : t('notifications.markRead')}
                                    </Button>
                                    {!notification.archived ? (
                                        <Button
                                            type='button'
                                            variant='neutral'
                                            onClick={() =>
                                                void archive(notification)
                                            }
                                        >
                                            {t('notifications.archive')}
                                        </Button>
                                    ) : null}
                                    {notification.actionUrl ? (
                                        <a
                                            className='font-bold underline'
                                            href={notification.actionUrl}
                                        >
                                            {t('notifications.open')}
                                        </a>
                                    ) : null}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
                {nextCursor ? (
                    <p className='mt-4'>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => void loadMore()}
                        >
                            {t('notifications.more')}
                        </Button>
                    </p>
                ) : null}
            </Panel>
            <p
                role={status.startsWith('Error:') ? 'alert' : 'status'}
                className='text-sm'
            >
                {status}
            </p>
        </section>
    );
};

const localDateTimeWithOffset = (value: string): string => {
    const date = new Date(value);
    const minutes = -date.getTimezoneOffset();
    const sign = minutes >= 0 ? '+' : '-';
    const absolute = Math.abs(minutes);
    const offset = `${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
    return `${value.length === 16 ? `${value}:00` : value}${sign}${offset}`;
};

const CoordinationSchedulingRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [connections, setConnections] = useState<CoordinationConnection[]>(
        [],
    );
    const [windows, setWindows] = useState<CoordinationWindow[]>([]);
    const [connectionId, setConnectionId] = useState('');
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [status, setStatus] = useState(String(t('scheduling.loading')));
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setStatus(String(t('scheduling.loading')));
        const [coordination, scheduling] = await Promise.all([
            fetchCoordinationViaApi(),
            fetchCoordinationWindowsViaApi(),
        ]);
        if (!coordination.ok || !scheduling.ok) {
            setStatus(
                `${t('common.error')}: ${!coordination.ok ? coordination.error : !scheduling.ok ? scheduling.error : ''}`,
            );
            return;
        }
        const active = coordination.data.connections.filter(
            (connection) => connection.status === 'active',
        );
        setConnections(active);
        setWindows(scheduling.data.windows);
        setConnectionId((current) => current || active[0]?.id || '');
        setStatus(
            active.length === 0
                ? String(t('scheduling.empty'))
                : String(t('scheduling.ready')),
        );
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);
    const current = windows.find(
        (window) => window.connectionId === connectionId,
    );
    const canPropose =
        !current ||
        (current.status === 'proposed' && current.recipientDid === did);

    const finish = async (
        operation: Promise<{ ok: boolean; error?: string }>,
    ) => {
        setBusy(true);
        setStatus(String(t('scheduling.saving')));
        const result = await operation;
        setBusy(false);
        if (!result.ok) {
            setStatus(
                `${t('common.error')}: ${result.error ?? t('scheduling.failed')}`,
            );
            return;
        }
        setStartAt('');
        setEndAt('');
        await load();
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('scheduling.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('scheduling.description')}
                </p>
                <p
                    role={
                        status.startsWith(String(t('common.error')))
                            ? 'alert'
                            : 'status'
                    }
                    className='mt-2 text-sm font-bold'
                >
                    {status}
                </p>
            </header>
            <Panel title={String(t('scheduling.proposeHeading'))}>
                {connections.length === 0 ? (
                    <p>{t('scheduling.empty')}</p>
                ) : (
                    <form
                        className='space-y-4'
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!connectionId || !startAt || !endAt) return;
                            const timezone =
                                Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone || 'UTC';
                            void finish(
                                proposeCoordinationWindowViaApi({
                                    connectionId,
                                    startAt: localDateTimeWithOffset(startAt),
                                    endAt: localDateTimeWithOffset(endAt),
                                    timezone,
                                    ...(current
                                        ? { expectedVersion: current.version }
                                        : {}),
                                }),
                            );
                        }}
                    >
                        <label className='block text-sm font-bold'>
                            {t('scheduling.connection')}
                            <select
                                className='mh-input mt-1 w-full px-3 py-2'
                                value={connectionId}
                                onChange={(event) =>
                                    setConnectionId(event.target.value)
                                }
                                disabled={busy}
                            >
                                {connections.map((connection) => (
                                    <option
                                        key={connection.id}
                                        value={connection.id}
                                    >
                                        {connection.counterpartDid}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('scheduling.start')}
                                <Input
                                    type='datetime-local'
                                    required
                                    value={startAt}
                                    onChange={(event) =>
                                        setStartAt(event.target.value)
                                    }
                                    disabled={busy || !canPropose}
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('scheduling.end')}
                                <Input
                                    type='datetime-local'
                                    required
                                    value={endAt}
                                    onChange={(event) =>
                                        setEndAt(event.target.value)
                                    }
                                    disabled={busy || !canPropose}
                                />
                            </label>
                        </div>
                        <Button type='submit' disabled={busy || !canPropose}>
                            {current
                                ? t('scheduling.counter')
                                : t('scheduling.propose')}
                        </Button>
                    </form>
                )}
            </Panel>
            <Panel title={String(t('scheduling.currentHeading'))}>
                {!current ? (
                    <p>{t('scheduling.noProposal')}</p>
                ) : (
                    <Card
                        title={String(t(`scheduling.status.${current.status}`))}
                    >
                        <p>
                            {fmt.longDate(current.startAt)} –{' '}
                            {fmt.longDate(current.endAt)}
                        </p>
                        <p className='mt-1 text-xs text-mh-textMuted'>
                            {current.timezone}
                        </p>
                        {current.status === 'proposed' &&
                        current.recipientDid === did ? (
                            <div className='mt-3 flex flex-wrap gap-2'>
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void finish(
                                            decideCoordinationWindowViaApi({
                                                connectionId,
                                                action: 'accept',
                                                expectedVersion:
                                                    current.version,
                                            }),
                                        )
                                    }
                                >
                                    {t('scheduling.accept')}
                                </Button>
                                <Button
                                    variant='secondary'
                                    disabled={busy}
                                    onClick={() =>
                                        void finish(
                                            decideCoordinationWindowViaApi({
                                                connectionId,
                                                action: 'decline',
                                                expectedVersion:
                                                    current.version,
                                            }),
                                        )
                                    }
                                >
                                    {t('scheduling.decline')}
                                </Button>
                            </div>
                        ) : null}
                        {current.status === 'confirmed' ? (
                            <Button
                                className='mt-3'
                                variant='secondary'
                                disabled={busy}
                                onClick={() =>
                                    void finish(
                                        decideCoordinationWindowViaApi({
                                            connectionId,
                                            action: 'cancel',
                                            expectedVersion: current.version,
                                        }),
                                    )
                                }
                            >
                                {t('scheduling.cancel')}
                            </Button>
                        ) : null}
                    </Card>
                )}
            </Panel>
        </section>
    );
};

const CoordinationInboxRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [offers, setOffers] = useState<CoordinationOffer[]>([]);
    const [connections, setConnections] = useState<CoordinationConnection[]>(
        [],
    );
    const [items, setItems] = useState<ActivityInboxItem[]>([]);
    const [feedback, setFeedback] = useState<OutcomeFeedback[]>([]);
    const [requests, setRequests] = useState<FeedRecordEnvelope[]>([]);
    const [matches, setMatches] = useState<
        Readonly<Record<string, MatchCandidate[]>>
    >({});
    const [offerRequestUri, setOfferRequestUri] = useState<string>();
    const [offerNote, setOfferNote] = useState('');
    const [languages, setLanguages] = useState('en');
    const [accessibility, setAccessibility] = useState('');
    const [outcomes, setOutcomes] = useState<
        Readonly<
            Record<
                string,
                {
                    outcome: (typeof outcomeOptions)[number];
                    rating: number;
                    comment: string;
                    safetyConcern: boolean;
                }
            >
        >
    >({});
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [status, setStatus] = useState(t('inbox.loading'));
    const requestContext = new URLSearchParams(window.location.search).get('uri');
    const visibleOffers = requestContext ? offers.filter(offer => offer.requestUri === requestContext) : offers;
    const visibleConnections = requestContext ? connections.filter(connection => connection.requestUri === requestContext) : connections;
    const refreshController = useRef<AbortController | undefined>(undefined);

    const load = useCallback(async () => {
        refreshController.current?.abort();
        const controller = new AbortController();
        refreshController.current = controller;
        const [coordination, inbox, outcomeHistory, discoverable] = await Promise.all([
            fetchCoordinationViaApi(controller.signal),
            fetchActivityInboxViaApi(unreadOnly, controller.signal),
            fetchMyOutcomeFeedbackViaApi(controller.signal),
            fetchFeedRecordsFromApi(defaultDiscoveryFilterState, 'feed', controller.signal),
        ]);
        if (controller.signal.aborted) return false;
        if (coordination.ok) {
            setOffers(coordination.data.offers);
            setConnections(coordination.data.connections);
        } else if (coordination.kind === 'authentication') { setOffers([]); setConnections([]); }
        if (inbox.ok) setItems(inbox.data.items);
        else if (inbox.kind === 'authentication') setItems([]);
        if (outcomeHistory.ok) setFeedback(outcomeHistory.data.feedback);
        else if (outcomeHistory.kind === 'authentication') setFeedback([]);
        if (discoverable.ok) setRequests(discoverable.data);
        else if (discoverable.kind === 'authentication') setRequests([]);
        const failed = [coordination, inbox, outcomeHistory, discoverable].some(result => !result.ok);
        setStatus(failed ? t('myRequests.activityPartial') : inbox.ok ? t('inbox.unreadCount', { count: inbox.data.unread }) : '');
        return !failed;
    }, [unreadOnly, t]);

    useEffect(() => {
        void load();
        return () => refreshController.current?.abort();
    }, [load]);
    useVisiblePoll(load, 15_000);

    const finish = async (
        pendingMessage: string,
        operation: Promise<{ ok: boolean; error?: string }>,
    ) => {
        setStatus(pendingMessage);
        const result = await operation;
        if (!result.ok) {
            setStatus(
                `${t('common.error')}: ${result.error ? t('common.requestFailed') : t('inbox.actionFailed')}`,
            );
            return;
        }
        await load();
    };

    const ownedRequests = requests.filter(
        (request) => request.recipientDid === did,
    );
    const availableRequests = requests.filter(
        (request) => request.recipientDid !== did,
    );
    const offerRequest = offerRequestUri
        ? availableRequests.find(
              (request) => request.aidPostUri === offerRequestUri,
          )
        : undefined;

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('inbox.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('inbox.description')}
                </p>
                <p
                    className='mt-2 text-sm font-bold'
                    role={status.startsWith('Error:') ? 'alert' : 'status'}
                >
                    {status}
                </p>
                <a
                    className='mt-3 inline-block font-bold underline'
                    href='/scheduling'
                >
                    {t('inbox.openScheduling')}
                </a>
                <Button variant='neutral' onClick={() => void load()}>{t('myRequests.refresh')}</Button>
            </header>

            <Suspense fallback={null}><LazyMyRequests key={did} /></Suspense>

            <Panel title={String(t('inbox.discover'))}>
                {availableRequests.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noRequests')}
                    </p>
                ) : (
                    <div className='grid gap-3 sm:grid-cols-2'>
                        {availableRequests.map((request) => (
                            <Card
                                key={request.aidPostUri}
                                title={request.card.title}
                            >
                                <p className='text-sm'>
                                    {request.card.description}
                                </p>
                                <p className='mt-2 text-xs text-mh-textMuted'>
                                    {formatLocalizedLabel(
                                        t,
                                        request.card.category,
                                    )}{' '}
                                    ·{' '}
                                    {formatLocalizedLabel(
                                        t,
                                        request.card.status,
                                    )}
                                </p>
                                <Button
                                    className='mt-3'
                                    aria-label={t('inbox.offerHelpFor', {
                                        title: request.card.title,
                                    })}
                                    onClick={() => {
                                        setOfferRequestUri(request.aidPostUri);
                                        setOfferNote('');
                                    }}
                                >
                                    {t('inbox.offerHelp')}
                                </Button>
                            </Card>
                        ))}
                    </div>
                )}
            </Panel>

            {offerRequest ? (
                <div
                    role='dialog'
                    aria-modal='true'
                    aria-labelledby='offer-help-title'
                    className='fixed inset-0 z-50 grid place-items-center bg-black/60 p-4'
                >
                    <section className='mh-card w-full max-w-xl space-y-4 p-5'>
                        <div>
                            <h2 id='offer-help-title' className='font-heading text-xl font-bold'>
                                {t('inbox.offerHelpFor', {
                                    title: offerRequest.card.title,
                                })}
                            </h2>
                            <p className='mt-1 text-sm text-mh-textMuted'>
                                {offerRequest.card.description}
                            </p>
                        </div>
                        <label className='block text-sm font-bold'>
                            {t('inbox.note')}
                            <textarea
                                autoFocus
                                className='mh-input mt-1 min-h-24 w-full px-3 py-2'
                                maxLength={1000}
                                value={offerNote}
                                onChange={(event) => setOfferNote(event.target.value)}
                            />
                        </label>
                        <div className='flex flex-wrap justify-end gap-2'>
                            <Button
                                variant='neutral'
                                onClick={() => setOfferRequestUri(undefined)}
                            >
                                {t('inbox.cancel')}
                            </Button>
                            <Button
                                onClick={() => {
                                    const requestUri = offerRequest.aidPostUri;
                                    setOfferRequestUri(undefined);
                                    void finish(
                                        t('inbox.sendingOffer'),
                                        createCoordinationOfferViaApi({
                                            requestUri,
                                            note: offerNote.trim() || null,
                                        }),
                                    );
                                }}
                            >
                                {t('inbox.offerHelp')}
                            </Button>
                        </div>
                    </section>
                </div>
            ) : null}

            {requestContext && <a href='/inbox' className='underline'>{t('myRequests.allActivity')}</a>}
            <div id='request-offers' />
            <Panel title={String(t('inbox.offers'))}>
                {visibleOffers.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noOffers')}
                    </p>
                ) : (
                    <div className='space-y-3'>
                        {visibleOffers.map((offer) => (
                            <Card
                                key={offer.id}
                                title={t('inbox.offerTitle', {
                                    direction: formatLocalizedLabel(
                                        t,
                                        offer.direction,
                                    ),
                                })}
                            >
                                <div className='flex flex-wrap gap-2'>
                                    <Badge
                                        tone={
                                            offer.status === 'accepted'
                                                ? 'success'
                                                : offer.status === 'pending'
                                                  ? 'info'
                                                  : 'neutral'
                                        }
                                    >
                                        {formatLocalizedLabel(t, offer.status)}
                                    </Badge>
                                    <span className='text-xs text-mh-textMuted'>
                                        {t('inbox.expires', {
                                            date: fmt.longDate(offer.expiresAt),
                                        })}
                                    </span>
                                </div>
                                {offer.note ? (
                                    <p className='mt-2 text-sm'>{offer.note}</p>
                                ) : null}
                                {offer.status === 'accepted' ? (
                                    <p className='mt-2 break-all text-xs'>
                                        {t('inbox.requester', {
                                            did: offer.requesterDid,
                                        })}
                                        <br />
                                        {t('inbox.helper', {
                                            did: offer.helperDid,
                                        })}
                                    </p>
                                ) : (
                                    <p className='mt-2 text-xs text-mh-textMuted'>
                                        {t('inbox.privateIdentity')}
                                    </p>
                                )}
                                {offer.status === 'pending' ? (
                                    <div className='mt-3 flex flex-wrap gap-2'>
                                        {offer.direction === 'received' ? (
                                            <>
                                                <Button
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.acceptingOffer',
                                                            ),
                                                            decideCoordinationOfferViaApi(
                                                                {
                                                                    offerId:
                                                                        offer.id,
                                                                    decision:
                                                                        'accept',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.accept')}
                                                </Button>
                                                <Button
                                                    variant='secondary'
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.decliningOffer',
                                                            ),
                                                            decideCoordinationOfferViaApi(
                                                                {
                                                                    offerId:
                                                                        offer.id,
                                                                    decision:
                                                                        'decline',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.decline')}
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                variant='secondary'
                                                onClick={() =>
                                                    void finish(
                                                        t(
                                                            'inbox.cancellingOffer',
                                                        ),
                                                        decideCoordinationOfferViaApi(
                                                            {
                                                                offerId:
                                                                    offer.id,
                                                                decision:
                                                                    'cancel',
                                                            },
                                                        ),
                                                    )
                                                }
                                            >
                                                {t('inbox.cancelOffer')}
                                            </Button>
                                        )}
                                    </div>
                                ) : null}
                            </Card>
                        ))}
                    </div>
                )}
            </Panel>

            <Panel title={String(t('inbox.matching'))}>
                <p className='mb-3 text-sm text-mh-textMuted'>
                    {t('inbox.matchingHelp')}
                </p>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='text-sm font-bold'>
                        {t('inbox.languages')}
                        <Input
                            value={languages}
                            onChange={(event) =>
                                setLanguages(event.target.value)
                            }
                            placeholder={t('inbox.languagesPlaceholder')}
                        />
                    </label>
                    <label className='text-sm font-bold'>
                        {t('inbox.accessibility')}
                        <Input
                            value={accessibility}
                            onChange={(event) =>
                                setAccessibility(event.target.value)
                            }
                            placeholder={t('inbox.accessibilityPlaceholder')}
                        />
                    </label>
                </div>
                {ownedRequests.length === 0 ? (
                    <p className='mt-3 text-sm text-mh-textMuted'>
                        {t('inbox.publishFirst')}
                    </p>
                ) : (
                    ownedRequests.map((request) => (
                        <div
                            key={request.aidPostUri}
                            className='mt-4 border-t border-mh-borderSoft pt-4'
                        >
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                                <h2 className='font-bold'>
                                    {request.card.title}
                                </h2>
                                <Button
                                    onClick={() =>
                                        void (async () => {
                                            setStatus(t('inbox.ranking'));
                                            const result =
                                                await matchRequestViaApi({
                                                    requestUri:
                                                        request.aidPostUri,
                                                    requiredLanguages:
                                                        parseCommaList(
                                                            languages,
                                                        ),
                                                    accessibilityNeeds:
                                                        parseCommaList(
                                                            accessibility,
                                                        ),
                                                });
                                            if (!result.ok) {
                                                setStatus(
                                                    `${t('common.error')}: ${t('common.requestFailed')}`,
                                                );
                                                return;
                                            }
                                            setMatches((current) => ({
                                                ...current,
                                                [request.aidPostUri]:
                                                    result.data.candidates,
                                            }));
                                            setStatus(
                                                t('inbox.ranked', {
                                                    count: result.data
                                                        .candidates.length,
                                                }),
                                            );
                                        })()
                                    }
                                >
                                    {t('inbox.find')}
                                </Button>
                            </div>
                            <ol className='mt-3 space-y-2'>
                                {(matches[request.aidPostUri] ?? []).map(
                                    (candidate) => (
                                        <li
                                            key={candidate.candidateRef}
                                            className='rounded border border-mh-borderSoft p-3'
                                        >
                                            <p className='font-bold'>
                                                #{candidate.rank}{' '}
                                                {candidate.label}
                                            </p>
                                            <p className='text-xs text-mh-textMuted'>
                                                {candidate.kind} ·{' '}
                                                {candidate.availability} ·{' '}
                                                {t('inbox.verification', {
                                                    status: candidate.verification,
                                                })}
                                            </p>
                                            <ul className='mt-2 list-disc pl-5 text-sm'>
                                                {candidate.explanations.map(
                                                    (explanation) => (
                                                        <li key={explanation}>
                                                            {explanation}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                            <p className='mt-2 text-xs font-bold'>
                                                {t('inbox.manual')}
                                            </p>
                                        </li>
                                    ),
                                )}
                            </ol>
                        </div>
                    ))
                )}
            </Panel>

            <Panel title={String(t('inbox.connections'))}>
                {visibleConnections.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noConnections')}
                    </p>
                ) : (
                    <div className='space-y-3'>
                        {visibleConnections.map((connection) => {
                            const submittedFeedback = feedback.find(
                                (entry) => entry.connectionId === connection.id,
                            );
                            const alreadySubmitted = Boolean(submittedFeedback);
                            const draft = outcomes[connection.id] ?? {
                                outcome: 'successful',
                                rating: 5,
                                comment: '',
                                safetyConcern: false,
                            };
                            return (
                                <Card
                                    key={connection.id}
                                    title={t('inbox.connectionTitle', {
                                        status: formatLocalizedLabel(
                                            t,
                                            connection.status,
                                        ),
                                    })}
                                >
                                    <p className='break-all text-xs'>
                                        {t('inbox.connected', {
                                            did: connection.counterpartDid,
                                        })}
                                    </p>
                                    {connection.status === 'active' ? (
                                        <>
                                            <ExactLocationExchange
                                                connectionId={connection.id}
                                            />
                                            <div className='mt-3 flex flex-wrap gap-2'>
                                                <Button
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.completing',
                                                            ),
                                                            transitionCoordinationConnectionViaApi(
                                                                {
                                                                    connectionId:
                                                                        connection.id,
                                                                    action: 'complete',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.complete')}
                                                </Button>
                                                <Button
                                                    variant='secondary'
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.cancellingConnection',
                                                            ),
                                                            transitionCoordinationConnectionViaApi(
                                                                {
                                                                    connectionId:
                                                                        connection.id,
                                                                    action: 'cancel',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.cancel')}
                                                </Button>
                                            </div>
                                        </>
                                    ) : connection.status === 'completed' &&
                                      !alreadySubmitted ? (
                                        <form
                                            className='mt-3 space-y-3 border-t border-mh-borderSoft pt-3'
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                void finish(
                                                    t('inbox.savingOutcome'),
                                                    submitOutcomeFeedbackViaApi(
                                                        {
                                                            connectionId:
                                                                connection.id,
                                                            outcome:
                                                                draft.outcome,
                                                            rating: draft.rating,
                                                            comment:
                                                                draft.comment.trim() ||
                                                                null,
                                                            tags: draft.safetyConcern
                                                                ? [
                                                                      'safety-concern',
                                                                  ]
                                                                : [],
                                                        },
                                                    ),
                                                );
                                            }}
                                        >
                                            <h3 className='font-bold'>
                                                {t('inbox.recordOutcome')}
                                            </h3>
                                            <div className='grid gap-3 sm:grid-cols-2'>
                                                <label className='text-sm font-bold'>
                                                    {t('inbox.outcome')}
                                                    <select
                                                        className='mh-input mt-1 w-full px-3 py-2'
                                                        value={draft.outcome}
                                                        onChange={(event) =>
                                                            setOutcomes(
                                                                (current) => ({
                                                                    ...current,
                                                                    [connection.id]:
                                                                        {
                                                                            ...draft,
                                                                            outcome:
                                                                                event
                                                                                    .target
                                                                                    .value as (typeof outcomeOptions)[number],
                                                                        },
                                                                }),
                                                            )
                                                        }
                                                    >
                                                        {outcomeOptions.map(
                                                            (value) => (
                                                                <option
                                                                    key={value}
                                                                    value={
                                                                        value
                                                                    }
                                                                >
                                                                    {formatLocalizedLabel(
                                                                        t,
                                                                        value,
                                                                    )}
                                                                </option>
                                                            ),
                                                        )}
                                                    </select>
                                                </label>
                                                <label className='text-sm font-bold'>
                                                    {t('inbox.rating')}
                                                    <Input
                                                        type='number'
                                                        min={1}
                                                        max={5}
                                                        value={draft.rating}
                                                        onChange={(event) =>
                                                            setOutcomes(
                                                                (current) => ({
                                                                    ...current,
                                                                    [connection.id]:
                                                                        {
                                                                            ...draft,
                                                                            rating: Number(
                                                                                event
                                                                                    .target
                                                                                    .value,
                                                                            ),
                                                                        },
                                                                }),
                                                            )
                                                        }
                                                    />
                                                </label>
                                            </div>
                                            <label className='block text-sm font-bold'>
                                                {t('inbox.comment')}
                                                <textarea
                                                    className='mh-input mt-1 min-h-20 w-full px-3 py-2'
                                                    maxLength={2000}
                                                    value={draft.comment}
                                                    onChange={(event) =>
                                                        setOutcomes(
                                                            (current) => ({
                                                                ...current,
                                                                [connection.id]:
                                                                    {
                                                                        ...draft,
                                                                        comment:
                                                                            event
                                                                                .target
                                                                                .value,
                                                                    },
                                                            }),
                                                        )
                                                    }
                                                />
                                            </label>
                                            <label className='block text-sm'>
                                                <input
                                                    type='checkbox'
                                                    checked={
                                                        draft.safetyConcern
                                                    }
                                                    onChange={(event) =>
                                                        setOutcomes(
                                                            (current) => ({
                                                                ...current,
                                                                [connection.id]:
                                                                    {
                                                                        ...draft,
                                                                        safetyConcern:
                                                                            event
                                                                                .target
                                                                                .checked,
                                                                    },
                                                            }),
                                                        )
                                                    }
                                                />{' '}
                                                {t('inbox.safety')}
                                            </label>
                                            <Button type='submit'>
                                                {t('inbox.submitOutcome')}
                                            </Button>
                                        </form>
                                    ) : alreadySubmitted ? (
                                        <p className='mt-3 text-sm text-mh-textMuted'>
                                            {submittedFeedback?.tags.includes(
                                                'safety-concern',
                                            )
                                                ? t('inbox.recordedSafety')
                                                : t('inbox.recorded')}
                                        </p>
                                    ) : null}
                                </Card>
                            );
                        })}
                    </div>
                )}
            </Panel>

            <Panel title={String(t('inbox.activity'))}>
                <label className='mb-3 block text-sm'>
                    <input
                        type='checkbox'
                        checked={unreadOnly}
                        onChange={(event) =>
                            setUnreadOnly(event.target.checked)
                        }
                    />{' '}
                    {t('inbox.unreadOnly')}
                </label>
                {items.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noActivity')}
                    </p>
                ) : (
                    <div className='space-y-2'>
                        {items.map((item) => (
                            <Card key={item.id} title={item.title}>
                                <p className='text-sm'>{item.summary}</p>
                                <p className='mt-1 text-xs text-mh-textMuted'>
                                    {formatLocalizedLabel(t, item.type)} ·{' '}
                                    {fmt.longDate(item.occurredAt)}
                                </p>
                                {!item.readAt ? (
                                    <Button
                                        className='mt-3'
                                        variant='neutral'
                                        aria-label={t('inbox.markReadFor', {
                                            title: item.title,
                                        })}
                                        onClick={() =>
                                            void finish(
                                                t('inbox.markingRead'),
                                                markActivityInboxReadViaApi(
                                                    item.id,
                                                ),
                                            )
                                        }
                                    >
                                        {t('inbox.markRead')}
                                    </Button>
                                ) : null}
                            </Card>
                        ))}
                    </div>
                )}
            </Panel>
        </section>
    );
};

const ChatRoute = ({
    currentUserDid,
    hasPermission,
    onTogglePermission,
    forceFallback,
    onToggleFallback,
    intent,
    state,
    requestPreview,
    onLaunch,
    onReset,
}: ChatRouteProps) => {
    const notice = toChatStatusNotice(state);

    const noticeTone =
        notice?.tone === 'danger'
            ? 'danger'
            : notice?.tone === 'warning'
              ? 'info'
              : notice?.tone === 'success'
                ? 'success'
                : 'neutral';

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>Chat handoff</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    Post-linked 1:1 initiation with permission checks and
                    recipient-capability fallback handling.
                </p>
            </header>

            <Panel title='Launch controls'>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                        <input
                            type='checkbox'
                            className='h-4 w-4'
                            checked={hasPermission}
                            onChange={(event) =>
                                onTogglePermission(event.target.checked)
                            }
                        />
                        Initiator has permission
                    </label>
                    <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                        <input
                            type='checkbox'
                            className='h-4 w-4'
                            checked={forceFallback}
                            onChange={(event) =>
                                onToggleFallback(event.target.checked)
                            }
                        />
                        Force capability fallback
                    </label>
                </div>

                <p className='mt-3 break-all text-xs text-mh-textSoft'>
                    Initiator DID: {currentUserDid}
                </p>

                {intent ? (
                    <div className='mt-4 rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-3'>
                        <p className='text-sm font-bold text-mh-text'>
                            Pending intent · {intent.aidPostTitle}
                        </p>
                        <p className='mt-1 break-all text-xs text-mh-textSoft'>
                            Recipient: {intent.recipientDid} · Source:{' '}
                            {intent.initiatedFrom}
                        </p>
                    </div>
                ) : (
                    <p className='mt-4 text-sm text-mh-textMuted'>
                        No pending chat intent. Start from Map or Feed “Contact
                        helper”.
                    </p>
                )}

                <div className='mt-4 flex flex-wrap gap-2'>
                    <Button onClick={onLaunch} disabled={!intent}>
                        Launch handoff chat
                    </Button>
                    <Button variant='neutral' onClick={onReset}>
                        Reset state
                    </Button>
                </div>
            </Panel>

            <Card title='Launch status'>
                <p className='text-sm text-mh-textMuted'>
                    State: {state.status}
                </p>

                {notice ? (
                    <div className='mt-3'>
                        <Badge tone={noticeTone}>{notice.message}</Badge>
                    </div>
                ) : null}

                {requestPreview ? (
                    <pre className='mt-3 max-w-full overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-3 text-xs text-mh-text'>
                        {requestPreview}
                    </pre>
                ) : null}
            </Card>
        </section>
    );
};

interface SettingsRouteProps {
    currentUserDid: string;
}

interface AccountPrivacyRouteProps {
    onDeactivated: () => Promise<void>;
}

const AccountPrivacyRoute = ({ onDeactivated }: AccountPrivacyRouteProps) => {
    const { changeLocale, t } = useLocale();
    const [accountActionResult, setAccountActionResult] = useState<string>();
    const [confirmDeactivation, setConfirmDeactivation] = useState(false);
    const [pendingAction, setPendingAction] = useState<
        'export' | 'deactivate'
    >();
    const [preferences, setPreferences] = useState<AccountPreferences>(
        defaultAccountPreferences,
    );
    const [preferencesStatus, setPreferencesStatus] = useState<string>();

    useEffect(() => {
        const controller = new AbortController();
        void fetchAccountPreferencesViaApi(controller.signal).then((result) => {
            if (!controller.signal.aborted && result.ok) {
                setPreferences(result.data);
                changeLocale(result.data.language);
            }
        });
        return () => controller.abort();
    }, [changeLocale]);

    const savePreferences = async () => {
        setPreferencesStatus(String(t('account.saving')));
        const result = await updateAccountPreferencesViaApi(preferences);
        if (!result.ok) {
            setPreferencesStatus(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }
        setPreferences(result.data);
        changeLocale(result.data.language);
        setPreferencesStatus(String(t('account.saved')));
    };

    const handleExport = async () => {
        setPendingAction('export');
        setAccountActionResult(undefined);
        const result = await exportDataViaApi();
        setPendingAction(undefined);

        if (!result.ok) {
            setAccountActionResult(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }

        const blob = new Blob([JSON.stringify(result.data, null, 2)], {
            type: 'application/json',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'patchwork-account-export.json';
        anchor.click();
        URL.revokeObjectURL(url);
        setAccountActionResult(t('account.exportReady'));
    };

    const handleDeactivate = async () => {
        setPendingAction('deactivate');
        setAccountActionResult(undefined);
        const result = await deactivateAccountViaApi();
        setPendingAction(undefined);

        if (!result.ok) {
            setAccountActionResult(
                `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            return;
        }

        setConfirmDeactivation(false);
        await onDeactivated();
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('account.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('account.description')}
                </p>
            </header>

            <Panel title={String(t('account.controls'))}>
                <div className='space-y-4'>
                    <Card title={String(t('account.preferences'))}>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('account.visibility')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={preferences.audience}
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            audience: event.target
                                                .value as AccountPreferences['audience'],
                                        }))
                                    }
                                >
                                    <option value='public'>
                                        {t('account.public')}
                                    </option>
                                    <option value='authenticated'>
                                        {t('account.signedIn')}
                                    </option>
                                    <option value='hidden'>
                                        {t('account.hidden')}
                                    </option>
                                </select>
                            </label>
                            <label className='text-sm font-bold'>
                                {t('account.language')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={preferences.language}
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            language: event.target
                                                .value as AccountPreferences['language'],
                                        }))
                                    }
                                >
                                    <option value='en'>
                                        {t('account.english')}
                                    </option>
                                    <option value='es'>
                                        {t('account.spanish')}
                                    </option>
                                </select>
                            </label>
                            <label className='text-sm font-bold'>
                                {t('account.location')}
                                <select
                                    className='mh-input mt-1 w-full px-3 py-2'
                                    value={preferences.location.sharing}
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            location: {
                                                ...current.location,
                                                sharing: event.target
                                                    .value as AccountPreferences['location']['sharing'],
                                            },
                                        }))
                                    }
                                >
                                    <option value='approximate'>
                                        {t('account.approximate')}
                                    </option>
                                    <option value='hidden'>
                                        {t('account.hidden')}
                                    </option>
                                </select>
                            </label>
                        </div>
                        <p className='mt-3 rounded-md border border-mh-border p-3 text-sm text-mh-textMuted'>
                            {t('account.exposurePreview', {
                                audience:
                                    preferences.audience === 'authenticated'
                                        ? t('account.signedIn')
                                        : t(`account.${preferences.audience}`),
                                location:
                                    preferences.location.sharing === 'approximate'
                                        ? t('account.approximate')
                                        : t('account.hidden'),
                            })}
                        </p>
                        <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                            {(
                                [
                                    ['inApp', 'In-app notifications'],
                                    ['email', 'Email notifications'],
                                    ['push', 'Browser push notifications'],
                                ] as const
                            ).map(([channel, label]) => (
                                <label
                                    key={channel}
                                    className='inline-flex items-center gap-2 text-sm'
                                >
                                    <input
                                        type='checkbox'
                                        checked={
                                            preferences.notifications[channel]
                                        }
                                        onChange={(event) =>
                                            setPreferences((current) => ({
                                                ...current,
                                                notifications: {
                                                    ...current.notifications,
                                                    [channel]:
                                                        event.target.checked,
                                                },
                                            }))
                                        }
                                    />
                                    {label}
                                </label>
                            ))}
                            <label className='inline-flex items-center gap-2 text-sm'>
                                <input
                                    type='checkbox'
                                    checked={
                                        preferences.location.noPermanentAddress
                                    }
                                    onChange={(event) =>
                                        setPreferences((current) => ({
                                            ...current,
                                            location: {
                                                ...current.location,
                                                noPermanentAddress:
                                                    event.target.checked,
                                            },
                                        }))
                                    }
                                />
                                {t('account.noAddress')}
                            </label>
                        </div>
                        <div className='mt-3 flex items-center gap-3'>
                            <Button
                                className='px-3 py-1 text-xs'
                                onClick={() => void savePreferences()}
                            >
                                {t('account.save')}
                            </Button>
                            {preferencesStatus ? (
                                <span
                                    role={
                                        preferencesStatus.startsWith('Error:')
                                            ? 'alert'
                                            : 'status'
                                    }
                                    className='text-xs'
                                >
                                    {preferencesStatus}
                                </span>
                            ) : null}
                        </div>
                    </Card>
                    <Card title={String(t('account.export'))}>
                        <p className='text-sm text-mh-textMuted'>
                            {t('account.exportHelp')}
                        </p>
                        <div className='mt-3'>
                            <Button
                                variant='secondary'
                                className='px-3 py-1 text-xs'
                                disabled={pendingAction !== undefined}
                                onClick={() => void handleExport()}
                            >
                                {pendingAction === 'export'
                                    ? t('account.preparing')
                                    : t('account.download')}
                            </Button>
                        </div>
                    </Card>

                    <Card title={String(t('account.deactivation'))}>
                        <p className='text-sm text-mh-textMuted'>
                            {t('account.deactivationHelp')}
                        </p>
                        <div className='mt-3'>
                            <Button
                                variant='neutral'
                                className='px-3 py-1 text-xs'
                                disabled={pendingAction !== undefined}
                                onClick={() => setConfirmDeactivation(true)}
                            >
                                {t('account.deactivate')}
                            </Button>
                        </div>
                        {confirmDeactivation ? (
                            <div
                                role='alertdialog'
                                aria-label={String(
                                    t('account.confirmDeactivate'),
                                )}
                                className='mh-alert mt-3'
                            >
                                <p className='text-sm font-bold'>
                                    {t('account.confirm')}
                                </p>
                                <p className='mt-1 text-xs'>
                                    {t('account.confirmHelp')}
                                </p>
                                <div className='mt-2 flex flex-wrap gap-2'>
                                    <Button
                                        type='button'
                                        disabled={pendingAction !== undefined}
                                        onClick={() => void handleDeactivate()}
                                    >
                                        {pendingAction === 'deactivate'
                                            ? t('account.deactivating')
                                            : t('account.confirmDeactivate')}
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='neutral'
                                        disabled={pendingAction !== undefined}
                                        onClick={() =>
                                            setConfirmDeactivation(false)
                                        }
                                    >
                                        {t('account.keep')}
                                    </Button>
                                </div>
                            </div>
                        ) : null}
                    </Card>

                    {accountActionResult ? (
                        <p
                            role={
                                accountActionResult.startsWith('Error:')
                                    ? 'alert'
                                    : 'status'
                            }
                            className='rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold'
                        >
                            {accountActionResult}
                        </p>
                    ) : null}
                </div>
            </Panel>
        </section>
    );
};

interface PolicyConsentGateProps {
    onAccepted: () => void;
}

const policyLabelKeys: Readonly<Record<string, string>> = {
    'terms-of-use': 'consent.terms',
    'privacy-notice': 'consent.privacy',
    'community-guidelines': 'consent.guidelines',
    'synthetic-data-disclosure': 'consent.synthetic',
    'location-sharing-consent': 'consent.location',
};

const PolicyConsentGate = ({ onAccepted }: PolicyConsentGateProps) => {
    const { t } = useLocale();
    const [accepted, setAccepted] = useState<Set<string>>(new Set());
    const [eligible, setEligible] = useState(false);
    const [status, setStatus] = useState<string>();
    const allAccepted = requiredPolicyDocuments.every((document) =>
        accepted.has(document),
    );

    const submit = async () => {
        setStatus(t('consent.recording'));
        const result = await acceptCurrentPoliciesViaApi();
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${result.error}`);
            return;
        }
        setStatus(t('consent.recorded'));
        onAccepted();
    };

    return (
        <Panel title={t('consent.title')}>
            <p className='text-sm text-mh-textMuted'>
                {t('consent.version', { version: CURRENT_POLICY_VERSION })}
            </p>
            <div className='mt-4 space-y-2'>
                {requiredPolicyDocuments.map((document) => (
                    <label
                        key={document}
                        className='flex items-start gap-2 text-sm'
                    >
                        <input
                            type='checkbox'
                            checked={accepted.has(document)}
                            onChange={(event) =>
                                setAccepted((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked)
                                        next.add(document);
                                    else next.delete(document);
                                    return next;
                                })
                            }
                        />
                        {t('consent.accept', {
                            policy: t(policyLabelKeys[document]),
                        })}
                    </label>
                ))}
                <label className='flex items-start gap-2 text-sm font-bold'>
                    <input
                        type='checkbox'
                        checked={eligible}
                        onChange={(event) => setEligible(event.target.checked)}
                    />
                    {t('consent.age')}
                </label>
            </div>
            <div className='mt-4 flex items-center gap-3'>
                <Button
                    disabled={!allAccepted || !eligible}
                    onClick={() => void submit()}
                >
                    {t('consent.continue')}
                </Button>
                {status ? (
                    <span
                        role={status.startsWith('Error:') ? 'alert' : 'status'}
                        className='text-xs'
                    >
                        {status}
                    </span>
                ) : null}
            </div>
        </Panel>
    );
};

const SettingsRoute = ({ currentUserDid }: SettingsRouteProps) => {
    const [settings, setSettings] = useState<UserSettings>(
        defaultSettingsViewModel.settings,
    );
    const [savedSettings, setSavedSettings] = useState<UserSettings>(
        defaultSettingsViewModel.settings,
    );
    const [activeSection, setActiveSection] =
        useState<SettingsSection>('privacy');
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string>();
    const [saveSuccess, setSaveSuccess] = useState<string>();
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [auditEntries, setAuditEntries] = useState<
        readonly {
            field: string;
            oldValue: unknown;
            newValue: unknown;
            timestamp: string;
            actor: string;
        }[]
    >([]);
    const [isLoadingAudit, setIsLoadingAudit] = useState(false);
    const [accountActionResult, setAccountActionResult] = useState<string>();

    const dirty = useMemo(
        () => isSettingsDirty(settings, savedSettings),
        [settings, savedSettings],
    );

    useEffect(() => {
        const controller = new AbortController();
        setIsLoadingSettings(true);

        void fetchSettingsFromApi(currentUserDid, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) {
                    return;
                }
                if (result.ok) {
                    setSettings(result.data.settings);
                    setSavedSettings(result.data.settings);
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoadingSettings(false);
                }
            });

        return () => {
            controller.abort();
        };
    }, [currentUserDid]);

    const handlePatch = (patch: SettingsPatch) => {
        setSettings((current) => applySettingsPatch(current, patch));
        setSaveSuccess(undefined);
        setSaveError(undefined);
    };

    const handleSave = async () => {
        const validation = validateSettings(settings);
        if (!validation.ok) {
            setSaveError(validation.errors.join('; '));
            return;
        }

        setIsSaving(true);
        setSaveError(undefined);
        setSaveSuccess(undefined);

        const result = await updateSettingsViaApi(currentUserDid, settings);
        setIsSaving(false);

        if (!result.ok) {
            setSaveError(result.error);
            return;
        }

        setSavedSettings(result.data.settings);
        setSettings(result.data.settings);
        setSaveSuccess(
            `Settings saved. ${result.data.changesRecorded} change(s) recorded.`,
        );
    };

    const handleCancel = () => {
        setSettings(savedSettings);
        setSaveError(undefined);
        setSaveSuccess(undefined);
    };

    const handleLoadAudit = async () => {
        setIsLoadingAudit(true);
        const result = await fetchSettingsAuditFromApi(currentUserDid);
        setIsLoadingAudit(false);

        if (result.ok) {
            setAuditEntries(result.data.entries);
        }
    };

    const handleDeactivate = async () => {
        setAccountActionResult(undefined);
        const result = await deactivateAccountViaApi();

        if (result.ok) {
            setAccountActionResult(
                'Account deactivated. Patchwork sessions are revoked and public projections are removed.',
            );
        } else {
            setAccountActionResult(`Error: ${result.error}`);
        }
    };

    const handleExport = async () => {
        setAccountActionResult(undefined);
        const result = await exportDataViaApi();

        if (result.ok) {
            const blob = new Blob([JSON.stringify(result.data, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'patchwork-account-export.json';
            anchor.click();
            URL.revokeObjectURL(url);
            setAccountActionResult('Your Patchwork data export is ready.');
        } else {
            setAccountActionResult(`Error: ${result.error}`);
        }
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>Account settings</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    Privacy controls, contact preferences, notifications, and
                    account management.
                </p>
                {dirty ? (
                    <div className='mt-3'>
                        <Badge tone='info'>Unsaved changes</Badge>
                    </div>
                ) : null}
            </header>

            {/* Section tabs */}
            <div className='flex flex-wrap gap-2'>
                {settingsSections.map((section) => (
                    <Button
                        key={section}
                        variant={
                            activeSection === section ? 'secondary' : 'neutral'
                        }
                        className='px-3 py-1 text-xs'
                        onClick={() => setActiveSection(section)}
                    >
                        {settingsSectionLabels[section]}
                    </Button>
                ))}
            </div>

            <p className='text-sm text-mh-textMuted'>
                {settingsSectionDescriptions[activeSection]}
            </p>

            {isLoadingSettings ? (
                <Panel title='Loading settings'>
                    <div className='space-y-3'>
                        <div className='mh-skeleton h-4 w-3/4' />
                        <div className='mh-skeleton h-4 w-1/2' />
                        <div className='mh-skeleton h-4 w-2/3' />
                    </div>
                </Panel>
            ) : null}

            {/* Privacy section */}
            {!isLoadingSettings && activeSection === 'privacy' ? (
                <Panel title='Privacy controls'>
                    <div className='space-y-4'>
                        <div>
                            <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                                Audience
                            </p>
                            <div className='flex flex-wrap gap-2'>
                                {privacyLevels.map((level) => (
                                    <Button
                                        key={level}
                                        variant={
                                            settings.privacyLevel === level
                                                ? 'secondary'
                                                : 'neutral'
                                        }
                                        className='px-3 py-1 text-xs'
                                        onClick={() =>
                                            handlePatch({
                                                section: 'privacy',
                                                field: 'privacyLevel',
                                                value: level,
                                            })
                                        }
                                    >
                                        {level === 'authenticated' ? 'Signed-in' : formatCategoryLabel(level)}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className='mb-2 text-xs font-bold uppercase tracking-[0.12em] text-mh-text'>
                                Location
                            </p>
                            <div className='flex flex-wrap gap-2'>
                                {geoSharingPrecisions.map((precision) => (
                                    <Button
                                        key={precision}
                                        variant={
                                            settings.locationVisibility ===
                                            precision
                                                ? 'secondary'
                                                : 'neutral'
                                        }
                                        className='px-3 py-1 text-xs'
                                        onClick={() =>
                                            handlePatch({
                                                section: 'privacy',
                                                field: 'locationVisibility',
                                                value: precision,
                                            })
                                        }
                                    >
                                        {precision === 'approximate' ? 'Approximate area' : 'Hidden'}
                                    </Button>
                                ))}
                            </div>
                        </div>
                        <p className='rounded-md border border-mh-border p-3 text-sm text-mh-textMuted'>
                            {privacyExposurePreview(
                                settings.privacyLevel,
                                settings.locationVisibility,
                            )}
                        </p>
                    </div>
                </Panel>
            ) : null}

            {/* Contact section */}
            {!isLoadingSettings && activeSection === 'contact' ? (
                <Panel title='Contact preferences'>
                    <div className='space-y-3'>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.contactPreferences
                                        .allowDirectMessages
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'contact',
                                        field: 'allowDirectMessages',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Allow direct messages
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={settings.contactPreferences.showEmail}
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'contact',
                                        field: 'showEmail',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Show email on profile
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={settings.contactPreferences.showPhone}
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'contact',
                                        field: 'showPhone',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Show phone on profile
                        </label>
                    </div>
                </Panel>
            ) : null}

            {/* Notifications section */}
            {!isLoadingSettings && activeSection === 'notifications' ? (
                <Panel title='Notification preferences'>
                    <div className='space-y-3'>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .aidRequestUpdates
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'aidRequestUpdates',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Aid request updates
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .chatMessages
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'chatMessages',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Chat messages
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .volunteerMatches
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'volunteerMatches',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            Volunteer matches
                        </label>
                        <label className='inline-flex items-center gap-2 text-sm text-mh-textMuted'>
                            <input
                                type='checkbox'
                                className='h-4 w-4'
                                checked={
                                    settings.notificationPreferences
                                        .systemAnnouncements
                                }
                                onChange={(event) =>
                                    handlePatch({
                                        section: 'notifications',
                                        field: 'systemAnnouncements',
                                        value: event.target.checked,
                                    })
                                }
                            />
                            System announcements
                        </label>
                    </div>
                </Panel>
            ) : null}

            {/* Account section */}
            {!isLoadingSettings && activeSection === 'account' ? (
                <Panel title='Account management'>
                    <div className='space-y-4'>
                        <Card title='Data export'>
                            <p className='text-sm text-mh-textMuted'>
                                Download the data Patchwork currently holds
                                about your authenticated account. Credentials,
                                third-party casework, and a complete AT
                                repository archive are excluded.
                            </p>
                            <div className='mt-3'>
                                <Button
                                    variant='secondary'
                                    className='px-3 py-1 text-xs'
                                    onClick={handleExport}
                                >
                                    Download data export
                                </Button>
                            </div>
                        </Card>

                        <Card title='Account deactivation'>
                            <p className='text-sm text-mh-textMuted'>
                                Deactivation immediately revokes Patchwork
                                sessions and removes your posts from Patchwork
                                discovery. Records in your independent AT
                                Protocol repository are not deleted.
                                Reactivation requires a controlled support
                                review.
                            </p>
                            <div className='mt-3'>
                                <Button
                                    variant='neutral'
                                    className='px-3 py-1 text-xs'
                                    onClick={handleDeactivate}
                                >
                                    Deactivate account
                                </Button>
                            </div>
                        </Card>

                        {accountActionResult ? (
                            <p className='rounded-none border-2 border-mh-border bg-mh-surfaceElev px-3 py-2 text-xs font-bold text-mh-success'>
                                {accountActionResult}
                            </p>
                        ) : null}

                        <Card title='Audit trail'>
                            <p className='text-sm text-mh-textMuted'>
                                View a log of all settings changes made to your
                                account.
                            </p>
                            <div className='mt-3'>
                                <Button
                                    variant='neutral'
                                    className='px-3 py-1 text-xs'
                                    onClick={handleLoadAudit}
                                    disabled={isLoadingAudit}
                                >
                                    {isLoadingAudit
                                        ? 'Loading...'
                                        : 'Load audit trail'}
                                </Button>
                            </div>

                            {auditEntries.length > 0 ? (
                                <ul className='mt-3 space-y-2'>
                                    {auditEntries.map((entry, index) => (
                                        <li
                                            key={`audit-${index}-${entry.field}`}
                                            className='rounded-none border-2 border-mh-borderSoft bg-mh-surfaceElev p-2 text-xs'
                                        >
                                            <p className='font-bold text-mh-text'>
                                                {entry.field}
                                            </p>
                                            <p className='text-mh-textSoft'>
                                                {String(entry.oldValue)} →{' '}
                                                {String(entry.newValue)}
                                            </p>
                                            <p className='text-mh-textSoft'>
                                                {new Date(
                                                    entry.timestamp,
                                                ).toLocaleString()}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </Card>
                    </div>
                </Panel>
            ) : null}

            {/* Save / Cancel bar */}
            {!isLoadingSettings && activeSection !== 'account' ? (
                <div className='flex flex-wrap items-center gap-3'>
                    <Button onClick={handleSave} disabled={!dirty || isSaving}>
                        {isSaving ? 'Saving...' : 'Save settings'}
                    </Button>
                    <Button
                        variant='neutral'
                        onClick={handleCancel}
                        disabled={!dirty}
                    >
                        Cancel
                    </Button>
                    {saveError ? (
                        <p className='mh-alert text-xs font-bold'>
                            {saveError}
                        </p>
                    ) : null}
                    {saveSuccess ? (
                        <p className='text-xs font-bold text-mh-success'>
                            {saveSuccess}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
};

const maintenanceReasonOptions: readonly {
    code: MaintenanceReasonCode;
    labelKey: string;
}[] = [
    { code: 'privacy', labelKey: 'moderator.privacyReason' },
    { code: 'authorization', labelKey: 'moderator.authorizationReason' },
    { code: 'abuse', labelKey: 'moderator.abuseReason' },
    { code: 'integrity', labelKey: 'moderator.integrityReason' },
    { code: 'moderation-backlog', labelKey: 'moderator.backlogReason' },
    { code: 'monitoring', labelKey: 'moderator.monitoringReason' },
    { code: 'backup', labelKey: 'moderator.backupReason' },
];

const ModeratorConsoleRoute = ({
    onMaintenanceChanged,
    currentUserDid,
}: {
    onMaintenanceChanged(state: MaintenanceState): void;
    currentUserDid: string;
}) => {
    const { t, fmt } = useLocale();
    const [items, setItems] = useState<ModerationQueueItem[]>([]);
    const [audit, setAudit] = useState<ModerationAuditRecord[]>([]);
    const [maintenance, setMaintenance] = useState<MaintenanceState>();
    const [selectedUri, setSelectedUri] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [priorityFilter, setPriorityFilter] = useState('');
    const [appealFilter, setAppealFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [reason, setReason] = useState(t('moderator.defaultReason'));
    const [maintenanceReasons, setMaintenanceReasons] = useState<
        MaintenanceReasonCode[]
    >(['integrity']);
    const [publicMessage, setPublicMessage] = useState(
        t('moderator.defaultPublicMessage'),
    );
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string>();
    const [accessDenied, setAccessDenied] = useState(false);
    const [notice, setNotice] = useState<string>();
    const [shutdownConfirmed, setShutdownConfirmed] = useState(false);

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setIsLoading(true);
            setError(undefined);
            const [queueResult, maintenanceResult] = await Promise.all([
                fetchModerationQueueViaApi(signal),
                fetchModeratorMaintenanceViaApi(signal),
            ]);
            if (signal?.aborted) return;
            const denied =
                (!queueResult.ok &&
                    (queueResult.code === 'AUTHORIZATION_DENIED' ||
                        queueResult.code === 'AUTHENTICATION_REQUIRED')) ||
                (!maintenanceResult.ok &&
                    (maintenanceResult.code === 'AUTHORIZATION_DENIED' ||
                        maintenanceResult.code === 'AUTHENTICATION_REQUIRED'));
            if (denied) {
                setAccessDenied(true);
                setIsLoading(false);
                return;
            }
            if (!queueResult.ok || !maintenanceResult.ok) {
                setError(
                    !queueResult.ok
                        ? queueResult.error
                        : !maintenanceResult.ok
                          ? maintenanceResult.error
                          : t('moderator.unavailable'),
                );
                setIsLoading(false);
                return;
            }
            setAccessDenied(false);
            setItems(queueResult.data);
            setMaintenance(maintenanceResult.data);
            onMaintenanceChanged(maintenanceResult.data);
            setSelectedUri((current) =>
                queueResult.data.some((item) => item.subjectUri === current)
                    ? current
                    : (queueResult.data[0]?.subjectUri ?? ''),
            );
            setIsLoading(false);
        },
        [onMaintenanceChanged, t],
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const selected = items.find((item) => item.subjectUri === selectedUri);
    const filteredItems = items.filter(
        (item) =>
            (!statusFilter || item.queueStatus === statusFilter) &&
            (!priorityFilter ||
                (item.priority ?? 'normal') === priorityFilter) &&
            (!appealFilter || item.appealState === appealFilter) &&
            (!typeFilter || item.subjectType === typeFilter),
    );

    const loadAudit = async (subjectUri: string) => {
        setSelectedUri(subjectUri);
        const result = await fetchModerationAuditViaApi(subjectUri);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setAudit(result.data);
    };

    const applyAction = async (action: ModerationPolicyAction) => {
        if (!selected || reason.trim().length < 1) return;
        setIsSaving(true);
        setError(undefined);
        const result = await applyModerationPolicyViaApi({
            subjectUri: selected.subjectUri,
            action,
            reason: reason.trim(),
        });
        setIsSaving(false);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setItems((current) =>
            current.map((item) =>
                item.subjectUri === result.data.subjectUri ? result.data : item,
            ),
        );
        setNotice(t('moderator.actionRecorded', {
            action: formatLocalizedLabel(t, action),
        }));
        await loadAudit(result.data.subjectUri);
    };

    const declareMaintenance = async () => {
        if (maintenanceReasons.length === 0) {
            setError(t('moderator.chooseReason'));
            return;
        }
        setIsSaving(true);
        const result = await declareMaintenanceViaApi({
            reasonCodes: maintenanceReasons,
            publicMessage,
        });
        setIsSaving(false);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setMaintenance(result.data);
        onMaintenanceChanged(result.data);
        setShutdownConfirmed(false);
        setNotice(t('moderator.shutdownRecorded'));
    };

    const resume = async () => {
        setIsSaving(true);
        const result = await resumeMaintenanceViaApi();
        setIsSaving(false);
        if (!result.ok) {
            setError(t('common.requestFailed'));
            return;
        }
        setMaintenance(result.data);
        onMaintenanceChanged(result.data);
        setNotice(t('moderator.resumeRecorded'));
    };

    if (accessDenied) {
        return (
            <Panel title={t('moderator.accessRequired')}>
                <p role='alert'>{t('moderator.accessHelp')}</p>
            </Panel>
        );
    }

    return (
        <div className='space-y-5'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('moderator.title')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('moderator.description')}
                </p>
            </header>
            <Panel title={t('moderator.title')}>
                <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                    <div>
                        <dt className='font-bold'>{t('moderator.actor')}</dt>
                        <dd className='break-all'>{currentUserDid}</dd>
                    </div>
                    <div>
                        <dt className='font-bold'>
                            {t('moderator.capability')}
                        </dt>
                        <dd>{t('moderator.capabilityValue')}</dd>
                    </div>
                    <div>
                        <dt className='font-bold'>
                            {t('moderator.environment')}
                        </dt>
                        <dd>{import.meta.env.MODE}</dd>
                    </div>
                    <div>
                        <dt className='font-bold'>{t('moderator.scope')}</dt>
                        <dd>{t('moderator.scopeValue')}</dd>
                    </div>
                </dl>
                <p className='mt-2 text-sm font-bold'>
                    {t('moderator.reviewTarget')}
                </p>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('moderator.noGo')}
                </p>
                <div className='mt-3 flex flex-wrap gap-3 text-sm'>
                    <a className='font-bold underline' href='/verification'>
                        {t('moderator.verificationControls')}
                    </a>
                    <a className='font-bold underline' href='/verification'>
                        {t('moderator.privateControls')}
                    </a>
                </div>
            </Panel>

            {error ? (
                <p
                    role='alert'
                    className='border-2 border-mh-danger p-3 font-bold'
                >
                    {error}
                </p>
            ) : null}
            {notice ? (
                <p
                    role='status'
                    className='border-2 border-mh-border p-3 font-bold'
                >
                    {notice}
                </p>
            ) : null}

            <Panel title={t('moderator.shutdown')}>
                <p className='text-sm text-mh-textMuted'>
                    {t('moderator.shutdownHelp')}
                </p>
                <p className='mt-2 font-bold'>
                    {t('moderator.currentState', {
                        state: maintenance?.active
                            ? t('moderator.readOnly')
                            : t('moderator.operating'),
                    })}
                    {maintenance?.environmentOverride
                        ? ` (${t('moderator.environmentOverride')})`
                        : ''}
                </p>
                <div className='mt-3 grid gap-2 sm:grid-cols-2'>
                    {maintenanceReasonOptions.map((option) => (
                        <label
                            key={option.code}
                            className='flex items-center gap-2 text-sm'
                        >
                            <input
                                type='checkbox'
                                checked={maintenanceReasons.includes(
                                    option.code,
                                )}
                                onChange={(event) =>
                                    setMaintenanceReasons((current) =>
                                        event.target.checked
                                            ? [...current, option.code]
                                            : current.filter(
                                                  (code) =>
                                                      code !== option.code,
                                              ),
                                    )
                                }
                            />
                            {t(option.labelKey)}
                        </label>
                    ))}
                </div>
                <label className='mt-3 block text-sm font-bold'>
                    {t('moderator.publicMessage')}
                    <Input
                        value={publicMessage}
                        maxLength={300}
                        onChange={(event) =>
                            setPublicMessage(event.target.value)
                        }
                    />
                </label>
                <div className='mt-3 border-2 border-mh-danger p-3 text-sm'>
                    <p className='font-bold'>{t('moderator.blastRadius')}</p>
                    <p className='mt-1 text-mh-textMuted'>
                        {t('moderator.blastRadiusHelp')}
                    </p>
                    <label className='mt-3 flex items-start gap-2 font-bold'>
                        <input
                            type='checkbox'
                            checked={shutdownConfirmed}
                            onChange={(event) =>
                                setShutdownConfirmed(event.target.checked)
                            }
                        />
                        {t('moderator.confirmShutdown')}
                    </label>
                </div>
                <div className='mt-3 flex flex-wrap gap-2'>
                    <Button
                        variant='neutral'
                        disabled={
                            isSaving ||
                            maintenance?.active ||
                            !shutdownConfirmed ||
                            maintenanceReasons.length === 0 ||
                            publicMessage.trim().length === 0
                        }
                        onClick={() => void declareMaintenance()}
                    >
                        {t('moderator.shutDown')}
                    </Button>
                    <Button
                        variant='secondary'
                        disabled={
                            isSaving ||
                            !maintenance?.active ||
                            maintenance.environmentOverride
                        }
                        onClick={() => void resume()}
                    >
                        {t('moderator.resume')}
                    </Button>
                </div>
            </Panel>

            <Panel title={t('moderator.queue')}>
                <div className='grid gap-2 sm:grid-cols-4'>
                    <select
                        aria-label={t('moderator.filterStatus')}
                        value={statusFilter}
                        onChange={(event) =>
                            setStatusFilter(event.target.value)
                        }
                    >
                        <option value=''>{t('moderator.allStatuses')}</option>
                        <option value='queued'>{t('moderator.queued')}</option>
                        <option value='processing'>
                            {t('moderator.processing')}
                        </option>
                        <option value='resolved'>
                            {t('moderator.resolved')}
                        </option>
                    </select>
                    <select
                        aria-label={t('moderator.filterPriority')}
                        value={priorityFilter}
                        onChange={(event) =>
                            setPriorityFilter(event.target.value)
                        }
                    >
                        <option value=''>{t('moderator.allPriorities')}</option>
                        <option value='urgent'>{t('moderator.urgent')}</option>
                        <option value='high'>{t('moderator.high')}</option>
                        <option value='normal'>{t('moderator.normal')}</option>
                        <option value='low'>{t('moderator.low')}</option>
                    </select>
                    <select
                        aria-label={t('moderator.filterAppeal')}
                        value={appealFilter}
                        onChange={(event) =>
                            setAppealFilter(event.target.value)
                        }
                    >
                        <option value=''>{t('moderator.allAppeals')}</option>
                        <option value='none'>{t('moderator.noAppeal')}</option>
                        <option value='pending'>
                            {t('moderator.pending')}
                        </option>
                        <option value='under-review'>
                            {t('moderator.underReview')}
                        </option>
                        <option value='upheld'>{t('moderator.upheld')}</option>
                        <option value='rejected'>
                            {t('moderator.rejected')}
                        </option>
                    </select>
                    <select
                        aria-label={t('moderator.filterType')}
                        value={typeFilter}
                        onChange={(event) => setTypeFilter(event.target.value)}
                    >
                        <option value=''>{t('moderator.allTypes')}</option>
                        <option value='aid-post'>
                            {t('moderator.aidPost')}
                        </option>
                        <option value='directory-resource'>
                            {t('moderator.directoryResource')}
                        </option>
                        <option value='other'>{t('moderator.other')}</option>
                    </select>
                </div>
                {isLoading ? (
                    <p className='mt-4' role='status'>
                        {t('moderator.loading')}
                    </p>
                ) : filteredItems.length === 0 ? (
                    <p className='mt-4'>{t('moderator.empty')}</p>
                ) : (
                    <div className='mt-4 grid gap-3 lg:grid-cols-2'>
                        {filteredItems.map((item) => (
                            <button
                                type='button'
                                key={item.subjectUri}
                                onClick={() => void loadAudit(item.subjectUri)}
                                className='border-2 border-mh-border p-3 text-left'
                                aria-pressed={selectedUri === item.subjectUri}
                            >
                                <span className='font-bold'>
                                    {item.safePreview?.['label'] ??
                                        t('moderator.submitted')}
                                </span>
                                <span className='mt-1 block text-xs uppercase'>
                                    {item.priority ?? 'normal'} ·{' '}
                                    {item.subjectType} · {item.queueStatus} ·{' '}
                                    {item.recordOrigin ??
                                        t('moderator.visitorCreated')}
                                </span>
                                <span className='mt-2 block text-sm'>
                                    {(
                                        item.reasonCodes ?? [item.latestReason]
                                    ).join(', ')}
                                </span>
                                <span className='mt-2 block break-all text-xs text-mh-textMuted'>
                                    {item.subjectUri}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </Panel>

            {selected ? (
                <Panel title={t('moderator.caseActions')}>
                    <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                        {Object.entries(selected.safePreview ?? {}).map(
                            ([key, value]) => (
                                <div key={key}>
                                    <dt className='font-bold'>{key}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ),
                        )}
                    </dl>
                    <label className='mt-3 block text-sm font-bold'>
                        {t('moderator.auditReason')}
                        <Input
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                        />
                    </label>
                    <div className='mt-3 flex flex-wrap gap-2'>
                        {selected.visibility !== 'suspended' ? (
                            <Button
                                variant='neutral'
                                disabled={isSaving}
                                onClick={() =>
                                    void applyAction('suspend-visibility')
                                }
                            >
                                {t('moderator.quarantine')}
                            </Button>
                        ) : null}
                        {selected.visibility !== 'delisted' ? (
                            <Button
                                variant='neutral'
                                disabled={isSaving}
                                onClick={() => void applyAction('delist')}
                            >
                                {t('moderator.delist')}
                            </Button>
                        ) : null}
                        {selected.visibility !== 'visible' ? (
                            <Button
                                variant='secondary'
                                disabled={isSaving}
                                onClick={() =>
                                    void applyAction('restore-visibility')
                                }
                            >
                                {t('moderator.restore')}
                            </Button>
                        ) : null}
                        {selected.appealState === 'none' ? (
                            <Button
                                variant='secondary'
                                disabled={isSaving}
                                onClick={() => void applyAction('open-appeal')}
                            >
                                {t('moderator.openAppeal')}
                            </Button>
                        ) : selected.appealState === 'pending' ? (
                            <Button
                                variant='secondary'
                                disabled={isSaving}
                                onClick={() =>
                                    void applyAction('start-appeal-review')
                                }
                            >
                                {t('moderator.startAppeal')}
                            </Button>
                        ) : selected.appealState === 'under-review' ? (
                            <>
                                <Button
                                    variant='secondary'
                                    disabled={isSaving}
                                    onClick={() =>
                                        void applyAction(
                                            'resolve-appeal-upheld',
                                        )
                                    }
                                >
                                    {t('moderator.upholdAppeal')}
                                </Button>
                                <Button
                                    variant='neutral'
                                    disabled={isSaving}
                                    onClick={() =>
                                        void applyAction(
                                            'resolve-appeal-rejected',
                                        )
                                    }
                                >
                                    {t('moderator.rejectAppeal')}
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <h3 className='mt-5 font-bold'>
                        {t('moderator.auditTrail')}
                    </h3>
                    {audit.length === 0 ? (
                        <p className='text-sm text-mh-textMuted'>
                            {t('moderator.selectAudit')}
                        </p>
                    ) : (
                        <ol className='mt-2 space-y-2'>
                            {audit.map((entry) => (
                                <li
                                    key={entry.actionId}
                                    className='border-l-4 border-mh-border pl-3 text-sm'
                                >
                                    <strong>
                                        {t('moderator.auditBy', {
                                            action: formatLocalizedLabel(
                                                t,
                                                entry.action,
                                            ),
                                            actor: entry.actorDid,
                                        })}
                                    </strong>
                                    <span className='block'>
                                        {entry.reason}
                                    </span>
                                    <time dateTime={entry.occurredAt}>
                                        {fmt.longDate(entry.occurredAt)}
                                    </time>
                                </li>
                            ))}
                        </ol>
                    )}
                </Panel>
            ) : null}
        </div>
    );
};

export const FrontendShell = ({ appTitle }: FrontendShellProps) => {
    const auth = useAuth();
    const { locale, changeLocale, t } = useLocale();
    const mainContentRef = useRef<HTMLDivElement>(null);
    const mobileNavToggleRef = useRef<HTMLButtonElement>(null);
    const secondaryNavRef = useRef<HTMLDivElement>(null);
    const secondaryNavToggleRef = useRef<HTMLButtonElement>(null);
    const [currentRoute, setCurrentRoute] = useState<AppRoute>(() =>
        readCurrentRoute(),
    );

    const [discoveryState, setDiscoveryState] = useState<DiscoveryFilterState>(
        () => readDiscoveryStateFromUrl(defaultShellDiscoveryState),
    );

    const [feedRecords, setFeedRecords] = useState<FeedRecordEnvelope[]>([]);
    const [resourceCards, setResourceCards] = useState<ResourceDirectoryCard[]>(
        [],
    );
    const [isAidLoading, setIsAidLoading] = useState(false);
    const [isDirectoryLoading, setIsDirectoryLoading] = useState(false);
    const [aidErrorMessage, setAidErrorMessage] = useState<string>();
    const [publicSyncFailure, setPublicSyncFailure] =
        useState<PublicSyncFailure>();
    const [publicSyncRetrying, setPublicSyncRetrying] = useState(false);
    const [directoryErrorMessage, setDirectoryErrorMessage] =
        useState<string>();
    const [aidDataOrigin, setAidDataOrigin] = useState<ApiDataOrigin>(
        webDataMode === 'fixture' ? 'fixture' : 'idle',
    );
    const [directoryDataOrigin, setDirectoryDataOrigin] =
        useState<ApiDataOrigin>(
            webDataMode === 'fixture' ? 'fixture' : 'idle',
        );
    const [aidReload, setAidReload] = useState(0);
    const [directoryReload, setDirectoryReload] = useState(0);
    const [aidPage, setAidPage] = useState(() => readPaginationPageFromUrl());
    const [aidHasNextPage, setAidHasNextPage] = useState(false);
    const [aidTotal, setAidTotal] = useState(0);
    const [directoryPage, setDirectoryPage] = useState(() => readPaginationPageFromUrl());
    const [directoryHasNextPage, setDirectoryHasNextPage] = useState(false);
    const [directoryTotal, setDirectoryTotal] = useState(0);
    const [selectedMapPostId, setSelectedMapPostId] = useState<string>();
    const [chatIntent, setChatIntent] = useState<ChatInitiationIntent>();
    const [chatState, setChatState] = useState<ChatLaunchState>(
        defaultChatLaunchState,
    );
    const [hasChatPermission, setHasChatPermission] = useState(true);
    const [forceChatFallback, setForceChatFallback] = useState(false);
    const [chatRequestPreview, setChatRequestPreview] = useState<string>();
    const [consentRequired, setConsentRequired] = useState<boolean | undefined>(
        webDataMode === 'fixture' ? false : undefined,
    );
    const [onboardingError, setOnboardingError] = useState<string>();
    const [maintenanceStatus, setMaintenanceStatus] =
        useState<MaintenanceState>();
    const [isOnline, setIsOnline] = useState(
        typeof navigator === 'undefined' ? true : navigator.onLine,
    );
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const [isSecondaryNavOpen, setIsSecondaryNavOpen] = useState(false);
    const [historyVersion, setHistoryVersion] = useState(0);

    const currentUserDid = auth.session?.did ?? '';

    useEffect(() => {
        document.title = `${t(routeLabelKeys[currentRoute])} · ${appTitle}`;
    }, [appTitle, currentRoute, locale, t]);

    useEffect(() => {
        if (!isMobileNavOpen && !isSecondaryNavOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (isSecondaryNavOpen) {
                setIsSecondaryNavOpen(false);
                secondaryNavToggleRef.current?.focus();
                return;
            }
            if (isMobileNavOpen) {
                setIsMobileNavOpen(false);
                mobileNavToggleRef.current?.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isMobileNavOpen, isSecondaryNavOpen]);

    useEffect(() => {
        if (!isSecondaryNavOpen) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            if (
                event.target instanceof Node &&
                !secondaryNavRef.current?.contains(event.target)
            ) {
                setIsSecondaryNavOpen(false);
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => document.removeEventListener('pointerdown', onPointerDown);
    }, [isSecondaryNavOpen]);

    useEffect(() => {
        if (!auth.session || webDataMode === 'fixture') return;
        const controller = new AbortController();
        void fetchAccountPreferencesViaApi(controller.signal).then((result) => {
            if (!controller.signal.aborted && result.ok) {
                changeLocale(result.data.language);
            }
        });
        return () => controller.abort();
    }, [auth.session, changeLocale]);

    useEffect(() => {
        if (webDataMode === 'fixture') return;
        const controller = new AbortController();
        void fetchPublicMaintenanceStatusViaApi(controller.signal).then(
            (result) => {
                if (!controller.signal.aborted && result.ok) {
                    setMaintenanceStatus(result.data);
                }
            },
        );
        return () => controller.abort();
    }, []);

    useEffect(() => {
        const online = () => setIsOnline(true);
        const offline = () => setIsOnline(false);
        window.addEventListener('online', online);
        window.addEventListener('offline', offline);
        return () => {
            window.removeEventListener('online', online);
            window.removeEventListener('offline', offline);
        };
    }, []);

    useEffect(() => {
        if (webDataMode === 'fixture' || !auth.session) {
            setConsentRequired(false);
            setOnboardingError(undefined);
            return;
        }
        const controller = new AbortController();
        setConsentRequired(undefined);
        setOnboardingError(undefined);
        void fetchAccountOnboardingViaApi(controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            if (!result.ok) {
                setOnboardingError(result.error);
                return;
            }
            setConsentRequired(result.data.consentRequired);
        });
        return () => controller.abort();
    }, [auth.session]);

    useEffect(() => {
        if (import.meta.env.VITE_DATA_MODE !== 'fixture') {
            return;
        }

        let active = true;
        void import('./fixtures').then(
            ({ fixtureFeedRecords, fixtureResourceCards }) => {
                if (!active) return;
                setFeedRecords([...fixtureFeedRecords]);
                setResourceCards([...fixtureResourceCards]);
            },
        );

        return () => {
            active = false;
        };
    }, []);

    const discoveryQueryString = useMemo(
        () => serializeDiscoveryFilterState(discoveryState),
        [discoveryState],
    );

    const resetDiscoveryKeyRef = useRef(`${currentRoute}:${discoveryQueryString}`);
    useEffect(() => {
        const key = `${currentRoute}:${discoveryQueryString}`;
        if (resetDiscoveryKeyRef.current === key) return;
        resetDiscoveryKeyRef.current = key;
        setAidPage(1);
        setAidHasNextPage(false);
        setAidTotal(0);
        setDirectoryPage(1);
        setDirectoryHasNextPage(false);
        setDirectoryTotal(0);
    }, [currentRoute, discoveryQueryString]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return undefined;
        }

        const handlePopState = () => {
            setIsMobileNavOpen(false);
            setIsSecondaryNavOpen(false);
            setCurrentRoute(readCurrentRoute());
            setHistoryVersion((version) => version + 1);
            const page = readPaginationPageFromUrl();
            setAidPage(page);
            setDirectoryPage(page);
            setDiscoveryState(
                readDiscoveryStateFromUrl(defaultShellDiscoveryState),
            );
            setSelectedMapPostId(undefined);
        };

        window.addEventListener('popstate', handlePopState);
        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const page = currentRoute === '/resources' ? directoryPage
            : currentRoute === '/map' || currentRoute === '/feed' ? aidPage : 1;
        const pageParams = new URLSearchParams(discoveryQueryString);
        // Preserve selected-item and authentication return context across filter updates.
        const contextParams = new URLSearchParams(window.location.search);
        for (const key of ['resource', 'uri', 'connection', 'view', 'dataset', 'resourceName']) {
            const value = contextParams.get(key);
            if (value) pageParams.set(key, value);
        }
        if (page > 1) pageParams.set('page', String(page));
        else pageParams.delete('page');
        const nextUrl = `${currentRoute}${pageParams.toString() ? `?${pageParams.toString()}` : ''}`;
        const currentUrl = `${window.location.pathname}${window.location.search}`;

        if (nextUrl !== currentUrl) {
            window.history.pushState({}, '', nextUrl);
        }
    }, [aidPage, currentRoute, directoryPage, discoveryQueryString]);

    useEffect(() => {
        if (currentRoute !== '/map' && currentRoute !== '/feed') {
            return undefined;
        }
        if (webDataMode === 'fixture') return undefined;
        if (
            !discoveryState.center &&
            (currentRoute === '/map' || discoveryState.feedTab === 'nearby')
        ) {
            setFeedRecords([]);
            setAidHasNextPage(false);
            setAidTotal(0);
            setAidDataOrigin('idle');
            setAidErrorMessage(undefined);
            setIsAidLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        setIsAidLoading(true);
        setAidErrorMessage(undefined);

        void fetchFeedRecordPageFromApi(
            discoveryState,
            currentRoute === '/map' ? 'map' : 'feed',
            aidPage,
            controller.signal,
        )
            .then(async (result) => {
                if (controller.signal.aborted) {
                    return;
                }

                if (result.ok) {
                    const records = await Promise.all(
                        result.data.items.map(async (record) => {
                            if (
                                !currentUserDid ||
                                record.recipientDid !== currentUserDid
                            ) {
                                return record;
                            }
                            const lifecycle = await queryAidPostLifecycleViaApi(
                                record.aidPostUri,
                                controller.signal,
                            );
                            const lifecycleStatus = lifecycle.ok
                                ? lifecycleStatusFromValue(
                                      lifecycle.data.currentStatus,
                                  )
                                : lifecycle.code === 'NOT_FOUND'
                                  ? lifecycleStatusFromValue(record.card.status)
                                  : undefined;
                            const validTransitions = lifecycle.ok
                                ? lifecycle.data.validTransitions.flatMap(
                                      (value) => {
                                          const status =
                                              lifecycleStatusFromValue(value);
                                          return status ? [status] : [];
                                      },
                                  )
                                : lifecycle.code === 'NOT_FOUND'
                                  ? ([
                                        'open',
                                        'resolved',
                                    ] satisfies LifecycleStatus[])
                                  : undefined;
                            return lifecycleStatus
                                ? {
                                      ...record,
                                      card: {
                                          ...record.card,
                                          lifecycleStatus,
                                          ...(validTransitions
                                              ? { validTransitions }
                                              : {}),
                                          ...(lifecycle.ok
                                              ? {
                                                    timeline:
                                                        lifecycle.data.timeline.flatMap(
                                                            (entry) => {
                                                                const from =
                                                                    lifecycleStatusFromValue(
                                                                        entry.from,
                                                                    );
                                                                const to =
                                                                    lifecycleStatusFromValue(
                                                                        entry.to,
                                                                    );
                                                                return from &&
                                                                    to
                                                                    ? [
                                                                          {
                                                                              ...entry,
                                                                              from,
                                                                              to,
                                                                          } satisfies FeedStatusTransition,
                                                                      ]
                                                                    : [];
                                                            },
                                                        ),
                                                }
                                              : {}),
                                      },
                                  }
                                : record;
                        }),
                    );
                    if (controller.signal.aborted) return;
                    setFeedRecords((current) =>
                        aidPage === 1
                            ? appendDedupedPage([], records, (record) => record.aidPostUri)
                            : appendDedupedPage(current, records, (record) => record.aidPostUri),
                    );
                    setAidHasNextPage(result.data.hasNextPage);
                    setAidTotal(result.data.total);
                    setAidDataOrigin('api');
                    return;
                }

                setAidDataOrigin('unavailable');
                setAidErrorMessage(t('common.requestFailed'));
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsAidLoading(false);
                }
            });

        return () => {
            controller.abort();
        };
    }, [aidPage, aidReload, currentRoute, currentUserDid, discoveryState, t]);

    useEffect(() => {
        if (currentRoute !== '/resources' && currentRoute !== '/map') {
            return undefined;
        }
        if (webDataMode === 'fixture') return undefined;
        if (!discoveryState.center) {
            setResourceCards([]);
            setDirectoryHasNextPage(false);
            setDirectoryTotal(0);
            setDirectoryDataOrigin('idle');
            setDirectoryErrorMessage(undefined);
            setIsDirectoryLoading(false);
            return undefined;
        }

        const controller = new AbortController();
        setIsDirectoryLoading(true);
        setDirectoryErrorMessage(undefined);

        void fetchDirectoryCardPageFromApi(discoveryState, directoryPage, controller.signal)
            .then((result) => {
                if (controller.signal.aborted) {
                    return;
                }

                if (result.ok) {
                    setResourceCards((current) =>
                        directoryPage === 1
                            ? appendDedupedPage([], result.data.items, (card) => card.uri)
                            : appendDedupedPage(current, result.data.items, (card) => card.uri),
                    );
                    setDirectoryHasNextPage(result.data.hasNextPage);
                    setDirectoryTotal(result.data.total);
                    setDirectoryDataOrigin('api');
                    return;
                }

                setDirectoryDataOrigin('unavailable');
                setDirectoryErrorMessage(t('common.requestFailed'));
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsDirectoryLoading(false);
                }
            });

        return () => {
            controller.abort();
        };
    }, [currentRoute, directoryPage, directoryReload, discoveryState, t]);

    const navigate = (route: AppRoute) => {
        if (typeof window !== 'undefined') {
            const nextUrl = `${route}${discoveryQueryString}`;
            const currentUrl = `${window.location.pathname}${window.location.search}`;

            if (nextUrl !== currentUrl) {
                window.history.pushState({}, '', nextUrl);
            }
        }

        setCurrentRoute(route);
        ariaLive.routeChange(t(routeLabelKeys[route]));
    };

    const handleRouteClick = (
        event: MouseEvent<HTMLAnchorElement>,
        route: AppRoute,
    ) => {
        event.preventDefault();
        setIsMobileNavOpen(false);
        setIsSecondaryNavOpen(false);
        navigate(route);
    };

    const patchDiscoveryState = (patch: Partial<DiscoveryFilterState>) => {
        setDiscoveryState((current) =>
            applyDiscoveryFilterPatch(current, patch),
        );
    };

    const pushDiscoveryState = (patch: Partial<DiscoveryFilterState>) => {
        setDiscoveryState((current) => {
            const next = applyDiscoveryFilterPatch(current, patch);
            if (typeof window !== 'undefined') {
                const nextUrl = `${currentRoute}${serializeDiscoveryFilterState(next)}`;
                const currentUrl = `${window.location.pathname}${window.location.search}`;
                if (nextUrl !== currentUrl) {
                    window.history.pushState({}, '', nextUrl);
                }
            }
            return next;
        });
    };

    const applyLifecycleAction = (action: FeedLifecycleAction) => {
        setFeedRecords((current) => {
            const currentCards = current.map((record) => record.card);
            const nextCards = applyFeedLifecycleAction(currentCards, action);
            const currentById = new Map(
                current.map((record) => [record.card.id, record]),
            );

            return nextCards.map((card) => {
                const existing = currentById.get(card.id);
                if (existing) {
                    return {
                        ...existing,
                        card,
                    };
                }

                return {
                    aidPostUri: `at://${currentUserDid}/app.patchwork.aid.post/${card.id}`,
                    recipientDid: currentUserDid,
                    card,
                } satisfies FeedRecordEnvelope;
            });
        });
    };

    const openChatFromRecord = (
        record: FeedRecordEnvelope,
        surface: ChatEntrySurface,
    ) => {
        setChatIntent({
            aidPostUri: record.aidPostUri,
            aidPostTitle: record.card.title,
            recipientDid: record.recipientDid,
            initiatedFrom: surface,
        });
        setChatState(defaultChatLaunchState);
        setChatRequestPreview(undefined);
        navigate('/chat');
    };

    const launchChat = async () => {
        if (!chatIntent) {
            return;
        }

        const request = buildChatInitiationRequest(chatIntent, currentUserDid);
        setChatRequestPreview(JSON.stringify(request, null, 2));

        setChatState((current) =>
            reduceChatLaunchState(current, {
                type: 'submit',
                intent: chatIntent,
            }),
        );

        const apiResult = await initiateChatViaApi({
            aidPostUri: chatIntent.aidPostUri,
            initiatedByDid: currentUserDid,
            recipientDid: chatIntent.recipientDid,
            initiatedFrom: chatIntent.initiatedFrom,
            allowInitiation: hasChatPermission,
            supportsAtprotoChat: !forceChatFallback,
            now: nowIso(),
        });

        if (!apiResult.ok) {
            setChatState((current) =>
                reduceChatLaunchState(current, {
                    type: 'failure',
                    intent: chatIntent,
                    errorMessage: apiResult.error,
                }),
            );
            return;
        }

        const fallbackNotice = apiResult.data.fallbackNotice;
        const fallbackTransport = fallbackNotice?.transportPath;

        setChatState((current) =>
            reduceChatLaunchState(current, {
                type: 'success',
                intent: chatIntent,
                result: {
                    conversationUri: apiResult.data.conversationUri,
                    created: apiResult.data.created,
                    transportPath: apiResult.data.transportPath,
                    fallbackNotice:
                        fallbackTransport &&
                        fallbackTransport !== 'atproto-direct'
                            ? {
                                  code: 'RECIPIENT_CAPABILITY_MISSING',
                                  message: fallbackNotice.message,
                                  safeForUser: true,
                                  transportPath: fallbackTransport,
                              }
                            : undefined,
                },
            }),
        );
    };

    const resetChat = () => {
        setChatState(defaultChatLaunchState);
        setChatIntent(undefined);
        setChatRequestPreview(undefined);
    };

    const retryPublicSync = () => {
        const failure = publicSyncFailure;
        if (!failure || !failure.expectedCid) return;
        setPublicSyncRetrying(true);
        void reconcileAidPostStatusViaApi({
            uri: failure.postUri,
            expectedCid: failure.expectedCid,
            updatedAt: failure.updatedAt,
        }).then((result) => {
            setPublicSyncRetrying(false);
            if (!result.ok) {
                setPublicSyncFailure({
                    ...failure,
                    message: `${result.code}: ${result.error}`,
                });
                return;
            }
            setFeedRecords((current) =>
                replaceRecordFromAtResult(current, result.data),
            );
            setPublicSyncFailure(undefined);
        });
    };

    const requiresAuthentication =
        currentRoute === '/posting' ||
        currentRoute === '/chat' ||
        currentRoute === '/inbox' ||
        currentRoute === '/scheduling' ||
        currentRoute === '/notifications' ||
        currentRoute === '/moderation' ||
        currentRoute === '/groups' ||
        currentRoute === '/settings';
    const isDeferredFixtureRoute =
        webDataMode !== 'fixture' && deferredFixtureRoutes.has(currentRoute);
    const visibleAccountRoutes: readonly AppRoute[] =
        webDataMode === 'fixture' ? accountRoutes
        : !auth.session ? []
        : productionAccountRoutes.filter(
              route =>
                  route !== '/moderation' ||
                  auth.session?.role === 'admin' ||
                  auth.session?.role === 'moderator',
          );
    const visibleSecondaryRoutes: readonly AppRoute[] =
        webDataMode === 'fixture' ? secondaryRoutes
        : auth.session ? [
              '/volunteer',
              '/organizations',
              '/posting',
              '/verification',
              '/chat',
              '/scheduling',
              '/groups',
          ]
        : ['/volunteer', '/organizations'];

    const content = isDeferredFixtureRoute ? (
        <Panel title={t('runtime.deferred')}>
            <p>{t('runtime.deferredHelp')}</p>
        </Panel>
    ) : requiresAuthentication && !auth.session ? (
        <Panel title={t('runtime.signInRequired')}>
            <p>{t('runtime.signInHelp')}</p>
            <a
                className='mt-3 inline-block font-bold underline'
                href={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
            >
                {t('runtime.signInContinue')}
            </a>
        </Panel>
    ) : auth.session && webDataMode !== 'fixture' && onboardingError ? (
        <Panel title={t('runtime.onboardingUnavailable')}>
            <p role='alert'>
                {t('runtime.onboardingError', { error: onboardingError })}
            </p>
        </Panel>
    ) : auth.session &&
      webDataMode !== 'fixture' &&
      consentRequired === undefined ? (
        <Panel title={t('runtime.checkingPolicies')}>
            <p role='status'>{t('runtime.loadingConsent')}</p>
        </Panel>
    ) : auth.session && webDataMode !== 'fixture' && consentRequired ? (
        <PolicyConsentGate
            onAccepted={() => {
                setConsentRequired(false);
                setOnboardingError(undefined);
            }}
        />
    ) : maintenanceStatus?.active && currentRoute === '/posting' ? (
        <Panel title={t('runtime.paused')}>
            <p role='alert'>{maintenanceStatus.publicMessage}</p>
            <p className='mt-2 text-sm text-mh-textMuted'>
                {t('runtime.pausedHelp')}
            </p>
        </Panel>
    ) : currentRoute === '/map' ? (
        <MapRoute
            discoveryState={discoveryState}
            onPatchDiscovery={patchDiscoveryState}
            onPushDiscovery={pushDiscoveryState}
            feedRecords={feedRecords}
            resourceCards={resourceCards}
            resourceErrorMessage={directoryErrorMessage}
            isLoading={isAidLoading}
            errorMessage={aidErrorMessage}
            dataOrigin={aidDataOrigin}
            onRetry={() => setAidReload((value) => value + 1)}
            hasNextPage={aidHasNextPage}
            total={aidTotal}
            onLoadMore={() => setAidPage((page) => page + 1)}
            onRetryResources={() => setDirectoryReload((value) => value + 1)}
            selectedPostId={selectedMapPostId}
            onSelectPost={setSelectedMapPostId}
            onOpenChat={openChatFromRecord}
            onTriageAction={(postId, action) => {
                const nextStatus: AidStatus =
                    action === 'mark_in_progress'
                        ? 'in-progress'
                        : action === 'mark_resolved'
                          ? 'resolved'
                          : 'open';

                if (action !== 'contact_helper') {
                    applyLifecycleAction({
                        action: 'edit',
                        id: postId,
                        patch: {
                            status: nextStatus,
                            updatedAt: nowIso(),
                        },
                    });
                }
            }}
        />
    ) : currentRoute === '/requests/view' ? (
        <Suspense fallback={<p role='status'>{t('handoff.loadingRequest')}</p>}><LazyRequestDetail /></Suspense>
    ) : currentRoute === '/feed' ? (
        <FeedRoute
            discoveryState={discoveryState}
            onPatchDiscovery={patchDiscoveryState}
            feedRecords={feedRecords}
            isLoading={isAidLoading}
            errorMessage={aidErrorMessage}
            dataOrigin={aidDataOrigin}
            onRetry={() => setAidReload((value) => value + 1)}
            hasNextPage={aidHasNextPage}
            total={aidTotal}
            onLoadMore={() => setAidPage((page) => page + 1)}
            publicSyncFailure={publicSyncFailure}
            publicSyncRetrying={publicSyncRetrying}
            onRetryPublicSync={retryPublicSync}
            onNavigate={navigate}
            onOpenChat={openChatFromRecord}
            onUpdateCard={(id, patch) => {
                applyLifecycleAction({
                    action: 'edit',
                    id,
                    patch,
                });
            }}
            onReplaceRecord={(replacement) =>
                setFeedRecords((current) =>
                    current.map((record) =>
                        record.aidPostUri === replacement.aidPostUri
                            ? replacement
                            : record,
                    ),
                )
            }
            onDeleteRecord={(aidPostUri) =>
                setFeedRecords((current) =>
                    current.filter(
                        (record) => record.aidPostUri !== aidPostUri,
                    ),
                )
            }
            onTransition={(id, postUri, targetStatus) => {
                const record = feedRecords.find(
                    (candidate) => candidate.aidPostUri === postUri,
                );
                const updatedAt = nowIso();
                setPublicSyncFailure(undefined);
                void transitionAidPostViaApi({
                    postUri,
                    targetStatus,
                    now: updatedAt,
                }).then((result) => {
                    if (result.ok) {
                        applyLifecycleAction({
                            action: 'transition',
                            id,
                            targetStatus,
                            actorDid: result.data.transition.actorDid,
                            actorRole: result.data.transition.actorRole,
                        });
                        if (!record?.cid) {
                            setAidErrorMessage(t('feed.indexedUnavailable'));
                            return;
                        }
                        void reconcileAidPostStatusViaApi({
                            uri: postUri,
                            expectedCid: record.cid,
                            updatedAt,
                        }).then((syncResult) => {
                            if (!syncResult.ok) {
                                setPublicSyncFailure({
                                    postUri,
                                    expectedCid: record.cid!,
                                    updatedAt,
                                    message: `${syncResult.code}: ${syncResult.error}`,
                                });
                                return;
                            }
                            setFeedRecords((current) =>
                                replaceRecordFromAtResult(
                                    current,
                                    syncResult.data,
                                ),
                            );
                            setPublicSyncFailure(undefined);
                        });
                    }
                });
            }}
            currentUserDid={currentUserDid}
        />
    ) : currentRoute === '/posting' ? (
        discoveryState.center ? (
            <PostingRoute
                location={{
                    center: discoveryState.center,
                    areaLabel:
                        discoveryState.areaLabel ??
                        String(t('discovery.areaUnknown')),
                }}
                onCreateRecord={(record) => {
                    setFeedRecords((current) => [record, ...current]);
                    patchDiscoveryState({
                        text: record.card.title,
                        feedTab: 'latest',
                    });
                }}
                onNavigate={navigate}
                onCreateViaApi={createAidPostViaApi}
            />
        ) : (
            <section className='mh-route-header'>
                <h1 className='mh-route-title'>{t('posting.heading')}</h1>
                <p className='mt-2 mh-alert p-4' role='status'>
                    {t('posting.areaRequired')}
                </p>
                <Button className='mt-3' onClick={() => navigate('/map')}>
                    {t('route.map')}
                </Button>
            </section>
        )
    ) : currentRoute === '/resources' ? (
        <ResourceRoute
            discoveryState={discoveryState}
            onPatchDiscovery={patchDiscoveryState}
            onNavigate={navigate}
            isLoading={isDirectoryLoading}
            errorMessage={directoryErrorMessage}
            dataOrigin={directoryDataOrigin}
            onRetry={() => setDirectoryReload((value) => value + 1)}
            hasNextPage={directoryHasNextPage}
            total={directoryTotal}
            onLoadMore={() => setDirectoryPage((page) => page + 1)}
            resourceCards={resourceCards}
            currentUserDid={currentUserDid}
        />
    ) : currentRoute === '/volunteer' ? (
        webDataMode === 'fixture' ? (
            <LegacyFixtureVolunteerRoute did={currentUserDid} />
        ) : (
            <VolunteerRoute
                did={currentUserDid}
                historyVersion={historyVersion}
            />
        )
    ) : currentRoute === '/organizations' ? (
        <OrganizationsRoute did={currentUserDid} />
    ) : currentRoute === '/verification' ? (
        <VerificationRoute did={currentUserDid} />
    ) : currentRoute === '/inbox' ? (
        <CoordinationInboxRoute did={currentUserDid} />
    ) : currentRoute === '/scheduling' ? (
        <CoordinationSchedulingRoute did={currentUserDid} />
    ) : currentRoute === '/notifications' ? (
        <NotificationCenterRoute />
    ) : currentRoute === '/moderation' ? (
        <ModeratorConsoleRoute
            onMaintenanceChanged={setMaintenanceStatus}
            currentUserDid={currentUserDid}
        />
    ) : currentRoute === '/groups' ? (
        <Suspense fallback={<p role='status'>{t('groups.loading')}</p>}><LazyProductionGroups /></Suspense>
    ) : currentRoute === '/chat' ? (
        webDataMode === 'fixture' ? (
            <ChatRoute
                currentUserDid={currentUserDid}
                hasPermission={hasChatPermission}
                onTogglePermission={setHasChatPermission}
                forceFallback={forceChatFallback}
                onToggleFallback={setForceChatFallback}
                intent={chatIntent}
                state={chatState}
                requestPreview={chatRequestPreview}
                onLaunch={launchChat}
                onReset={resetChat}
            />
        ) : (
            <Suspense fallback={<p role='status'>{t('chat.loading')}</p>}><LazyProductionChat currentUserDid={currentUserDid} /></Suspense>
        )
    ) : currentRoute === '/settings' ? (
        webDataMode === 'fixture' ? (
            <SettingsRoute currentUserDid={currentUserDid} />
        ) : (
            <AccountPrivacyRoute onDeactivated={auth.restore} />
        )
    ) : currentRoute === '/legal/terms' ||
      currentRoute === '/legal/privacy' ||
      currentRoute === '/legal/community-guidelines' ? (
        <LegalPolicyRoute route={currentRoute} />
    ) : (
        <DashboardRoute
            onNavigate={navigate}
            discoveryState={discoveryState}
            onPatchDiscovery={patchDiscoveryState}
        />
    );

    return (
        <main className='mh-grain min-h-screen overflow-x-clip bg-mh-bg text-mh-text'>
            <a
                href='#main-content'
                className='mh-skip-link sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-mh-accent focus:px-4 focus:py-2 focus:text-white focus:outline-2 focus:outline-offset-2'
            >
                {t('app.skipToContent')}
            </a>
            <div className='mh-grid-pattern mx-auto min-h-screen max-w-7xl px-3 pb-16 sm:px-6 lg:px-10'>
                <header className='mh-masthead'>
                    <a
                        href='/'
                        className='mh-brand'
                        onClick={(event) => handleRouteClick(event, '/')}
                    >
                        <span className='mh-brand-mark' aria-hidden='true'>
                            P
                        </span>
                        <span>
                            <strong>{appTitle}</strong>
                            <small>{t('runtime.tagline')}</small>
                        </span>
                    </a>
                    <div className='mh-network-status' role='status'>
                        <span aria-hidden='true' /> {t('runtime.environment')}
                    </div>
                    <label className='text-xs font-bold'>
                        {t('a11y.languageSwitcher')}
                        <select
                            className='mh-input ml-2 px-2 py-1'
                            aria-label={String(t('a11y.languageSwitcher'))}
                            value={locale}
                            onChange={(event) =>
                                changeLocale(event.target.value as 'en' | 'es')
                            }
                        >
                            <option value='en'>{t('account.english')}</option>
                            <option value='es'>{t('account.spanish')}</option>
                        </select>
                    </label>
                </header>

                <nav aria-label={t('nav.ariaLabel')} className='mh-primary-nav'>
                    <button
                        ref={mobileNavToggleRef}
                        type='button'
                        className='mh-mobile-nav-toggle'
                        aria-expanded={isMobileNavOpen}
                        aria-controls='primary-navigation-links'
                        onClick={() => setIsMobileNavOpen((open) => !open)}
                    >
                        {t('nav.menu')}
                    </button>
                    <div
                        id='primary-navigation-links'
                        className={`mh-nav-collapse${isMobileNavOpen ? ' is-open' : ''}`}
                    >
                    <div className='mh-nav-main'>
                        <p className='mh-nav-group-label'>{t('nav.discoverGroup')}</p>
                        {primaryRoutes.map((route) => (
                            <a
                                key={route}
                                href={route}
                                className='mh-nav-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mh-accent'
                                aria-current={
                                    currentRoute === route ? 'page' : undefined
                                }
                                onClick={(event) =>
                                    handleRouteClick(event, route)
                                }
                            >
                                {t(routeLabelKeys[route])}
                            </a>
                        ))}
                    </div>
                    <div className='mh-nav-tools'>
                        <p className='mh-nav-group-label'>{t('nav.accountGroup')}</p>
                        {visibleAccountRoutes.map((route) => (
                            <a
                                key={route}
                                href={route}
                                className='mh-nav-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mh-accent'
                                aria-current={
                                    currentRoute === route ? 'page' : undefined
                                }
                                onClick={(event) =>
                                    handleRouteClick(event, route)
                                }
                            >
                                {t(routeLabelKeys[route])}
                            </a>
                        ))}
                        <div className='mh-secondary-nav' ref={secondaryNavRef}>
                            <p className='mh-nav-group-label'>{t('nav.secondaryGroup')}</p>
                            <button
                                ref={secondaryNavToggleRef}
                                type='button'
                                className='mh-nav-chip mh-secondary-nav-toggle'
                                aria-expanded={isSecondaryNavOpen}
                                aria-controls='secondary-navigation-links'
                                onClick={() =>
                                    setIsSecondaryNavOpen((open) => !open)
                                }
                            >
                                {t('runtime.more')}
                            </button>
                            <div
                                id='secondary-navigation-links'
                                className={`mh-more-menu-panel${isSecondaryNavOpen ? ' is-open' : ''}`}
                            >
                                {visibleSecondaryRoutes.map((route) => (
                                    <a
                                        key={route}
                                        href={route}
                                        aria-current={
                                            currentRoute === route
                                                ? 'page'
                                                : undefined
                                        }
                                        onClick={(event) =>
                                            handleRouteClick(event, route)
                                        }
                                    >
                                        {t(routeLabelKeys[route])}
                                    </a>
                                ))}
                            </div>
                        </div>
                        <div className='mh-auth-control' aria-live='polite'>
                            {auth.status === 'booting' ? (
                                <span>{t('runtime.checkingSession')}</span>
                            ) : auth.session ? (
                                <>
                                    <span className='max-w-48 truncate text-xs font-bold'>
                                        {auth.session.handle
                                            ? `@${auth.session.handle.replace(/^@/, '')}`
                                            : t('nav.accountFallback')}
                                    </span>
                                    {auth.session.canManageSignupInvitations ? (
                                        <a className='mh-nav-chip' href='/admin/invites'>
                                            {t('route.invites')}
                                        </a>
                                    ) : null}
                                    <Button
                                        variant='neutral'
                                        className='px-3 py-1 text-xs'
                                        onClick={() => void auth.logout()}
                                    >
                                        {t('runtime.signOut')}
                                    </Button>
                                </>
                            ) : (
                                <a
                                    className='mh-nav-chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mh-accent'
                                    href={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                                >
                                    {t('runtime.signIn')}
                                </a>
                            )}
                        </div>
                    </div>
                    </div>
                </nav>

                {maintenanceStatus?.active ? (
                    <div
                        role='alert'
                        className='mb-4 border-4 border-mh-danger bg-mh-surfaceElev p-4'
                    >
                        <strong>{t('runtime.readOnly')}</strong>{' '}
                        {maintenanceStatus.publicMessage}{' '}
                        {t('runtime.readOnlyHelp')}
                    </div>
                ) : null}

                {!isOnline ? (
                    <div
                        role='alert'
                        className='mb-4 border-4 border-mh-danger bg-mh-surfaceElev p-4'
                    >
                        <strong>{t('runtime.offline')}</strong>{' '}
                        {t('runtime.offlineHelp')}
                    </div>
                ) : null}

                <div
                    id='main-content'
                    ref={mainContentRef}
                    tabIndex={-1}
                    className='focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mh-accent'
                >
                    {content}
                </div>

                <footer className='mh-footer'>
                    <p>{t('runtime.footer')}</p>
                    <div role='navigation' aria-label={t('runtime.legalLabel')}>
                        <a
                            href='/legal/terms'
                            onClick={(event) =>
                                handleRouteClick(event, '/legal/terms')
                            }
                        >
                            {t('legal.termsNav')}
                        </a>
                        <a
                            href='/legal/privacy'
                            onClick={(event) =>
                                handleRouteClick(event, '/legal/privacy')
                            }
                        >
                            {t('legal.privacyNav')}
                        </a>
                        <a
                            href='/legal/community-guidelines'
                            onClick={(event) =>
                                handleRouteClick(
                                    event,
                                    '/legal/community-guidelines',
                                )
                            }
                        >
                            {t('legal.guidelinesNav')}
                        </a>
                    </div>
                </footer>
            </div>
        </main>
    );
};
