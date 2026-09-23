import {
    useEffect,
    useRef,
    useState,
} from 'react';
import { useLocale } from '../i18n';
import { resolvePaginationFocus } from './pagination-focus';

export const parseCommaList = (value: string): string[] => {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
};

export const formatCategoryLabel = (value: string): string => {
    return value
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
};

export const formatLocalizedLabel = (
    t: ReturnType<typeof useLocale>['t'],
    value: string,
): string => t(`labels.${value}`, { defaultValue: formatCategoryLabel(value) });

export const readPaginationPageFromUrl = (): number => {
    if (typeof window === 'undefined') return 1;
    const page = Number.parseInt(new URLSearchParams(window.location.search).get('page') ?? '1', 10);
    return Number.isInteger(page) && page > 0 ? page : 1;
};

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

export interface PublicSyncFailure {
    postUri: string;
    expectedCid: string;
    updatedAt: string;
    message: string;
}
