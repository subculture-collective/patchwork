export const LEXICON_SET_VERSION = '2.0.0';

export const LEXICON_VERSION_POLICY = {
    baseline: 'All v1 record schemas are published as 1.0.0 lexicon revisions.',
    additive:
        'Additive optional fields increment MINOR (1.x.0) and preserve backward compatibility.',
    breaking:
        'Breaking changes increment MAJOR and require migration notes before rollout.',
    fixes: 'Constraint clarifications and docs-only corrections increment PATCH.',
} as const;

export const LEXICON_SCHEMA_REVISIONS = {
    'app.patchwork.aid.post': '2.0.0',
    'app.patchwork.volunteer.profile': '1.2.0',
    'app.patchwork.conversation.meta': '1.0.0',
    'app.patchwork.moderation.report': '1.0.0',
    'app.patchwork.directory.resource': '1.1.0',
} as const;

export const isSemver = (value: string): boolean =>
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
