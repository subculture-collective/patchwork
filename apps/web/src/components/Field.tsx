import {
    cloneElement,
    isValidElement,
    useId,
    type ReactElement,
    type ReactNode,
    type SelectHTMLAttributes,
    type TextareaHTMLAttributes,
} from 'react';

interface FieldProps {
    label: ReactNode;
    hint?: ReactNode;
    error?: string;
    /** Marks the label with a visible "optional" note when false. */
    required?: boolean;
    optionalLabel?: string;
    className?: string;
    /** A single form control; Field wires id, aria-describedby and aria-invalid. */
    children: ReactElement<{
        id?: string;
        'aria-describedby'?: string;
        'aria-invalid'?: boolean;
    }>;
}

/** Label, hint and error wiring around one form control. */
export const Field = ({
    label,
    hint,
    error,
    required,
    optionalLabel,
    className = '',
    children,
}: FieldProps) => {
    const generatedId = useId();
    const controlId = children.props.id ?? generatedId;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;
    const describedBy = [children.props['aria-describedby'], hintId, errorId]
        .filter(Boolean)
        .join(' ');

    const control = isValidElement(children)
        ? cloneElement(children, {
              id: controlId,
              'aria-describedby': describedBy || undefined,
              'aria-invalid': error ? true : children.props['aria-invalid'],
          })
        : children;

    return (
        <div className={['grid gap-1.5', className].filter(Boolean).join(' ')}>
            <label htmlFor={controlId} className='mh-field-label'>
                {label}
                {required === false && optionalLabel ? (
                    <span className='ml-1 font-normal text-mh-textMuted'>
                        ({optionalLabel})
                    </span>
                ) : null}
            </label>
            {hint ? (
                <p id={hintId} className='mh-field-hint'>
                    {hint}
                </p>
            ) : null}
            {control}
            {error ? (
                <p id={errorId} role='alert' className='mh-field-error'>
                    {error}
                </p>
            ) : null}
        </div>
    );
};

export const Select = ({
    className = '',
    ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select
        className={['mh-input w-full px-3 py-2', className]
            .filter(Boolean)
            .join(' ')}
        {...props}
    />
);

export const Textarea = ({
    className = '',
    ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
        className={['mh-input w-full px-3 py-2', className]
            .filter(Boolean)
            .join(' ')}
        {...props}
    />
);
