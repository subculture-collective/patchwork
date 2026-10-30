// Pass this function to playwright-cli run-code against the isolated web build.
async page => {
    const origin = new URL(page.url()).origin;
    if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
        throw new Error('Profile only the isolated loopback web application.');
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Performance.enable');
    const samples = [];
    try {
        for (const mobile of [false, true]) {
            await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: mobile ? 4 : 1 });
            for (let i = 0; i < 3; i++) {
                const start = Date.now();
                await page.goto(`${origin}/resources`, { waitUntil: 'domcontentloaded' });
                await page.getByRole('button', { name: /^Details for/ }).first().waitFor();
                const render = await page.evaluate(() => {
                    const nav = performance.getEntriesByType('navigation')[0];
                    const resources = performance.getEntriesByType('resource');
                    return {
                        domContentLoadedMs: nav.domContentLoadedEventEnd,
                        paint: performance.getEntriesByType('paint').map(p => ({ name: p.name, ms: p.startTime })),
                        encodedBytes: resources.reduce((n, r) => n + r.encodedBodySize, nav.encodedBodySize),
                        decodedBytes: resources.reduce((n, r) => n + r.decodedBodySize, nav.decodedBodySize),
                        transferBytes: resources.reduce((n, r) => n + r.transferSize, nav.transferSize),
                        nodeCount: document.querySelectorAll('*').length,
                    };
                });
                samples.push({ mobile, cpuSlowdown: mobile ? 4 : 1, coldCache: true,
                    timeToCardsMs: Date.now() - start, cardCount: await page.getByRole('button', { name: /^Details for/ }).count(), ...render,
                    metrics: (await cdp.send('Performance.getMetrics')).metrics.filter(m => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'JSHeapUsedSize'].includes(m.name)),
                });
            }
        }
    } finally {
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    }
    return { kind: 'national-directory-browser-profile', samples };
};
