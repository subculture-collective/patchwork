import {
    forwardRef,
    type AnchorHTMLAttributes,
    type ButtonHTMLAttributes,
    type PropsWithChildren,
} from 'react';

export type ButtonVariant =
    | 'primary'
    | 'accent'
    | 'secondary'
    | 'neutral'
    | 'danger'
    | 'ghost';

export type ButtonSize = 'sm' | 'md';

interface ButtonStyleProps {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Stretch to the container width (useful for mobile action rows). */
    block?: boolean;
}

export const buttonClassName = ({
    variant = 'primary',
    size = 'md',
    block = false,
    className = '',
}: ButtonStyleProps & { className?: string }): string =>
    [
        'mh-button',
        `mh-button--${variant}`,
        `mh-button--${size}`,
        block ? 'w-full' : '',
        className,
    ]
        .filter(Boolean)
        .join(' ');

interface ButtonProps
    extends ButtonHTMLAttributes<HTMLButtonElement>,
        ButtonStyleProps {}

export const Button = forwardRef<
    HTMLButtonElement,
    PropsWithChildren<ButtonProps>
>(
    (
        {
            children,
            className = '',
            variant = 'primary',
            size = 'md',
            block,
            type = 'button',
            disabled,
            ...props
        },
        ref,
    ) => (
        <button
            ref={ref}
            type={type}
            className={buttonClassName({ variant, size, block, className })}
            disabled={disabled}
            aria-disabled={disabled || undefined}
            {...props}
        >
            {children}
        </button>
    ),
);

Button.displayName = 'Button';

interface ButtonLinkProps
    extends AnchorHTMLAttributes<HTMLAnchorElement>,
        ButtonStyleProps {}

/** An anchor styled as a button, for navigation that should look like an action. */
export const ButtonLink = ({
    children,
    className = '',
    variant = 'primary',
    size = 'md',
    block,
    ...props
}: PropsWithChildren<ButtonLinkProps>) => (
    <a
        className={buttonClassName({ variant, size, block, className })}
        {...props}
    >
        {children}
    </a>
);
