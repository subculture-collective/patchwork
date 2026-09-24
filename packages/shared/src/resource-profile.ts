import { z } from 'zod';

const url = z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value));
export const resourceEvidenceSchema = z
    .object({
        sourceUrl: url,
        sourceName: z.string().trim().min(1).max(160),
        confirmedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        reviewStatus: z.enum(['reviewed', 'pending', 'conflicting']),
    })
    .strict()
    .refine(
        (e) => Date.parse(e.expiresAt) > Date.parse(e.confirmedAt),
        'Expiry must follow confirmation.',
    );
const minute = z.number().int().min(0).max(1440);
export const serviceHoursSchema = z
    .object({
        timezone: z
            .string()
            .max(100)
            .refine((value) => {
                try {
                    new Intl.DateTimeFormat('en', { timeZone: value });
                    return true;
                } catch {
                    return false;
                }
            }),
        weekly: z
            .array(
                z
                    .object({
                        day: z.number().int().min(0).max(6),
                        start: minute,
                        end: minute,
                    })
                    .strict()
                    .refine(
                        (i) => i.start !== i.end && i.start < 1440,
                        'Use explicit nonempty intervals.',
                    ),
            )
            .max(28),
        exceptions: z
            .array(
                z
                    .object({
                        date: z
                            .string()
                            .regex(/^\d{4}-\d{2}-\d{2}$/)
                            .refine(
                                (v) =>
                                    !Number.isNaN(Date.parse(v)) &&
                                    new Date(v).toISOString().slice(0, 10) ===
                                        v,
                            ),
                        intervals: z
                            .array(
                                z
                                    .object({ start: minute, end: minute })
                                    .strict()
                                    .refine((i) => i.start < i.end),
                            )
                            .max(8),
                    })
                    .strict(),
            )
            .max(100),
    })
    .strict()
    .refine(
        (h) =>
            new Set(h.exceptions.map((e) => e.date)).size ===
            h.exceptions.length,
        'Each date can have only one exception.',
    );
export const eligibilityQuestionIds = [
    'ageYears',
    'householdSize',
    'annualIncome',
    'state',
    'veteran',
    'pregnantOrPostpartum',
] as const;
export const eligibilityRuleSchema = z
    .object({
        question: z.enum(eligibilityQuestionIds),
        operator: z.enum(['equals', 'at-most', 'at-least']),
        value: z.union([z.string().max(100), z.number().finite(), z.boolean()]),
        description: z.string().min(1).max(500),
        evidence: resourceEvidenceSchema,
    })
    .strict()
    .superRefine((rule, ctx) => {
        const numeric = ['ageYears', 'householdSize', 'annualIncome'].includes(
            rule.question,
        );
        const expected = numeric
            ? 'number'
            : rule.question === 'state'
              ? 'string'
              : 'boolean';
        if (
            typeof rule.value !== expected ||
            (!numeric && rule.operator !== 'equals') ||
            (numeric && Number(rule.value) < 0)
        )
            ctx.addIssue({
                code: 'custom',
                message: 'Rule value and operator must match the question.',
            });
    });
const assertion = <T extends z.ZodType>(value: T) =>
    z.object({ value, evidence: resourceEvidenceSchema }).strict();
export const resourceServiceProfileSchema = z
    .object({
        id: z.string().regex(/^[a-z0-9-]{1,80}$/),
        name: z.string().trim().min(1).max(160),
        delivery: assertion(
            z.enum(['in-person', 'remote', 'hybrid']),
        ).optional(),
        serviceArea: assertion(z.string().max(1000)).optional(),
        cost: assertion(z.string().max(500)).optional(),
        languages: assertion(z.array(z.string().max(80)).max(30)).optional(),
        accessibility: assertion(
            z.array(z.string().max(160)).max(30),
        ).optional(),
        documents: assertion(z.array(z.string().max(200)).max(30)).optional(),
        appointment: assertion(
            z.enum(['required', 'recommended', 'walk-in']),
        ).optional(),
        applicationUrl: assertion(url).optional(),
        hours: assertion(serviceHoursSchema).optional(),
        eligibility: z.array(eligibilityRuleSchema).max(30).default([]),
    })
    .strict();
