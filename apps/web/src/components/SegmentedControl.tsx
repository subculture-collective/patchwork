import { useId, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
    label: string;
    value: T;
    options: readonly SegmentedOption<T>[];
    onChange: (value: T) => void;
    /** Visually hide the group label (it stays available to screen readers). */
    hideLabel?: boolean;
    className?: string;
}

/** A compact radio group for choosing one of a few mutually exclusive views. */
export const SegmentedControl = <T extends string>({
    label,
    value,
    options,
    onChange,
    hideLabel = true,
    className = '',
}: SegmentedControlProps<T>) => {
    const name = useId();
    return (
        <fieldset className={['min-w-0', className].filter(Boolean).join(' ')}>
            <legend className={hideLabel ? 'sr-only' : 'mh-field-label mb-2'}>
                {label}
            </legend>
            <div className='mh-segmented'>
                {options.map((option) => (
                    <label key={option.value}>
                        <input
                            type='radio'
                            name={name}
                            value={option.value}
                            checked={option.value === value}
                            onChange={() => onChange(option.value)}
                        />
                        <span>{option.label}</span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
};
