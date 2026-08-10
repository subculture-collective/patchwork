import { expect, test } from '@playwright/test';

const organizationId = 'b7b8b206-c3c3-4ae7-8f29-6877b5a93531';
const ownerDid = 'did:plc:organization-owner';
const stewardDid = 'did:plc:organization-steward';
const resourceUri =
    `at://${stewardDid}/app.patchwork.directory.resource/pantry`;

test('owner creates an organization, invites a real DID, assigns stewardship, and reconfirms it', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'organization-csrf',
            url: baseURL,
        },
    ]);
    let organization:
        | {
              id: string;
              slug: string;
              name: string;
              description: string;
              origin: 'visitor-created';
              provenance: null;
              nonEndorsementLabel: string;
              createdAt: string;
              updatedAt: string;
          }
        | undefined;
    let invited = false;
    let stewardship:
        | {
              id: string;
              organizationId: string;
              resourceUri: string;
              stewardDid: string;
              status: 'active';
              lastReconfirmedAt: string;
              reconfirmDueAt: string;
              createdAt: string;
              updatedAt: string;
          }
        | undefined;
    const commandBodies: Array<Record<string, unknown>> = [];

    await page.route('**/api/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');
        if (pathname === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: ownerDid,
                        handle: 'owner.test',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    },
                }),
            });
            return;
        }
        if (pathname === '/account/onboarding') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    consentRequired: false,
                    acceptedAt: '2026-07-28T12:00:00.000Z',
                }),
            });
            return;
        }
        if (pathname === '/organizations' && request.method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    organizations: organization ? [organization] : [],
                }),
            });
            return;
        }
        if (pathname === '/organizations' && request.method() === 'POST') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            organization = {
                id: organizationId,
                slug: 'northside-mutual-aid',
                name: String(body['name']),
                description: String(body['description']),
                origin: 'visitor-created',
                provenance: null,
                nonEndorsementLabel:
                    'Listed for public information. Patchwork does not endorse or guarantee this organization.',
                createdAt: '2026-07-28T12:00:00.000Z',
                updatedAt: '2026-07-28T12:00:00.000Z',
            };
            await route.fulfill({
                status: 201,
                contentType: 'application/json',
                body: JSON.stringify({ organization }),
            });
            return;
        }
        if (pathname === '/organizations/mine') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    organizations:
                        organization ?
                            [
                                {
                                    ...organization,
                                    membership: {
                                        organizationId,
                                        memberDid: ownerDid,
                                        role: 'owner',
                                        status: 'active',
                                        invitedByDid: ownerDid,
                                        joinedAt: organization.createdAt,
                                        updatedAt: organization.updatedAt,
                                    },
                                },
                            ]
                        :   [],
                }),
            });
            return;
        }
        if (pathname === '/organizations/members') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    members: [
                        {
                            organizationId,
                            memberDid: ownerDid,
                            role: 'owner',
                            status: 'active',
                            invitedByDid: ownerDid,
                            joinedAt: '2026-07-28T12:00:00.000Z',
                            updatedAt: '2026-07-28T12:00:00.000Z',
                        },
                        ...(invited ?
                            [
                                {
                                    organizationId,
                                    memberDid: stewardDid,
                                    role: 'steward',
                                    status: 'active',
                                    invitedByDid: ownerDid,
                                    joinedAt: '2026-07-28T12:10:00.000Z',
                                    updatedAt: '2026-07-28T12:10:00.000Z',
                                },
                            ]
                        :   []),
                    ],
                }),
            });
            return;
        }
        if (pathname === '/organizations/invitations') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            invited = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    invitation: {
                        id: 'c7b8b206-c3c3-4ae7-8f29-6877b5a93531',
                        status: 'pending',
                    },
                    token: 'private-one-time-organization-invitation-token',
                }),
            });
            return;
        }
        if (
            pathname === '/organizations/stewardships' &&
            request.method() === 'GET'
        ) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    stewardships: stewardship ? [stewardship] : [],
                }),
            });
            return;
        }
        if (
            pathname === '/organizations/stewardships' &&
            request.method() === 'POST'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            stewardship = {
                id: 'd7b8b206-c3c3-4ae7-8f29-6877b5a93531',
                organizationId,
                resourceUri: String(body['resourceUri']),
                stewardDid: String(body['stewardDid']),
                status: 'active',
                lastReconfirmedAt: '2026-07-28T12:20:00.000Z',
                reconfirmDueAt: '2026-10-26T12:20:00.000Z',
                createdAt: '2026-07-28T12:20:00.000Z',
                updatedAt: '2026-07-28T12:20:00.000Z',
            };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ stewardship }),
            });
            return;
        }
        if (pathname === '/organizations/stewardships/reconfirm') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            if (!stewardship) throw new Error('missing stewardship');
            stewardship = {
                ...stewardship,
                lastReconfirmedAt: '2026-07-29T12:00:00.000Z',
                reconfirmDueAt: '2026-10-27T12:00:00.000Z',
                updatedAt: '2026-07-29T12:00:00.000Z',
            };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ stewardship }),
            });
            return;
        }
        await route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
                error: { code: 'NOT_FOUND', message: 'Not found.' },
            }),
        });
    });

    await page.goto('/organizations');
    await page.getByLabel('Organization name').fill('Northside Mutual Aid');
    await page
        .getByLabel('Organization description')
        .fill('Neighborhood resource coordination.');
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(page.getByText('Organization created.')).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Northside Mutual Aid' }),
    ).toBeVisible();
    await expect(page.getByText(/does not endorse/)).toBeVisible();
    await expect(page.getByText('Your role: Owner')).toBeVisible();

    await page.getByLabel('Invitee AT DID').fill(stewardDid);
    await page.getByLabel('Organization role').selectOption('steward');
    await page.getByRole('button', { name: 'Create invitation' }).click();
    await expect(
        page.getByLabel('One-time invitation token'),
    ).toHaveValue('private-one-time-organization-invitation-token');

    await page.getByLabel('Public resource AT URI').fill(resourceUri);
    await page.getByLabel('Steward AT DID').fill(stewardDid);
    await page.getByRole('button', { name: 'Assign stewardship' }).click();
    await expect(page.getByText(resourceUri)).toBeVisible();
    await page.getByRole('button', { name: 'Reconfirm resource' }).click();
    await expect(
        page.getByText('Resource reconfirmed for 90 days.'),
    ).toBeVisible();

    expect(commandBodies).toHaveLength(4);
    expect(commandBodies[0]).toEqual({
        name: 'Northside Mutual Aid',
        description: 'Neighborhood resource coordination.',
    });
    for (const command of commandBodies) {
        expect(command).not.toHaveProperty('actorDid');
        expect(command).not.toHaveProperty('ownerDid');
        expect(command).not.toHaveProperty('origin');
    }
    expect(JSON.stringify(commandBodies)).not.toContain('did:org:');
});

