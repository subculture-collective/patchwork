export type PaginationFocusTarget = 'load-more' | 'loaded-count';

export const resolvePaginationFocus = ({
    previousCount,
    itemCount,
    isLoading,
    hasNextPage,
}: {
    previousCount: number | undefined;
    itemCount: number;
    isLoading: boolean;
    hasNextPage: boolean;
}): PaginationFocusTarget | undefined => {
    if (previousCount === undefined || isLoading) return undefined;
    if (itemCount <= previousCount && hasNextPage) return undefined;
    return hasNextPage ? 'load-more' : 'loaded-count';
};
