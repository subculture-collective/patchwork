import { expect, test, type Page } from '@playwright/test';

/**
 * This is deliberately a real-browser, real-HTTP staging suite.  Do not add
 * page.route() here: fixture-backed unit/E2E specs already cover that layer.
 *
 * It is opt-in because it writes only to disposable staging accounts. The
 * suite creates and deletes its own request and closes its own group. The
 * workflow refuses to run unless all three OAuth storage states and the
 * explicit opt-in are present.
 */
const enabled = process.env['PATCHWORK_E2E_STAGING_LIFECYCLE'] === 'true';
const requesterState = process.env['PATCHWORK_E2E_REQUESTER_STATE'];
const helperState = process.env['PATCHWORK_E2E_HELPER_STATE'];
const maintainerState = process.env['PATCHWORK_E2E_MAINTAINER_STATE'];
const latitude = process.env['PATCHWORK_E2E_DISCOVERY_LATITUDE'];
const longitude = process.env['PATCHWORK_E2E_DISCOVERY_LONGITUDE'];
const postalCode = process.env['PATCHWORK_E2E_POSTAL_CODE'] ?? '10001';
const canRun = Boolean(
    enabled &&
        process.env['PATCHWORK_E2E_BASE_URL'] &&
        requesterState &&
        helperState &&
        maintainerState &&
        latitude &&
        longitude,
);

type ApiResult = { status: number; body: unknown };

const request = async (
    page: Page,
    path: string,
    init: { method?: string; body?: Record<string, unknown> } = {},
): Promise<ApiResult> =>
    page.evaluate(async ({ path: endpoint, init: options }) => {
        const csrf = document.cookie
            .split('; ')
            .find(value => value.startsWith('patchwork_csrf='))
            ?.split('=')
            .slice(1)
            .join('=');
        const response = await fetch(`/api${endpoint}`, {
            method: options.method ?? 'GET',
            credentials: 'include',
            headers: {
                ...(options.body ? { 'content-type': 'application/json' } : {}),
                ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
                ...(options.method && options.method !== 'GET' ?
                    { 'idempotency-key': crypto.randomUUID() } :
                    {}),
            },
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        });
        return {
            status: response.status,
            body: await response.json().catch(() => null),
        };
    }, { path, init });

const object = (value: unknown): Record<string, unknown> => {
    expect(value).toBeTruthy();
    expect(typeof value).toBe('object');
    expect(Array.isArray(value)).toBe(false);
    return value as Record<string, unknown>;
};

const id = (value: unknown, field: string): string => {
    const candidate = object(value)[field];
    expect(typeof candidate).toBe('string');
    return candidate as string;
};

