import { useState } from 'react';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { acceptCurrentPoliciesViaApi } from '../features/api-client';
import { useLocale } from '../i18n';
import { CURRENT_POLICY_VERSION, requiredPolicyDocuments } from '@patchwork/shared';

interface PolicyConsentGateProps {
    onAccepted: () => void;
}

const policyLabelKeys: Readonly<Record<string, string>> = {
    'terms-of-use': 'consent.terms',
    'privacy-notice': 'consent.privacy',
    'community-guidelines': 'consent.guidelines',
    'synthetic-data-disclosure': 'consent.synthetic',
    'location-sharing-consent': 'consent.location',
};

export const PolicyConsentGate = ({ onAccepted }: PolicyConsentGateProps) => {
    const { t } = useLocale();
    const [accepted, setAccepted] = useState<Set<string>>(new Set());
    const [eligible, setEligible] = useState(false);
    const [status, setStatus] = useState<string>();
    const allAccepted = requiredPolicyDocuments.every((document) =>
        accepted.has(document),
    );

    const submit = async () => {
        setStatus(t('consent.recording'));
        const result = await acceptCurrentPoliciesViaApi();
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${result.error}`);
            return;
        }
        setStatus(t('consent.recorded'));
        onAccepted();
    };

    return (
        <Panel title={t('consent.title')}>
            <p className='text-sm text-mh-textMuted'>
                {t('consent.version', { version: CURRENT_POLICY_VERSION })}
            </p>
            <div className='mt-4 space-y-2'>
                {requiredPolicyDocuments.map((document) => (
                    <label
                        key={document}
                        className='flex items-start gap-2 text-sm'
                    >
                        <input
                            type='checkbox'
                            checked={accepted.has(document)}
                            onChange={(event) =>
                                setAccepted((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked)
                                        next.add(document);
                                    else next.delete(document);
                                    return next;
                                })
                            }
                        />
                        {t('consent.accept', {
                            policy: t(policyLabelKeys[document]),
                        })}
                    </label>
                ))}
                <label className='flex items-start gap-2 text-sm font-bold'>
                    <input
                        type='checkbox'
                        checked={eligible}
                        onChange={(event) => setEligible(event.target.checked)}
                    />
                    {t('consent.age')}
                </label>
            </div>
            <div className='mt-4 flex items-center gap-3'>
                <Button
                    disabled={!allAccepted || !eligible}
                    onClick={() => void submit()}
                >
                    {t('consent.continue')}
                </Button>
                {status ? (
                    <span
                        role={status.startsWith('Error:') ? 'alert' : 'status'}
                        className='text-xs'
                    >
                        {status}
                    </span>
                ) : null}
            </div>
        </Panel>
    );
};
