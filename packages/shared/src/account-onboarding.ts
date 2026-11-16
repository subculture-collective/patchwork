import { z } from 'zod';

export const CURRENT_POLICY_VERSION = '2026-07-28';

export const requiredPolicyDocuments = [
    'terms-of-use',
    'privacy-notice',
    'community-guidelines',
    'synthetic-data-disclosure',
    'location-sharing-consent',
] as const;

export const supportedAccountLanguages = ['en', 'es'] as const;
export const accountLanguageSchema = z.enum(supportedAccountLanguages);

const canonicalAccountPreferenceSchema = z
    .object({
        audience: z.enum(['public', 'authenticated', 'hidden']),
        notifications: z
            .object({
                inApp: z.boolean(),
                email: z.boolean(),
                push: z.boolean(),
            })
            .strict(),
        language: accountLanguageSchema,
        location: z
            .object({
                sharing: z.enum(['approximate', 'hidden']),
                noPermanentAddress: z.boolean(),
            })
            .strict(),
    })
    .strict();

const legacyAccountPreferenceSchema = z.object({
    privacy: z.enum(['public', 'community', 'private']),
    notifications: canonicalAccountPreferenceSchema.shape.notifications,
    visibility: z.enum(['public', 'authenticated', 'hidden']),
    language: accountLanguageSchema,
    location: canonicalAccountPreferenceSchema.shape.location,
}).strict();

/** Accept legacy overlapping fields for one release, return one audience. */
export const accountPreferenceSchema = z.union([
    canonicalAccountPreferenceSchema,
    legacyAccountPreferenceSchema,
]).transform((value) => {
    if ('audience' in value) return value;
    return {
        audience: value.visibility,
        notifications: value.notifications,
        language: value.language,
        location: value.location,
    };
});

export type AccountPreferences = z.infer<typeof accountPreferenceSchema>;

export const defaultAccountPreferences: AccountPreferences = {
    audience: 'authenticated',
    notifications: {
        inApp: true,
        email: true,
        push: false,
    },
    language: 'en',
    location: {
        sharing: 'approximate',
        noPermanentAddress: false,
    },
};

export const acceptPolicyConsentSchema = z
    .object({
        policyVersion: z.literal(CURRENT_POLICY_VERSION),
        asserted18OrOlder: z.literal(true),
        acceptedDocuments: z
            .array(z.enum(requiredPolicyDocuments))
            .length(requiredPolicyDocuments.length)
            .refine(
                value =>
                    requiredPolicyDocuments.every(document =>
                        value.includes(document),
                    ),
                'Every required policy document must be accepted.',
            ),
    })
    .strict();

export type AcceptPolicyConsent = z.infer<
    typeof acceptPolicyConsentSchema
>;
