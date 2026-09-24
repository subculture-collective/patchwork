import { defineConfig } from 'vitest/config';

const suite = process.env.PATCHWORK_TEST_SUITE ?? 'unit';
if (suite !== 'unit') {
    const database = process.env.TEST_DATABASE_URL;
    if (!database || !/_(test|qa)$/.test(new URL(database).pathname)) {
        throw new Error('Database tests require TEST_DATABASE_URL naming a disposable database ending in _test or _qa. Use npm run test:integration to create one.');
    }
    if (suite === 'attachments') {
        for (const key of ['OBJECT_ENDPOINT', 'OBJECT_ACCESS_KEY', 'OBJECT_SECRET_KEY', 'OBJECT_BUCKET', 'CLAMD_HOST']) {
            if (!process.env[`TEST_ATTACHMENT_${key}`]) {
                throw new Error(`Attachment integration requires TEST_ATTACHMENT_${key}.`);
            }
        }
    }
}

export default defineConfig({
    envDir: false,
    esbuild: { jsx: 'automatic' },
    test: {
        env: { VITE_API_BASE_URL: '/api' },
        include: suite === 'postgres' ? ['services/**/*.postgres.test.ts']
            : suite === 'attachments' ? ['services/api/src/attachment-real-integration.test.ts']
            : ['{apps,services,packages}/**/src/**/*.test.{ts,tsx}'],
        exclude: ['**/node_modules/**', '**/dist/**', ...(suite === 'unit'
            ? ['**/*.postgres.test.ts', '**/attachment-real-integration.test.ts'] : [])],
        // Database suites share tables; serialization prevents TRUNCATE/migration races.
        fileParallelism: suite === 'unit',
        maxWorkers: 4,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'lcov'],
            reportsDirectory: 'coverage',
            include: ['{apps,services,packages}/**/src/**/*.{ts,tsx}'],
            exclude: ['**/*.{test,spec}.{ts,tsx}', '**/fixtures/**', '**/*-fixtures.ts', '**/fixtures.ts', '**/migrations/**', '**/vite-env.d.ts'],
        },
    },
});
