import { useId, type PropsWithChildren, type ReactNode } from 'react';

interface EmptyStateProps {
    title: ReactNode;
    actions?: ReactNode;
    /**
     * Render as a labelled region with an h2 heading. Use when the empty state
     * replaces a whole page (e.g. sign-in required) rather than a list.
     */
    region?: boolean;
    className?: string;
}

/** Explains why nothing is shown and offers the next step. */
export const EmptyState = ({
    title,
    actions,
    region = false,
    className = '',
    children,
}: PropsWithChildren<EmptyStateProps>) => {
    const headingId = useId();
    const Element = region ? 'section' : 'div';
    const Title = region ? 'h2' : 'p';
    return (
        <Element
            className={['mh-empty', className].filter(Boolean).join(' ')}
            aria-labelledby={region ? headingId : undefined}
        >
            <Title id={headingId} className='mh-empty__title'>
                {title}
            </Title>
            {children ? <div className='max-w-prose'>{children}</div> : null}
            {actions ? (
                <div className='mt-2 flex flex-wrap gap-2'>{actions}</div>
            ) : null}
        </Element>
    );
};
