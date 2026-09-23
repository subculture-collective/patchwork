import { shortenDid } from './useHandles';

interface AccountNameProps {
    did: string;
    handles: Record<string, string>;
}

/** Shows "@handle" when known; otherwise a shortened DID with the full value on hover. */
export const AccountName = ({ did, handles }: AccountNameProps) => {
    const handle = handles[did];
    return handle ? (
        <span title={did}>{`@${handle}`}</span>
    ) : (
        <span title={did} className='font-mono text-[0.9em]'>
            {shortenDid(did)}
        </span>
    );
};

export const accountLabel = (
    did: string,
    handles: Record<string, string>,
): string => (handles[did] ? `@${handles[did]}` : shortenDid(did));
