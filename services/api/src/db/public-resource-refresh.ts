import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parsePublicResourceCatalog, publicResourceSchema } from './public-resource-catalog.js';

type Catalog = ReturnType<typeof parsePublicResourceCatalog>;
type Resource = Catalog['resources'][number];
export interface RefreshListing {
    resourceUri: string;
    sourceSnapshot: unknown;
    sourceUrl: string;
    sourceRetrievedAt: string;
    recordOrigin: string;
    contact: unknown;
    claimed: boolean;
    listed: boolean;
    profileRevision: number | null;
    pendingCorrection: boolean;
    recordUpdatedAt: string;
    listingUpdatedAt: string;
}

const catalogPrefix = 'at://did:plc:patchwork-public-catalog/app.patchwork.directory.resource/';
const canonicalize = (input: unknown): unknown => Array.isArray(input) ? input.map(canonicalize)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => [key, canonicalize(value)])) : input;
export const hashRefreshValue = (input: unknown) => createHash('sha256')
    .update(JSON.stringify(canonicalize(input))).digest('hex');
const content = (resource: Resource) => publicResourceSchema.parse(
    Object.fromEntries(Object.keys(publicResourceSchema.shape).map(key => [key, resource[key as keyof Resource]])),
);
const contact = (resource: ReturnType<typeof content>) => ({
    url: resource.website, ...(resource.phone ? { phone: resource.phone } : {}),
});

/** A preview is not permission to write: execution must recheck live revisions and evidence. */
export function planPublicResourceRefresh(input: unknown, listings: readonly RefreshListing[], now = new Date()) {
    if (!Number.isFinite(now.getTime())) throw new Error('Invalid refresh time.');
    const catalog = parsePublicResourceCatalog(input);
    const existing = new Map(listings.map(listing => [listing.resourceUri, listing]));
    if (existing.size !== listings.length) throw new Error('Duplicate live resource URI.');
    const candidates = catalog.resources.map(resource => {
        const resourceUri = `${catalogPrefix}${resource.id}`;
        const live = existing.get(resourceUri);
        const next = content(resource);
        const raw = live?.sourceSnapshot;
        const previous = publicResourceSchema.safeParse(raw && typeof raw === 'object'
            ? Object.fromEntries(Object.keys(publicResourceSchema.shape).map(key => [key, (raw as Record<string, unknown>)[key]]))
            : raw);
        const fields = previous.success ? Object.keys(next).filter(key =>
            !isDeepStrictEqual(next[key as keyof typeof next], previous.data[key as keyof typeof next]),
        ) : Object.keys(next);
        const reasons: string[] = [];
        const retrieved = Date.parse(resource.source.retrievedAt);
        if (retrieved > now.getTime() || retrieved + 90 * 86400000 <= now.getTime()) reasons.push('source-date-outside-valid-window');
        if (!live) reasons.push('new-listing');
        else {
            if (live.recordOrigin !== 'sourced-public') reasons.push('record-origin-conflict');
            if (!previous.success) reasons.push('invalid-imported-snapshot');
            if (previous.success && (previous.data.id !== resource.id || previous.data.sourceId !== resource.sourceId)) reasons.push('source-identity-conflict');
            if (live.sourceUrl !== resource.source.url) reasons.push('source-url-changed');
            const previousTime = Date.parse(live.sourceRetrievedAt);
            if (!Number.isFinite(previousTime) || retrieved < previousTime) reasons.push('source-date-regressed');
            if (fields.length && retrieved <= previousTime) reasons.push('changed-source-not-newer');
            if (live.claimed || live.profileRevision !== null) reasons.push('provider-or-reviewed-profile');
            if (!live.listed) reasons.push('listing-withdrawn');
            if (live.pendingCorrection) reasons.push('pending-correction');
            if (previous.success && !isDeepStrictEqual(live.contact, contact(previous.data))) reasons.push('contact-diverged-from-import');
        }
        if (fields.some(field => field !== 'phone' && field !== 'website')) reasons.push('non-contact-change');
        if (previous.success && previous.data.phone && !next.phone) reasons.push('contact-removed');
        if (fields.includes('website')) {
            const url = new URL(next.website);
            if (url.protocol !== 'https:' || url.username || url.password || !previous.success
                || url.hostname !== new URL(previous.data.website).hostname) reasons.push('website-requires-review');
        }
        if (fields.includes('phone') && next.phone && (!/^\+?[\d ().-]{7,30}$/.test(next.phone)
            || !/^\d{7,15}$/.test(next.phone.replace(/\D/g, '')))) reasons.push('phone-requires-review');
        const disposition = !live ? 'new-listing-review' : fields.length === 0 && reasons.length === 0 ? 'unchanged'
            : fields.length > 0 && reasons.length === 0 ? 'contact-automation-candidate' : 'review';
        return {
            resourceUri, disposition, fields, reasons,
            before: previous.success ? previous.data : null, after: next,
            evidence: resource.source,
            // Persisted previews must never be used as a substitute for current DB state.
            base: live ? { recordUpdatedAt: live.recordUpdatedAt, listingUpdatedAt: live.listingUpdatedAt,
                profileRevision: live.profileRevision, snapshotSha256: hashRefreshValue(live.sourceSnapshot) } : null,
        };
    });
    const candidateUris = new Set(candidates.map(candidate => candidate.resourceUri));
    // Absence from a partial feed is only a review signal, never closure evidence.
    const missing = listings.filter(listing => {
        const raw = listing.sourceSnapshot;
        const sourceId = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).sourceId : undefined;
        return listing.resourceUri.startsWith(catalogPrefix) && typeof sourceId === 'string'
            && Object.hasOwn(catalog.sources, sourceId) && !candidateUris.has(listing.resourceUri);
    }).map(listing => ({ resourceUri: listing.resourceUri, disposition: 'missing-review', reasons: ['absent-from-candidate-feed'] }));
    const counts: Record<string, number> = {};
    for (const candidate of [...candidates, ...missing]) counts[candidate.disposition] = (counts[candidate.disposition] ?? 0) + 1;
    return { version: 1, mode: 'preview-only', generatedAt: now.toISOString(),
        catalogSha256: hashRefreshValue(catalog), counts, candidates, missing };
}
