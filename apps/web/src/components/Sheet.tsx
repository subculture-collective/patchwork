import {
    useEffect,
    useId,
    useRef,
    type PropsWithChildren,
    type ReactNode,
    type RefObject,
} from 'react';
import { Icon } from './Icon';

interface SheetProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    /** Accessible name for the close button, e.g. t('common.close'). */
    closeLabel: string;
    /** `bottom` slides up on phones; `side` docks to the right on wider screens. */
    placement?: 'bottom' | 'side';
    footer?: ReactNode;
    /** Element to focus after the sheet closes (defaults to the opener). */
    returnFocusRef?: RefObject<HTMLElement | null>;
    id?: string;
}

/**
 * Modal sheet built on the native <dialog> element, which provides focus
 * containment, Escape handling and an inert background.
 */
export const Sheet = ({
    open,
    onClose,
    title,
    closeLabel,
    placement = 'bottom',
    footer,
    returnFocusRef,
    id,
    children,
}: PropsWithChildren<SheetProps>) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const titleId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else dialog.setAttribute('open', '');
        } else if (!open && dialog.open) {
            if (typeof dialog.close === 'function') dialog.close();
            else dialog.removeAttribute('open');
            returnFocusRef?.current?.focus();
        }
    }, [open, returnFocusRef]);

    return (
        <dialog
            ref={dialogRef}
            id={id}
            aria-labelledby={titleId}
            className={`mh-sheet mh-sheet--${placement}`}
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            onClick={(event) => {
                // A click on the backdrop targets the dialog element itself.
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className='mh-sheet__panel'>
                <header className='mh-sheet__header'>
                    <h2 id={titleId} className='mh-surface__title'>
                        {title}
                    </h2>
                    <button
                        type='button'
                        className='mh-button mh-button--ghost mh-button--sm'
                        onClick={onClose}
                        aria-label={closeLabel}
                    >
                        <Icon name='close' />
                    </button>
                </header>
                <div className='mh-sheet__body'>{children}</div>
                {footer ? (
                    <footer className='mh-sheet__footer'>{footer}</footer>
                ) : null}
            </div>
        </dialog>
    );
};
