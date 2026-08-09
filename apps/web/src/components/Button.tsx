import { forwardRef, type ButtonHTMLAttributes, type PropsWithChildren } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'neutral';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
}

const variantClassMap: Record<ButtonVariant, string> = {
    primary: 'mh-button--primary',
    secondary: 'mh-button--secondary',
    neutral: 'mh-button--neutral',
};

export const Button = forwardRef<HTMLButtonElement, PropsWithChildren<ButtonProps>>(({
    children,
    className = '',
    variant = 'primary',
    type = 'button',
    disabled,
    'aria-label': ariaLabel,
    ...props
}, ref) => {
    return (
        <button
            ref={ref}
            type={type}
            className={[
                'mh-button inline-flex items-center justify-center px-4 py-2 text-sm font-semibold tracking-[0.01em] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mh-accent',
                variantClassMap[variant],
                disabled ? 'opacity-50 cursor-not-allowed' : '',
                className,
            ].join(' ')}
            disabled={disabled}
            aria-disabled={disabled || undefined}
            aria-label={ariaLabel}
            {...props}
        >
            {children}
        </button>
    );
});

Button.displayName = 'Button';
