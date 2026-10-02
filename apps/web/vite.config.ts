import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { resolveWebDataMode } from './src/features/data-mode';

export default defineConfig(({ command, mode }) => {
    resolveWebDataMode(loadEnv(mode, process.cwd(), ''), { command, mode });
    const apiProxy = {
        ...(process.env.PATCHWORK_DEV_TILE_TARGET ? { '/tiles': { target: process.env.PATCHWORK_DEV_TILE_TARGET, changeOrigin: true } } : {}),
        '/api': {
            target: process.env.PATCHWORK_DEV_API_TARGET ?? 'http://localhost:4000',
            changeOrigin: false,
            rewrite: (path: string) => path.replace(/^\/api/, ''),
        },
    };
    return {
        plugins: [react(), tailwindcss()],
        resolve: {
            alias: {
                '@patchwork/at-lexicons': fileURLToPath(
                    new URL(
                        '../../packages/at-lexicons/src/validators.ts',
                        import.meta.url,
                    ),
                ),
            },
        },
        server: {
            port: 5173,
            proxy: apiProxy,
        },
        preview: {
            proxy: apiProxy,
        },
        build: {
            // The content security policy allows fonts from 'self' only, so a
            // small font subset must stay a file instead of a data: URI.
            assetsInlineLimit: (filePath: string) =>
                filePath.endsWith('.woff2') ? false : undefined,
            // The national ZIP lookup changes independently from application
            // code. Keep it in a stable cacheable chunk so routine UI releases
            // do not force browsers to download the 2020 Census index again.
            chunkSizeWarningLimit: 1500,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (
                            id.includes('postal-index.json') ||
                            id.includes('geography-names.json') ||
                            id.endsWith('/postal-geography.ts')
                        ) {
                            return 'postal-geography-census2020';
                        }
                        if (
                            id.includes('/node_modules/react/') ||
                            id.includes('/node_modules/react-dom/') ||
                            id.includes('/node_modules/scheduler/')
                        ) {
                            return 'react-vendor';
                        }
                    },
                },
            },
        },
    };
});
