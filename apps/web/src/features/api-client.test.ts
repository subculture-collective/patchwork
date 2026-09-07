import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    type AidPostCreateApiInput,
    type LifecycleTransitionApiInput,
    blockUserViaApi,
    archiveNotificationViaApi,
    confirmNotificationEmailViaApi,
    createAidPostViaApi,
    createAtAidPostViaApi,
    createAtDirectoryResourceViaApi,
    createAtVolunteerProfileViaApi,
    createOrganizationViaApi,
    consentToExactLocationViaApi,
    deactivateAccountViaApi,
    disableNotificationEmailViaApi,
    deleteAtVolunteerProfileViaApi,
    deleteAtDirectoryResourceViaApi,
    fetchAccountOnboardingViaApi,
    fetchAccountPreferencesViaApi,
    fetchDirectoryCardsFromApi,
    fetchFeedRecordsFromApi,
    fetchMyOrganizationsViaApi,
    fetchNotificationChannelsViaApi,
    fetchModeratorMaintenanceViaApi,
    fetchModerationAuditViaApi,
    fetchModerationQueueViaApi,
    fetchPublicMaintenanceStatusViaApi,
    fetchNotificationsViaApi,
    fetchOrganizationsViaApi,
    fetchPrivateAttachmentsViaApi,
    fetchVolunteerProfilesViaApi,
    exportDataViaApi,
    initiateChatViaApi,
    inviteOrganizationMemberViaApi,
    markAllNotificationsReadViaApi,
    markNotificationReadViaApi,
    getAtDirectoryResourceViaApi,
    queryAidPostLifecycleViaApi,
    reportAidPostViaApi,
    requestPrivateAttachmentAccessViaApi,
    requestNotificationEmailVerificationViaApi,
    registerPushSubscriptionViaApi,
    reconcileAidPostStatusViaApi,
    revokeExactLocationSessionViaApi,
    revokePushSubscriptionViaApi,
    sendExactLocationSignalViaApi,
    transitionAidPostViaApi,
    uploadPrivateAttachmentViaApi,
    updateAccountPreferencesViaApi,
    updateAtDirectoryResourceViaApi,
    updateAtVolunteerProfileViaApi,
    applyModerationPolicyViaApi,
    appendDedupedPage,
    declareMaintenanceViaApi,
    resumeMaintenanceViaApi,
} from './api-client.js';
import {
    CURRENT_POLICY_VERSION,
    defaultAccountPreferences,
    requiredPolicyDocuments,
} from '@patchwork/shared';
import type { DiscoveryFilterState } from '../discovery-filters.js';

const originalFetch = globalThis.fetch;
const baseDiscoveryState: DiscoveryFilterState = {
    feedTab: 'nearby',
    center: {
        lat: 1.3,
        lng: 103.8,
    },
    radiusMeters: 5000,
    text: 'food',
};

const createJsonResponse = (payload: unknown, ok = true, status = 200) => {
    return {
        ok,
        status,
        json: async () => payload,
    } as Response;
};

const setApiBaseUrl = (value: string | undefined) => {
    if (value === undefined) {
        vi.unstubAllEnvs();
        return;
    }

    vi.stubEnv('VITE_API_BASE_URL', value);
};

