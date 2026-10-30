import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env['PATCHWORK_E2E_BASE_URL'];
const chromiumExecutable =
    process.env['PATCHWORK_E2E_CHROMIUM_EXECUTABLE'];
const localPort = Number(process.env['PATCHWORK_E2E_PORT'] ?? '41739');
if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65_535) {
    throw new Error('PATCHWORK_E2E_PORT must be an integer TCP port.');
}
// Keep the development origin on the same loopback hostname as the API
// default. Newer Chromium versions enforce private-network boundaries before
// Playwright can fulfill mismatched localhost/127.0.0.1 routes.
const localBaseUrl = `http://localhost:${localPort}`;

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    timeout: 60_000,
    // Functional readiness can include cold lazy chunks on the shared CI
    // runner. Capacity probes enforce their separate, much shorter budgets.
    expect: { timeout: process.env['CI'] ? 15_000 : 5_000 },
    forbidOnly: !!process.env['CI'],
    // Vite/Chromium occasionally yields a transient blank navigation on the
    // constrained local acceptance host. One local retry distinguishes that
    // infrastructure blip from a repeatable product failure; CI retains two.
    retries: process.env['CI'] ? 2 : 1,
    // The local Vite server and Chromium share a constrained acceptance host.
    // Serial browser execution avoids false blank-page/navigation failures
    // under concurrent cold module transforms.
    workers: 1,
    reporter: process.env['CI'] ? 'github' : 'list',
    use: {
        baseURL: externalBaseUrl ?? localBaseUrl,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        ...(chromiumExecutable ?
            { launchOptions: { executablePath: chromiumExecutable } }
        :   {}),
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer:
        externalBaseUrl ? undefined : {
            command: `npm run build && npm run preview -- --host localhost --port ${localPort} --strictPort`,
            url: localBaseUrl,
            reuseExistingServer: false,
            timeout: 60_000,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                VITE_MAP_TILE_URL:
                    process.env['VITE_MAP_TILE_URL'] ??
                    `/tiles/us.${'0'.repeat(64)}.pmtiles`,
            },
        },
});
