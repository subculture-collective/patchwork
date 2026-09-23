import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent,
    type ReactNode,
} from 'react';
import { ariaLive } from '../a11y';
import {
    applyDiscoveryFilterPatch,
    defaultDiscoveryFilterState,
    parseDiscoveryFilterState,
    serializeDiscoveryFilterState,
    type AidStatus,
    type DiscoveryFilterState,
} from '../discovery-filters';
import {
    applyFeedLifecycleAction,
    type FeedLifecycleAction,
    type FeedStatusTransition,
    type LifecycleStatus,
} from '../feed-ux';
import { type ResourceDirectoryCard } from '../resource-directory-ux';
import {
    buildChatInitiationRequest,
    defaultChatLaunchState,
    reduceChatLaunchState,
    type ChatEntrySurface,
    type ChatInitiationIntent,
    type ChatLaunchState,
} from '../chat-ux';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import {
    type ApiDataOrigin,
    type AtAidPostResult,
    type MaintenanceState,
    createAidPostViaApi,
    fetchAccountOnboardingViaApi,
    fetchAccountPreferencesViaApi,
    fetchDirectoryCardPageFromApi,
    fetchFeedRecordPageFromApi,
    appendDedupedPage,
    fetchPublicMaintenanceStatusViaApi,
    initiateChatViaApi,
    queryAidPostLifecycleViaApi,
    reconcileAidPostStatusViaApi,
    transitionAidPostViaApi,
} from './api-client';
import { useLocale } from '../i18n';
import { ProductionGroups } from './production-groups';
import { ProductionChat } from './production-chat';
import { type FeedRecordEnvelope } from './discovery-runtime';
import { useAuth } from '../auth/AuthProvider';
import {
    type AppRoute,
    authenticatedRoutes,
    deferredFixtureRoutes,
        readCurrentRoute,
    resolveNavRoutes,
    routeLabelKeys,
} from '../app/routes';
import {
    nowIso,
    webDataMode,
} from '../app/runtime';
import {
    PublicSyncFailure,
    readPaginationPageFromUrl,
} from './shell-shared';
import {
    AccountPrivacyRoute,
} from '../routes/account-privacy';
import {
    ChatRoute,
} from '../routes/chat-fixture';
import {
    FeedRoute,
} from '../routes/feed';
import {
    DashboardRoute,
} from '../routes/home';
import {
    CoordinationInboxRoute,
} from '../routes/inbox';
import {
    LegalPolicyRoute,
} from '../routes/legal';
import {
    MapRoute,
} from '../routes/map';
import {
    ModeratorConsoleRoute,
} from '../routes/moderation';
import {
    NotificationCenterRoute,
} from '../routes/notifications';
import {
    OrganizationsRoute,
} from '../routes/organizations';
import {
    PolicyConsentGate,
} from '../routes/policy-consent';
import {
    PostingRoute,
} from '../routes/posting';
import {
    ResourceRoute,
} from '../routes/resources';
import {
    CoordinationSchedulingRoute,
} from '../routes/scheduling';
import {
    SettingsRoute,
} from '../routes/settings-fixture';
import {
    VerificationRoute,
} from '../routes/verification';
import {
    LegacyFixtureVolunteerRoute,
    VolunteerRoute,
} from '../routes/volunteer';

interface FrontendShellProps {
    appTitle: string;
}

const defaultShellDiscoveryState = applyDiscoveryFilterPatch(
    defaultDiscoveryFilterState,
    {
        status: undefined,
    },
);

