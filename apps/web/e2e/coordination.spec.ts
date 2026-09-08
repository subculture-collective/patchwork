import { expect, test, type Page } from '@playwright/test';

const requesterDid = 'did:plc:browser-requester';
const helperDid = 'did:plc:browser-helper';
const requestUri =
    `at://${requesterDid}/app.patchwork.aid.post/browser-groceries`;
const now = '2026-07-28T12:00:00.000Z';
const expiresAt = '2026-08-04T12:00:00.000Z';

test('two accounts offer, accept, hand off, and record an outcome without fixture identity leakage', async ({
    browser,
    baseURL,
}) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    type OfferState = {
        id: string;
        status: 'pending' | 'accepted' | 'declined' | 'expired';
        note: string | null;
    };
    const offers: OfferState[] = [];
    let connection:
        | {
              id: string;
              offerId: string;
              status: 'active' | 'completed';
          }
        | undefined;
    const inbox = new Map<
        string,
        Array<{
            id: string;
            type: string;
            title: string;
            summary: string;
            readAt: string | null;
        }>
    >([
        [requesterDid, []],
        [helperDid, []],
    ]);
    const feedback: Array<{
        id: string;
        connectionId: string;
        outcome: string;
        rating: number;
        comment: string | null;
        tags: string[];
        submittedAt: string;
        submitterDid: string;
    }> = [];
    const commandBodies: Array<Record<string, unknown>> = [];

    const renderOffer = (offer: OfferState, actorDid: string) => ({
        id: offer.id,
        requestUri,
        direction: actorDid === requesterDid ? 'received' : 'sent',
        note: offer.note,
        status: offer.status,
        offeredAt: now,
        expiresAt,
        decidedAt: offer.status === 'pending' ? null : now,
        ...(offer.status === 'accepted' ?
            { requesterDid, helperDid }
        :   {}),
    });
    const renderConnection = (actorDid: string) =>
        connection ?
            {
                id: connection.id,
                offerId: connection.offerId,
                requestUri,
                status: connection.status,
                requesterDid,
                helperDid,
                counterpartDid:
                    actorDid === requesterDid ? helperDid : requesterDid,
                acceptedAt: now,
                completedAt:
                    connection.status === 'completed' ? now : null,
                updatedAt: now,
            }
        :   undefined;

    const installRoutes = async (page: Page, actorDid: string) => {
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
                        did: actorDid,
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
            if (path === '/query/feed') {
                await fulfill({
                    total: 1,
                    page: 1,
                    pageSize: 20,
                    hasNextPage: false,
                    results: [
                        {
                            uri: requestUri,
                            authorDid: requesterDid,
                            title: 'Groceries for Tuesday',
                            summary: 'Shelf-stable groceries are needed.',
                            status: 'open',
                            category: 'food',
                            urgency: 'medium',
                            updatedAt: now,
                        },
                    ],
                });
                return;
            }
            if (path === '/coordination/mine') {
                await fulfill({
                    offers: offers.map(offer =>
                        renderOffer(offer, actorDid),
                    ),
                    connections:
                        connection ? [renderConnection(actorDid)] : [],
                });
                return;
            }
            if (path === '/inbox' && request.method() === 'GET') {
                const items = (inbox.get(actorDid) ?? []).map(item => ({
                    ...item,
                    actionUrl: '/inbox',
                    metadata: {},
                    occurredAt: now,
                }));
                await fulfill({
                    items,
                    unread: items.filter(item => item.readAt === null).length,
                });
                return;
            }
            if (path === '/outcomes/mine') {
                await fulfill({
                    feedback: feedback
                        .filter(item => item.submitterDid === actorDid)
                        .map(({ submitterDid: _submitterDid, ...item }) => item),
                });
                return;
            }
            const parsedBody = request.postDataJSON() as unknown;
            const body =
                parsedBody &&
                typeof parsedBody === 'object' &&
                !Array.isArray(parsedBody) ?
                    parsedBody as Record<string, unknown>
                :   {};
            if (request.method() !== 'GET') commandBodies.push(body);
            if (path === '/coordination/offers') {
                const offer: OfferState = {
                    id:
                        offers.length === 0 ?
                            '11111111-1111-4111-8111-111111111111'
                        :   '61111111-1111-4111-8111-111111111111',
                    status: 'pending',
                    note:
                        typeof body['note'] === 'string' ?
                            body['note']
                        :   null,
                };
                offers.push(offer);
                inbox.get(requesterDid)?.push({
                    id: '21111111-1111-4111-8111-111111111111',
                    type: 'offer',
                    title: 'New offer on your request',
                    summary:
                        'A volunteer offered to help. Their identity stays private until you accept.',
                    readAt: null,
                });
                await fulfill({ offer: renderOffer(offer, actorDid) }, 201);
                return;
            }
            if (path === '/coordination/offer-decisions') {
                const offer = offers.find(
                    item => item.id === body['offerId'],
                );
                if (!offer) throw new Error('Offer not found in browser state');
                offer.status =
                    body['decision'] === 'accept' ? 'accepted' : 'declined';
                if (offer.status === 'accepted') {
                    connection = {
                        id: '31111111-1111-4111-8111-111111111111',
                        offerId: offer.id,
                        status: 'active',
                    };
                }
                await fulfill({
                    offer: renderOffer(offer, actorDid),
                    connection: renderConnection(actorDid) ?? null,
                });
                return;
            }
            if (path === '/coordination/connections') {
                if (!connection) throw new Error('Connection missing');
                connection.status = 'completed';
                inbox.get(requesterDid)?.push({
                    id: '41111111-1111-4111-8111-111111111111',
                    type: 'outcome',
                    title: 'Connection completed',
                    summary: 'The handoff is complete.',
                    readAt: null,
                });
                await fulfill({
                    connection: renderConnection(actorDid),
                });
                return;
            }
            if (path === '/coordination/matches') {
                await fulfill({
                    requestUri,
                    generatedAt: now,
                    policy: {
                        opaqueReputationScoreUsed: false,
                        automaticAssignment: false,
                        deterministicTieBreak: 'stable-candidate-identifier',
                    },
                    candidates: [
                        {
                            candidateRef: 'volunteer-opaque',
                            kind: 'volunteer',
                            label: 'Volunteer candidate 1',
                            rank: 1,
                            score: 0.91,
                            approximateDistanceKm: 2.5,
                            availability: 'within-24h',
                            verification: 'active',
                            explanations: [
                                'Supports food.',
                                'Matches requested languages: en.',
                            ],
                            assignment: 'manual-only',
                        },
                    ],
                });
                return;
            }
            if (path === '/outcomes') {
                const item = {
                    id: '51111111-1111-4111-8111-111111111111',
                    connectionId: String(body['connectionId']),
                    outcome: String(body['outcome']),
                    rating: Number(body['rating']),
                    comment:
                        typeof body['comment'] === 'string' ?
                            body['comment']
                        :   null,
                    tags: body['tags'] as string[],
                    submittedAt: now,
                    submitterDid: actorDid,
                };
                feedback.push(item);
                const { submitterDid: _submitterDid, ...publicItem } = item;
                await fulfill(
                    {
                        feedback: publicItem,
                        safetyEscalated: item.tags.includes('safety-concern'),
                    },
                    201,
                );
                return;
            }
            if (path === '/inbox/read') {
                const item = (inbox.get(actorDid) ?? []).find(
                    entry => entry.id === body['itemId'],
                );
                if (item) item.readAt = now;
                await fulfill({ itemId: body['itemId'], readAt: now });
                return;
            }
            await fulfill(
                { error: { code: 'NOT_FOUND', message: 'Not found.' } },
                404,
            );
        });
    };

    const requesterContext = await browser.newContext({ baseURL });
    const helperContext = await browser.newContext({ baseURL });
    await requesterContext.addCookies([
        { name: 'patchwork_csrf', value: 'requester-csrf', url: baseURL },
    ]);
    await helperContext.addCookies([
        { name: 'patchwork_csrf', value: 'helper-csrf', url: baseURL },
    ]);
    const requesterPage = await requesterContext.newPage();
    const helperPage = await helperContext.newPage();
    await installRoutes(requesterPage, requesterDid);
    await installRoutes(helperPage, helperDid);
    const openInbox = async (page: Page) => {
        await page.goto('/inbox', {
            waitUntil: 'domcontentloaded',
            timeout: 15_000,
        });
        try {
            await page
                .getByRole('heading', { name: 'My activity' })
                .waitFor({ timeout: 5_000 });
        } catch {
            await page.reload();
            await page.getByRole('heading', { name: 'My activity' }).waitFor();
        }
    };
    const refreshWorkspace = async (page: Page) => {
        await Promise.all([
            page.waitForResponse(response =>
                new URL(response.url()).pathname.endsWith(
                    '/coordination/mine',
                ),
            ),
            page.getByLabel('Show unread only').click(),
        ]);
        await page.getByRole('heading', { name: 'My activity' }).waitFor();
    };

    await openInbox(helperPage);
    await helperPage
        .getByRole('button', { name: /Offer help for Groceries for Tuesday/ })
        .click();
    const offerDialog = helperPage.getByRole('dialog');
    await expect(
        offerDialog
      .getByLabel('Optional coordination note'),
    ).toBeFocused();
    await helperPage.keyboard.press('Shift+Tab');
    await expect(
        offerDialog.getByRole('button', { name: 'Offer help', exact: true }),
    ).toBeFocused();
    await helperPage.keyboard.press('Escape');
    await expect(offerDialog).toHaveCount(0);
    await expect(
        helperPage
      .getByRole('button', { name: /Offer help for Groceries for Tuesday/ }),
    ).toBeFocused();
    await helperPage
        .getByRole('button', { name: /Offer help for Groceries for Tuesday/ })
        .click();
    await offerDialog
        .getByLabel('Optional coordination note')
        .fill('I can deliver Tuesday afternoon.');
    await offerDialog.getByRole('button', { name: 'Offer help' }).click();
    await expect(helperPage.getByText('Sent offer')).toBeVisible();

    await openInbox(requesterPage);
    const receivedOffer = requesterPage.getByRole('article', {
        name: 'Received offer',
    });
    await expect(receivedOffer).toContainText(
        'Participant identity remains private until acceptance.',
    );
    await expect(requesterPage.getByText(helperDid)).toHaveCount(0);
    await receivedOffer.getByRole('button', { name: 'Decline' }).click();
    await expect(receivedOffer).toContainText('Declined');

    await refreshWorkspace(helperPage);
    await helperPage
        .getByRole('button', { name: /Offer help for Groceries for Tuesday/ })
        .click();
    const renewedOfferDialog = helperPage.getByRole('dialog');
    await renewedOfferDialog
        .getByLabel('Optional coordination note')
        .fill('I remain available for this request.');
    await renewedOfferDialog
        .getByRole('button', { name: 'Offer help' })
        .click();
    await refreshWorkspace(requesterPage);
    const pendingOffer = requesterPage
        .getByRole('article', { name: 'Received offer' })
        .filter({ hasText: 'Pending' });
    await pendingOffer.getByRole('button', { name: 'Accept' }).click();
    await expect(
        requesterPage.getByText(`Connected with ${helperDid}`),
    ).toBeVisible();

    await requesterPage.getByRole('button', {
        name: 'Find candidates',
    }).click();
    await expect(
        requesterPage.getByText('Volunteer candidate 1'),
    ).toBeVisible();
    await expect(requesterPage.getByText('Manual selection only')).toBeVisible();
    await expect(requesterPage.getByText(/reputation score/)).toBeVisible();

    await refreshWorkspace(helperPage);
    await expect(
        helperPage.getByText(`Connected with ${requesterDid}`),
    ).toBeVisible();
    await helperPage
        .getByRole('button', { name: 'Complete handoff' })
        .click();
    await expect(
        helperPage.getByText('Record structured outcome'),
    ).toBeVisible();

    await refreshWorkspace(requesterPage);
    await requesterPage
        .getByRole('combobox', { name: 'Outcome' })
        .selectOption('successful');
    await requesterPage.getByLabel('Rating').fill('5');
    await requesterPage
        .getByLabel('Optional comment')
        .fill('The handoff was completed safely.');
    await requesterPage
        .getByLabel('Flag as a safety concern for structured review')
        .check();
    await requesterPage
        .getByRole('button', { name: 'Submit outcome' })
        .click();
    await expect(
        requesterPage.getByText(
            'Your outcome feedback is recorded and the safety concern was sent for moderator review.',
        ),
    ).toBeVisible();

    expect(commandBodies).not.toContainEqual(
        expect.objectContaining({
            actorDid: expect.anything(),
        }),
    );
    expect(
        commandBodies.find(body => body['decision'] === 'accept'),
    ).toEqual({
        offerId: '61111111-1111-4111-8111-111111111111',
        decision: 'accept',
    });
    expect(feedback[0]).toMatchObject({
        submitterDid: requesterDid,
        outcome: 'successful',
        rating: 5,
        tags: ['safety-concern'],
    });

    offers.push({
        id: '71111111-1111-4111-8111-111111111111',
        status: 'expired',
        note: null,
    });
    await refreshWorkspace(helperPage);
    await expect(
        helperPage
            .getByRole('article', { name: 'Sent offer' })
            .filter({ hasText: 'Expired' }),
    ).toBeVisible();

    await requesterContext.close();
    await helperContext.close();
});
