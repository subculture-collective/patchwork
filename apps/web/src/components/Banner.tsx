import type { PropsWithChildren, ReactNode } from 'react';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

interface BannerProps {
    tone?: BannerTone;
    title?: ReactNode;
    actions?: ReactNode;
    /**
     * Live-region role. Defaults to `alert` for danger and `status` otherwise;
     * pass `none` for static notices that should not be announced.
     */
    live?: 'alert' | 'status' | 'none';
    className?: string;
}

/** Page- or section-level message. Tone is always paired with text. */
export const Banner = ({
    tone = 'info',
    title,
    actions,
    live,
    className = '',
    children,
}: PropsWithChildren<BannerProps>) => {
    const role = live ?? (tone === 'danger' ? 'alert' : 'status');
    return (
        <div
            role={role === 'none' ? undefined : role}
            className={['mh-banner', `mh-banner--${tone}`, className]
                .filter(Boolean)
                .join(' ')}
        >
            <div className='min-w-0 flex-1'>
                {title ? <p className='font-bold'>{title}</p> : null}
                {children ? (
                    <div className={title ? 'mt-1' : ''}>{children}</div>
                ) : null}
            </div>
            {actions ? (
                <div className='flex shrink-0 flex-wrap gap-2'>{actions}</div>
            ) : null}
        </div>
    );
};
