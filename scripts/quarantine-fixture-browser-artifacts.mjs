// Fixture diagnostics are not release inputs. Keep them outside build/upload
// roots without ever calling them redacted. Real-provider jobs use the strict
// check-playwright-artifacts.mjs gate and cannot enter this path.
import { cp, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';

if (!['1', 'true'].includes(process.env.CI)) throw new Error('Fixture-only CI context is required.');
const forbidden = ['PATCHWORK_E2E_BASE_URL', 'PATCHWORK_E2E_REQUESTER_STATE',
    'PATCHWORK_E2E_HELPER_STATE', 'PATCHWORK_E2E_MAINTAINER_STATE',
    'PATCHWORK_E2E_EXACT_LATITUDE', 'PATCHWORK_E2E_EXACT_LONGITUDE', 'PATCHWORK_E2E_PRIVATE_MARKER'];
if (forbidden.some(key => process.env[key]?.trim()) || process.env.PATCHWORK_E2E_STAGING_LIFECYCLE === 'true'
    || (process.env.VITE_API_BASE_URL?.trim() && process.env.VITE_API_BASE_URL.trim() !== '/api')
    || process.env.PATCHWORK_DEV_API_TARGET?.trim()) {
    throw new Error('Credentialed/external browser configuration is forbidden in the fixture-only job.');
}
const mode = process.argv[2];
if (mode === '--check') {
    console.log('Fixture-only browser configuration accepted; provider suites remain disabled.');
} else if (mode === '--quarantine') {
    const roots = ['apps/web/test-results', 'apps/web/playwright-report'].filter(existsSync);
    if (roots.length) {
        const parent = relative(process.cwd(), tmpdir());
        if (!parent.startsWith('..')) throw new Error('Diagnostics must be withheld outside the workspace.');
        const destination = await mkdtemp(join(tmpdir(), 'patchwork-unreviewed-browser-'));
        await mkdir(destination, { mode: 0o700, recursive: true });
        for (const root of roots) {
            const target = join(destination, basename(root));
            try { await rename(root, target); }
            catch (error) {
                if (error.code !== 'EXDEV') throw error;
                await cp(root, target, { recursive: true, dereference: false });
                await rm(root, { recursive: true });
            }
        }
        console.log(`Fixture diagnostics withheld at ${destination}; unreviewed and not eligible for upload.`);
    } else console.log('No fixture diagnostics to withhold.');
} else throw new Error('Use --check or --quarantine.');
