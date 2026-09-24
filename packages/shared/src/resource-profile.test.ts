import { describe, it, expect } from 'vitest';
import {
    resourceProfileSchema,
    evaluateServiceEligibility,
    serviceScheduleStatus,
    type ResourceServiceProfile,
} from './resource-profile.js';
const now = new Date('2026-09-10T12:00:00Z');
const evidence = {
    sourceUrl: 'https://example.org',
    sourceName: 'Provider',
    confirmedAt: '2026-09-01T00:00:00Z',
    expiresAt: '2026-12-01T00:00:00Z',
    reviewStatus: 'reviewed' as const,
};
const service: ResourceServiceProfile = {
    id: 'pantry',
    name: 'Pantry',
    eligibility: [],
    hours: {
        evidence,
        value: {
            timezone: 'America/Chicago',
            weekly: [{ day: 4, start: 22 * 60, end: 2 * 60 }],
            exceptions: [],
        },
    },
};
describe('source-backed service matching', () => {
    it('retains uncertainty and explains unmet requirements without determining eligibility', () => {
        const s = {
            ...service,
            eligibility: [
                {
                    question: 'ageYears' as const,
                    operator: 'at-least' as const,
                    value: 18,
                    description: 'Age 18 or older',
                    evidence,
                },
            ],
        };
        expect(evaluateServiceEligibility(s, {}, now).status).toBe(
            'more-information',
        );
        expect(
            evaluateServiceEligibility(s, { ageYears: 17 }, now).status,
        ).toBe('requirement-not-met');
        expect(
            evaluateServiceEligibility(s, { ageYears: 18 }, now).status,
        ).toBe('potential-match');
        expect(
            evaluateServiceEligibility(
                {
                    ...s,
                    eligibility: [
                        {
                            ...s.eligibility[0]!,
                            evidence: {
                                ...evidence,
                                reviewStatus: 'conflicting',
                            },
                        },
                    ],
                },
                { ageYears: 18 },
                now,
            ).status,
        ).toBe('more-information');
    });
    it('handles local overnight hours and explicit closure exceptions', () => {
        expect(
            serviceScheduleStatus(
                service,
                new Date('2026-09-11T04:00:00Z'),
                now,
            ),
        ).toBe('scheduled-open');
        expect(
            serviceScheduleStatus(
                service,
                new Date('2026-09-11T06:00:00Z'),
                now,
            ),
        ).toBe('scheduled-open');
        expect(
            serviceScheduleStatus(
                service,
                new Date('2026-09-11T07:00:00Z'),
                now,
            ),
        ).toBe('scheduled-closed');
        const closed = {
            ...service,
            hours: {
                ...service.hours!,
                value: {
                    ...service.hours!.value,
                    exceptions: [{ date: '2026-09-11', intervals: [] }],
                },
            },
        };
        expect(
            serviceScheduleStatus(
                closed,
                new Date('2026-09-11T06:00:00Z'),
                now,
            ),
        ).toBe('scheduled-closed');
    });
    it('does not use expired evidence or invalid schedules', () => {
        expect(
            serviceScheduleStatus(
                service,
                new Date('2027-01-01T00:00:00Z'),
                now,
            ),
        ).toBe('unknown');
        expect(
            resourceProfileSchema.safeParse({
                version: 1,
                services: [
                    {
                        ...service,
                        hours: {
                            ...service.hours!,
                            value: {
                                ...service.hours!.value,
                                timezone: 'Not/AZone',
                            },
                        },
                    },
                ],
            }).success,
        ).toBe(false);
        expect(
            resourceProfileSchema.safeParse({
                version: 1,
                services: [service, service],
            }).success,
        ).toBe(false);
    });
    it('uses the service timezone across the fall daylight-saving transition', () => {
        const sunday = {
            ...service,
            hours: {
                ...service.hours!,
                value: {
                    ...service.hours!.value,
                    weekly: [{ day: 0, start: 60, end: 120 }],
                },
            },
        };
        for (const hour of ['2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z'])
            expect(serviceScheduleStatus(sunday, new Date(hour), now)).toBe(
                'scheduled-open',
            );
    });
});