const readDiscoveryStateFromUrl = (
    fallback: DiscoveryFilterState,
): DiscoveryFilterState => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    return parseDiscoveryFilterState(window.location.search, fallback);
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

    const requiresAuthentication = authenticatedRoutes.has(currentRoute);
    const isDeferredFixtureRoute =
        webDataMode !== 'fixture' && deferredFixtureRoutes.has(currentRoute);
    const navRoutes = resolveNavRoutes(webDataMode, auth.session ?? undefined);

    const renderContent = (): ReactNode => {
        if (isDeferredFixtureRoute) {
            return (
                <Panel title={t('runtime.deferred')}>
                    <p>{t('runtime.deferredHelp')}</p>
                </Panel>
            );
        }
        if (requiresAuthentication && !auth.session) {
            return (
                <Panel title={t('runtime.signInRequired')}>
                    <p>{t('runtime.signInHelp')}</p>
                    <a
                        className='mt-3 inline-block font-bold underline'
                        href={`/login?returnTo=${encodeURIComponent(currentRoute)}`}
                    >
                        {t('runtime.signInContinue')}
                    </a>
                </Panel>
            );
        }
        if (auth.session && webDataMode !== 'fixture' && onboardingError) {
            return (
                <Panel title={t('runtime.onboardingUnavailable')}>
                    <p role='alert'>
                        {t('runtime.onboardingError', { error: onboardingError })}
                    </p>
                </Panel>
            );
        }
        if (auth.session && webDataMode !== 'fixture' && consentRequired === undefined) {
            return (
                <Panel title={t('runtime.checkingPolicies')}>
                    <p role='status'>{t('runtime.loadingConsent')}</p>
                </Panel>
            );
        }
        if (auth.session && webDataMode !== 'fixture' && consentRequired) {
            return (
                <PolicyConsentGate
                    onAccepted={() => {
                        setConsentRequired(false);
                        setOnboardingError(undefined);
                    }}
                />
            );
        }
        if (maintenanceStatus?.active && currentRoute === '/posting') {
            return (
                <Panel title={t('runtime.paused')}>
                    <p role='alert'>{maintenanceStatus.publicMessage}</p>
                    <p className='mt-2 text-sm text-mh-textMuted'>
                        {t('runtime.pausedHelp')}
                    </p>
                </Panel>
            );
        }
        switch (currentRoute) {
            case '/map':
                return (
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
                );
            case '/feed':
                return (
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
                );
            case '/posting':
                return (
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
                );
            case '/resources':
                return (
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
                );
            case '/volunteer':
                return (
                    webDataMode === 'fixture' ? (
                        <LegacyFixtureVolunteerRoute did={currentUserDid} />
                    ) : (
                        <VolunteerRoute
                            did={currentUserDid}
                            historyVersion={historyVersion}
                        />
                    )
                );
            case '/organizations':
                return (
                    <OrganizationsRoute did={currentUserDid} />
                );
            case '/verification':
                return (
                    <VerificationRoute did={currentUserDid} />
                );
            case '/inbox':
                return (
                    <CoordinationInboxRoute did={currentUserDid} />
                );
            case '/scheduling':
                return (
                    <CoordinationSchedulingRoute did={currentUserDid} />
                );
            case '/notifications':
                return (
                    <NotificationCenterRoute />
                );
            case '/moderation':
                return (
                    <ModeratorConsoleRoute
                        onMaintenanceChanged={setMaintenanceStatus}
                        currentUserDid={currentUserDid}
                    />
                );
            case '/groups':
                return (
                    <ProductionGroups />
                );
            case '/chat':
                return (
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
                        <ProductionChat currentUserDid={currentUserDid} />
                    )
                );
            case '/settings':
                return (
                    webDataMode === 'fixture' ? (
                        <SettingsRoute currentUserDid={currentUserDid} />
                    ) : (
                        <AccountPrivacyRoute onDeactivated={auth.restore} />
                    )
                );
            case '/legal/terms':
            case '/legal/privacy':
            case '/legal/community-guidelines':
                return (
                    <LegalPolicyRoute route={currentRoute} />
                );
            default:
                return (
                    <DashboardRoute
                        onNavigate={navigate}
                        discoveryState={discoveryState}
                        onPatchDiscovery={patchDiscoveryState}
                    />
                );
        }
    };
    const content = renderContent();

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
                        {navRoutes.primary.map((route) => (
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
                        {navRoutes.account.map((route) => (
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
                                {navRoutes.secondary.map((route) => (
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
                                    href={`/login?returnTo=${encodeURIComponent(currentRoute)}`}
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
