import { useId } from 'react';
import { useLocale } from '../../i18n';
import type { LinkableRequest } from '../api-client';

interface LinkedRequestSelectProps {
    label: string;
    help?: string;
    value: string;
    onChange: (uri: string) => void;
    /** Undefined while loading. */
    requests: readonly LinkableRequest[] | undefined;
    disabled?: boolean;
}

/** Optional request link, chosen from requests the account may link. */
export const LinkedRequestSelect = ({
    label,
    help,
    value,
    onChange,
    requests,
    disabled = false,
}: LinkedRequestSelectProps) => {
    const { t } = useLocale();
    const id = useId();
    const helpId = `${id}-help`;
    return (
        <div className='grid gap-1.5'>
            <label htmlFor={id} className='mh-field-label'>
                {label}
            </label>
            <select
                id={id}
                className='mh-input w-full px-3 py-2'
                value={value}
                disabled={disabled || requests === undefined}
                aria-describedby={help ? helpId : undefined}
                onChange={(event) => onChange(event.target.value)}
            >
                <option value=''>
                    {requests === undefined
                        ? t('scopePicker.loading')
                        : t('groups.noLinkedRequest')}
                </option>
                {(requests ?? []).map((request) => (
                    <option key={request.uri} value={request.uri}>
                        {(request.title ?? t('groups.untitledRequest')) +
                            ' · ' +
                            (request.role === 'requester'
                                ? t('groups.yourRequest')
                                : t('groups.helpingWith'))}
                    </option>
                ))}
            </select>
            {help ? (
                <p id={helpId} className='mh-field-hint'>
                    {help}
                </p>
            ) : null}
        </div>
    );
};
