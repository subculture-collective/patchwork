import { describe, expect, it } from 'vitest';
import { createSourceRegistry, parsePausedSources, resolveSource } from './source-registry.js';
import { parseSourceRunnerArguments } from './source-runner-cli.js';

describe('source registry and operator boundary', () => {
    it('rejects unknown publishers instead of treating imported endpoints as runnable', () => {
        expect(() => resolveSource('hrsa-national')).toThrow('qualified adapter');
        expect(() => resolveSource('../cpl')).toThrow();
    });
    it('validates complete-feed bounds and bounded retry policy', () => {
        const cpl = resolveSource('cpl');
        for (const change of [{ minRows: 101 }, { maxAttempts: 4 }, { maxBytes: 2_000_000 }, { publication: 'automatic' }]) {
            expect(() => createSourceRegistry([{ ...cpl, ...change }])).toThrow();
        }
        expect(() => createSourceRegistry([cpl, cpl])).toThrow('Duplicate');
    });
    it('only permits pausing known sources', () => {
        expect([...parsePausedSources(' cpl,cpl ')]).toEqual(['cpl']);
        expect(() => parsePausedSources('unknown')).toThrow();
    });
    it('requires explicit mode and rejects duplicate or unknown CLI flags', () => {
        expect(parseSourceRunnerArguments(['--source=cpl', '--output=/tmp/evidence', '--mode=preview']))
            .toMatchObject({ list: false, mode: 'preview', source: { id: 'cpl' } });
        expect(parseSourceRunnerArguments(['--list'])).toEqual({ list: true });
        for (const args of [[], ['--source=cpl', '--output=/tmp'], ['--list', '--mode=persist'],
            ['--source=cpl', '--source=cpl', '--output=/tmp', '--mode=persist'],
            ['--source=cpl', '--output=/tmp', '--mode=apply']]) {
            expect(() => parseSourceRunnerArguments(args)).toThrow();
        }
    });
});
