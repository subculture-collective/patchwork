import type { PropsWithChildren, ReactNode } from 'react';

interface EmptyStateProps {
    title: ReactNode;
    actions?: ReactNode;
    className?: string;
}

/** Explains why nothing is shown and offers the next step. */
export const EmptyState = ({
    title,
    actions,
    className = '',
    children,
}: PropsWithChildren<EmptyStateProps>) => (
    <div className={['mh-empty', className].filter(Boolean).join(' ')}>
        <p className='mh-empty__title'>{title}</p>
        {children ? <div className='max-w-prose'>{children}</div> : null}
        {actions ? (
            <div className='mt-2 flex flex-wrap gap-2'>{actions}</div>
        ) : null}
    </div>
);
