/** Services can overlap: a resource is not limited to its organization category. */
export const resourceServices = ['food', 'housing', 'health', 'legal', 'clothing', 'hygiene', 'benefits', 'transport', 'disability', 'employment', 'youth', 'reentry', 'community'] as const;
export type ResourceService = (typeof resourceServices)[number];
export const resourceServiceLabels: Record<ResourceService, string> = {
    food: 'Food & meals', housing: 'Housing & shelter', health: 'Health care',
    legal: 'Legal & tenant help', clothing: 'Clothing & household essentials',
    hygiene: 'Showers & laundry', benefits: 'Benefits & bills', transport: 'Transportation help',
    disability: 'Disability support', employment: 'Jobs & training', youth: 'Youth & family support',
    reentry: 'Reentry support', community: 'Libraries & shared tools',
};
export const categoryServices: Record<string, ResourceService> = {
    'food-bank': 'food', shelter: 'housing', clinic: 'health', 'legal-aid': 'legal',
};

/** Program filters require explicit publisher provenance, never guessed eligibility. */
export const resourcePrograms = ['wic', 'snap', 'tanf', 'medicaid', 'social-security', 'va-benefits', 'vet-center', 'public-housing', 'housing-vouchers', 'housing-counseling'] as const;
export type ResourceProgram = (typeof resourcePrograms)[number];
export const resourceProgramLabels: Record<ResourceProgram, string> = {
    wic: 'WIC nutrition program', snap: 'SNAP application help', tanf: 'TANF cash assistance',
    medicaid: 'Medicaid application help', 'social-security': 'Social Security / SSI / SSDI',
    'va-benefits': 'VA benefits offices', 'vet-center': 'Vet Center counseling',
    'public-housing': 'Public housing applications', 'housing-vouchers': 'Section 8 / housing vouchers',
    'housing-counseling': 'Housing counseling',
};
export const resourceProgramEvidence: Record<ResourceProgram, { sourceIds: readonly string[]; phrase?: string }> = {
    wic: { sourceIds: ['idhs-wic', 'colorado-wic'] },
    snap: { sourceIds: ['idhs-benefits', 'idhs-snap-outreach'] },
    tanf: { sourceIds: ['idhs-benefits'] },
    medicaid: { sourceIds: ['idhs-benefits'] },
    'social-security': { sourceIds: ['ssa-field-offices'] },
    'va-benefits': { sourceIds: ['va-public-offices'], phrase: 'Government VA benefits office' },
    'vet-center': { sourceIds: ['va-public-offices'], phrase: 'Government VA Vet Center' },
    'public-housing': { sourceIds: ['hud-public-housing-authorities'], phrase: 'for public housing' },
    'housing-vouchers': { sourceIds: ['hud-public-housing-authorities'], phrase: 'Housing Choice Voucher' },
    'housing-counseling': { sourceIds: ['hud-current'] },
};
