import { useEffect, useId, useRef, useState } from 'react';
import { useLocale } from '../../i18n';
import {
    resolveIdentityViaApi,
    type ResolvedIdentity,
} from '../api-client';

type LookupState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'found'; identity: ResolvedIdentity }
    | { kind: 'not-found' }
    | { kind: 'unavailable' };

interface IdentityFieldProps {
    label: string;
    /** Called with the resolved account, or undefined while unresolved. */
    onResolved: (identity: ResolvedIdentity | undefined) => void;
    /** Clears the text when this value changes (e.g. after a successful submit). */
    resetKey?: number;
    disabled?: boolean;
    id?: string;
}

const LOOKUP_DELAY_MS = 450;

/**
 * Asks for "@alice.bsky.social" instead of a DID. The account is looked up
 * after typing pauses; only a resolved DID is passed to the form.
 */
export const IdentityField = ({
    label,
    onResolved,
    resetKey = 0,
    disabled = false,
    id,
}: IdentityFieldProps) => {
    const { t } = useLocale();
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const hintId = `${inputId}-hint`;
    const statusId = `${inputId}-status`;
    const [text, setText] = useState('');
    const [lookup, setLookup] = useState<LookupState>({ kind: 'idle' });
    const onResolvedRef = useRef(onResolved);
    onResolvedRef.current = onResolved;

    useEffect(() => {
        setText('');
        setLookup({ kind: 'idle' });
    }, [resetKey]);

    useEffect(() => {
        const identifier = text.trim();
        onResolvedRef.current(undefined);
        if (!identifier) {
            setLookup({ kind: 'idle' });
            return undefined;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setLookup({ kind: 'checking' });
            void resolveIdentityViaApi(identifier, controller.signal).then(
                (result) => {
                    if (controller.signal.aborted) return;
                    if (result.ok) {
                        setLookup({ kind: 'found', identity: result.data });
                        onResolvedRef.current(result.data);
                        return;
                    }
                    setLookup(
                        result.code === 'IDENTITY_NOT_FOUND' ||
                            result.code === 'INVALID_IDENTIFIER'
                            ? { kind: 'not-found' }
                            : { kind: 'unavailable' },
                    );
                },
            );
        }, LOOKUP_DELAY_MS);
        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [text]);

    const invalid = lookup.kind === 'not-found';

    return (
        <div className='grid gap-1.5'>
            <label htmlFor={inputId} className='mh-field-label'>
                {label}
            </label>
            <p id={hintId} className='mh-field-hint'>
                {t('identity.hint')}
            </p>
            <input
                id={inputId}
                className='mh-input w-full px-3 py-2'
                autoComplete='off'
                autoCapitalize='none'
                spellCheck={false}
                placeholder={String(t('auth.handlePlaceholder'))}
                aria-describedby={`${hintId} ${statusId}`}
                aria-invalid={invalid || undefined}
                disabled={disabled}
                value={text}
                onChange={(event) => setText(event.target.value)}
            />
            <p
                id={statusId}
                role='status'
                className={
                    invalid || lookup.kind === 'unavailable'
                        ? 'mh-field-error'
                        : 'mh-field-hint'
                }
            >
                {lookup.kind === 'checking'
                    ? t('identity.checking')
                    : lookup.kind === 'found'
                      ? t('identity.found', {
                            account: lookup.identity.handle
                                ? `@${lookup.identity.handle}`
                                : lookup.identity.did,
                        })
                      : lookup.kind === 'not-found'
                        ? t('identity.notFound')
                        : lookup.kind === 'unavailable'
                          ? t('identity.unavailable')
                          : null}
            </p>
        </div>
    );
};
