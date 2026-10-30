import { createRequire } from 'node:module';
import { Client } from 'minio';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const query = require('query-string') as { parse(value: string): Record<string, unknown>; stringify(value: Record<string, string>): string };

describe('MinIO query-string decoder compatibility', () => {
    it('preserves CommonJS decoding and malformed percent escapes with the patched ESM parser', () => {
        expect(query.parse('name=hello%20neighbor&bad=%zz&unicode=%C3%A5'))
            .toMatchObject({ name: 'hello neighbor', bad: '%zz', unicode: 'å' });
        const input = Array.from({ length: 32000 }, (_, n) =>
            `%${Math.floor(n / 256).toString(16).padStart(2, '0')}%${(n % 256).toString(16).padStart(2, '0')}x`).join('') + '%zz';
        expect(typeof query.parse(`value=${input}`).value).toBe('string');
    }, 2000);

    it('keeps MinIO presigned response query encoding compatible without a network request', async () => {
        const client = new Client({ endPoint: 'localhost', port: 9000, useSSL: false,
            accessKey: 'fixture-access', secretKey: 'fixture-secret', region: 'us-east-1' });
        const url = new URL(await client.presignedGetObject('fixture-bucket', 'shared item', 60,
            { 'response-content-disposition': 'attachment; filename="shared item.txt"' }));
        expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="shared item.txt"');
        expect(url.pathname).toBe('/fixture-bucket/shared%20item');
    });
});
