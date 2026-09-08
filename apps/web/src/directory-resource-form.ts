import {
    directoryResourceSchema,
    type DirectoryResourceRecord,
} from '@patchwork/at-lexicons';

export const directoryResourceCategories = [
    'food-bank',
    'shelter',
    'clinic',
    'legal-aid',
    'hotline',
    'other',
] as const;

export const directoryOperationalStatuses = [
    'unknown',
    'open',
    'limited',
    'closed',
] as const;

export interface DirectoryResourceDraft {
    name: string;
    category: (typeof directoryResourceCategories)[number];
    serviceArea: string;
    contactUrl: string;
    contactPhone: string;
    latitude: string;
    longitude: string;
    precisionKm: string;
    openHours: string;
    eligibilityNotes: string;
    operationalStatus: (typeof directoryOperationalStatuses)[number];
}

export interface DirectoryResourceFormResult {
    ok: boolean;
    issues: string[];
    record?: DirectoryResourceRecord;
}

const optionalText = (value: string): string | undefined => {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
};

export const buildDirectoryResourceRecord = (
    draft: DirectoryResourceDraft,
    now: string,
    existing?: DirectoryResourceRecord,
): DirectoryResourceFormResult => {
    const latitude = Number(draft.latitude);
    const longitude = Number(draft.longitude);
    const precisionKm = Number(draft.precisionKm);
    const issues: string[] = [];
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        issues.push('Latitude must be between -90 and 90.');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        issues.push('Longitude must be between -180 and 180.');
    }
    if (
        !Number.isFinite(precisionKm) ||
        precisionKm < 1 ||
        precisionKm > 50
    ) {
        issues.push(
            'Public location precision must be between 1 and 50 kilometres.',
        );
    }

    const url = optionalText(draft.contactUrl);
    const phone = optionalText(draft.contactPhone);
    if (!url && !phone) {
        issues.push('Add a public website or phone number.');
    }
    if (issues.length > 0) return { ok: false, issues };

    const candidate = {
        $type: 'app.patchwork.directory.resource',
        version: '1.1.0',
        name: draft.name.trim(),
        category: draft.category,
        serviceArea: draft.serviceArea.trim(),
        contact: {
            ...(url ? { url } : {}),
            ...(phone ? { phone } : {}),
        },
        verificationStatus: existing?.verificationStatus ?? 'unverified',
        location: {
            latitude,
            longitude,
            precisionKm,
            areaLabel: draft.serviceArea.trim(),
        },
        ...(optionalText(draft.openHours)
            ? { openHours: optionalText(draft.openHours) }
            : {}),
        ...(optionalText(draft.eligibilityNotes)
            ? { eligibilityNotes: optionalText(draft.eligibilityNotes) }
            : {}),
        operationalStatus: draft.operationalStatus,
        createdAt: existing?.createdAt ?? now,
        ...(existing ? { updatedAt: now } : {}),
    };
    const parsed = directoryResourceSchema.safeParse(candidate);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.map(issue => issue.message),
        };
    }
    return { ok: true, issues: [], record: parsed.data };
};

export const draftFromDirectoryResource = (
    record: DirectoryResourceRecord,
): DirectoryResourceDraft => ({
    name: record.name,
    category: record.category,
    serviceArea: record.serviceArea,
    contactUrl: record.contact.url ?? '',
    contactPhone: record.contact.phone ?? '',
    latitude: record.location?.latitude.toString() ?? '',
    longitude: record.location?.longitude.toString() ?? '',
    precisionKm: record.location?.precisionKm.toString() ?? '1',
    openHours: record.openHours ?? '',
    eligibilityNotes: record.eligibilityNotes ?? '',
    operationalStatus: record.operationalStatus ?? 'unknown',
});
