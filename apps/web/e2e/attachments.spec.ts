import { expect, test } from '@playwright/test';

test('posting binds private bytes to the created aid-post without exposing storage keys', async ({
    page,
    baseURL,
}) => {
    if (!baseURL) throw new Error('Playwright baseURL is required.');
    await page.context().addCookies([
        {
            name: 'patchwork_csrf',
            value: 'attachment-csrf',
            url: baseURL,
        },
    ]);
    const ownerDid = 'did:plc:attachment-poster';
    const postUri =
        `at://${ownerDid}/app.patchwork.aid.post/private-file`;
    const attachmentId =
        '11111111-1111-4111-8111-111111111111';
    let authorizationBody: Record<string, unknown> | undefined;
    let uploadUrl = '';
    let uploadToken = '';
    let uploadedBytes = 0;
    let aidPostBody: Record<string, unknown> | undefined;

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
                    did: ownerDid,
                    handle: 'poster.test',
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
        if (pathname === '/at/aid-posts' && request.method() === 'POST') {
            aidPostBody = request.postDataJSON() as Record<string, unknown>;
            await fulfill(
                {
                    uri: postUri,
                    cid: 'bafy-private-file',
                    record: aidPostBody,
                },
                201,
            );
            return;
        }
        if (
            pathname === '/attachments/uploads' &&
            request.method() === 'POST'
        ) {
            authorizationBody =
                request.postDataJSON() as Record<string, unknown>;
            await fulfill(
                {
                    attachment: {
                        id: attachmentId,
                        purpose: 'aid-post',
                        subjectRef: postUri,
                        filename: 'handoff.png',
                        declaredMime: 'image/png',
                        detectedMime: null,
                        byteSize: 21,
                        status: 'authorized',
                        uploadExpiresAt:
                            '2026-07-28T12:10:00.000Z',
                        retentionExpiresAt:
                            '2027-07-28T12:00:00.000Z',
                        createdAt: '2026-07-28T12:00:00.000Z',
                        updatedAt: '2026-07-28T12:00:00.000Z',
                    },
                    upload: {
                        token: 'private-upload-token',
                        expiresAt: '2026-07-28T12:10:00.000Z',
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
            uploadUrl = request.url();
            uploadToken =
                request.headers()['x-patchwork-upload-token'] ?? '';
            uploadedBytes = request.postDataBuffer()?.length ?? 0;
            await fulfill({
                attachment: {
                    id: attachmentId,
                    purpose: 'aid-post',
                    subjectRef: postUri,
                    filename: 'handoff.png',
                    declaredMime: 'image/png',
                    detectedMime: 'image/png',
                    byteSize: uploadedBytes,
                    status: 'uploaded',
                    uploadExpiresAt: '2026-07-28T12:10:00.000Z',
                    retentionExpiresAt: '2027-07-28T12:00:00.000Z',
                    createdAt: '2026-07-28T12:00:00.000Z',
                    updatedAt: '2026-07-28T12:00:01.000Z',
                },
            });
            return;
        }
        await fulfill(
            { error: { code: 'NOT_FOUND', message: 'Not found.' } },
            404,
        );
    });

    await page.goto(
        '/posting?tab=nearby&r=20000&lat=41.88&lng=-87.63&area=Disposable+test+area',
        { waitUntil: 'networkidle' },
    );
    await expect(page.getByText('@poster.test', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Latitude')).toHaveCount(0);
    await expect(page.getByLabel('Longitude')).toHaveCount(0);
    await expect(page.getByLabel('Precision meters')).toHaveCount(0);
    await expect(page.getByText('Selected area: Disposable test area')).toBeVisible();
    await expect(page.getByText(/Public at 1 km precision or coarser/)).toBeVisible();
    await page.getByLabel('Title').fill('Disposable attachment request');
    await page
        .getByLabel('Description')
        .fill('Exercises the private attachment boundary in a disposable test.');
    await page.getByLabel('Private attachments (optional)').setInputFiles({
        name: 'handoff.png',
        mimeType: 'image/png',
        buffer: Buffer.from('private-handoff-bytes'),
    });
    await expect(
        page.getByText('handoff.png · 1 KB', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Publish request' }).click();

    expect(aidPostBody).toMatchObject({
        location: {
            precisionKm: 1,
        },
    });

    await expect(
        page.getByText(
            '1 private attachment(s) uploaded and queued for malware scanning.',
        ),
    ).toBeVisible();
    expect(authorizationBody).toMatchObject({
        filename: 'handoff.png',
        declaredMime: 'image/png',
        purpose: 'aid-post',
        subjectRef: postUri,
    });
    expect(uploadedBytes).toBeGreaterThan(0);
    expect(uploadToken).toBe('private-upload-token');
    expect(uploadUrl).not.toContain(uploadToken);
    expect(JSON.stringify(authorizationBody)).not.toContain(
        'private/original/',
    );
});
