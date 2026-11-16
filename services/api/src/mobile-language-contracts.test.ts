import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountPreferenceSchema, supportedAccountLanguages } from '@patchwork/shared';
import { localizedNotificationCopy } from './durable-notification-service.js';

const read = <T = unknown>(name: string): T => JSON.parse(readFileSync(
    new URL(`../../../packages/mobile-contracts/fixtures/${name}.json`, import.meta.url), 'utf8')) as T;

describe('portable native language fixtures', () => {
    it.each(supportedAccountLanguages)('keeps the %s preference canonical', language => {
        const fixture = read<{ preferences: unknown }>(`account-preferences-${language}`);
        expect(accountPreferenceSchema.parse(fixture.preferences)).toEqual(fixture.preferences);
    });
    it('rejects unsupported languages rather than coercing them', () => {
        const input = read<{ preferences: unknown }>('account-preferences-unsupported');
        expect(accountPreferenceSchema.safeParse(input.preferences).success).toBe(false);
    });
    it('binds unknown-error fallback to existing localized member copy, never diagnostic prose', () => {
        const fixture = read<{ error: { code: string; message: string }; messageKey: string; translations: Record<string, string> }>('native-error-fallback');
        expect(fixture.messageKey).toBe('common.requestFailed');
        for (const locale of supportedAccountLanguages) {
            const web = JSON.parse(readFileSync(new URL(`../../../apps/web/src/i18n/${locale}.json`, import.meta.url), 'utf8'));
            expect(fixture.translations[locale]).toBe(web.common.requestFailed);
            expect(fixture.translations[locale]).not.toContain(fixture.error.message);
        }
    });
    it('leaves unrecognized English text unchanged and never machine-translates member text', () => {
        const memberCopy = { title: 'A fictional member title', body: 'Texto escrito por una persona.' };
        expect(localizedNotificationCopy('offer_received', 'en', memberCopy)).toEqual(memberCopy);
        expect(localizedNotificationCopy('offer_received', 'unsupported', memberCopy)).toEqual(memberCopy);
    });
});
