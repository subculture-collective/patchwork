import { z } from 'zod';
import { lookupPostalArea, postalLocationSchema } from './postal-geography.js';

export const recordNsid = {
    aidPost: 'app.patchwork.aid.post',
    volunteerProfile: 'app.patchwork.volunteer.profile',
    conversationMeta: 'app.patchwork.conversation.meta',
    moderationReport: 'app.patchwork.moderation.report',
    directoryResource: 'app.patchwork.directory.resource',
} as const;

export type RecordNsid = (typeof recordNsid)[keyof typeof recordNsid];

const didSchema = z
    .string()
    .regex(/^did:[a-z0-9]+:[a-z0-9._:%-]+$/i, 'Expected a valid DID');
const atUriSchema = z
    .string()
    .regex(/^at:\/\/[^\s]+$/i, 'Expected a valid at:// URI');
const isoDateTimeSchema = z.string().datetime({ offset: true });

const aidCategoryValues = [
    'food',
    'shelter',
    'medical',
    'transport',
    'childcare',
    'other',
] as const;

const aidUrgencyValues = ['low', 'medium', 'high', 'critical'] as const;

const legacyAidLocationSchema = z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    precisionKm: z.number().min(1).max(50),
    areaLabel: z.string().min(1).max(120).optional(),
    postalCode: postalLocationSchema.shape.postalCode.optional(),
    countryCode: z.literal('US').optional(),
}).strict();

// Coordinates on a ZIP record are derived public geography metadata. Re-parsing
// always overwrites them, so callers cannot inject a more precise location.
const aidLocationSchema = z.union([postalLocationSchema, legacyAidLocationSchema])
    .transform(value => {
        if (value.postalCode) {
            const area = lookupPostalArea(value.postalCode)!;
            return { latitude: area.latitude, longitude: area.longitude,
                precisionKm: 1, areaLabel: `ZIP ${area.postalCode}`,
                postalCode: area.postalCode, countryCode: 'US' as const };
        }
        return value as z.infer<typeof legacyAidLocationSchema>;
    });

export const aidPostSchema = z.object({
    $type: z.literal(recordNsid.aidPost),
    version: z.enum(['1.0.0', '2.0.0']),
    title: z.string().min(1).max(140),
    description: z.string().min(1).max(5000),
    category: z.enum(aidCategoryValues),
    urgency: z.enum(aidUrgencyValues),
    status: z.enum(['open', 'in-progress', 'resolved', 'closed']),
    location: aidLocationSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.optional(),
}).strict().superRefine((value, context) => {
    if (value.version === '2.0.0' && !value.location.postalCode) {
        context.addIssue({ code: 'custom', path: ['location', 'postalCode'], message: 'A five-digit ZIP is required.' });
    }
    if (value.version === '1.0.0' && value.location.postalCode) {
        context.addIssue({ code: 'custom', path: ['version'], message: 'ZIP locations require record version 2.0.0.' });
    }
});

const volunteerServiceAreaSchema = z
    .object({
        areaLabel: z.string().min(1).max(120),
        noPermanentAddress: z.boolean(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        precisionKm: z.number().min(1).max(50).optional(),
    })
    .strict()
    .superRefine((value, context) => {
        const coordinateFields = [
            value.latitude,
            value.longitude,
            value.precisionKm,
        ];
        const count = coordinateFields.filter(
            item => item !== undefined,
        ).length;
        if (count !== 0 && count !== coordinateFields.length) {
            context.addIssue({
                code: 'custom',
                message:
                    'Approximate service-area coordinates must be supplied together.',
            });
        }
    });

export const volunteerProfileSchema = z
    .object({
        $type: z.literal(recordNsid.volunteerProfile),
        version: z.enum(['1.0.0', '1.1.0', '1.2.0']),
        displayName: z.string().min(1).max(80),
        bio: z.string().max(500).optional(),
        capabilities: z
            .array(
                z.enum([
                    'transport',
                    'food-delivery',
                    'translation',
                    'first-aid',
                    'childcare',
                    'other',
                ]),
            )
            .min(1),
        availability: z.enum([
            'immediate',
            'within-24h',
            'scheduled',
            'unavailable',
        ]),
        contactPreference: z.enum(['chat-only', 'chat-or-call']),
        skills: z.array(z.string().min(1).max(64)).min(1).max(50).optional(),
        languages: z
            .array(
                z
                    .string()
                    .min(2)
                    .max(35)
                    .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/),
            )
            .min(1)
            .max(20)
            .optional(),
        serviceArea: volunteerServiceAreaSchema.optional(),
        // Legacy fields remain readable for repository compatibility. New
        // Patchwork writes keep these private and never publish them.
        availabilityWindows: z
            .array(z.string().min(1).max(64))
            .min(1)
            .max(50)
            .optional(),
        verificationCheckpoints: z
            .object({
                identityCheck: z.enum(['pending', 'approved', 'rejected']),
                safetyTraining: z.enum(['pending', 'approved', 'rejected']),
                communityReference: z.enum([
                    'pending',
                    'approved',
                    'rejected',
                ]),
            })
            .strict()
            .optional(),
        matchingPreferences: z
            .object({
                preferredCategories: z
                    .array(z.enum(aidCategoryValues))
                    .min(1),
                preferredUrgencies: z
                    .array(z.enum(aidUrgencyValues))
                    .min(1),
                maxDistanceKm: z.number().min(1).max(250),
                acceptsLateNight: z.boolean().optional(),
            })
            .strict()
            .optional(),
        notes: z.string().max(500).optional(),
        createdAt: isoDateTimeSchema,
        updatedAt: isoDateTimeSchema.optional(),
    })
    .strict();

