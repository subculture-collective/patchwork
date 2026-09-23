import type { PropsWithChildren } from 'react';
import type { VerificationTier } from '@patchwork/shared';
import { useLocale } from '../i18n';

// ---------------------------------------------------------------------------
// Base Badge
// ---------------------------------------------------------------------------

interface BadgeProps {
    tone?: 'default' | 'neutral' | 'info' | 'danger' | 'success';
    /** Accessible label for screen readers when badge text alone is insufficient */
    'aria-label'?: string;
}

const toneMap: Record<NonNullable<BadgeProps['tone']>, string> = {
    default: 'mh-badge--default',
    neutral: 'mh-badge--neutral',
    info: 'mh-badge--info',
    danger: 'mh-badge--danger',
    success: 'mh-badge--success',
};

export const Badge = ({
    children,
    tone = 'default',
    'aria-label': ariaLabel,
}: PropsWithChildren<BadgeProps>) => {
    return (
        <span
            aria-label={ariaLabel}
            className={[
                'inline-flex min-w-0 max-w-full items-center gap-1 break-words whitespace-normal rounded-full border border-mh-border px-2.5 py-0.5 text-xs font-bold leading-5',
                toneMap[tone],
            ].join(' ')}
        >
            {children}
        </span>
    );
};

// ---------------------------------------------------------------------------
// Verification tier badge
// ---------------------------------------------------------------------------

const TIER_BADGE_CONFIG: Record<
    VerificationTier,
    { labelKey: string; tone: NonNullable<BadgeProps['tone']>; icon: string }
> = {
    unverified: {
        labelKey: 'shared.unverified',
        tone: 'neutral',
        icon: '\u25CB',
    },
    basic: { labelKey: 'shared.basic', tone: 'default', icon: '\u25CF' },
    verified: { labelKey: 'shared.verified', tone: 'info', icon: '\u2713' },
    trusted: { labelKey: 'shared.trusted', tone: 'success', icon: '\u2605' },
    org_verified: {
        labelKey: 'shared.orgVerified',
        tone: 'success',
        icon: '\u2606\u2713',
    },
};

interface VerificationBadgeProps {
    tier: VerificationTier;
    /** When true, shows a warning indicator next to the badge. */
    expiryWarning?: boolean;
    /** When true, shows an expired indicator instead of the normal badge. */
    expired?: boolean;
}

export const VerificationBadge = ({
    tier,
    expiryWarning = false,
    expired = false,
}: VerificationBadgeProps) => {
    const { t } = useLocale();
    const config = TIER_BADGE_CONFIG[tier];
    const label = t(config.labelKey);

    if (expired) {
        return (
            <span
                role='status'
                aria-label={t('shared.verificationExpired', { tier: label })}
                className={[
                    'inline-flex min-w-0 max-w-full items-center gap-1 break-words whitespace-normal rounded-full border border-mh-border px-2.5 py-0.5 text-xs font-bold leading-5',
                    toneMap.danger,
                ].join(' ')}
            >
                <span aria-hidden='true'>{'\u26A0'}</span>
                {label} ({t('shared.expired')})
            </span>
        );
    }

    return (
        <span
            role='status'
            aria-label={t('shared.verificationTier', {
                tier: label,
                warning: expiryWarning ? t('shared.renewWarning') : '',
            })}
            className={[
                'inline-flex min-w-0 max-w-full items-center gap-1 break-words whitespace-normal rounded-full border border-mh-border px-2.5 py-0.5 text-xs font-bold leading-5',
                toneMap[config.tone],
            ].join(' ')}
        >
            <span aria-hidden='true'>{config.icon}</span>
            {label}
            {expiryWarning && (
                <span
                    aria-hidden='true'
                    className='ml-1 text-mh-warning'
                    title={t('shared.renewSoon')}
                >
                    {'\u23F0'}
                </span>
            )}
        </span>
    );
};
