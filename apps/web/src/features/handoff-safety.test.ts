import { describe, expect, it } from 'vitest';
import { loadPostingDraft, savePostingDraft, postingDraftTtlMs, type PostingTextDraft } from './posting-draft';
import { resourceContactLinks } from './resource-actions';
import type { ResourceDirectoryCard } from '../resource-directory-ux';

const resource: ResourceDirectoryCard = {
    uri: 'at://did:plc:test/app.patchwork.directory.resource/1', id: '1', name: 'Resource',
    category: 'food-bank', location: { lat: 41.85, lng: -87.93, precisionMeters: 1000 },
    contact: { url: 'https://example.org', phone: '+1 (555) 123-4567' },
};

describe('resource contact privacy and provenance', () => {
    it('never makes demo contacts actionable, including approved-address metadata', () => {
        expect(resourceContactLinks({ ...resource, recordOrigin: 'synthetic' })).toEqual({});
    });
    it('rejects executable and credential-bearing links; does not route to approximate points', () => {
        for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:password@example.org']) {
            expect(resourceContactLinks({ ...resource, contact: { url } }).website).toBeUndefined();
        }
        expect(resourceContactLinks(resource)).toMatchObject({ telephone: 'tel:+15551234567', directions: undefined });
    });
    it('expires directions along with exact-address approval', () => {
        const exactPublicAddress = { kind: 'exact-public-resource' as const, streetAddress: 'Public address', latitude: 41, longitude: -87, approvalExpiresAt: '2000-01-01T00:00:00Z' };
        expect(resourceContactLinks({ ...resource, exactPublicAddress }).directions).toBeUndefined();
        expect(resourceContactLinks({ ...resource, exactPublicAddress: { ...exactPublicAddress, approvalExpiresAt: '2099-01-01T00:00:00Z' } }).directions).toContain('41%2C-87');
    });
});

describe('tab draft retention', () => {
    const draft: PostingTextDraft = { title: 'Need food', description: 'Help with groceries', category: 'food', urgency: 3, tagsText: '', startAt: '', endAt: '' };
    const storage = () => {
        const data = new Map<string, string>();
        return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } as unknown as Storage;
    };
    it('restores text, strips private fields and expires at 24 hours', () => {
        const target = storage();
        savePostingDraft(target, { ...draft, location: { lat: 41.123456 }, attachmentBytes: 'secret', credentials: 'secret' } as PostingTextDraft, 100);
        expect(loadPostingDraft(target, 101)).toEqual(draft);
        expect(target.getItem('patchwork:posting-text:v1')).not.toContain('secret');
        expect(loadPostingDraft(target, 100 + postingDraftTtlMs)).toBeUndefined();
    });
    it('handles disabled storage and corrupt or future-dated drafts', () => {
        const target = storage();
        target.setItem('patchwork:posting-text:v1', '{');
        expect(loadPostingDraft(target)).toBeUndefined();
        savePostingDraft(target, draft, 100);
        expect(loadPostingDraft(target, 99)).toBeUndefined();
        expect(() => savePostingDraft({ setItem() { throw new Error('disabled'); } } as unknown as Storage, draft)).not.toThrow();
    });
});