test.describe('staging release lifecycle (non-mocked)', () => {
    test.skip(
        !canRun,
        'Requires explicit disposable staging accounts, discovery coordinates, and opt-in.',
    );
    test.describe.configure({ mode: 'serial' });

    test('exercises projection, two-account coordination, groups/chat, verification, notifications, and a guarded maintenance transition', async ({
        browser,
    }) => {
        test.setTimeout(180_000);
        const requester = await browser.newContext({ storageState: requesterState! });
        const helper = await browser.newContext({ storageState: helperState! });
        const maintainer = await browser.newContext({ storageState: maintainerState! });
        const requesterPage = await requester.newPage();
        const helperPage = await helper.newPage();
        const maintainerPage = await maintainer.newPage();
        const marker = `staging-${Date.now().toString(36)}`;
        let requestUri: string | undefined;
        let requestCid: string | undefined;
        let groupId: string | undefined;
        let maintenanceEnabled = false;

        try {
            for (const page of [requesterPage, helperPage, maintainerPage]) {
                await page.goto('/');
                const session = await request(page, '/auth/session');
                expect(session.status).toBe(200);
                expect(object(session.body)).toHaveProperty('session');
            }

            const createdRequest = await request(requesterPage, '/at/aid-posts', {
                method: 'POST',
                body: {
                    $type: 'app.patchwork.aid.post',
                    version: '2.0.0',
                    title: `Disposable release request ${marker}`,
                    description: 'Staging lifecycle fixture; delete after verification.',
                    category: 'food',
                    urgency: 'medium',
                    status: 'open',
                    location: {
                        countryCode: 'US',
                        postalCode,
                    },
                    createdAt: new Date().toISOString(),
                },
            });
            expect(createdRequest.status).toBe(201);
            requestUri = id(createdRequest.body, 'uri');
            requestCid = id(createdRequest.body, 'cid');

            // Prove the real index/projection is queryable before a second
            // account makes a coordination offer against the new record.
            await expect.poll(async () => {
                const result = await request(
                    helperPage,
                    `/query/feed?postalCode=${encodeURIComponent(postalCode)}&page=1&pageSize=100`,
                );
                if (result.status !== 200) return false;
                const results = object(result.body)['results'];
                return Array.isArray(results) && results.some(item =>
                    object(item)['uri'] === requestUri,
                );
            }, { timeout: 60_000, intervals: [2_000, 5_000, 10_000] }).toBe(true);

            const offer = await request(helperPage, '/coordination/offers', {
                method: 'POST',
                body: { requestUri, note: `Disposable ${marker}; decline after verification.` },
            });
            expect(offer.status).toBe(201);
            const offerId = id(object(offer.body)['offer'], 'id');
            const decision = await request(requesterPage, '/coordination/offer-decisions', {
                method: 'POST',
                body: { offerId, decision: 'decline' },
            });
            expect(decision.status).toBe(200);

            const createdGroup = await request(requesterPage, '/groups', {
                method: 'POST',
                body: {
                    name: `Disposable release ${marker}`,
                    description: 'Staging lifecycle cleanup fixture.',
                    purpose: 'Release verification only.',
                    visibility: 'private',
                },
            });
            expect(createdGroup.status).toBe(201);
            const group = object(object(createdGroup.body)['group']);
            groupId = id(group, 'id');
            const rooms = group['rooms'];
            expect(Array.isArray(rooms)).toBe(true);
            const roomId = id((rooms as unknown[])[0], 'id');

            const invitation = await request(requesterPage, '/groups/invitations', {
                method: 'POST',
                body: { groupId, inviteeDid: id(object((await request(helperPage, '/auth/session')).body)['session'], 'did'), role: 'member' },
            });
            expect(invitation.status).toBe(201);
            const invitationToken = id(invitation.body, 'token');
            const accepted = await request(helperPage, '/groups/invitation-responses', {
                method: 'POST', body: { token: invitationToken, action: 'accept' },
            });
            expect(accepted.status).toBe(200);

            const conversation = await request(requesterPage, '/chat/conversations', {
                method: 'POST', body: { kind: 'group', roomId },
            });
            expect(conversation.status).toBe(201);
            const conversationId = id(object(conversation.body)['conversation'], 'id');
            const sent = await request(helperPage, '/chat/messages', {
                method: 'POST',
                body: { conversationId, clientMessageId: crypto.randomUUID(), body: `Disposable ${marker}` },
            });
            expect(sent.status).toBe(201);
            const messageId = id(object(sent.body)['message'], 'id');
            const redacted = await request(helperPage, '/chat/messages/redactions', {
                method: 'POST', body: { conversationId, messageId },
            });
            expect(redacted.status).toBe(200);

            // These are authenticated, durable reads.  Decision creation is
            // intentionally excluded: it needs a separately reviewed evidence
            // fixture and must never be manufactured by a launch smoke test.
            for (const [page, path] of [
                [requesterPage, '/verification/mine'],
                [requesterPage, '/notifications'],
                [requesterPage, '/notifications/channels'],
                [maintainerPage, '/verification/review'],
                [maintainerPage, '/maintenance'],
            ] as const) {
                const result = await request(page, path);
                expect(result.status).toBe(200);
            }

            if (process.env['PATCHWORK_E2E_EXERCISE_MAINTENANCE'] === 'true') {
                const declared = await request(maintainerPage, '/maintenance/declare', {
                    method: 'POST',
                    body: { reasonCodes: ['monitoring'], publicMessage: 'Disposable staging release verification.' },
                });
                expect(declared.status).toBe(200);
                maintenanceEnabled = true;
                const resumed = await request(maintainerPage, '/maintenance/resume', { method: 'POST', body: {} });
                expect(resumed.status).toBe(200);
                maintenanceEnabled = false;
            }
        } finally {
            let cleanupError: unknown;
            if (maintenanceEnabled) {
                try {
                    const resumed = await request(maintainerPage, '/maintenance/resume', {
                        method: 'POST', body: {},
                    });
                    expect(resumed.status).toBe(200);
                } catch (error) {
                    cleanupError = error;
                }
            }
            if (groupId) {
                try {
                    const closed = await request(requesterPage, '/groups/closures', {
                        method: 'POST', body: { groupId },
                    });
                    expect(closed.status).toBe(200);
                } catch (error) {
                    cleanupError ??= error;
                }
            }
            if (requestUri && requestCid) {
                try {
                    const deleted = await request(requesterPage, '/at/aid-posts', {
                        method: 'DELETE',
                        body: { uri: requestUri, expectedCid: requestCid },
                    });
                    expect(deleted.status).toBe(204);
                } catch (error) {
                    cleanupError ??= error;
                }
            }
            await Promise.all([requester.close(), helper.close(), maintainer.close()]);
            if (cleanupError) throw cleanupError;
        }
    });
});
