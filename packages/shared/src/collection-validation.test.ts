import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('collection validation resource limits', () => {
    it('rejects oversized arrays before validating every element', () => {
        let validatedElements = 0;
        const schema = z.array(z.string().refine(() => {
            validatedElements++;
            return false;
        })).max(10);

        const result = schema.safeParse(Array(100_000).fill('invalid'));

        expect(result.success).toBe(false);
        expect(result.error?.issues).toHaveLength(1);
        expect(result.error?.issues[0]?.code).toBe('too_big');
        expect(validatedElements).toBe(0);
    });
});
