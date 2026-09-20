import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PublisherValidationError } from './publisher-validation-error.js';
import { withBoundedPublisherRetry } from './source-runner.js';
import { parseQuarantineArguments } from './source-quarantine-cli.js';
import { renderRegisteredSourceMetrics } from './source-refresh-metrics.js';

describe('source quarantine controls', () => {
    it('retries 429 within bounds but never retries a typed publisher validation failure', async () => {
        const delay = vi.fn(async () => {});
        const network = vi.fn().mockRejectedValueOnce(new Error('HTTP 429')).mockResolvedValue('ok');
        expect(await withBoundedPublisherRetry(network, delay)).toBe('ok');
        expect(delay).toHaveBeenCalledWith(1000);
        const validation = vi.fn(async () => { throw new PublisherValidationError('Publisher value contains HTTP 503'); });
        await expect(withBoundedPublisherRetry(validation, delay)).rejects.toThrow(PublisherValidationError);
        expect(validation).toHaveBeenCalledOnce();
    });
    it('requires a registered source, exact incident and nontrivial review reason for clearing', () => {
        expect(parseQuarantineArguments(['--source=cpl'])).toMatchObject({ action: 'inspect' });
        const incident = randomUUID();
        expect(parseQuarantineArguments(['--source=cpl', `--quarantine=${incident}`, '--reason=Reviewed complete official preview and source contract.']))
            .toMatchObject({ action: 'clear', quarantineId: incident });
        for (const args of [['--source=unknown'], ['--source=cpl', `--quarantine=${incident}`],
            ['--source=cpl', '--source=cpl'], ['--source=cpl', '--quarantine=all', '--reason=ok']])
            expect(() => parseQuarantineArguments(args)).toThrow();
    });
    it('exposes quarantine without inventing an attempt or successful refresh', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ source_id: 'cpl', quarantined: true,
            last_attempt_succeeded: null, last_attempt_timestamp: null, last_success_timestamp: null }] });
        const output = await renderRegisteredSourceMetrics({ query } as never);
        expect(output).toContain('patchwork_source_refresh_quarantined{project="patchwork",service="api",source="cpl"} 1');
        expect(output).not.toContain('patchwork_source_refresh_last_attempt_success{');
        expect(output).not.toContain('patchwork_source_refresh_last_success_timestamp_seconds{');
    });
});
