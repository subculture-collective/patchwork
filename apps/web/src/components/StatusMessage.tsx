import { Banner } from './Banner';

interface StatusMessageProps {
    /** Status text. Messages starting with "Error:" render as a danger banner. */
    message: string | undefined;
    className?: string;
}

const isErrorMessage = (message: string) => /^error\s*:/i.test(message);

/**
 * One place for the "Error: …" / progress strings routes build up. Errors
 * become an alert banner; everything else stays a quiet live status line
 * (rendered even when empty so the live region exists before it changes).
 */
export const StatusMessage = ({ message, className = '' }: StatusMessageProps) =>
    message && isErrorMessage(message) ? (
        <Banner tone='danger' className={className}>
            {message}
        </Banner>
    ) : (
        <p
            role='status'
            className={['text-sm text-mh-textMuted', className]
                .filter(Boolean)
                .join(' ')}
        >
            {message}
        </p>
    );