test('anonymous organization discovery shows provenance and no management controls', async ({
    page,
}) => {
    await page.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname.replace(
            /^\/api/,
            '',
        );
        if (pathname === '/auth/session') {
            await route.fulfill({
                status: 401,
                contentType: 'application/json',
                body: JSON.stringify({
                    error: {
                        code: 'AUTHENTICATION_REQUIRED',
                        message: 'Authentication required.',
                    },
                }),
            });
            return;
        }
        if (pathname === '/organizations') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    organizations: [
                        {
                            id: organizationId,
                            slug: 'public-pantry',
                            name: 'Public Pantry',
                            description: 'Imported from a public directory.',
                            origin: 'sourced-public',
                            provenance: {
                                sourceUrl: 'https://example.test/pantry',
                                retrievedAt: '2026-07-01T00:00:00.000Z',
                                lastVerifiedAt:
                                    '2026-07-20T00:00:00.000Z',
                            },
                            nonEndorsementLabel:
                                'Listed for public information. Patchwork does not endorse or guarantee this organization.',
                            createdAt: '2026-07-01T00:00:00.000Z',
                            updatedAt: '2026-07-20T00:00:00.000Z',
                        },
                    ],
                }),
            });
            return;
        }
        await route.fulfill({ status: 404, body: '{}' });
    });

    await page.goto('/organizations');
    await expect(page.getByText('Public Pantry')).toBeVisible();
    await expect(
        page.getByRole('link', { name: 'authoritative public record' }),
    ).toHaveAttribute('href', 'https://example.test/pantry');
    await expect(page.getByText(/does not endorse/)).toBeVisible();
    await expect(
        page.getByRole('region', { name: 'Sign in to participate' }),
    ).toBeVisible();
    await expect(page.getByLabel('Organization name')).toHaveCount(0);
});

