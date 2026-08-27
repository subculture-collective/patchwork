import { describe, expect, it } from 'vitest';
import { resolvePaginationFocus } from './pagination-focus.js';

describe('pagination focus', () => {
    it('returns focus to Load more while another page remains', () => {
        expect(
            resolvePaginationFocus({
                previousCount: 20,
                itemCount: 40,
                isLoading: false,
                hasNextPage: true,
            }),
        ).toBe('load-more');
    });

    it('uses the loaded-count status when the final page removes Load more', () => {
        expect(
            resolvePaginationFocus({
                previousCount: 20,
                itemCount: 25,
                isLoading: false,
                hasNextPage: false,
            }),
        ).toBe('loaded-count');
    });
});
