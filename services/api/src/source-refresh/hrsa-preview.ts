import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicResourceCatalog, publicResourceSchema } from '../db/public-resource-catalog.js';
import { hashRefreshValue } from '../db/public-resource-refresh.js';
import { type ArcgisFeature } from './arcgis-contract.js';
import { retainArcgisCollection, replayArcgisEvidence } from './arcgis-evidence.js';
import { writeImmutableEvidence } from './evidence-storage.js';
import { HRSA_COLLECTION_POLICY, HRSA_SOURCE_KEY, normalizeHrsaFeatures } from './hrsa-adapter.js';

type Resource = ReturnType<typeof publicResourceSchema.parse>;
const content = (resource: Resource) => publicResourceSchema.parse(Object.fromEntries(
    Object.keys(publicResourceSchema.shape).map(key => [key, resource[key as keyof Resource]])));
// Same conservative overlap key as the legacy builder, used only to request review.
const overlapKey = (r: Resource) => {
    const suffixes: Record<string, string> = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', boulevard: 'blvd' };
    const address = r.streetAddress.toLowerCase().replace(/\b(street|avenue|road|drive|boulevard)\b/g, word => suffixes[word]!);
    return [r.name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''), address.replace(/[^\p{L}\p{N}]/gu, ''), r.postalCode].join('|');
};
export function previewHrsaFeatures(features: readonly ArcgisFeature[], baseline: readonly Resource[]) {
    const normalized = normalizeHrsaFeatures(features);
    const prior = baseline.map(content);
    const existing = new Map(prior.map(resource => [resource.id, resource]));
    if (existing.size !== prior.length) throw new Error('Duplicate baseline resource identity.');
    const overlaps = new Map<string, Set<string>>();
    for (const resource of [...prior, ...normalized.resources]) {
        const key = overlapKey(resource); const ids = overlaps.get(key) ?? new Set<string>();
        ids.add(resource.id); overlaps.set(key, ids);
    }
    const decisions: { resourceId: string; status: 'new-review' | 'changed-review' | 'unchanged' | 'overlap-review' | 'missing-review'; changedFields: string[]; relatedIds: string[] }[] = [];
    for (const resource of normalized.resources) {
        const previous = existing.get(resource.id);
        if (previous && previous.sourceId !== 'hrsa-national') throw new Error('HRSA identity conflicts with another source.');
        const relatedIds = [...overlaps.get(overlapKey(resource))!].filter(id => id !== resource.id).sort();
        const changedFields = Object.keys(publicResourceSchema.shape).filter(key =>
            JSON.stringify(resource[key as keyof Resource]) !== JSON.stringify(previous?.[key as keyof Resource]));
        decisions.push({ resourceId: resource.id, status: relatedIds.length ? 'overlap-review'
            : !previous ? 'new-review' : changedFields.length ? 'changed-review' : 'unchanged', changedFields, relatedIds });
    }
    const present = new Set(normalized.resources.map(resource => resource.id));
    for (const resource of prior) {
        if (resource.sourceId === 'hrsa-national' && !present.has(resource.id)) decisions.push({ resourceId: resource.id,
            status: 'missing-review', changedFields: [], relatedIds: [] });
    }
    decisions.sort((a, b) => a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0);
    prior.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return { version: 1, baselineKind: 'checked-in-catalog' as const, baselineSha256: hashRefreshValue(prior),
        normalizedSha256: hashRefreshValue(normalized), ...normalized, decisions,
        summary: { inputCount: features.length, eligibleCount: normalized.resources.length, excludedCount: normalized.exclusions.length,
            decisions: Object.fromEntries(['new-review', 'changed-review', 'unchanged', 'overlap-review', 'missing-review']
                .map(status => [status, decisions.filter(decision => decision.status === status).length])) } };
}

/** Fetch/replay and write local review artifacts. Never connects to the candidate database. */
export async function runHrsaPreview(root: string, manifestSha256?: string) {
    const digest = manifestSha256 ?? (await retainArcgisCollection(root, HRSA_SOURCE_KEY, HRSA_COLLECTION_POLICY)).manifestSha256;
    const evidence = await replayArcgisEvidence(root, digest, HRSA_SOURCE_KEY, HRSA_COLLECTION_POLICY);
    const preview = previewHrsaFeatures(evidence.features, publicResourceCatalog.resources);
    const envelope = { ...preview, evidence: { manifestSha256: digest, firstRetrievedAt: evidence.firstRetrievedAt,
        lastRetrievedAt: evidence.lastRetrievedAt, consistency: evidence.consistency } };
    const outputPath = join(root, 'hrsa-previews', `${digest}-${preview.baselineSha256}.json`);
    await writeImmutableEvidence(outputPath, Buffer.from(JSON.stringify(envelope, null, 2) + '\n'));
    return { status: 'review-only' as const, manifestSha256: digest, baselineKind: preview.baselineKind, baselineSha256: preview.baselineSha256,
        normalizedSha256: preview.normalizedSha256, firstRetrievedAt: evidence.firstRetrievedAt, lastRetrievedAt: evidence.lastRetrievedAt,
        outputPath, ...preview.summary };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (!(args.length === 1 || (args.length === 3 && args[1] === '--replay' && /^[a-f0-9]{64}$/.test(args[2]!))) || args[0]!.startsWith('-')) {
        console.error('Usage: resources:refresh:hrsa-preview <evidence-root> [--replay <manifest-sha256>]'); process.exitCode = 1;
    } else {
        try { console.log(JSON.stringify(await runHrsaPreview(resolve(args[0]!), args[2]), null, 2)); }
        catch { console.error('HRSA preview failed. Retained evidence remains available; no database or listing was changed.'); process.exitCode = 1; }
    }
}
