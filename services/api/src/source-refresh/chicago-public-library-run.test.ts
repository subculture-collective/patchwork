import { describe, expect, it, vi } from 'vitest';
import { recordSourceRefreshAttempt, withBoundedPublisherRetry } from './chicago-public-library-run.js';

describe('bounded publisher retry', () => {
    it('retries transient publisher failures with bounded backoff', async () => {
        const operation = vi.fn()
            .mockRejectedValueOnce(new Error('CPL publisher request failed with HTTP 503.'))
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValue({ ok: true });
        const delay = vi.fn().mockResolvedValue(undefined);
        await expect(withBoundedPublisherRetry(operation, delay)).resolves.toEqual({ ok: true });
        expect(operation).toHaveBeenCalledTimes(3);
        expect(delay.mock.calls).toEqual([[1000], [2000]]);
    });

    it('does not retry validation failures', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('CPL response row count is outside the complete-feed boundary.'));
        const delay = vi.fn().mockResolvedValue(undefined);
        await expect(withBoundedPublisherRetry(operation, delay)).rejects.toThrow('complete-feed');
        expect(operation).toHaveBeenCalledOnce();
        expect(delay).not.toHaveBeenCalled();
    });

    it('does not mistake URL validation TypeErrors for network failures', async () => {
        const operation = vi.fn().mockRejectedValue(new TypeError('Invalid URL'));
        const delay = vi.fn().mockResolvedValue(undefined);
        await expect(withBoundedPublisherRetry(operation, delay)).rejects.toThrow('Invalid URL');
        expect(operation).toHaveBeenCalledOnce();
        expect(delay).not.toHaveBeenCalled();
    });

    it('stops after three transient failures', async () => {
        const operation = vi.fn().mockRejectedValue(new Error('CPL publisher request failed with HTTP 503.'));
        const delay = vi.fn().mockResolvedValue(undefined);
        await expect(withBoundedPublisherRetry(operation, delay)).rejects.toThrow('HTTP 503');
        expect(operation).toHaveBeenCalledTimes(3);
        expect(delay).toHaveBeenCalledTimes(2);
    });

    it('records operational attempts without treating a concurrent skip as fresh evidence', async () => {
        const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
        const at = new Date('2026-09-20T08:00:00.000Z');
        await recordSourceRefreshAttempt({ query } as never, true, false, at);
        expect(query).toHaveBeenCalledWith(expect.stringContaining('source_refresh_operational_status'), [at, true, false]);
        expect(query.mock.calls[0]![0]).toContain('CASE WHEN $3');
    });
});
