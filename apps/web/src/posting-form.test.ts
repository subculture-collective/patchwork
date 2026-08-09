import { describe, expect, it } from 'vitest';
import { aidPostSchema } from '@patchwork/at-lexicons';
import {
    buildAidPostCreatePayload,
    buildAidPostEditPayload,
    toPostingDraftFromRecord,
    validatePostingDraft,
} from './posting-form.js';

describe('posting form', () => {
    it('creates schema-compatible payload with geoprivacy enforcement', () => {
        const payload = buildAidPostCreatePayload(
            {
                title: 'Need water and groceries',
                description: 'Family of four needs support tonight',
                category: 'food',
                urgency: 4,
                accessibilityTags: ['wheelchair', ' wheelchair '],
                location: {
                    lat: 1.30019,
                    lng: 103.80019,
                    precisionMeters: 120,
                },
                timeWindow: {
                    startAt: '2026-02-26T18:00:00.000Z',
                    endAt: '2026-02-26T22:00:00.000Z',
                },
            },
            { now: '2026-02-26T17:00:00.000Z', id: 'post-1' },
        );

        expect(payload.record.$type).toBe('app.patchwork.aid.post');
        expect(payload.record.location.precisionKm).toBeGreaterThanOrEqual(1);
        expect(aidPostSchema.safeParse(payload.record).success).toBe(true);
        expect(payload.record.status).toBe('open');
        expect(payload.metadata.accessibilityTags).toEqual(['wheelchair']);
    });

    it('reports validation failures for invalid taxonomy and time window', () => {
        const result = validatePostingDraft({
            title: '',
            description: '',
            category: undefined,
            urgency: undefined,
            accessibilityTags: [''],
            timeWindow: {
                startAt: '2026-02-26T18:00:00.000Z',
                endAt: '2026-02-26T09:00:00.000Z',
            },
            location: {
                lat: 999,
                lng: 0,
                precisionMeters: 20,
            },
        });

        expect(result.ok).toBe(false);
        expect(result.errors.some(error => error.field === 'title')).toBe(true);
        expect(result.errors.some(error => error.field === 'category')).toBe(true);
        expect(result.errors.some(error => error.field === 'timeWindow')).toBe(
            true,
        );
    });

    it('supports edit mode while preserving createdAt lifecycle data', () => {
        const existingCreatePayload = buildAidPostCreatePayload(
            {
                title: 'Need transit support',
                description: 'Need ride to clinic',
                category: 'transport',
                urgency: 3,
                accessibilityTags: ['mobility-aid'],
                timeWindow: {
                    startAt: '2026-02-26T10:00:00.000Z',
                    endAt: '2026-02-26T14:00:00.000Z',
                },
                location: {
                    lat: 1.31,
                    lng: 103.81,
                    precisionMeters: 600,
                },
            },
            { id: 'post-2', now: '2026-02-26T10:00:00.000Z' },
        );

        const editPayload = buildAidPostEditPayload({
            existingRecord: existingCreatePayload.record,
            draft: {
                ...toPostingDraftFromRecord(existingCreatePayload.record),
                title: 'Need urgent transit support',
                urgency: 4,
                timeWindow: {
                    startAt: '2026-02-26T10:00:00.000Z',
                    endAt: '2026-02-26T16:00:00.000Z',
                },
            },
            metadata: { localId: 'post-2' },
            now: '2026-02-26T10:30:00.000Z',
        });

        expect(editPayload.record.createdAt).toBe(
            existingCreatePayload.record.createdAt,
        );
        expect(editPayload.record.updatedAt).toBe('2026-02-26T10:30:00.000Z');
        expect(editPayload.record.title).toBe('Need urgent transit support');
        expect(editPayload.record.urgency).toBe('high');
        expect(editPayload.metadata.timeWindow?.endAt).toBe(
            '2026-02-26T16:00:00.000Z',
        );
    });
});
