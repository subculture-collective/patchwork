import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

interface ToggleChipProps
    extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> {
    pressed: boolean;
}

/** A pill toggle for multi-select filters. Selection is exposed via aria-pressed. */
export const ToggleChip = ({
    pressed,
    children,
    className = '',
    type = 'button',
    ...props
}: PropsWithChildren<ToggleChipProps>) => (
    <button
        type={type}
        aria-pressed={pressed}
        className={['mh-chip', className].filter(Boolean).join(' ')}
        {...props}
    >
        {children}
    </button>
);

interface ChipGroupProps {
    legend: ReactNode;
    /** Visually hide the legend while keeping it for assistive technology. */
    hideLegend?: boolean;
    className?: string;
}

export const ChipGroup = ({
    legend,
    hideLegend = false,
    className = '',
    children,
}: PropsWithChildren<ChipGroupProps>) => (
    <fieldset className={['min-w-0', className].filter(Boolean).join(' ')}>
        <legend
            className={hideLegend ? 'sr-only' : 'mh-field-label mb-2'}
        >
            {legend}
        </legend>
        <div className='flex flex-wrap gap-2'>{children}</div>
    </fieldset>
);
