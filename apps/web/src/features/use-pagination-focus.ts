import { useEffect, useRef, useState } from 'react';
import { resolvePaginationFocus } from './pagination-focus';

export const usePaginationFocus = ({
    itemCount,
    isLoading,
    hasNextPage,
    announce,
}: {
    itemCount: number;
    isLoading: boolean;
    hasNextPage: boolean;
    announce: (start: number, end: number) => string;
}) => {
    const [pendingFrom, setPendingFrom] = useState<number>();
    const [announcement, setAnnouncement] = useState('');
    const loadMoreRef = useRef<HTMLButtonElement>(null);
    const loadedCountRef = useRef<HTMLParagraphElement>(null);

    useEffect(() => {
        if (pendingFrom === undefined) return;
        const focusTarget = resolvePaginationFocus({
            previousCount: pendingFrom,
            itemCount,
            isLoading,
            hasNextPage,
        });
        if (!focusTarget) return;

        if (itemCount > pendingFrom) {
            setAnnouncement(announce(pendingFrom + 1, itemCount));
        }
        if (focusTarget === 'load-more') loadMoreRef.current?.focus();
        else loadedCountRef.current?.focus();
        setPendingFrom(undefined);
    }, [announce, hasNextPage, isLoading, itemCount, pendingFrom]);

    return {
        announcement,
        loadedCountRef,
        loadMoreRef,
        loadMore: (callback: () => void) => {
            setPendingFrom(itemCount);
            callback();
        },
    };
};

