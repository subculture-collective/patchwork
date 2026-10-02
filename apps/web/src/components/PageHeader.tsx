import type { PropsWithChildren, ReactNode } from 'react';

interface PageHeaderProps {
    title: ReactNode;
    /** Id for the h1, when a landmark is labelled by the page title. */
    titleId?: string;
    eyebrow?: ReactNode;
    description?: ReactNode;
    /** Primary page actions, e.g. "Ask for help". */
    actions?: ReactNode;
    /** Small status row under the description (data source, counts). */
    meta?: ReactNode;
    className?: string;
}

/**
 * Route heading. Renders the page's only h1. Children sit under the
 * description, for a page-level status line or notice.
 */
export const PageHeader = ({
    title,
    titleId,
    eyebrow,
    description,
    actions,
    meta,
    className = '',
    children,
}: PropsWithChildren<PageHeaderProps>) => (
    <header
        className={['mh-page-header', className].filter(Boolean).join(' ')}
    >
        <div className='min-w-0'>
            {eyebrow ? <p className='mh-eyebrow mb-2'>{eyebrow}</p> : null}
            <h1 id={titleId} className='mh-route-title'>
                {title}
            </h1>
            {description ? (
                <p className='mh-page-header__description'>{description}</p>
            ) : null}
            {meta ? (
                <div className='mt-3 flex flex-wrap items-center gap-2 text-sm text-mh-textMuted'>
                    {meta}
                </div>
            ) : null}
            {children}
        </div>
        {actions ? (
            <div className='mh-page-header__actions'>{actions}</div>
        ) : null}
    </header>
);
