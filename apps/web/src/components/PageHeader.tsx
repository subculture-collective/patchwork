import type { ReactNode } from 'react';

interface PageHeaderProps {
    title: ReactNode;
    eyebrow?: ReactNode;
    description?: ReactNode;
    /** Primary page actions, e.g. "Ask for help". */
    actions?: ReactNode;
    /** Small status row under the description (data source, counts). */
    meta?: ReactNode;
    className?: string;
}

/** Route heading. Renders the page's only h1. */
export const PageHeader = ({
    title,
    eyebrow,
    description,
    actions,
    meta,
    className = '',
}: PageHeaderProps) => (
    <header
        className={['mh-page-header', className].filter(Boolean).join(' ')}
    >
        <div className='min-w-0'>
            {eyebrow ? <p className='mh-eyebrow mb-2'>{eyebrow}</p> : null}
            <h1 className='mh-route-title'>{title}</h1>
            {description ? (
                <p className='mh-page-header__description'>{description}</p>
            ) : null}
            {meta ? (
                <div className='mt-3 flex flex-wrap items-center gap-2 text-sm text-mh-textMuted'>
                    {meta}
                </div>
            ) : null}
        </div>
        {actions ? (
            <div className='mh-page-header__actions'>{actions}</div>
        ) : null}
    </header>
);
