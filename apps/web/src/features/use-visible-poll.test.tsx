// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisiblePoll } from './use-visible-poll';

describe('foreground receiving', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
    it('backs off failures, pauses hidden tabs, resumes immediately, and stops on unmount', async () => {
        vi.useFakeTimers();
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        let hidden = false;
        vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
        const receive = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
        function Harness() { useVisiblePoll(receive, 3000); return null; }
        const root = createRoot(document.createElement('div'));
        await act(async () => root.render(<Harness />));
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(receive).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(receive).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(3000));
        expect(receive).toHaveBeenCalledTimes(2);
        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        expect(receive).toHaveBeenCalledTimes(2);
        hidden = false;
        await act(async () => document.dispatchEvent(new Event('visibilitychange')));
        expect(receive).toHaveBeenCalledTimes(3);
        await act(async () => root.unmount());
        await act(async () => vi.advanceTimersByTimeAsync(30000));
        expect(receive).toHaveBeenCalledTimes(3);
    });
});
