import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal behavior supplies focus containment, Escape, and an inert page. */
export function Modal({
    children,
    labelledBy,
    onClose,
}: {
    children: ReactNode;
    labelledBy: string;
    onClose: () => void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        const previous = document.activeElement;
        const element = dialog.current!;
        element.showModal();
        const cancel = (event: Event) => {
            event.preventDefault();
            close.current();
        };
        element.addEventListener('cancel', cancel);
        const containFocus = (event: KeyboardEvent) => {
            if (event.key !== 'Tab') return;
            const controls = [
                ...element.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
                ),
            ].filter((control) => control.getClientRects().length > 0);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        element.addEventListener('keydown', containFocus);
        return () => {
            element.removeEventListener('cancel', cancel);
            element.removeEventListener('keydown', containFocus);
            element.close();
            if (previous instanceof HTMLElement && previous.isConnected)
                previous.focus({ preventScroll: true });
        };
    }, []);
    return (
        <dialog ref={dialog} aria-labelledby={labelledBy} className='mh-modal'>
            {children}
        </dialog>
    );
}
