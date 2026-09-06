import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Non-modal details: the map and readable list remain keyboard reachable. */
export const MapDetailSheet = ({ children, closeLabel, onClose }: {
    children: ReactNode; closeLabel: string; onClose: () => void;
}) => {
    const closeButton = useRef<HTMLButtonElement>(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    useEffect(() => {
        const previousFocus = document.activeElement;
        closeButton.current?.focus({ preventScroll: true });
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            if (previousFocus instanceof Element && previousFocus.isConnected && 'focus' in previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
        };
    }, []);
    return createPortal(<div className='mh-map-detail-sheet'>
        <div className='mh-map-detail-close'>
            <button ref={closeButton} type='button' className='mh-nav-chip' onClick={onClose}>{closeLabel}</button>
        </div>
        {children}
    </div>, document.body);
};
