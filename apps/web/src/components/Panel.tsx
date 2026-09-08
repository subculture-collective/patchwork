import { useId, type PropsWithChildren } from 'react';

interface PanelProps {
    title: string;
    /** Optional aria-label override for the region landmark */
    'aria-label'?: string;
}

export const Panel = ({
    title,
    children,
    'aria-label': ariaLabel,
}: PropsWithChildren<PanelProps>) => {
    const headingId = useId();

    return (
        <section
            className='mh-panel-shell p-3 sm:p-4'
            role='region'
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : headingId}
        >
            <h2
                id={headingId}
                className='mh-panel-titlebar mb-3 px-3 py-2 text-sm font-semibold tracking-[0.01em] text-mh-text'
            >
                {title}
            </h2>
            <div className='mh-panel-body'>{children}</div>
        </section>
    );
};
