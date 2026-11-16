import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AccountOnboardingService } from './account-onboarding-service.js';
import { NativeHandoffService, challengeFor, type NativeCompletionStore } from './auth/native-handoff.js';
import type { BrowserSessionRepository } from './auth/session-repository.js';

const fixture = (name: string) => JSON.parse(readFileSync(
    new URL(`../../../packages/mobile-contracts/fixtures/${name}`, import.meta.url), 'utf8'));

describe('native Android auth wire fixtures', () => {
    it('binds the exchange fixture to the real bounded-session service', async () => {
        const expected = fixture('native-auth-session.json');
        const store: NativeCompletionStore = {
            put: vi.fn(async () => undefined),
            consume: vi.fn(async () => 'did:plc:fixture'),
        };
        const sessions = { create: vi.fn(async () => expected.sessionToken) } as unknown as BrowserSessionRepository;
        const service = new NativeHandoffService(['org.example.patchwork.shell.development.oauth://callback'], store,
            sessions, () => new Date('2026-11-16T12:00:00Z'));
        const result = await service.exchange({
            code: 'c'.repeat(43), codeVerifier: 'v'.repeat(43),
            redirectUri: 'org.example.patchwork.shell.development.oauth://callback', state: 's'.repeat(43),
        });
        expect(result).toEqual(expected);
        expect(store.consume).toHaveBeenCalledWith(expect.any(String), challengeFor('v'.repeat(43)),
            'org.example.patchwork.shell.development.oauth://callback', 's'.repeat(43), expect.any(Date));
        expect(sessions.create).toHaveBeenCalledWith('did:plc:fixture', new Date(expected.expiresAt));
    });

    it('binds versioned consent documents to the actual onboarding service', async () => {
        const pool = { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool;
        expect(await new AccountOnboardingService(pool).statusFor('did:plc:fixture'))
            .toEqual(fixture('native-auth-policy.json'));
    });
});
