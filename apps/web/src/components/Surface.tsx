import { useId, type PropsWithChildren, type ReactNode } from 'react';

type SurfaceTone = 'default' | 'flat' | 'quiet' | 'tinted';
type HeadingLevel = 'h2' | 'h3';

interface SurfaceProps {
    title?: ReactNode;
    description?: ReactNode;
    /** Controls rendered at the end of the header row. */
    actions?: ReactNode;
    eyebrow?: ReactNode;
    tone?: SurfaceTone;
    as?: 'section' | 'article' | 'div';
    headingLevel?: HeadingLevel;
    padding?: 'sm' | 'md' | 'lg';
    className?: string;
    id?: string;
    'aria-label'?: string;
}

const toneClass: Record<SurfaceTone, string> = {
    default: '',
    flat: 'mh-surface--flat',
    quiet: 'mh-surface--quiet',
    tinted: 'mh-surface--tinted',
};

const paddingClass = {
    sm: 'p-3 sm:p-4',
    md: 'p-4 sm:p-6',
    lg: 'p-5 sm:p-8',
} as const;

/** The single content container. One idea per surface; do not nest surfaces. */
export const Surface = ({
    title,
    description,
    actions,
    eyebrow,
    tone = 'default',
    as: Element = 'section',
    headingLevel: Heading = 'h2',
    padding = 'md',
    className = '',
    id,
    'aria-label': ariaLabel,
    children,
}: PropsWithChildren<SurfaceProps>) => {
    const headingId = useId();
    const hasHeader = Boolean(title || actions || eyebrow);
    const titled = Boolean(title) && tone === 'default';
    if (titled) {
        return (
            <Element
                id={id}
                className={['mh-surface', 'mh-surface--titled', className]
                    .filter(Boolean)
                    .join(' ')}
                aria-label={ariaLabel}
                aria-labelledby={!ariaLabel ? headingId : undefined}
            >
                <header className='mh-surface__titlebar'>
                    <Heading id={headingId} className='mh-surface__title'>
                        {title}
                    </Heading>
                    {actions ? (
                        <div className='flex flex-wrap items-center gap-2'>
                            {actions}
                        </div>
                    ) : null}
                    {description ? (
                        <p className='mh-surface__description'>{description}</p>
                    ) : null}
                </header>
                <div className='mh-surface__sheet'>{children}</div>
            </Element>
        );
    }
    return (
        <Element
            id={id}
            className={[
                'mh-surface',
                toneClass[tone],
                paddingClass[padding],
                className,
            ]
                .filter(Boolean)
                .join(' ')}
            aria-label={ariaLabel}
            aria-labelledby={!ariaLabel && title ? headingId : undefined}
        >
            {hasHeader ? (
                <header
                    className={[
                        'mh-surface__header',
                        children ? 'mb-4' : '',
                    ].join(' ')}
                >
                    <div className='min-w-0'>
                        {eyebrow ? (
                            <p className='mh-eyebrow mb-1'>{eyebrow}</p>
                        ) : null}
                        {title ? (
                            <Heading id={headingId} className='mh-surface__title'>
                                {title}
                            </Heading>
                        ) : null}
                        {description ? (
                            <p className='mh-surface__description'>
                                {description}
                            </p>
                        ) : null}
                    </div>
                    {actions ? (
                        <div className='flex flex-wrap items-center gap-2'>
                            {actions}
                        </div>
                    ) : null}
                </header>
            ) : null}
            {children}
        </Element>
    );
};