describe('api client', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        setApiBaseUrl(undefined);
    });

    afterEach(() => {
        setApiBaseUrl(undefined);
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    it.each([
        [[], [], []],
        [['one'], [], ['one']],
        [Array.from({ length: 20 }, (_, index) => `item-${index}`), ['item-20'], Array.from({ length: 21 }, (_, index) => `item-${index}`)],
        [['one'], ['one', 'two', 'two'], ['one', 'two']],
    ])('dedupes discovery page appends (%o + %o)', (current, page, expected) => {
        expect(appendDedupedPage(current, page, (value) => value)).toEqual(expected);
    });

    it('exports the authenticated account without putting identity in the request', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                formatVersion: '1.0',
                generatedAt: '2026-07-11T12:00:00.000Z',
                subject: { did: 'did:plc:viewer' },
                data: {},
                exclusions: [],
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await exportDataViaApi();

        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringMatching(/\/account\/export$/),
            expect.objectContaining({ method: 'GET', credentials: 'include' }),
        );
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
            'did:plc:viewer',
        );
    });

    it('uses authenticated, idempotent moderator commands without accepting browser actor identity', async () => {
        const queueItem = {
            queueId: 'queue-one',
            subjectUri:
                'at://did:plc:alice/app.patchwork.aid.post/one',
            subjectType: 'aid-post',
            reasons: ['sensitive-data'],
            latestReason: 'SENSITIVE_DATA_REVIEW',
            reportCount: 1,
            queueStatus: 'queued',
            visibility: 'suspended',
            appealState: 'none',
            context: {},
            priority: 'high',
            reasonCodes: ['sensitive-data'],
            safePreview: { label: 'Meal delivery' },
            automatedDecision: 'quarantined',
            createdAt: '2026-07-28T12:00:00.000Z',
            requestedAt: '2026-07-28T12:00:00.000Z',
            updatedAt: '2026-07-28T12:00:00.000Z',
        };
        const maintenance = {
            active: false,
            reasonCodes: [],
            publicMessage: 'Patchwork is operating normally.',
            activatedAt: null,
            resumedAt: null,
            version: 0,
            updatedAt: '2026-07-28T12:00:00.000Z',
            environmentOverride: false,
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createJsonResponse({ results: [queueItem] }))
            .mockResolvedValueOnce(createJsonResponse({ results: [] }))
            .mockResolvedValueOnce(createJsonResponse({ item: queueItem }))
            .mockResolvedValueOnce(createJsonResponse({ maintenance }))
            .mockResolvedValueOnce(createJsonResponse({ maintenance }))
            .mockResolvedValueOnce(createJsonResponse({
                maintenance: { ...maintenance, active: true },
            }))
            .mockResolvedValueOnce(createJsonResponse({ maintenance }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(fetchModerationQueueViaApi()).resolves.toMatchObject({
            ok: true,
            data: [{ safePreview: { label: 'Meal delivery' } }],
        });
        await expect(
            fetchModerationAuditViaApi(queueItem.subjectUri),
        ).resolves.toMatchObject({ ok: true, data: [] });
        await expect(applyModerationPolicyViaApi({
            subjectUri: queueItem.subjectUri,
            action: 'suspend-visibility',
            reason: 'Safety review',
        })).resolves.toMatchObject({ ok: true });
        await expect(fetchPublicMaintenanceStatusViaApi()).resolves.toMatchObject({
            ok: true,
            data: { active: false },
        });
        await expect(fetchModeratorMaintenanceViaApi()).resolves.toMatchObject({
            ok: true,
        });
        await expect(declareMaintenanceViaApi({
            reasonCodes: ['integrity'],
            publicMessage: 'Submissions are paused.',
        })).resolves.toMatchObject({ ok: true, data: { active: true } });
        await expect(resumeMaintenanceViaApi()).resolves.toMatchObject({
            ok: true,
            data: { active: false },
        });

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit | undefined]
        >;
        for (const [, init] of calls.filter(([, init]) => init?.method === 'POST')) {
            expect(init?.credentials).toBe('include');
            expect(init?.headers).toMatchObject({
                'idempotency-key': expect.any(String),
            });
            expect(String(init?.body)).not.toContain('actorDid');
        }
    });

    it('deactivates the authenticated account without sending browser identity', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                status: 'deactivated',
                effectiveAt: '2026-07-11T12:00:00.000Z',
                removed: {},
                revoked: {},
                retained: { deactivationReceipt: 1 },
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await deactivateAccountViaApi();

        expect(result.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toMatch(/\/account\/deactivate$/);
        expect(init).toMatchObject({
            method: 'POST',
            credentials: 'include',
            headers: expect.objectContaining({
                'idempotency-key': expect.any(String),
            }),
        });
        expect(JSON.parse(String(init.body))).toEqual({});
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('did:');
    });

    it('loads durable notification filters and channel state without browser identity', async () => {
        const notification = {
            id: '11111111-1111-4111-8111-111111111111',
            type: 'offer_received',
            recipientDid: 'did:plc:session-owner',
            title: 'New offer',
            body: 'Someone offered to help with your request.',
            priority: 'normal',
            read: false,
            archived: false,
            actionUrl: '/inbox',
            metadata: { offerId: 'safe-offer-id' },
            templateVersion: 'v1',
            deduplicationKey: 'coordination-event:1',
            createdAt: '2026-07-28T12:00:00.000Z',
            updatedAt: '2026-07-28T12:00:00.000Z',
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse({
                    items: [notification],
                    total: 1,
                    unread: 1,
                    nextCursor: notification.id,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    preferences: {
                        inApp: true,
                        email: false,
                        push: false,
                    },
                    email: null,
                    push: {
                        supported: true,
                        publicKey: 'public-vapid-key',
                        activeSubscriptions: 0,
                    },
                }),
            );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(
            fetchNotificationsViaApi({
                filter: 'unread',
                type: 'offer_received',
                cursor: notification.id,
                limit: 10,
            }),
        ).resolves.toMatchObject({
            ok: true,
            data: { total: 1, unread: 1 },
        });
        await expect(fetchNotificationChannelsViaApi()).resolves.toMatchObject({
            ok: true,
            data: {
                push: { supported: true, activeSubscriptions: 0 },
            },
        });

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit]
        >;
        expect(calls[0]![0]).toContain(
            '/notifications?filter=unread&type=offer_received',
        );
        expect(calls[0]![0]).toContain(`cursor=${notification.id}`);
        expect(calls[0]![0]).toContain('limit=10');
        expect(calls[1]![0]).toMatch(/\/notifications\/channels$/u);
        expect(calls.every(([, init]) => init.credentials === 'include'))
            .toBe(true);
        expect(JSON.stringify(calls)).not.toContain('session-owner');
    });

    it('mutates notification state and explicit external subscriptions with bounded payloads', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createJsonResponse({ updated: true }))
            .mockResolvedValueOnce(createJsonResponse({ updated: 2 }))
            .mockResolvedValueOnce(createJsonResponse({ archived: true }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    expiresAt: '2026-07-28T12:30:00.000Z',
                }),
            )
            .mockResolvedValueOnce(createJsonResponse({ confirmed: true }))
            .mockResolvedValueOnce(createJsonResponse({ disabled: true }))
            .mockResolvedValueOnce(
                createJsonResponse({
                    id: '22222222-2222-4222-8222-222222222222',
                }),
            )
            .mockResolvedValueOnce(createJsonResponse({ revoked: 1 }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const notificationId =
            '11111111-1111-4111-8111-111111111111';
        const endpoint = 'https://push.example.test/subscription';

        await markNotificationReadViaApi(notificationId, true);
        await markAllNotificationsReadViaApi();
        await archiveNotificationViaApi(notificationId);
        await requestNotificationEmailVerificationViaApi(
            'member@example.test',
        );
        await confirmNotificationEmailViaApi('opaque-confirmation-token');
        await disableNotificationEmailViaApi();
        await registerPushSubscriptionViaApi({
            endpoint,
            keys: {
                p256dh: 'p256dh-public-key-material',
                auth: 'auth-secret-material',
            },
        });
        await revokePushSubscriptionViaApi(endpoint);

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit]
        >;
        expect(calls.map(([url]) => new URL(url).pathname)).toEqual([
            '/api/notifications/read',
            '/api/notifications/read-all',
            '/api/notifications/archive',
            '/api/notifications/email',
            '/api/notifications/email/confirm',
            '/api/notifications/email',
            '/api/notifications/push',
            '/api/notifications/push',
        ]);
        expect(calls.map(([, init]) => init.method)).toEqual([
            'POST',
            'POST',
            'POST',
            'POST',
            'POST',
            'DELETE',
            'POST',
            'DELETE',
        ]);
        expect(JSON.parse(String(calls[6]![1].body))).toEqual({
            endpoint,
            keys: {
                p256dh: 'p256dh-public-key-material',
                auth: 'auth-secret-material',
            },
        });
        const serialized = JSON.stringify(calls);
        expect(serialized).not.toMatch(
            /ownerDid|recipientDid|actorDid|exactLatitude|exactLongitude/u,
        );
    });

    it('keeps exact coordinates out of the location signaling API', async () => {
        const connectionId = '81111111-1111-4111-8111-111111111111';
        const sessionId = '82111111-1111-4111-8111-111111111111';
        const sessionState = {
            connectionId,
            consent: {
                actorConsented: true,
                peerConsented: true,
                freshForSeconds: 120,
            },
            session: {
                id: sessionId,
                status: 'pending',
                role: 'offerer',
                singleUse: true,
                issuedAt: '2026-07-28T12:00:00.000Z',
                expiresAt: '2026-07-28T12:05:00.000Z',
                participantProof: 'actor-proof',
                expectedPeerProof: 'peer-proof',
                signals: [],
            },
            serverTime: '2026-07-28T12:00:00.000Z',
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createJsonResponse(sessionState))
            .mockResolvedValueOnce(
                createJsonResponse({
                    accepted: true,
                    sequence: 1,
                    status: 'pending',
                    expiresAt: sessionState.session.expiresAt,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    connectionId,
                    status: 'revoked',
                    revokedAt: '2026-07-28T12:01:00.000Z',
                }),
            );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(
            consentToExactLocationViaApi(connectionId),
        ).resolves.toMatchObject({ ok: true });
        await expect(
            sendExactLocationSignalViaApi({
                connectionId,
                sessionId,
                kind: 'description',
                payload: { type: 'offer', sdp: 'v=0\r\n' },
            }),
        ).resolves.toMatchObject({ ok: true });
        await expect(
            revokeExactLocationSessionViaApi(connectionId),
        ).resolves.toMatchObject({ ok: true });

        const requestBodies = fetchMock.mock.calls
            .map(call => (call[1] as RequestInit | undefined)?.body)
            .filter((body): body is string => typeof body === 'string')
            .map(body => JSON.parse(body) as Record<string, unknown>);
        expect(requestBodies).toHaveLength(3);
        expect(requestBodies[0]).toEqual({
            connectionId,
            consent: true,
        });
        expect(requestBodies[2]).toEqual({ connectionId });
        expect(JSON.stringify(requestBodies)).not.toMatch(
            /actorDid|latitude|longitude|coordinates|streetAddress/i,
        );
    });

    it('loads consent status and persists only schema-valid account preferences', async () => {
        const updated = {
            ...defaultAccountPreferences,
            audience: 'hidden' as const,
            location: {
                sharing: 'hidden' as const,
                noPermanentAddress: true,
            },
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse({
                    policyVersion: CURRENT_POLICY_VERSION,
                    requiredDocuments: [...requiredPolicyDocuments],
                    consentRequired: false,
                    acceptedAt: '2026-07-28T12:00:00.000Z',
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    preferences: defaultAccountPreferences,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({ preferences: updated }),
            );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(fetchAccountOnboardingViaApi()).resolves.toMatchObject({
            ok: true,
            data: { consentRequired: false },
        });
        await expect(fetchAccountPreferencesViaApi()).resolves.toEqual({
            ok: true,
            data: defaultAccountPreferences,
        });
        await expect(
            updateAccountPreferencesViaApi(updated),
        ).resolves.toEqual({ ok: true, data: updated });

        const [, updateInit] = fetchMock.mock.calls[2] as unknown as [
            string,
            RequestInit,
        ];
        expect(updateInit).toMatchObject({
            method: 'PUT',
            credentials: 'include',
            headers: expect.objectContaining({
                'idempotency-key': expect.any(String),
            }),
        });
        expect(JSON.parse(String(updateInit.body))).toEqual({
            preferences: updated,
        });
        expect(String(updateInit.body)).not.toContain('did:');
    });

    it('fetches and maps aid records for map scope', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                total: 1,
                page: 1,
                pageSize: 20,
                hasNextPage: false,
                results: [
                    {
                        uri: 'at://did:example:alice/app.patchwork.aid.post/post-1',
                        cid: 'bafy-discovered',
                        authorDid: 'did:example:alice',
                        title: 'Need groceries',
                        summary: 'Two households need meal kits.',
                        status: 'open',
                        category: 'food',
                        urgency: 'high',
                        approximateGeo: {
                            latitude: 1.3001,
                            longitude: 103.8002,
                            precisionKm: 0.6,
                        },
                        updatedAt: '2026-02-28T10:00:00.000Z',
                    },
                ],
            }),
        );

        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await fetchFeedRecordsFromApi(baseDiscoveryState, 'map');

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.card.title).toBe('Need groceries');
        expect(result.data[0]?.card.category).toBe('food');
        expect(result.data[0]?.card.urgency).toBe(4);
        expect(result.data[0]?.card.location?.precisionKm).toBe(1);
        expect(result.data[0]?.cid).toBe('bafy-discovered');

        const firstCall = (
            fetchMock.mock.calls as unknown as Array<[unknown]>
        )[0];
        const url = firstCall?.[0];
        expect(String(url)).toContain('/query/map?');
        expect(String(url)).toContain('latitude=1.300000');
        expect(String(url)).toContain('searchText=food');
        expect(String(url)).toContain('pageSize=20');
    });

    it('loads all-area map results without substituting a city after clearing the area', async () => {
        const fetchMock = vi.fn(async () => createJsonResponse({ total: 0, page: 1, pageSize: 20, hasNextPage: false, results: [] }));
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        const result = await fetchFeedRecordsFromApi({ feedTab: 'nearby' }, 'map');
        expect(result).toEqual({ ok: true, data: [] });
        const url = String((fetchMock.mock.calls as unknown as Array<[unknown]>)[0]?.[0]);
        expect(url).toContain('/query/map?');
        expect(url).not.toContain('latitude=');
        expect(url).not.toContain('radiusKm=');
    });

    it('keeps unlocated requests in latest and rejects inconsistent nearby counts', async () => {
        globalThis.fetch = vi.fn(async () => createJsonResponse({ total: 1, page: 1, pageSize: 20, hasNextPage: false, results: [{
            uri: 'at://did:plc:test/app.patchwork.aid.post/unlocated', authorDid: 'did:plc:test', title: 'Unlocated request', summary: 'No coordinates',
            category: 'food', status: 'open', urgency: 'medium', updatedAt: '2026-09-05T12:00:00Z',
        }] })) as unknown as typeof fetch;
        const latest = await fetchFeedRecordsFromApi({ feedTab: 'latest' }, 'feed');
        expect(latest.ok).toBe(true);
        if (latest.ok) expect(latest.data).toHaveLength(1);
        const nearby = await fetchFeedRecordsFromApi(baseDiscoveryState, 'feed');
        expect(nearby.ok).toBe(false);
    });

    it('does not send an implicit location with a latest feed request', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                total: 0,
                page: 1,
                pageSize: 20,
                hasNextPage: false,
                results: [],
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await fetchFeedRecordsFromApi({ ...baseDiscoveryState, feedTab: 'latest' }, 'feed');

        const url = String(
            (fetchMock.mock.calls as unknown as Array<[unknown]>)[0]?.[0],
        );
        expect(url).toContain('/query/feed?');
        expect(url).not.toContain('latitude=');
        expect(url).not.toContain('longitude=');
    });

    it.each([
        ['https://example.test/api', 'https://example.test/api/query/map?'],
        ['https://example.test/api/', 'https://example.test/api/query/map?'],
        ['/api', '/api/query/map?'],
        ['/api/', '/api/query/map?'],
    ] as const)(
        'preserves configured API base path for %s',
        async (baseUrl, expectedPrefix) => {
            setApiBaseUrl(baseUrl);
            const fetchMock = vi.fn(async () =>
                createJsonResponse({ total: 0, page: 1, pageSize: 20, hasNextPage: false, results: [] }),
            );
            globalThis.fetch = fetchMock as unknown as typeof fetch;

            await fetchFeedRecordsFromApi(baseDiscoveryState, 'map');

            const calls = fetchMock.mock.calls as unknown as Array<[string]>;
            const url = calls[0][0];
            expect(String(url)).toContain(expectedPrefix);
            expect(String(url)).toContain('latitude=1.300000');
        },
    );

    it('returns API error message for directory fetch failure', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse(
                {
                    error: {
                        code: 'INVALID_QUERY',
                        message: 'Query parameters failed validation.',
                    },
                },
                false,
                400,
            ),
        );

        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await fetchDirectoryCardsFromApi(baseDiscoveryState);

        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }

        expect(result.error).toContain('validation');
        expect(result).toMatchObject({
            code: 'INVALID_QUERY',
            kind: 'validation',
            retryable: false,
        });
    });

    it('maps durable directory projection responses into resource cards', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                total: 1,
                page: 1,
                pageSize: 20,
                hasNextPage: false,
                results: [
                    {
                        uri: 'at://did:plc:pantry/app.patchwork.directory.resource/main',
                        cid: 'bafy-directory',
                        authorDid: 'did:plc:pantry',
                        name: 'Northside Community Pantry',
                        category: 'food-bank',
                        serviceArea: 'Near North Side',
                        status: 'community-verified',
                        contact: { url: 'https://pantry.example' },
                        approximateGeo: {
                            latitude: 41.9,
                            longitude: -87.64,
                            precisionKm: 2,
                        },
                        openHours: 'Mon-Fri 09:00-17:00',
                        eligibilityNotes: 'Open to local residents.',
                        operationalStatus: 'open',
                        createdAt: '2026-07-26T12:00:00.000Z',
                        updatedAt: '2026-07-26T12:00:00.000Z',
                    },
                ],
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await fetchDirectoryCardsFromApi(baseDiscoveryState);

        expect(result).toMatchObject({
            ok: true,
            data: [
                {
                    id: 'main',
                    cid: 'bafy-directory',
                    authorDid: 'did:plc:pantry',
                    name: 'Northside Community Pantry',
                    category: 'food-bank',
                    location: {
                        lat: 41.9,
                        lng: -87.64,
                        precisionMeters: 2000,
                        areaLabel: 'Near North Side',
                    },
                    contact: { url: 'https://pantry.example' },
                },
            ],
        });
        const firstCall = (
            fetchMock.mock.calls as unknown as Array<[unknown]>
        )[0];
        expect(String(firstCall?.[0])).toContain('/query/directory');
        expect(String(firstCall?.[0])).toContain('pageSize=20');
    });

    it('creates, reads, updates, and deletes directory AT records through authenticated routes', async () => {
        const record = {
            $type: 'app.patchwork.directory.resource' as const,
            version: '1.1.0' as const,
            name: 'Northside Community Pantry',
            category: 'food-bank' as const,
            serviceArea: 'Near North Side',
            contact: { phone: '312-555-0100' },
            verificationStatus: 'unverified' as const,
            location: {
                latitude: 41.9,
                longitude: -87.64,
                precisionKm: 2,
            },
            operationalStatus: 'open' as const,
            createdAt: '2026-07-28T12:00:00.000Z',
        };
        const response = {
            uri: 'at://did:plc:alice/app.patchwork.directory.resource/main',
            cid: 'bafy-directory',
            record,
        };
        const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
            init?.method === 'DELETE' ?
                ({
                    ok: true,
                    status: 204,
                    json: async () => undefined,
                } as Response)
            :   createJsonResponse(response),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(createAtDirectoryResourceViaApi(record)).resolves.toEqual({
            ok: true,
            data: response,
        });
        await expect(
            getAtDirectoryResourceViaApi(response.uri),
        ).resolves.toMatchObject({ ok: true, data: response });
        await expect(
            updateAtDirectoryResourceViaApi({
                uri: response.uri,
                expectedCid: response.cid,
                record,
            }),
        ).resolves.toMatchObject({ ok: true, data: response });
        await expect(
            deleteAtDirectoryResourceViaApi({
                uri: response.uri,
                expectedCid: response.cid,
            }),
        ).resolves.toEqual({ ok: true, data: undefined });

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit]
        >;
        expect(calls.map(([, init]) => init.method)).toEqual([
            'POST',
            'GET',
            'PUT',
            'DELETE',
        ]);
        expect(calls.every(([url]) => url.includes('/at/directory-resources'))).toBe(
            true,
        );
    });

    it.each([
        [401, 'AUTH_REQUIRED', 'authentication', false],
        [503, 'SERVICE_UNAVAILABLE', 'server', true],
    ] as const)(
        'classifies HTTP %i as a typed %s failure',
        async (status, code, kind, retryable) => {
            globalThis.fetch = vi.fn(async () =>
                createJsonResponse(
                    { error: { code, message: 'Request failed.' } },
                    false,
                    status,
                ),
            ) as unknown as typeof fetch;

            const result = await fetchDirectoryCardsFromApi(baseDiscoveryState);

            expect(result).toMatchObject({
                ok: false,
                code,
                kind,
                retryable,
            });
        },
    );

    it('classifies fetch rejection as a retryable network failure', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new TypeError('fetch failed');
        }) as unknown as typeof fetch;

        const result = await fetchDirectoryCardsFromApi(baseDiscoveryState);

        expect(result).toMatchObject({
            ok: false,
            code: 'NETWORK_ERROR',
            kind: 'network',
            retryable: true,
        });
    });

    it('rejects discovery rows without durable record identity', async () => {
        globalThis.fetch = vi.fn(async () =>
            createJsonResponse({
                results: [
                    {
                        title: 'Unidentified request',
                        summary: 'Missing URI and author DID.',
                        status: 'open',
                        category: 'food',
                        urgency: 'medium',
                        updatedAt: '2026-07-11T00:00:00.000Z',
                    },
                ],
            }),
        ) as unknown as typeof fetch;

        const result = await fetchFeedRecordsFromApi(baseDiscoveryState, 'feed');

        expect(result).toMatchObject({
            ok: false,
            code: 'INVALID_API_RESPONSE',
            kind: 'validation',
            retryable: false,
        });
    });

    it('reports an aid post without accepting browser-supplied identity', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({ reportId: '41', created: true }, true, 201),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await reportAidPostViaApi({
            subjectUri:
                'at://did:plc:subject/app.patchwork.aid.post/unsafe-post',
            reason: 'fraud',
            details: 'The request asks users to send prepaid cards.',
        });

        expect(result).toEqual({
            ok: true,
            data: { reportId: '41', created: true },
        });
        const [, init] = (
            fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
        )[0]!;
        expect(init).toMatchObject({
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/json',
                'idempotency-key': expect.any(String),
            },
        });
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
            subjectUri:
                'at://did:plc:subject/app.patchwork.aid.post/unsafe-post',
            reason: 'fraud',
            details: 'The request asks users to send prepaid cards.',
        });
        expect(body['commandId']).toEqual(expect.any(String));
        expect(body).not.toHaveProperty('reporterDid');
        expect(body).not.toHaveProperty('actorDid');
    });

    it('blocks the record author without accepting browser-supplied identity', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({ blockId: '51', created: true }, true, 201),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await blockUserViaApi({
            subjectDid: 'did:plc:subject',
            reason: 'Unsafe contact after request publication.',
        });

        expect(result).toEqual({
            ok: true,
            data: { blockId: '51', created: true },
        });
        const [, init] = (
            fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
        )[0]!;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
            subjectDid: 'did:plc:subject',
            reason: 'Unsafe contact after request publication.',
            commandId: expect.any(String),
        });
        expect(body).not.toHaveProperty('blockerDid');
        expect(body).not.toHaveProperty('actorDid');
    });

    it('transitions lifecycle status without browser-supplied actor or role', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                postUri:
                    'at://did:plc:subject/app.patchwork.aid.post/lifecycle-1',
                previousStatus: 'open',
                currentStatus: 'resolved',
                transition: {},
                timeline: [],
                updatedAt: '2026-07-11T00:00:00.000Z',
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const hostileInput: LifecycleTransitionApiInput & {
            actorDid: string;
            actorRole: string;
        } = {
            postUri:
                'at://did:plc:subject/app.patchwork.aid.post/lifecycle-1',
            targetStatus: 'resolved',
            actorDid: 'did:plc:hostile-browser',
            actorRole: 'admin',
        };
        await transitionAidPostViaApi(hostileInput);

        const [, init] = (
            fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
        )[0]!;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
            postUri:
                'at://did:plc:subject/app.patchwork.aid.post/lifecycle-1',
            targetStatus: 'resolved',
        });
        expect(body).not.toHaveProperty('actorDid');
        expect(body).not.toHaveProperty('actorRole');
    });

    it('reconciles durable lifecycle status to the owner AT record without browser identity', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                uri: 'at://did:plc:owner/app.patchwork.aid.post/post-1',
                cid: 'bafy-synced',
                record: {
                    $type: 'app.patchwork.aid.post',
                    version: '1.0.0',
                    title: 'Need groceries',
                    description: 'Delivery requested.',
                    category: 'food',
                    urgency: 'medium',
                    status: 'in-progress',
                    location: {
                        latitude: 41.88,
                        longitude: -87.63,
                        precisionKm: 3,
                    },
                    createdAt: '2026-07-11T12:00:00.000Z',
                    updatedAt: '2026-07-11T12:05:00.000Z',
                },
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await reconcileAidPostStatusViaApi({
            uri: 'at://did:plc:owner/app.patchwork.aid.post/post-1',
            expectedCid: 'bafy-before',
            updatedAt: '2026-07-11T12:05:00.000Z',
        });

        expect(result.ok).toBe(true);
        const [, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(JSON.parse(String(init.body))).toEqual({
            uri: 'at://did:plc:owner/app.patchwork.aid.post/post-1',
            expectedCid: 'bafy-before',
            updatedAt: '2026-07-11T12:05:00.000Z',
        });
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('actorDid');
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('actorRole');
    });

    it('loads private lifecycle state with an authenticated identity-free GET', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                postUri: 'at://did:plc:owner/app.patchwork.aid.post/post-1',
                currentStatus: 'open',
                statusLabel: 'Open',
                timeline: [],
                validTransitions: ['open', 'resolved'],
                updatedAt: '2026-07-11T12:00:00.000Z',
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await queryAidPostLifecycleViaApi(
            'at://did:plc:owner/app.patchwork.aid.post/post-1',
        );

        expect(result.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toContain('/aid/post/lifecycle?postUri=');
        expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
        expect(url).not.toContain('actorRole');
        expect(url).not.toContain('actorDid');
    });

    it('exposes the durable projection receipt instead of inferring public visibility', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                postUri: 'at://did:plc:owner/app.patchwork.aid.post/post-1',
                currentStatus: 'open',
                statusLabel: 'Open',
                timeline: [],
                validTransitions: ['open', 'resolved'],
                updatedAt: '2026-07-11T12:00:00.000Z',
                projectionReceipt: {
                    sourceUri: 'at://did:plc:owner/app.patchwork.aid.post/post-1',
                    sourceCid: 'bafy-source',
                    state: 'pending',
                    retryAfterSeconds: 12,
                },
            }),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(
            queryAidPostLifecycleViaApi('at://did:plc:owner/app.patchwork.aid.post/post-1'),
        ).resolves.toMatchObject({
            ok: true,
            data: {
                projectionReceipt: {
                    state: 'pending',
                    retryAfterSeconds: 12,
                },
            },
        });
    });

    it('maps chat initiation fallback payload from API', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                conversationUri:
                    'at://did:example:alice/app.patchwork.conversation.meta/conv-123',
                created: true,
                transportPath: 'manual-fallback',
                fallbackNotice: {
                    code: 'RECIPIENT_CAPABILITY_MISSING',
                    message: 'Recipient cannot receive AT-native chat yet.',
                    safeForUser: true,
                    transportPath: 'manual-fallback',
                },
            }),
        );

        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const result = await initiateChatViaApi({
            aidPostUri: 'at://did:example:alice/app.patchwork.aid.post/post-1',
            initiatedByDid: 'did:example:helper-1',
            recipientDid: 'did:example:alice',
            initiatedFrom: 'map',
            allowInitiation: true,
            supportsAtprotoChat: false,
            now: '2026-02-28T12:00:00.000Z',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        expect(result.data.transportPath).toBe('manual-fallback');
        expect(result.data.fallbackNotice?.safeForUser).toBe(true);

        const firstCall = (
            fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>
        )[0];
        const url = firstCall?.[0];
        expect(String(url)).toContain('/chat/initiate');
        expect(String(url)).not.toContain('?');
        expect(firstCall?.[1].method).toBe('POST');
        expect(JSON.parse(String(firstCall?.[1].body))).toMatchObject({
            allowInitiation: true,
            supportsAtprotoChat: false,
        });
    });

    it('creates aid post via API and maps response to feed record envelope', async () => {
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                uri: 'at://did:example:resident-1/app.patchwork.aid.post/post-new-1',
                cid: 'bafy-created',
                record: {
                    $type: 'app.patchwork.aid.post',
                    version: '1.0.0',
                    title: 'Need transport to clinic',
                    description: 'Wheelchair-compatible ride needed by 18:00.',
                    category: 'transport',
                    urgency: 'critical',
                    status: 'open',
                    location: {
                        latitude: 1.3,
                        longitude: 103.8,
                        precisionKm: 1,
                    },
                    createdAt: '2026-02-28T18:00:00.000Z',
                    updatedAt: '2026-02-28T18:00:00.000Z',
                },
            }),
        );

        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const hostileInput: AidPostCreateApiInput & { authorDid: string } = {
            authorDid: 'did:plc:hostile-browser',
            rkey: 'post-new-1',
            now: '2026-02-28T18:00:00.000Z',
            draft: {
                title: 'Need transport to clinic',
                description: 'Wheelchair-compatible ride needed by 18:00.',
                category: 'transport',
                urgency: 5,
                accessibilityTags: ['mobility-aid'],
                location: {
                    postalCode: '60625',
                    lat: 1.301,
                    lng: 103.802,
                    precisionMeters: 500,
                },
            },
        };
        const result = await createAidPostViaApi(hostileInput);

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        expect(result.data.card.title).toBe('Need transport to clinic');
        expect(result.data.card.urgency).toBe(5);
        expect(result.data.aidPostUri).toContain('/post-new-1');
        expect(result.data.recipientDid).toBe('did:example:resident-1');

        const firstCall = (
            fetchMock.mock.calls as unknown as Array<[unknown, unknown]>
        )[0];
        const url = firstCall?.[0];
        const init = firstCall?.[1] as RequestInit | undefined;
        expect(String(url)).toContain('/at/aid-posts');
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
            'idempotency-key': expect.any(String),
        });
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body['category']).toBe('transport');
        expect(body['urgency']).toBe('critical');
        expect(body['version']).toBe('2.0.0');
        expect(body['location']).toEqual({ countryCode: 'US', postalCode: '60625' });
    });

    it('creates an authenticated AT aid post with browser credentials', async () => {
        const record = {
            $type: 'app.patchwork.aid.post' as const,
            version: '1.0.0' as const,
            title: 'Need groceries',
            description: 'Grocery delivery needed this afternoon.',
            category: 'food' as const,
            urgency: 'medium' as const,
            status: 'open' as const,
            location: {
                latitude: 41.88,
                longitude: -87.63,
                precisionKm: 1,
            },
            createdAt: '2026-07-10T12:00:00.000Z',
        };
        const fetchMock = vi.fn(async () =>
            createJsonResponse({
                uri: 'at://did:plc:alice/app.patchwork.aid.post/3abc',
                cid: 'bafy-created',
                record,
            }, true, 201),
        );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(createAtAidPostViaApi(record)).resolves.toMatchObject({
            ok: true,
            data: { cid: 'bafy-created' },
        });
        const call = (
            fetchMock.mock.calls as unknown as Array<[unknown, RequestInit]>
        )[0];
        expect(String(call?.[0])).toContain('/at/aid-posts');
        expect(call?.[1].credentials).toBe('include');
    });

    it('keeps volunteer private details out of public discovery and PDS profile fields', async () => {
        const record = {
            $type: 'app.patchwork.volunteer.profile' as const,
            version: '1.2.0' as const,
            displayName: 'Alex Helper',
            bio: 'Available for neighborhood deliveries.',
            capabilities: ['food-delivery'] as const,
            availability: 'within-24h' as const,
            contactPreference: 'chat-only' as const,
            skills: ['route planning'],
            languages: ['en'],
            serviceArea: {
                areaLabel: 'North side',
                noPermanentAddress: false,
                latitude: 41.92,
                longitude: -87.68,
                precisionKm: 2,
            },
            createdAt: '2026-07-28T12:00:00.000Z',
            updatedAt: '2026-07-28T12:00:00.000Z',
        };
        const privateProfile = {
            contactEmail: 'alex-private@example.test',
            contactPhone: null,
            availabilityWindows: ['weekday evenings'],
            matchingPreferences: {
                preferredCategories: ['food'],
                preferredUrgencies: ['high'],
                maxDistanceKm: 12,
                acceptsLateNight: false,
            },
        };
        const command = {
            profile: {
                displayName: record.displayName,
                bio: record.bio,
                capabilities: [...record.capabilities],
                availability: record.availability,
                contactPreference: record.contactPreference,
                skills: record.skills,
                languages: record.languages,
                serviceArea: record.serviceArea,
            },
            privateProfile,
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse(
                    {
                        uri: 'at://did:plc:alex/app.patchwork.volunteer.profile/self',
                        cid: 'bafy-created',
                        record,
                        privateProfile,
                    },
                    true,
                    201,
                ),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    uri: 'at://did:plc:alex/app.patchwork.volunteer.profile/self',
                    cid: 'bafy-updated',
                    record: { ...record, bio: 'Updated public bio.' },
                    privateProfile,
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [
                        {
                            uri: 'at://did:plc:alex/app.patchwork.volunteer.profile/self',
                            cid: 'bafy-updated',
                            authorDid: 'did:plc:alex',
                            displayName: record.displayName,
                            bio: 'Updated public bio.',
                            capabilities: ['food-delivery'],
                            availability: 'within-24h',
                            contactPreference: 'chat-only',
                            skills: ['route planning'],
                            languages: ['en'],
                            serviceArea: {
                                areaLabel: 'North side',
                                noPermanentAddress: false,
                                approximateGeo: {
                                    latitude: 41.92,
                                    longitude: -87.68,
                                    precisionKm: 2,
                                },
                            },
                            updatedAt: record.updatedAt,
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(createJsonResponse({}, true, 204));
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(
            createAtVolunteerProfileViaApi(command),
        ).resolves.toMatchObject({ ok: true, data: { cid: 'bafy-created' } });
        await expect(
            updateAtVolunteerProfileViaApi({
                ...command,
                profile: { ...command.profile, bio: 'Updated public bio.' },
                uri: 'at://did:plc:alex/app.patchwork.volunteer.profile/self',
                expectedCid: 'bafy-created',
            }),
        ).resolves.toMatchObject({ ok: true, data: { cid: 'bafy-updated' } });
        const discovery = await fetchVolunteerProfilesViaApi();
        expect(discovery).toMatchObject({
            ok: true,
            data: [{ displayName: 'Alex Helper' }],
        });
        await expect(
            deleteAtVolunteerProfileViaApi({
                uri: 'at://did:plc:alex/app.patchwork.volunteer.profile/self',
                expectedCid: 'bafy-updated',
            }),
        ).resolves.toEqual({ ok: true, data: undefined });

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit | undefined]
        >;
        const createBody = JSON.parse(String(calls[0]?.[1]?.body)) as {
            profile: Record<string, unknown>;
            privateProfile: Record<string, unknown>;
        };
        expect(createBody.profile).not.toHaveProperty('did');
        expect(createBody.profile).not.toHaveProperty(
            'verificationCheckpoints',
        );
        expect(createBody.privateProfile['contactEmail']).toBe(
            'alex-private@example.test',
        );
        expect(String(calls[2]?.[0])).not.toContain('alex-private');
        expect(String(calls[2]?.[0])).toContain('pageSize=20');
        expect(JSON.stringify(discovery)).not.toContain(
            'alex-private@example.test',
        );
    });

    it('uses session-derived organization authority and preserves public provenance labels', async () => {
        const organization = {
            id: 'b7b8b206-c3c3-4ae7-8f29-6877b5a93531',
            slug: 'northside-mutual-aid',
            name: 'Northside Mutual Aid',
            description: 'Neighborhood resource coordination.',
            origin: 'visitor-created' as const,
            provenance: null,
            nonEndorsementLabel:
                'Listed for public information. Patchwork does not endorse or guarantee this organization.',
            createdAt: '2026-07-28T12:00:00.000Z',
            updatedAt: '2026-07-28T12:00:00.000Z',
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse({ organization }, true, 201),
            )
            .mockResolvedValueOnce(
                createJsonResponse({ organizations: [organization] }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    organizations: [
                        {
                            ...organization,
                            membership: {
                                organizationId: organization.id,
                                memberDid: 'did:plc:owner',
                                role: 'owner',
                                status: 'active',
                                invitedByDid: 'did:plc:owner',
                                joinedAt: organization.createdAt,
                                updatedAt: organization.updatedAt,
                            },
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    invitation: { status: 'pending' },
                    token: 'one-time-invitation-token-that-is-long-enough',
                }),
            );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        await expect(
            createOrganizationViaApi({
                name: organization.name,
                description: organization.description,
            }),
        ).resolves.toMatchObject({
            ok: true,
            data: { organization: { origin: 'visitor-created' } },
        });
        await expect(fetchOrganizationsViaApi()).resolves.toMatchObject({
            ok: true,
            data: [
                expect.objectContaining({
                    nonEndorsementLabel:
                        organization.nonEndorsementLabel,
                }),
            ],
        });
        await expect(fetchMyOrganizationsViaApi()).resolves.toMatchObject({
            ok: true,
            data: [
                expect.objectContaining({
                    membership: expect.objectContaining({ role: 'owner' }),
                }),
            ],
        });
        await expect(
            inviteOrganizationMemberViaApi({
                organizationId: organization.id,
                inviteeDid: 'did:plc:steward',
                role: 'steward',
            }),
        ).resolves.toMatchObject({ ok: true });

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit | undefined]
        >;
        const createBody = JSON.parse(String(calls[0]?.[1]?.body));
        const inviteBody = JSON.parse(String(calls[3]?.[1]?.body));
        expect(createBody).toEqual({
            name: organization.name,
            description: organization.description,
        });
        expect(createBody).not.toHaveProperty('ownerDid');
        expect(createBody).not.toHaveProperty('origin');
        expect(inviteBody).not.toHaveProperty('actorDid');
        expect(calls[0]?.[1]?.credentials).toBe('include');
        expect(calls[3]?.[1]?.credentials).toBe('include');
    });

    it('authorizes and uploads private bytes without exposing object keys or upload tokens in URLs', async () => {
        const attachment = {
            id: '11111111-1111-4111-8111-111111111111',
            purpose: 'verification-evidence',
            subjectRef: null,
            filename: 'evidence.png',
            declaredMime: 'image/png',
            detectedMime: null,
            byteSize: 8,
            status: 'authorized',
            uploadExpiresAt: '2026-07-28T12:10:00.000Z',
            retentionExpiresAt: '2027-07-28T12:00:00.000Z',
            createdAt: '2026-07-28T12:00:00.000Z',
            updatedAt: '2026-07-28T12:00:00.000Z',
        };
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                createJsonResponse(
                    {
                        attachment,
                        upload: {
                            token: 'private-upload-token',
                            expiresAt: attachment.uploadExpiresAt,
                            maximumBytes: 10 * 1024 * 1024,
                        },
                    },
                    true,
                    201,
                ),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    attachment: {
                        ...attachment,
                        status: 'uploaded',
                        detectedMime: 'image/png',
                    },
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    attachments: [
                        {
                            ...attachment,
                            status: 'clean',
                            detectedMime: 'image/png',
                        },
                    ],
                }),
            )
            .mockResolvedValueOnce(
                createJsonResponse({
                    attachment: {
                        ...attachment,
                        status: 'clean',
                        detectedMime: 'image/png',
                    },
                    access: {
                        url:
                            'https://patchwork.test/api/attachments/content/' +
                            `${attachment.id}?expires=1785268860&signature=signed`,
                        expiresAt: '2026-07-28T12:01:00.000Z',
                    },
                }),
            );
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const file = new File([Buffer.from('png-body')], 'evidence.png', {
            type: 'image/png',
        });
        await expect(
            uploadPrivateAttachmentViaApi(
                file,
                'verification-evidence',
                null,
            ),
        ).resolves.toMatchObject({
            ok: true,
            data: { status: 'uploaded' },
        });
        await expect(fetchPrivateAttachmentsViaApi()).resolves.toMatchObject({
            ok: true,
            data: [{ status: 'clean' }],
        });
        await expect(
            requestPrivateAttachmentAccessViaApi(attachment.id),
        ).resolves.toMatchObject({
            ok: true,
            data: { expiresAt: '2026-07-28T12:01:00.000Z' },
        });

        const calls = fetchMock.mock.calls as unknown as Array<
            [string, RequestInit | undefined]
        >;
        expect(calls[0]?.[0]).toMatch(/\/attachments\/uploads$/);
        expect(calls[1]?.[0]).toMatch(
            new RegExp(`/attachments/uploads/${attachment.id}$`),
        );
        expect(calls[1]?.[1]?.headers).toMatchObject({
            'x-patchwork-upload-token': 'private-upload-token',
        });
        expect(String(calls[1]?.[0])).not.toContain('private-upload-token');
        expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
            'private/original/',
        );
    });
});
