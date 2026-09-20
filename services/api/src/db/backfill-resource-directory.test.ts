import { describe, expect, it } from 'vitest';
import { parseDirectoryBackfillArgs } from './backfill-resource-directory.js';

describe('bounded directory backfill arguments', () => {
    it('defaults to a small preview and requires explicit persistence', () => {
        expect(parseDirectoryBackfillArgs([])).toEqual({ mode: 'preview', limit: 25, afterUri: '' });
        expect(parseDirectoryBackfillArgs(['--mode=persist', '--limit=1', '--after-uri=at://public/resource/site']))
            .toEqual({ mode: 'persist', limit: 1, afterUri: 'at://public/resource/site' });
    });
    it('rejects unbounded or ambiguous execution flags', () => {
        for (const args of [['--limit=0'], ['--limit=101'], ['--limit=1.5'], ['--all'], ['--apply'],
            ['--mode=persist', '--mode=preview'], ['--mode=delete']])
            expect(() => parseDirectoryBackfillArgs(args)).toThrow();
    });
});
