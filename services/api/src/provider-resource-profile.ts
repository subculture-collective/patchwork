import { type ResourceProfile, type ResourceEvidence } from '@patchwork/shared';
import { isDeepStrictEqual } from 'node:util';

/** Server-owned confirmation dates; unchanged assertions keep their original evidence. */
export function confirmProviderProfile(next: ResourceProfile, previous: ResourceProfile | undefined, reconfirmServiceIds: readonly string[], now = new Date()): ResourceProfile {
    const reconfirm = new Set(reconfirmServiceIds);
    const confirm = (e: ResourceEvidence): ResourceEvidence => ({...e, reviewStatus:'reviewed', confirmedAt:now.toISOString(), expiresAt:new Date(now.getTime()+30*86400000).toISOString()});
    const content = (assertion: {evidence: ResourceEvidence}) => {
        const {evidence, ...value} = assertion;
        return {...value, sourceUrl:evidence.sourceUrl, sourceName:evidence.sourceName};
    };
    return {...next, services: next.services.map(service => {
        const prior = previous?.services.find(s=>s.id===service.id);
        const force = reconfirm.has(service.id);
        const result = {...service};
        for (const key of ['delivery','serviceArea','cost','languages','accessibility','documents','appointment','applicationUrl','hours'] as const) {
            const assertion = service[key];
            if (!assertion) continue;
            const old = prior?.[key];
            const evidence = !force && old && isDeepStrictEqual(content(assertion),content(old)) ? old.evidence : confirm(assertion.evidence);
            Object.assign(result, {[key]: {...assertion, evidence}});
        }
        result.eligibility = service.eligibility.map(rule => {
            const old = prior?.eligibility.find(candidate=>isDeepStrictEqual(content(candidate),content(rule)));
            return {...rule,evidence:!force && old ? old.evidence : confirm(rule.evidence)};
        });
        return result;
    })};
}
