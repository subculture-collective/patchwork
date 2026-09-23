import type { PropsWithChildren } from 'react';
import { Surface } from './Surface';

interface PanelProps {
    title: string;
    /** Optional aria-label override for the region landmark */
    'aria-label'?: string;
}

/**
 * Legacy titled section. Renders a single Surface; kept so existing routes
 * migrate without markup churn. New code should use Surface directly.
 */
export const Panel = ({
    title,
    children,
    'aria-label': ariaLabel,
}: PropsWithChildren<PanelProps>) => (
    <Surface title={title} aria-label={ariaLabel}>
        <div className='text-mh-text'>{children}</div>
    </Surface>
);
