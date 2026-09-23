import type { ApiDataOrigin } from '../features/api-client';
import { resolveWebDataMode } from '../features/data-mode';

export const webDataMode = resolveWebDataMode(import.meta.env, {
    command: import.meta.env.PROD ? 'build' : 'serve',
    mode: import.meta.env.MODE,
});

export const nowIso = (): string => new Date().toISOString();

type Translate = (key: string) => string;

/** Short, localised label for where discovery data came from. */
export const dataOriginLabel = (origin: ApiDataOrigin, t: Translate): string =>
    t(
        origin === 'api'
            ? 'runtime.origin.api'
            : origin === 'fixture'
              ? 'runtime.origin.fixture'
              : origin === 'idle'
                ? 'runtime.origin.idle'
                : 'runtime.origin.unavailable',
    );
