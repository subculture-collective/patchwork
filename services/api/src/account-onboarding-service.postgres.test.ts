import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    CURRENT_POLICY_VERSION,
    defaultAccountPreferences,
    requiredPolicyDocuments,
} from '@patchwork/shared';
import { AccountOnboardingService } from './account-onboarding-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('durable account onboarding', () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const service = new AccountOnboardingService(pool);
    const did = 'did:plc:onboarding-alice';

    beforeAll(async () => {
        await pool.query(
            await readFile(
                new URL(
                    './db/migrations/0014_account_onboarding.sql',
                    import.meta.url,
                ),
                'utf8',
            ),
        );
        await pool.query(
            `TRUNCATE account_preference_audit, account_preferences,
                      account_policy_consents`,
        );
    });

    afterAll(async () => {
        await pool.end();
    });

    it('requires current consent, persists it across service instances, and rejects stale policy', async () => {
        await expect(service.statusFor(did)).resolves.toMatchObject({
            policyVersion: CURRENT_POLICY_VERSION,
            consentRequired: true,
            acceptedAt: null,
        });
        await expect(service.requireCurrentConsent(did)).rejects.toMatchObject({
            code: 'CURRENT_POLICY_CONSENT_REQUIRED',
        });
        await expect(
            service.accept(did, {
                policyVersion: 'stale',
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            }),
        ).rejects.toMatchObject({ code: 'INVALID_POLICY_CONSENT' });

        await service.accept(
            did,
            {
                policyVersion: CURRENT_POLICY_VERSION,
                asserted18OrOlder: true,
                acceptedDocuments: [...requiredPolicyDocuments],
            },
            new Date('2026-07-28T20:00:00.000Z'),
        );
        const restarted = new AccountOnboardingService(pool);
        await expect(restarted.statusFor(did)).resolves.toEqual({
            policyVersion: CURRENT_POLICY_VERSION,
            requiredDocuments: [...requiredPolicyDocuments],
            consentRequired: false,
            acceptedAt: '2026-07-28T20:00:00.000Z',
        });
        await expect(restarted.requireCurrentConsent(did)).resolves.toBeUndefined();
    });

    it('persists privacy-safe preferences and an audit without accepting exact location', async () => {
        await expect(service.preferencesFor(did)).resolves.toEqual(
            defaultAccountPreferences,
        );
        const next = {
            ...defaultAccountPreferences,
            audience: 'hidden' as const,
            language: 'es' as const,
            location: {
                sharing: 'hidden' as const,
                noPermanentAddress: true,
            },
        };
        await expect(
            service.updatePreferences(
                did,
                next,
                new Date('2026-07-28T20:05:00.000Z'),
            ),
        ).resolves.toEqual(next);
        await expect(service.preferencesFor(did)).resolves.toEqual(next);
        await expect(
            service.updatePreferences(did, {
                ...next,
                location: {
                    sharing: 'exact',
                    noPermanentAddress: true,
                },
            }),
        ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_PREFERENCES' });

        const audit = await pool.query(
            `SELECT did, next_value FROM account_preference_audit
             WHERE did = $1`,
            [did],
        );
        expect(audit.rows).toEqual([{ did, next_value: next }]);
    });
});