export const resourceProfileSchema = z
    .object({
        version: z.literal(1),
        organizationName: z.string().min(1).max(200).optional(),
        services: z.array(resourceServiceProfileSchema).max(50),
    })
    .strict()
    .refine(
        (p) => new Set(p.services.map((s) => s.id)).size === p.services.length,
        'Service identifiers must be unique.',
    );
export type ResourceProfile = z.infer<typeof resourceProfileSchema>;
export type ResourceServiceProfile = z.infer<
    typeof resourceServiceProfileSchema
>;
export type ResourceEvidence = z.infer<typeof resourceEvidenceSchema>;
export type EligibilityAnswers = Partial<
    Record<(typeof eligibilityQuestionIds)[number], string | number | boolean>
>;
export function currentResourceEvidence(
    e: ResourceEvidence,
    now: Date,
): boolean {
    return (
        e.reviewStatus === 'reviewed' &&
        Date.parse(e.confirmedAt) <= now.getTime() &&
        Date.parse(e.expiresAt) > now.getTime()
    );
}
export function evaluateServiceEligibility(
    service: ResourceServiceProfile,
    answers: EligibilityAnswers,
    now = new Date(),
) {
    const rules = service.eligibility.map((rule) => {
        const answer = answers[rule.question];
        if (
            !currentResourceEvidence(rule.evidence, now) ||
            answer === undefined ||
            typeof answer !== typeof rule.value
        )
            return {
                description: rule.description,
                status: 'unknown' as const,
            };
        const match =
            rule.operator === 'equals'
                ? answer === rule.value
                : rule.operator === 'at-most'
                  ? Number(answer) <= Number(rule.value)
                  : Number(answer) >= Number(rule.value);
        return {
            description: rule.description,
            status: match ? ('met' as const) : ('not-met' as const),
        };
    });
    return {
        status: rules.some((r) => r.status === 'not-met')
            ? ('requirement-not-met' as const)
            : !rules.length || rules.some((r) => r.status === 'unknown')
              ? ('more-information' as const)
              : ('potential-match' as const),
        rules,
    };
}
export function serviceScheduleStatus(
    service: ResourceServiceProfile,
    at: Date,
    now = new Date(),
): 'scheduled-open' | 'scheduled-closed' | 'unknown' {
    if (
        !service.hours ||
        !currentResourceEvidence(service.hours.evidence, now) ||
        Date.parse(service.hours.evidence.expiresAt) <= at.getTime() ||
        !Number.isFinite(at.getTime())
    )
        return 'unknown';
    const hours = service.hours.value;
    // Evaluate wall-clock schedules in the service timezone, including DST.
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: hours.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        })
            .formatToParts(at)
            .map((p) => [p.type, p.value]),
    );
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
        parts.weekday!,
    );
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const exception = hours.exceptions.find((e) => e.date === date);
    if (exception)
        return exception.intervals.some(
            (i) => minute >= i.start && minute < i.end,
        )
            ? 'scheduled-open'
            : 'scheduled-closed';
    const previousDate = new Date(
        Date.UTC(
            Number(parts.year),
            Number(parts.month) - 1,
            Number(parts.day) - 1,
        ),
    )
        .toISOString()
        .slice(0, 10);
    const priorException = hours.exceptions.some(
        (e) => e.date === previousDate,
    );
    return hours.weekly.some(
        (i) =>
            (i.day === day &&
                (i.start < i.end
                    ? minute >= i.start && minute < i.end
                    : minute >= i.start)) ||
            (!priorException &&
                i.day === (day + 6) % 7 &&
                i.start > i.end &&
                minute < i.end),
    )
        ? 'scheduled-open'
        : 'scheduled-closed';
}
