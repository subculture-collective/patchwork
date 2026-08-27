import type { Sync } from '@bsky/jetstream';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresJetstreamControlStore } from './jetstream-control-store.js';

describe('PostgresJetstreamControlStore', () => {
    it('replaces a blank control-event time with a valid observation time', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [] });
        const store = new PostgresJetstreamControlStore({ query } as unknown as Pool);

        await store.sync(24_359_560_729, 'did:plc:alice', {
            did: 'did:plc:alice',
            rev: '3jzfcijpj2z2a',
            time: '',
        } as unknown as Sync);

        const params = query.mock.calls[0]?.[1] as unknown[];
        expect(params.slice(0, 3)).toEqual([
            'did:plc:alice',
            '3jzfcijpj2z2a',
            24_359_560_729,
        ]);
        expect(Number.isNaN(Date.parse(String(params[3])))).toBe(false);
    });
});
