import type { PropsWithChildren, ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import type { FeedBadge } from '../../feed-ux';
import { useLocale } from '../../i18n';
import { formatLocalizedLabel } from '../shell-shared';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface RequestCardProps {
    title: string;
    description: string;
    category: string;
    updatedAt: string;
    urgency: number;
    badges: readonly (FeedBadge | undefined)[];
    /** Extra badges (e.g. record origin) appended after the status badges. */
    extraBadges?: ReactNode;
    /** Rendered below the description: primary actions for this request. */
    actions?: ReactNode;
    headingLevel?: 'h2' | 'h3';
    selected?: boolean;
    className?: string;
}

/** A single aid request as it appears in discovery lists. */
export const RequestCard = ({
    title,
    description,
    category,
    updatedAt,
    urgency,
    badges,
    extraBadges,
    actions,
    headingLevel: Heading = 'h3',
    selected = false,
    className = '',
    children,
}: PropsWithChildren<RequestCardProps>) => {
    const { t, fmt } = useLocale();
    return (
        <article
            className={[
                'mh-request-card',
                `mh-request-card--urgency-${urgency}`,
                selected ? 'is-selected' : '',
                className,
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div className='mh-request-card__meta'>
                <span className='mh-eyebrow'>
                    {formatLocalizedLabel(t, category)}
                </span>
                <time
                    className='mh-request-card__time'
                    dateTime={updatedAt}
                    title={fmt.longDate(updatedAt)}
                >
                    {Math.abs(Date.now() - new Date(updatedAt).getTime()) <
                    WEEK_MS
                        ? fmt.relativeTime(updatedAt)
                        : fmt.shortDate(updatedAt)}
                </time>
            </div>
            <Heading className='mh-request-card__title'>{title}</Heading>
            <p className='mh-request-card__description'>{description}</p>
            <div className='mh-request-card__badges'>
                {badges.map((badge) =>
                    badge ? (
                        <Badge key={badge.label} tone={badge.tone}>
                            {t(
                                `labels.${badge.label.toLowerCase().replace(/[\s_]+/g, '-')}`,
                                { defaultValue: badge.label },
                            )}
                        </Badge>
                    ) : null,
                )}
                {extraBadges}
            </div>
            {actions ? (
                <div className='mh-request-card__actions'>{actions}</div>
            ) : null}
            {children}
        </article>
    );
};
