import { expect, test } from '@playwright/test';

test('notification center persists state and requests push permission only after explicit opt-in', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'notification-csrf',
            url: baseURL,
        },
    ]);
    await page.addInitScript(() => {
        const state = {
            permissionRequests: 0,
            subscribed: 0,
            unsubscribed: 0,
        };
        Object.defineProperty(window, '__notificationPushState', {
            value: state,
        });
        Object.defineProperty(window, 'Notification', {
            configurable: true,
            value: {
                permission: 'default',
                requestPermission: async () => {
                    state.permissionRequests += 1;
                    return 'granted';
                },
            },
        });
        Object.defineProperty(window, 'PushManager', {
            configurable: true,
            value: function PushManager() {},
        });
        const subscription = {
            endpoint: 'https://push.example.test/browser-subscription',
            toJSON: () => ({
                endpoint:
                    'https://push.example.test/browser-subscription',
                keys: {
                    p256dh: 'p256dh-public-key-material',
                    auth: 'auth-secret-material',
                },
            }),
            unsubscribe: async () => {
                state.unsubscribed += 1;
                return true;
            },
        };
        const registration = {
            pushManager: {
                getSubscription: async () =>
                    state.subscribed ? subscription : null,
                subscribe: async () => {
                    state.subscribed += 1;
                    return subscription;
                },
            },
        };
        Object.defineProperty(navigator, 'serviceWorker', {
            configurable: true,
            value: {
                register: async () => registration,
                ready: Promise.resolve(registration),
                getRegistration: async () => registration,
            },
        });
    });

    const notificationId = '11111111-1111-4111-8111-111111111111';
    let read = false;
    let archived = false;
    let email:
        | { address: string; verified: boolean }
        | null = null;
    let activePush = 0;
    const notificationBodies: Array<Record<string, unknown>> = [];
    const preferenceBodies: Array<Record<string, unknown>> = [];

    await page.route('**/api/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');
        const fulfill = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        if (pathname === '/auth/session') {
            await fulfill({
                session: {
                    did: 'did:plc:notification-owner',
                    handle: 'notification-owner.test',
                    expiresAt: '2099-01-01T00:00:00.000Z',
                },
            });
            return;
        }
        if (pathname === '/account/onboarding') {
            await fulfill({
                policyVersion: '2026-07-28',
                requiredDocuments: [],
                consentRequired: false,
                acceptedAt: '2026-07-28T12:00:00.000Z',
            });
            return;
        }
        if (
            pathname === '/account/preferences' &&
            request.method() === 'GET'
        ) {
            await fulfill({
                preferences: {
                    privacy: 'community',
                    notifications: {
                        inApp: true,
                        email: Boolean(email),
                        push: activePush > 0,
                    },
                    visibility: 'authenticated',
                    language: 'en',
                    location: {
                        sharing: 'approximate',
                        noPermanentAddress: false,
                    },
                },
            });
            return;
        }
        if (
            pathname === '/account/preferences' &&
            request.method() === 'PUT'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            const preferences =
                body['preferences'] as Record<string, unknown>;
            preferenceBodies.push(preferences);
            await fulfill({ preferences });
            return;
        }
        if (
            pathname === '/notifications' &&
            request.method() === 'GET'
        ) {
            const filter = new URL(request.url()).searchParams.get('filter');
            const visible =
                filter === 'archived' ? archived
                : filter === 'unread' ? !read && !archived
                : filter === 'read' ? read && !archived
                : !archived;
            await fulfill({
                items:
                    visible ?
                        [
                            {
                                id: notificationId,
                                type: 'offer_received',
                                recipientDid:
                                    'did:plc:notification-owner',
                                title: 'New offer',
                                body:
                                    'Someone offered to help with your request.',
                                priority: 'normal',
                                read,
                                archived,
                                actionUrl: '/inbox',
                                metadata: {
                                    offerId: 'safe-offer-id',
                                },
                                templateVersion: 'v1',
                                deduplicationKey:
                                    'coordination-event:1',
                                createdAt:
                                    '2026-07-28T12:00:00.000Z',
                                updatedAt:
                                    '2026-07-28T12:00:00.000Z',
                            },
                        ]
                    :   [],
                total: archived ? 0 : 1,
                unread: read || archived ? 0 : 1,
            });
            return;
        }
        if (pathname === '/notifications/channels') {
            await fulfill({
                preferences: {
                    inApp: true,
                    email: Boolean(email),
                    push: activePush > 0,
                },
                email,
                push: {
                    supported: true,
                    publicKey: 'AQIDBA',
                    activeSubscriptions: activePush,
                },
            });
            return;
        }
        if (pathname === '/notifications/read') {
            const body = request.postDataJSON() as Record<string, unknown>;
            notificationBodies.push(body);
            read = body['read'] !== false;
            await fulfill({ updated: true });
            return;
        }
        if (pathname === '/notifications/read-all') {
            read = true;
            await fulfill({ updated: 1 });
            return;
        }
        if (pathname === '/notifications/archive') {
            const body = request.postDataJSON() as Record<string, unknown>;
            notificationBodies.push(body);
            archived = true;
            await fulfill({ archived: true });
            return;
        }
        if (
            pathname === '/notifications/email' &&
            request.method() === 'POST'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            notificationBodies.push(body);
            email = { address: String(body['email']), verified: false };
            await fulfill({
                expiresAt: '2026-07-28T12:30:00.000Z',
            }, 202);
            return;
        }
        if (
            pathname === '/notifications/push' &&
            request.method() === 'POST'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            notificationBodies.push(body);
            activePush = 1;
            await fulfill({
                id: '22222222-2222-4222-8222-222222222222',
            }, 201);
            return;
        }
        if (
            pathname === '/notifications/push' &&
            request.method() === 'DELETE'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            notificationBodies.push(body);
            activePush = 0;
            await fulfill({ revoked: 1 });
            return;
        }
        await fulfill(
            { error: { code: 'NOT_FOUND', message: 'Not found.' } },
            404,
        );
    });

    await page.goto('/notifications', { waitUntil: 'networkidle' });
    await expect(
        page.getByRole('heading', { name: 'Notification center' }),
    ).toBeVisible();
    await expect(page.getByText('New offer')).toBeVisible();
    await expect(
        page.getByText(
            'External channels never contain exact locations, private evidence, contact details, or moderation notes.',
        ),
    ).toBeVisible();
    await expect.poll(() =>
        page.evaluate(
            () =>
                (window as unknown as {
                    __notificationPushState: {
                        permissionRequests: number;
                    };
                }).__notificationPushState.permissionRequests,
        ),
    ).toBe(0);

    await page.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'Mark unread', exact: true }),
    ).toBeVisible();
    await page.getByLabel('Notification filter').selectOption('unread');
    await expect(
        page.getByText('No notifications match this filter.'),
    ).toBeVisible();
    await page.getByLabel('Notification filter').selectOption('read');
    await expect(page.getByText('New offer')).toBeVisible();

    await page.getByLabel('Verified notification email').fill(
        'member@example.test',
    );
    await page.getByRole('button', { name: 'Send confirmation' }).click();
    await expect(
        page.getByText(
            'Confirmation email sent. The link expires in 30 minutes.',
        ),
    ).toBeVisible();

    const revokePush = page.getByRole('button', {
        name: 'Revoke browser push',
    });
    await expect(revokePush).toBeDisabled();
    await page.getByRole('button', {
        name: 'Enable browser push',
    }).click();
    await expect(
        page.getByText('Browser push enabled by explicit opt-in.'),
    ).toBeVisible();
    await expect(revokePush).toBeEnabled();
    await expect.poll(() =>
        page.evaluate(
            () =>
                (window as unknown as {
                    __notificationPushState: {
                        permissionRequests: number;
                    };
                }).__notificationPushState.permissionRequests,
        ),
    ).toBe(1);
    await revokePush.click();
    await expect(page.getByText('Browser push revoked.')).toBeVisible();
    await expect(revokePush).toBeDisabled();

    expect(notificationBodies).toEqual(
        expect.arrayContaining([
            { notificationId, read: true },
            { email: 'member@example.test' },
            {
                endpoint:
                    'https://push.example.test/browser-subscription',
                keys: {
                    p256dh: 'p256dh-public-key-material',
                    auth: 'auth-secret-material',
                },
            },
            {
                endpoint:
                    'https://push.example.test/browser-subscription',
            },
        ]),
    );
    expect(preferenceBodies).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                notifications: expect.objectContaining({ email: true }),
            }),
            expect.objectContaining({
                notifications: expect.objectContaining({ push: true }),
            }),
            expect.objectContaining({
                notifications: expect.objectContaining({ push: false }),
            }),
        ]),
    );
    expect(JSON.stringify(notificationBodies)).not.toMatch(
        /ownerDid|actorDid|recipientDid|exactLatitude|exactLongitude/u,
    );
});