export const conversationMetaSchema = z.object({
    $type: z.literal(recordNsid.conversationMeta),
    version: z.literal('1.0.0'),
    aidPostUri: atUriSchema,
    participantDids: z.array(didSchema).min(2).max(2),
    status: z.enum(['open', 'handoff', 'closed']),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.optional(),
});

export const moderationReportSchema = z.object({
    $type: z.literal(recordNsid.moderationReport),
    version: z.literal('1.0.0'),
    subjectUri: atUriSchema,
    reporterDid: didSchema,
    reason: z.enum(['spam', 'abuse', 'fraud', 'other']),
    details: z.string().max(1000).optional(),
    createdAt: isoDateTimeSchema,
});

export const directoryResourceSchema = z.object({
    $type: z.literal(recordNsid.directoryResource),
    version: z.enum(['1.0.0', '1.1.0']),
    name: z.string().min(1).max(120),
    category: z.enum([
        'food-bank',
        'shelter',
        'clinic',
        'legal-aid',
        'hotline',
        'other',
    ]),
    serviceArea: z.string().min(1).max(120),
    contact: z
        .object({
            url: z.string().url().optional(),
            phone: z.string().min(7).max(32).optional(),
        })
        .strict()
        .refine(value => value.url !== undefined || value.phone !== undefined, {
            message: 'At least one contact method is required.',
        }),
    verificationStatus: z.enum([
        'unverified',
        'community-verified',
        'partner-verified',
    ]),
    location: z
        .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            precisionKm: z.number().min(0.1).max(50),
            areaLabel: z.string().min(1).max(120).optional(),
        })
        .strict()
        .optional(),
    openHours: z.string().min(1).max(200).optional(),
    eligibilityNotes: z.string().min(1).max(500).optional(),
    operationalStatus: z.enum(['open', 'limited', 'closed']).optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema.optional(),
}).strict();

export type AidPostRecord = z.infer<typeof aidPostSchema>;
export type VolunteerProfileRecord = z.infer<typeof volunteerProfileSchema>;
export type ConversationMetaRecord = z.infer<typeof conversationMetaSchema>;
export type ModerationReportRecord = z.infer<typeof moderationReportSchema>;
export type DirectoryResourceRecord = z.infer<typeof directoryResourceSchema>;

const MICRODEGREES_PER_DEGREE = 1_000_000;
const METRES_PER_KILOMETRE = 1_000;

interface AtLocation {
    latitudeE6: number;
    longitudeE6: number;
    precisionMeters: number;
    areaLabel?: string;
}

type AtAidPostRecord = Omit<AidPostRecord, 'location'> & {
    location: AtLocation | { countryCode: 'US'; postalCode: string };
};

type AtDirectoryResourceRecord = Omit<DirectoryResourceRecord, 'location'> & {
    location?: AtLocation;
};

type AtVolunteerProfileRecord = Omit<
    VolunteerProfileRecord,
    'serviceArea'
> & {
    serviceArea?:
        | Omit<
              NonNullable<VolunteerProfileRecord['serviceArea']>,
              'latitude' | 'longitude' | 'precisionKm'
          >
        | (Omit<
              NonNullable<VolunteerProfileRecord['serviceArea']>,
              'latitude' | 'longitude' | 'precisionKm'
          > &
              AtLocation);
};

const encodeLocation = (
    location: AidPostRecord['location'],
): AtLocation => ({
    latitudeE6: Math.round(
        location.latitude * MICRODEGREES_PER_DEGREE,
    ),
    longitudeE6: Math.round(
        location.longitude * MICRODEGREES_PER_DEGREE,
    ),
    precisionMeters: Math.round(
        location.precisionKm * METRES_PER_KILOMETRE,
    ),
    ...(location.areaLabel === undefined
        ? {}
        : { areaLabel: location.areaLabel }),
});

const decodeLocation = (input: unknown): AidPostRecord['location'] | unknown => {
    if (typeof input !== 'object' || input === null) return input;
    const encoded = input as Record<string, unknown>;
    const latitudeE6 = encoded['latitudeE6'];
    const longitudeE6 = encoded['longitudeE6'];
    const precisionMeters = encoded['precisionMeters'];
    if (
        typeof latitudeE6 !== 'number' ||
        !Number.isInteger(latitudeE6) ||
        typeof longitudeE6 !== 'number' ||
        !Number.isInteger(longitudeE6) ||
        typeof precisionMeters !== 'number' ||
        !Number.isInteger(precisionMeters)
    ) {
        return input;
    }
    return {
        latitude: latitudeE6 / MICRODEGREES_PER_DEGREE,
        longitude: longitudeE6 / MICRODEGREES_PER_DEGREE,
        precisionKm: precisionMeters / METRES_PER_KILOMETRE,
        ...(typeof encoded['areaLabel'] === 'string'
            ? { areaLabel: encoded['areaLabel'] }
            : {}),
    };
};

