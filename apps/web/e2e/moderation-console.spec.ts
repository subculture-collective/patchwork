import { expect, test } from '@playwright/test';

const moderatorDid = 'did:plc:moderator';
const subjectUri =
    'at://did:plc:alice/app.patchwork.aid.post/moderation-one';
const now = '2026-07-28T12:00:00.000Z';

const baseItem = {
    queueId: 'queue-moderation-one',
    subjectUri,
    subjectType: 'aid-post',
    reasons: ['user-report:privacy'],
    latestReason: 'user-report:privacy',
    reportCount: 1,
    queueStatus: 'queued',
    visibility: 'visible',
    appealState: 'none',
    context: {},
    priority: 'high',
    reasonCodes: ['sensitive-data'],
    safePreview: {
        label: 'Meal delivery',
        category: 'food',
        submissionType: 'aid-post',
        operation: 'create',
    },
    automatedDecision: 'quarantined',
    createdAt: now,
    requestedAt: now,
    updatedAt: now,
};

test('moderators can quarantine, appeal, audit, and shut down submissions without exposing raw evidence', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([{
        name: 'patchwork_csrf',
        value: 'moderation-csrf',
        url: baseURL,
    }]);
    let item = { ...baseItem };
    let maintenance = {
        active: false,
        reasonCodes: [] as string[],
        publicMessage: 'Patchwork is operating normally.',
        activatedAt: null as string | null,
        resumedAt: null as string | null,
        version: 0,
        updatedAt: now,
        environmentOverride: false,
    };
    const audits: Array<Record<string, unknown>> = [];
    const commandBodies: Array<Record<string, unknown>> = [];

    await page.route('**/api/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname.replace(/^\/api/, '');
        const fulfill = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        if (path === '/auth/session') {
            await fulfill({
                session: {
                    did: moderatorDid,
                    expiresAt: '2099-01-01T00:00:00.000Z',
                },
            });
            return;
        }
        if (path === '/account/onboarding') {
            await fulfill({
                policyVersion: '2026-07-28',
                requiredDocuments: [],
                consentRequired: false,
                acceptedAt: now,
            });
            return;
        }
        if (path === '/status') {
            await fulfill({ maintenance });
            return;
        }
        if (path === '/maintenance' && request.method() === 'GET') {
            await fulfill({ maintenance });
            return;
        }
        if (path === '/maintenance/declare') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            maintenance = {
                ...maintenance,
                active: true,
                reasonCodes: body['reasonCodes'] as string[],
                publicMessage: String(body['publicMessage']),
                activatedAt: now,
                version: maintenance.version + 1,
            };
            await fulfill({ maintenance });
            return;
        }
        if (path === '/maintenance/resume') {
            maintenance = {
                ...maintenance,
                active: false,
                reasonCodes: [],
                publicMessage: 'Patchwork is operating normally.',
                resumedAt: now,
                version: maintenance.version + 1,
            };
            await fulfill({ maintenance });
            return;
        }
        if (path === '/moderation/queue') {
            await fulfill({ total: 1, results: [item] });
            return;
        }
        if (path === '/moderation/audit') {
            await fulfill({ total: audits.length, results: audits });
            return;
        }
        if (path === '/moderation/policy/apply') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const action = String(body['action']);
            const previous = {
                queueStatus: item.queueStatus,
                visibility: item.visibility,
                appealState: item.appealState,
            };
            item = {
                ...item,
                visibility:
                    action === 'suspend-visibility' ? 'suspended'
                    : action === 'restore-visibility' ? 'visible'
                    : action === 'delist' ? 'delisted'
                    : item.visibility,
                appealState:
                    action === 'open-appeal' ? 'pending'
                    : action === 'start-appeal-review' ? 'under-review'
                    : action === 'resolve-appeal-upheld' ? 'upheld'
                    : action === 'resolve-appeal-rejected' ? 'rejected'
                    : item.appealState,
                queueStatus:
                    action.startsWith('resolve-') ? 'resolved' : item.queueStatus,
                updatedAt: now,
            };
            audits.push({
                actionId: `action-${audits.length + 1}`,
                queueId: item.queueId,
                subjectUri,
                actorDid: moderatorDid,
                action,
                reason: body['reason'],
                occurredAt: body['occurredAt'],
                idempotencyKey: `command-${audits.length + 1}`,
                previousState: previous,
                nextState: {
                    queueStatus: item.queueStatus,
                    visibility: item.visibility,
                    appealState: item.appealState,
                },
            });
            await fulfill({ item });
            return;
        }
        await fulfill(
            { error: { code: 'NOT_FOUND', message: 'Not found.' } },
            404,
        );
    });

    await page.goto('/moderation');
    const consoleRegion = page.getByRole('region', {
        name: 'Moderator safety console',
    });
    await expect(consoleRegion).toBeVisible();
    await expect(
        page.getByRole('heading', {
            level: 1,
            name: 'Moderator safety console',
        }),
    ).toBeVisible();
    await expect(
        consoleRegion.getByText(moderatorDid, { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText('Maintenance-mode management', { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText(
            'All new submissions and exact-location exchange',
            { exact: true },
        ),
    ).toBeVisible();
    const queueItem = page.getByRole('button', {
        name: /Meal delivery high · aid-post/,
    });
    await expect(queueItem).toBeVisible();
    await expect(page.getByText('resident@example.org')).toHaveCount(0);
    await expect(page.getByText(/two business days/)).toBeVisible();
    await expect(page.getByText(/operationally NO-GO/)).toBeVisible();

    await queueItem.click();
    await page.getByRole('button', { name: 'Quarantine now' }).click();
    await expect(page.getByText('Action recorded: Suspend visibility.')).toBeVisible();
    await expect(page.getByText(/Suspend visibility by/)).toBeVisible();

    await page.getByRole('button', { name: 'Open appeal' }).click();
    await page.getByRole('button', { name: 'Start appeal review' }).click();
    await page.getByRole('button', { name: 'Uphold appeal' }).click();
    await expect(page.getByText('Action recorded: Resolve appeal as upheld.')).toBeVisible();

    const shutdown = page.getByRole('button', {
        name: 'Shut down new submissions',
    });
    await expect(shutdown).toBeDisabled();
    await page
        .getByRole('checkbox', {
            name: /intend to apply this platform-wide shutdown/,
        })
        .check();
    await expect(shutdown).toBeEnabled();
    await shutdown.click();
    await expect(page.getByText('Patchwork is temporarily read-only.')).toBeVisible();
    await expect(page.getByText(/exact-location exchange are disabled/)).toBeVisible();
    await page.goto('/posting');
    await expect(
        page.getByRole('region', {
            name: 'New submissions are temporarily paused',
        }),
    ).toBeVisible();
    await expect(page.getByText(/Existing public information remains readable/)).toBeVisible();

    expect(commandBodies.length).toBeGreaterThan(0);
    expect(JSON.stringify(commandBodies)).not.toContain('actorDid');
    expect(JSON.stringify(commandBodies)).not.toContain('resident@example.org');
});

test('non-moderators receive an access-denied console', async ({ page }) => {
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
        if (path === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: 'did:plc:user',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    },
                }),
            });
            return;
        }
        if (path === '/account/onboarding') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    consentRequired: false,
                    acceptedAt: now,
                }),
            });
            return;
        }
        if (path === '/status') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    maintenance: {
                        active: false,
                        reasonCodes: [],
                        publicMessage: 'Patchwork is operating normally.',
                        environmentOverride: false,
                    },
                }),
            });
            return;
        }
        await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({
                error: {
                    code: 'AUTHORIZATION_DENIED',
                    message: 'Insufficient capability.',
                },
            }),
        });
    });

    await page.goto('/moderation');
    await expect(
        page.getByRole('region', { name: 'Moderator access required' }),
    ).toBeVisible();
    await expect(page.getByText('You need moderator access to use this console.')).toBeVisible();
});
