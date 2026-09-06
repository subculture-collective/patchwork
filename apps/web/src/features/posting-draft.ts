import { z } from 'zod';

const draftSchema = z.object({
    title: z.string().max(140), description: z.string().max(5000),
    category: z.enum(['food', 'shelter', 'medical', 'transport', 'childcare', 'other']),
    urgency: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    tagsText: z.string().max(1000), startAt: z.string().max(40), endAt: z.string().max(40),
});
export type PostingTextDraft = z.infer<typeof draftSchema>;
const key = 'patchwork:posting-text:v1';
export const postingDraftTtlMs = 24 * 60 * 60 * 1000;

export function loadPostingDraft(storage: Storage, now = Date.now()): PostingTextDraft | undefined {
    try {
        const envelope = JSON.parse(storage.getItem(key) ?? 'null');
        if (!envelope || typeof envelope.savedAt !== 'number' || envelope.savedAt > now || now - envelope.savedAt >= postingDraftTtlMs) {
            storage.removeItem(key); return;
        }
        const parsed = draftSchema.safeParse(envelope.draft);
        if (parsed.success) return parsed.data;
        storage.removeItem(key);
    } catch { /* Storage may be disabled. The form remains usable. */ }
}

export function savePostingDraft(storage: Storage, draft: PostingTextDraft, now = Date.now()) {
    try {
        // Explicit schema strips coordinates, attachment bytes and unknown fields.
        storage.setItem(key, JSON.stringify({ savedAt: now, draft: draftSchema.parse(draft) }));
    } catch { /* A storage failure must not prevent publishing. */ }
}

export function clearPostingDraft(storage: Storage) {
    try { storage.removeItem(key); } catch { /* Optional browser storage. */ }
}
