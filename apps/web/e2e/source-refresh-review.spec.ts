import { expect, test } from '@playwright/test';

test('reviewer inspects retained evidence, applies contact data, and dismisses a review-only candidate', async ({ page }) => {
    const candidateId = '00000000-0000-4000-8000-000000000041';
    const reviewId = '00000000-0000-4000-8000-000000000042';
    const updatedAt = '2026-09-19T18:00:00.000Z';
    const actions: { path: string; body: Record<string, unknown> }[] = [];
    let pending = [
        {
            candidateId, runId: '00000000-0000-4000-8000-000000000051',
            resourceUri: 'at://did:plc:cpl/app.patchwork.directory.resource/albany-park',
            disposition: 'contact-automation-candidate', changedFields: ['phone'], reasons: [],
            before: { name: 'Albany Park Library', phone: '(312) 555-0100' },
            after: { name: 'Albany Park Library', phone: '(312) 555-0199' },
            evidence: { url: 'https://data.cityofchicago.org/resource/x8fc-8rcq.json', retrievedAt: updatedAt, sha256: 'a'.repeat(64) },
            status: 'pending', decisionDetails: null, sourceId: 'cpl', rawSha256: 'a'.repeat(64),
            normalizedSha256: 'b'.repeat(64), retrievedAt: updatedAt, createdAt: updatedAt, updatedAt, appliedAt: null,
        },
        {
            candidateId: reviewId, runId: '00000000-0000-4000-8000-000000000052',
            resourceUri: 'at://did:plc:cpl/app.patchwork.directory.resource/avondale',
            disposition: 'review', changedFields: ['openHours'], reasons: ['structured-evidence-required'],
            before: { name: 'Avondale Library', openHours: 'See website' },
            after: { name: 'Avondale Library', openHours: 'Mon 9–5' },
            evidence: { url: 'https://data.cityofchicago.org/resource/x8fc-8rcq.json', retrievedAt: updatedAt, sha256: 'c'.repeat(64) },
            status: 'pending', decisionDetails: null, sourceId: 'cpl', rawSha256: 'c'.repeat(64),
            normalizedSha256: 'd'.repeat(64), retrievedAt: updatedAt, createdAt: updatedAt, updatedAt, appliedAt: null,
        },
    ];
    await page.route('**/api/**', route => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api/, '');
        if (path === '/auth/session') return route.fulfill({ json: { session: {
            did: 'did:plc:reviewer', handle: 'reviewer.test', role: 'moderator', expiresAt: '2099-01-01T00:00:00.000Z',
        } } });
        if (path === '/account/onboarding') return route.fulfill({ json: {
            policyVersion: '2026-07-28', requiredDocuments: [], consentRequired: false, acceptedAt: updatedAt,
        } });
        if (path === '/moderation/queue') return route.fulfill({ json: { results: [] } });
        if (path === '/maintenance') return route.fulfill({ json: { maintenance: {
            active: false, reasonCodes: [], publicMessage: 'Operating normally.', activatedAt: null,
            resumedAt: null, version: 1, updatedAt, environmentOverride: false,
        } } });
        if (path === '/admin/source-refresh/candidates' && route.request().method() === 'GET') {
            return route.fulfill({ json: { items: pending, page: 1, hasNextPage: false } });
        }
        if (path.endsWith('/apply-contact')) {
            const body = route.request().postDataJSON(); actions.push({ path, body });
            pending = pending.filter(item => item.candidateId !== body.candidateId);
            return route.fulfill({ json: { candidateId: body.candidateId, applied: true } });
        }
        if (path.endsWith('/dismiss')) {
            const body = route.request().postDataJSON(); actions.push({ path, body });
            pending = pending.filter(item => item.candidateId !== body.candidateId);
            return route.fulfill({ json: { updated: true } });
        }
        return route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Unavailable.' } } });
    });

    await page.goto('/moderation');
    await expect(page.getByRole('heading', { name: 'Publisher source refresh review' })).toBeVisible();
    await expect(page.getByText('SHA-256: ' + 'a'.repeat(64))).toBeHidden();
    await page.getByText('Publisher evidence', { exact: true }).first().click();
    await expect(page.getByText('SHA-256: ' + 'a'.repeat(64))).toBeVisible();
    await page.getByRole('button', { name: 'Apply verified contact update' }).click();
    await expect(page.getByText('The contact update was applied and audited.')).toBeVisible();
    await page.getByLabel('Reason for dismissal').fill('The publisher record needs a structured-hours review before use.');
    await page.getByRole('button', { name: 'Dismiss candidate' }).click();
    await expect(page.getByText('The candidate was dismissed.')).toBeVisible();
    expect(actions).toEqual([
        { path: '/admin/source-refresh/candidates/apply-contact', body: { candidateId } },
        { path: '/admin/source-refresh/candidates/dismiss', body: { candidateId: reviewId, expectedUpdatedAt: updatedAt, reason: 'The publisher record needs a structured-hours review before use.' } },
    ]);
});
