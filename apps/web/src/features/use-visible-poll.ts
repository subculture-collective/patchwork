import { useEffect, useRef } from 'react';

/** One request at a time; suspend hidden/offline tabs and back off after failures. */
export function useVisiblePoll(run: () => Promise<boolean>, intervalMs: number, enabled = true) {
    const latest = useRef(run);
    latest.current = run;
    useEffect(() => {
        if (!enabled) return;
        let stopped = false;
        let running = false;
        let failures = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const available = () => !document.hidden && navigator.onLine;
        const schedule = () => {
            if (!stopped && available()) timer = setTimeout(tick, Math.min(intervalMs * 2 ** failures, 60_000));
        };
        const tick = async () => {
            clearTimeout(timer);
            if (stopped || running || !available()) return;
            running = true;
            try { failures = await latest.current() ? 0 : Math.min(failures + 1, 5); }
            catch { failures = Math.min(failures + 1, 5); }
            finally { running = false; schedule(); }
        };
        const resume = () => { clearTimeout(timer); if (available()) void tick(); };
        document.addEventListener('visibilitychange', resume);
        window.addEventListener('focus', resume);
        window.addEventListener('online', resume);
        window.addEventListener('offline', resume);
        schedule();
        return () => {
            stopped = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', resume);
            window.removeEventListener('focus', resume);
            window.removeEventListener('online', resume);
            window.removeEventListener('offline', resume);
        };
    }, [intervalMs, enabled]);
}
