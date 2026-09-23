import type { ApiDataOrigin } from '../features/api-client';
import { resolveWebDataMode } from '../features/data-mode';

export const webDataMode = resolveWebDataMode(import.meta.env, {
    command: import.meta.env.PROD ? 'build' : 'serve',
    mode: import.meta.env.MODE,
});

export const nowIso = (): string => new Date().toISOString();

export const dataOriginLabel = (origin: ApiDataOrigin): string =>
    origin === 'api'
        ? 'DB-backed API'
        : origin === 'fixture'
          ? 'Local fixture demo'
          : origin === 'idle'
            ? 'Requesting location'
            : 'API unavailable';