test('named AT account accepts an invitation and receives only its granted steward controls', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'organization-invite-csrf',
            url: baseURL,
        },
    ]);
    let accepted = false;
    await page.route('**/api/**', async route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname.replace(/^\/api/, '');
        if (pathname === '/auth/session') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    session: {
                        did: stewardDid,
                        handle: 'steward.test',
                        expiresAt: '2099-01-01T00:00:00.000Z',
                    },
                }),
            });
            return;
        }
        if (pathname === '/account/onboarding') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    consentRequired: false,
                    policyVersion: '2026-07-28',
                    requiredDocuments: [],
                    acceptedAt: '2026-07-28T12:00:00.000Z',
                }),
            });
            return;
        }
        if (pathname === '/organizations' && request.method() === 'GET') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ organizations: [] }),
            });
            return;
        }
        if (pathname === '/organization-invitations/accept') {
            expect(request.postDataJSON()).toEqual({
                token: 'valid-private-invitation-token',
            });
            accepted = true;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ organizationId }),
            });
            return;
        }
        if (pathname === '/organizations/mine') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    organizations:
                        accepted ?
                            [
                                {
                                    id: organizationId,
                                    slug: 'northside-mutual-aid',
                                    name: 'Northside Mutual Aid',
                                    description: '',
                                    origin: 'visitor-created',
                                    provenance: null,
                                    nonEndorsementLabel:
                                        'Listed for public information. Patchwork does not endorse or guarantee this organization.',
                                    createdAt:
                                        '2026-07-28T12:00:00.000Z',
                                    updatedAt:
                                        '2026-07-28T12:00:00.000Z',
                                    membership: {
                                        organizationId,
                                        memberDid: stewardDid,
                                        role: 'steward',
                                        status: 'active',
                                        invitedByDid: ownerDid,
                                        joinedAt:
                                            '2026-07-28T12:10:00.000Z',
                                        updatedAt:
                                            '2026-07-28T12:10:00.000Z',
                                    },
                                },
                            ]
                        :   [],
                }),
            });
            return;
        }
        if (pathname === '/organizations/members') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    members: [
                        {
                            organizationId,
                            memberDid: stewardDid,
                            role: 'steward',
                            status: 'active',
                            invitedByDid: ownerDid,
                            joinedAt: '2026-07-28T12:10:00.000Z',
                            updatedAt: '2026-07-28T12:10:00.000Z',
                        },
                    ],
                }),
            });
            return;
        }
        if (pathname === '/organizations/stewardships') {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ stewardships: [] }),
            });
            return;
        }
        await route.fulfill({ status: 404, body: '{}' });
    });

    await page.goto('/organizations');
    await expect(page.getByText('@steward.test', { exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page
        .getByLabel('Invitation token')
        .fill('valid-private-invitation-token');
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(
        page.getByText('Organization invitation accepted.'),
    ).toBeVisible();
    await expect(page.getByText('Your role: Steward')).toBeVisible();
    await expect(page.getByText('Invite a member')).toHaveCount(0);
    await expect(page.getByText('Assign resource stewardship')).toHaveCount(0);
});