export const encodeAidPostForAt = (
    record: AidPostRecord,
): AtAidPostRecord => ({
    ...record,
    location: record.location.postalCode
        ? { countryCode: 'US', postalCode: record.location.postalCode }
        : encodeLocation(record.location),
});

export const decodeAidPostFromAt = (input: unknown): AidPostRecord => {
    if (typeof input !== 'object' || input === null) {
        return aidPostSchema.parse(input);
    }
    const record = input as Record<string, unknown>;
    return aidPostSchema.parse({
        ...record,
        location: decodeLocation(record['location']),
    });
};

export const encodeDirectoryResourceForAt = (
    record: DirectoryResourceRecord,
): AtDirectoryResourceRecord => {
    const { location, ...rest } = record;
    return {
        ...rest,
        ...(location ? { location: encodeLocation(location) } : {}),
    };
};

export const decodeDirectoryResourceFromAt = (
    input: unknown,
): DirectoryResourceRecord => {
    if (typeof input !== 'object' || input === null) {
        return directoryResourceSchema.parse(input);
    }
    const record = input as Record<string, unknown>;
    return directoryResourceSchema.parse({
        ...record,
        ...(record['location'] === undefined
            ? {}
            : { location: decodeLocation(record['location']) }),
    });
};

export const encodeVolunteerProfileForAt = (
    record: VolunteerProfileRecord,
): AtVolunteerProfileRecord => {
    const { serviceArea, ...rest } = record;
    if (
        !serviceArea ||
        serviceArea.latitude === undefined ||
        serviceArea.longitude === undefined ||
        serviceArea.precisionKm === undefined
    ) {
        return {
            ...rest,
            ...(serviceArea ? { serviceArea } : {}),
        };
    }
    return {
        ...rest,
        serviceArea: {
            noPermanentAddress: serviceArea.noPermanentAddress,
            ...encodeLocation({
                latitude: serviceArea.latitude,
                longitude: serviceArea.longitude,
                precisionKm: serviceArea.precisionKm,
                areaLabel: serviceArea.areaLabel,
            }),
            areaLabel: serviceArea.areaLabel,
        },
    };
};

export const decodeVolunteerProfileFromAt = (
    input: unknown,
): VolunteerProfileRecord => {
    if (typeof input !== 'object' || input === null) {
        return volunteerProfileSchema.parse(input);
    }
    const record = input as Record<string, unknown>;
    const serviceArea = record['serviceArea'];
    if (typeof serviceArea !== 'object' || serviceArea === null) {
        return volunteerProfileSchema.parse(record);
    }
    const encoded = serviceArea as Record<string, unknown>;
    const decoded = decodeLocation(serviceArea);
    return volunteerProfileSchema.parse({
        ...record,
        serviceArea:
            decoded === serviceArea ?
                serviceArea
            :   {
                    ...(decoded as Record<string, unknown>),
                    noPermanentAddress:
                        encoded['noPermanentAddress'] === true,
                },
    });
};

export const decodeRecordFromAt = (
    collection: RecordNsid,
    input: unknown,
): unknown => {
    if (collection === recordNsid.aidPost) {
        return decodeAidPostFromAt(input);
    }
    if (collection === recordNsid.directoryResource) {
        return decodeDirectoryResourceFromAt(input);
    }
    if (collection === recordNsid.volunteerProfile) {
        return decodeVolunteerProfileFromAt(input);
    }
    return input;
};

export type RecordByNsid = {
    'app.patchwork.aid.post': AidPostRecord;
    'app.patchwork.volunteer.profile': VolunteerProfileRecord;
    'app.patchwork.conversation.meta': ConversationMetaRecord;
    'app.patchwork.moderation.report': ModerationReportRecord;
    'app.patchwork.directory.resource': DirectoryResourceRecord;
};

export const recordValidators: {
    [K in RecordNsid]: z.ZodType<RecordByNsid[K], z.ZodTypeDef, unknown>;
} = {
    [recordNsid.aidPost]: aidPostSchema,
    [recordNsid.volunteerProfile]: volunteerProfileSchema,
    [recordNsid.conversationMeta]: conversationMetaSchema,
    [recordNsid.moderationReport]: moderationReportSchema,
    [recordNsid.directoryResource]: directoryResourceSchema,
};

export const validateRecordPayload = <N extends RecordNsid>(
    nsid: N,
    payload: unknown,
): RecordByNsid[N] => {
    return recordValidators[nsid].parse(payload);
};

export const safeValidateRecordPayload = <N extends RecordNsid>(
    nsid: N,
    payload: unknown,
) => {
    return recordValidators[nsid].safeParse(payload);
};

export * from './postal-geography.js';
