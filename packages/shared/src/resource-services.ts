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
