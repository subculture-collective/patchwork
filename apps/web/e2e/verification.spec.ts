import { expect, test } from '@playwright/test';

const reviewerDid = 'did:plc:verification-reviewer';
const organizationId = 'b7b8b206-c3c3-4ae7-8f29-6877b5a93531';
const resourceUri =
    'at://did:plc:verification-reviewer/app.patchwork.directory.resource/pantry';

test('authenticated verification, appeal, renewal, and exact-address approval remain privacy-safe', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'verification-csrf',
            url: baseURL,
        },
    ]);

    const now = '2026-07-28T12:00:00.000Z';
    const applications: Array<Record<string, unknown>> = [];
    const evidence: Array<Record<string, unknown>> = [];
    const appeals: Array<Record<string, unknown>> = [];
    const exactAddressRequests: Array<Record<string, unknown>> = [];
    const commandBodies: Array<Record<string, unknown>> = [];
    const privateAttachments: Array<Record<string, unknown>> = [];
    const attachmentId =
        'f7b8b206-c3c3-4ae7-8f29-6877b5a93531';
    let uploadedBytes = 0;

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
                    did: reviewerDid,
                    handle: 'reviewer.test',
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
                acceptedAt: now,
            });
            return;
        }
        if (pathname === '/verification/mine') {
            await fulfill({
                applications,
                evidence,
                appeals,
                exactAddressRequests,
            });
            return;
        }
        if (pathname === '/attachments' && request.method() === 'GET') {
            await fulfill({ attachments: privateAttachments });
            return;
        }
        if (
            pathname === '/attachments/uploads' &&
            request.method() === 'POST'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            const attachment = {
                id: attachmentId,
                purpose: body['purpose'],
                subjectRef: body['subjectRef'],
                filename: body['filename'],
                declaredMime: body['declaredMime'],
                detectedMime: null,
                byteSize: body['byteSize'],
                status: 'authorized',
                uploadExpiresAt: '2026-07-28T12:10:00.000Z',
                retentionExpiresAt: '2027-07-28T12:00:00.000Z',
                createdAt: now,
                updatedAt: now,
            };
            privateAttachments.push(attachment);
            await fulfill(
                {
                    attachment,
                    upload: {
                        token: 'private-upload-token',
                        expiresAt: attachment.uploadExpiresAt,
                        maximumBytes: 10 * 1024 * 1024,
                    },
                },
                201,
            );
            return;
        }
        if (
            pathname === `/attachments/uploads/${attachmentId}` &&
            request.method() === 'PUT'
        ) {
            expect(
                request.headers()['x-patchwork-upload-token'],
            ).toBe('private-upload-token');
            uploadedBytes = request.postDataBuffer()?.length ?? 0;
            Object.assign(privateAttachments[0]!, {
                status: 'clean',
                detectedMime: 'image/png',
                updatedAt: now,
            });
            await fulfill({
                attachment: {
                    ...privateAttachments[0],
                    status: 'uploaded',
                },
            });
            return;
        }
        if (
            pathname === '/verification/applications' &&
            request.method() === 'POST'
        ) {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const id = `a7b8b206-c3c3-4ae7-8f29-6877b5a9353${applications.length}`;
            const subjectType = String(body['subjectType']);
            const application = {
                id,
                applicantDid: reviewerDid,
                subjectType,
                organizationId:
                    subjectType === 'volunteer' ? null : organizationId,
                subjectRef:
                    subjectType === 'volunteer' ? reviewerDid
                    : subjectType === 'organization' ? organizationId
                    : resourceUri,
                status: 'pending',
                submittedAt: now,
                decidedAt: null,
                expiresAt: null,
                revokedAt: null,
                updatedAt: now,
            };
            applications.push(application);
            const submittedEvidence = (
                body['evidence'] as Array<Record<string, unknown>>
            )[0];
            evidence.push({
                id: `e7b8b206-c3c3-4ae7-8f29-6877b5a9353${evidence.length}`,
                applicationId: id,
                ...submittedEvidence,
                createdAt: now,
                attachment:
                    submittedEvidence?.['attachmentId'] === attachmentId ?
                        {
                            id: attachmentId,
                            status: privateAttachments[0]?.['status'],
                            detectedMime:
                                privateAttachments[0]?.['detectedMime'],
                        }
                    :   null,
            });
            await fulfill({ application, evidence: [evidence.at(-1)] }, 201);
            return;
        }
        if (pathname === '/verification/review') {
            await fulfill({
                applications: applications.filter(item =>
                    ['pending', 'approved'].includes(String(item['status'])),
                ),
                evidence,
                appeals: appeals.filter(item => item['status'] === 'pending'),
            });
            return;
        }
        if (pathname === '/verification/decisions') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const application = applications.find(
                item => item['id'] === body['applicationId'],
            );
            if (!application) throw new Error('missing application');
            const action = String(body['action']);
            application['status'] =
                action === 'approve' || action === 'renew' ? 'approved'
                : action === 'deny' ? 'denied'
                : 'revoked';
            application['decidedAt'] = now;
            application['expiresAt'] =
                application['status'] === 'approved' ?
                    '2027-07-28T12:00:00.000Z'
                :   null;
            await fulfill({ application, evidence: [] });
            return;
        }
        if (pathname === '/verification/appeals') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const appeal = {
                id: 'c7b8b206-c3c3-4ae7-8f29-6877b5a93531',
                applicationId: body['applicationId'],
                applicantDid: reviewerDid,
                reason: body['reason'],
                status: 'pending',
                submittedAt: now,
            };
            appeals.push(appeal);
            await fulfill({ appeal }, 201);
            return;
        }
        if (pathname === '/verification/appeal-decisions') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const appeal = appeals[0];
            appeal!['status'] = body['decision'];
            const application = applications.find(
                item => item['id'] === appeal!['applicationId'],
            );
            if (body['decision'] === 'upheld' && application) {
                application['status'] = 'approved';
                application['expiresAt'] = '2027-07-28T12:00:00.000Z';
            }
            await fulfill({ appeal });
            return;
        }
        if (pathname === '/verification/exact-address/requests') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const exact = {
                id: 'd7b8b206-c3c3-4ae7-8f29-6877b5a93531',
                organizationId,
                resourceUri,
                applicantDid: reviewerDid,
                streetAddress: body['streetAddress'],
                latitude: body['latitude'],
                longitude: body['longitude'],
                confidentialFacility: body['confidentialFacility'],
                status:
                    body['confidentialFacility'] === true ?
                        'quarantined'
                    :   'pending',
                requestedAt: now,
                approvalExpiresAt: null,
            };
            exactAddressRequests.push(exact);
            await fulfill({ request: exact }, 201);
            return;
        }
        if (pathname === '/verification/exact-address/review') {
            await fulfill({
                requests: exactAddressRequests.filter(item =>
                    ['pending', 'quarantined'].includes(String(item['status'])),
                ),
            });
            return;
        }
        if (pathname === '/verification/exact-address/decisions') {
            const body = request.postDataJSON() as Record<string, unknown>;
            commandBodies.push(body);
            const exact = exactAddressRequests[0];
            exact!['status'] =
                body['decision'] === 'approve' ? 'approved' : body['decision'];
            exact!['approvalExpiresAt'] = '2027-07-28T12:00:00.000Z';
            await fulfill({ request: exact });
            return;
        }
        if ((pathname === '/query/directory' || pathname === '/query/directory-resource')) {
            const approved = exactAddressRequests.find(
                item =>
                    item['status'] === 'approved' &&
                    item['confidentialFacility'] === false,
            );
            await fulfill({
                total: 1,
                page: 1,
                pageSize: 20,
                hasNextPage: false,
                results: [
                    {
                        uri: resourceUri,
                        authorDid: reviewerDid,
                        name: 'Northside Pantry',
                        category: 'food-bank',
                        serviceArea: 'North side',
                        status: 'partner-verified',
                        operationalStatus: 'open',
                        approximateGeo: {
                            latitude: 41.92,
                            longitude: -87.68,
                            precisionKm: 2,
                        },
                        contact: {},
                        updatedAt: now,
                        ...(approved ?
                            {
                                exactPublicAddress: {
                                    kind: 'exact-public-resource',
                                    streetAddress: approved['streetAddress'],
                                    latitude: approved['latitude'],
                                    longitude: approved['longitude'],
                                    approvalExpiresAt:
                                        approved['approvalExpiresAt'],
                                },
                            }
                        :   {}),
                    },
                ],
            });
            return;
        }
        await fulfill(
            { error: { code: 'NOT_FOUND', message: 'Not found.' } },
            404,
        );
    });

    await page.goto('/verification');
    await expect(
        page.getByText('Verification status loaded.'),
    ).toBeVisible();
    const applicationPanel = page.getByRole('region', {
        name: 'Apply for verification',
    });
    await applicationPanel
        .getByLabel('Image or PDF')
        .setInputFiles({
            name: 'evidence.png',
            mimeType: 'image/png',
            buffer: Buffer.from('private-image-bytes'),
        });
    await applicationPanel
        .getByRole('button', { name: 'Upload privately' })
        .click();
    const attachmentSelect = applicationPanel.getByLabel(
        'Clean private attachment (optional)',
    );
    await expect(
        attachmentSelect.locator(`option[value="${attachmentId}"]`),
    ).toHaveText('evidence.png');
    await attachmentSelect.selectOption(attachmentId);
    await applicationPanel.getByLabel('Evidence label').fill('Government ID');
    await applicationPanel
        .getByLabel('Private reviewer notes (optional)')
        .fill('private evidence detail');
    await applicationPanel
        .getByRole('button', { name: 'Submit private application' })
        .click();
    await expect(
        page.getByText('Verification application submitted privately.'),
    ).toBeVisible();
    expect(uploadedBytes).toBeGreaterThan(0);
    expect(commandBodies[0]).toMatchObject({
        evidence: [
            expect.objectContaining({ attachmentId }),
        ],
    });

    const moderatorPanel = page.getByRole('region', {
        name: 'Moderator review',
    });
    await moderatorPanel.getByRole('button', { name: 'Deny' }).click();
    await expect(page.getByText('Denied', { exact: true }).first()).toBeVisible();

    await page.getByLabel('Application').selectOption({ index: 1 });
    await page.getByLabel('Appeal reason').fill('The evidence is current.');
    await page.getByRole('button', { name: 'Submit appeal' }).click();
    await expect(page.getByText('The evidence is current.')).toBeVisible();
    await moderatorPanel.getByRole('button', { name: 'Uphold appeal' }).click();
    await expect(
        page.getByText('Approved', { exact: true }).first(),
    ).toBeVisible();

    const exactPanel = page.getByRole('region', {
        name: 'Request an exact public-resource address',
    });
    await exactPanel.getByLabel('Organization ID').fill(organizationId);
    await exactPanel.getByLabel('Resource AT URI').fill(resourceUri);
    await exactPanel.getByLabel('Street address').fill('123 Public Pantry Way');
    await exactPanel.getByLabel('Latitude').fill('41.921');
    await exactPanel.getByLabel('Longitude').fill('-87.681');
    await exactPanel
        .getByRole('button', { name: 'Request separate approval' })
        .click();
    await moderatorPanel
        .getByRole('button', { name: 'Approve public address' })
        .click();

    await page.goto(
        '/resources?tab=nearby&r=20000&lat=41.88&lng=-87.63&area=Disposable+test+area',
    );
    await page.getByRole('button', { name: 'Open details' }).click();
    await expect(page.getByText('123 Public Pantry Way')).toBeVisible();
    await expect(page.getByText('private evidence detail')).toHaveCount(0);

    for (const command of commandBodies) {
        expect(command).not.toHaveProperty('actorDid');
        expect(command).not.toHaveProperty('moderatorDid');
        expect(command).not.toHaveProperty('status');
        expect(command).not.toHaveProperty('expiresAt');
    }
});
