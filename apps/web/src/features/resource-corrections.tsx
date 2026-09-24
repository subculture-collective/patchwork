import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { useLocale } from '../i18n';
import {
    submitResourceCorrectionViaApi,
    resourceCorrectionStatusViaApi,
    respondResourceCorrectionViaApi,
    listResourceCorrectionsViaApi,
    decideResourceCorrectionViaApi,
    fetchResourceViaApi,
    type ResourceCorrection,
} from './api-client';
import type { ResourceDetail } from '../resource-directory-ux';
const newReceipt = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
        value.toString(16).padStart(2, '0'),
    ).join('');

export function ResourceCorrectionForm({
    resourceUri,
}: {
    resourceUri: string;
}) {
    const { t } = useLocale();
    const [receipt] = useState(newReceipt);
    const [busy, setBusy] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [message, setMessage] = useState('');
    const [lookup, setLookup] = useState('');
    const [correction, setCorrection] = useState<ResourceCorrection>();
    return (
        <details className="py-3">
            <summary>{t('corrections.report')}</summary>
            <p>{t('corrections.privacy')}</p>
            {!submitted && (
                <form
                    className="space-y-2"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        if (busy) return;
                        const data = new FormData(event.currentTarget);
                        setBusy(true);
                        setMessage('');
                        setLookup(receipt);
                        const result = await submitResourceCorrectionViaApi({
                            receipt,
                            resourceUri,
                            category: data.get('category'),
                            explanation: data.get('explanation'),
                            sourceUrl: data.get('sourceUrl') || undefined,
                        });
                        setBusy(false);
                        if (result.ok) {
                            setSubmitted(true);
                            setMessage(t('corrections.submitted'));
                        } else setMessage(result.error);
                    }}
                >
                    <label className="block">
                        {t('corrections.category')}
                        <select
                            name="category"
                            className="mh-input block w-full"
                        >
                            {(
                                [
                                    'contact',
                                    'hours',
                                    'access',
                                    'closure',
                                    'other',
                                ] as const
                            ).map((category) => (
                                <option key={category} value={category}>
                                    {t(`corrections.categories.${category}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        {t('corrections.explanation')}
                        <textarea
                            name="explanation"
                            className="mh-input block w-full"
                            required
                            minLength={10}
                            maxLength={2000}
                        />
                    </label>
                    <label className="block">
                        {t('corrections.source')}
                        <input
                            name="sourceUrl"
                            type="url"
                            className="mh-input block w-full"
                            maxLength={2000}
                        />
                    </label>
                    <Button type="submit" disabled={busy}>
                        {t('corrections.submit')}
                    </Button>
                </form>
            )}
            {lookup === receipt && (
                <label className="block py-2">
                    {t('corrections.receiptHelp')}
                    <input
                        className="mh-input block w-full"
                        readOnly
                        value={receipt}
                        autoComplete="off"
                        onFocus={(event) => event.target.select()}
                    />
                </label>
            )}
            <form
                className="space-y-2 py-2"
                onSubmit={async (event) => {
                    event.preventDefault();
                    setBusy(true);
                    setMessage('');
                    const result = await resourceCorrectionStatusViaApi(
                        lookup.trim(),
                    );
                    setBusy(false);
                    if (result.ok)
                        setCorrection(
                            (result.data as { correction: ResourceCorrection })
                                .correction,
                        );
                    else setMessage(result.error);
                }}
            >
                <label className="block">
                    {t('corrections.receipt')}
                    <input
                        className="mh-input block w-full"
                        required
                        pattern="[a-f0-9]{64}"
                        value={lookup}
                        onChange={(event) => {
                            setLookup(event.target.value);
                            setCorrection(undefined);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </label>
                <Button type="submit" variant="neutral" disabled={busy}>
                    {t('corrections.check')}
                </Button>
            </form>
            {message && <p role="status">{message}</p>}
            {correction && (
                <CorrectionStatus
                    correction={correction}
                    receipt={lookup.trim()}
                    onRefresh={async () => {
                        const result = await resourceCorrectionStatusViaApi(
                            lookup.trim(),
                        );
                        if (result.ok)
                            setCorrection(
                                (
                                    result.data as {
                                        correction: ResourceCorrection;
                                    }
                                ).correction,
                            );
                        else setMessage(result.error);
                    }}
                />
            )}
        </details>
    );
}
function CorrectionStatus({
    correction,
    receipt,
    onRefresh,
    allowRespond = true,
}: {
    correction: ResourceCorrection;
    receipt?: string;
    onRefresh: () => void;
    allowRespond?: boolean;
}) {
    const { t } = useLocale();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    return (
        <article className="space-y-2 border-t py-3">
            <p>{t(`corrections.status.${correction.status}`)}</p>
            <p>{correction.explanation}</p>
            {correction.response && <p>{correction.response}</p>}
            <a
                className="mh-link"
                href={`/resources?resource=${encodeURIComponent(correction.resource_uri)}`}
            >
                {t('claims.viewResource')}
            </a>
            {allowRespond && correction.status === 'needs-information' && (
                <form
                    className="space-y-2"
                    onSubmit={async (event) => {
                        event.preventDefault();
                        const data = new FormData(event.currentTarget);
                        setBusy(true);
                        const result = await respondResourceCorrectionViaApi({
                            ...(receipt ? { receipt } : { id: correction.id }),
                            revision: correction.revision,
                            explanation: data.get('explanation'),
                            sourceUrl: data.get('sourceUrl') || undefined,
                        });
                        setBusy(false);
                        if (result.ok) onRefresh();
                        else setMessage(result.error);
                    }}
                >
                    <label className="block">
                        {t('corrections.followup')}
                        <textarea
                            className="mh-input block w-full"
                            name="explanation"
                            required
                            minLength={10}
                            maxLength={2000}
                        />
                    </label>
                    <label className="block">
                        {t('corrections.source')}
                        <input
                            className="mh-input block w-full"
                            type="url"
                            name="sourceUrl"
                            maxLength={2000}
                        />
                    </label>
                    <Button type="submit" disabled={busy}>
                        {t('corrections.sendFollowup')}
                    </Button>
                </form>
            )}
            {message && <p role="status">{message}</p>}
        </article>
    );
}
export function ResourceCorrectionList({
    review = false,
}: {
    review?: boolean;
}) {
    const { t } = useLocale();
    const [items, setItems] = useState<ResourceCorrection[]>([]);
    const [page, setPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const load = async (target = 1) => {
        setBusy(true);
        setMessage('');
        const result = await listResourceCorrectionsViaApi(review, target);
        setBusy(false);
        if (result.ok) {
            const data = result.data as {
                items: ResourceCorrection[];
                hasNextPage: boolean;
            };
            setItems(data.items);
            setHasNext(data.hasNextPage);
            setPage(target);
        } else setMessage(result.error);
    };
    useEffect(() => {
        void load();
    }, [review]);
    return (
        <Panel title={t(review ? 'corrections.review' : 'corrections.mine')}>
            <Button
                variant="neutral"
                disabled={busy}
                onClick={() => void load(page)}
            >
                {t('corrections.refresh')}
            </Button>
            {message && <p role="status">{message}</p>}
            {!busy && !message && !items.length && (
                <p>{t('corrections.empty')}</p>
            )}
            {items.map((item) => (
                <div key={item.id}>
                    <CorrectionStatus
                        correction={item}
                        allowRespond={!review}
                        onRefresh={() => void load(page)}
                    />
                    {review && (
                        <CorrectionDecision
                            correction={item}
                            onRefresh={() => void load(page)}
                        />
                    )}
                </div>
            ))}
            {page > 1 && (
                <Button
                    variant="neutral"
                    disabled={busy}
                    onClick={() => void load(page - 1)}
                >
                    {t('corrections.previous')}
                </Button>
            )}
            {hasNext && (
                <Button
                    variant="neutral"
                    disabled={busy}
                    onClick={() => void load(page + 1)}
                >
                    {t('corrections.next')}
                </Button>
            )}
        </Panel>
    );
}
function CorrectionDecision({
    correction,
    onRefresh,
}: {
    correction: ResourceCorrection;
    onRefresh: () => void;
}) {
    const { t } = useLocale();
    const [action, setAction] = useState<
        'applied' | 'denied' | 'duplicate' | 'needs-information'
    >('needs-information');
    const [resource, setResource] = useState<ResourceDetail>();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [field, setField] = useState<
        'name' | 'openHours' | 'eligibilityNotes' | 'url' | 'phone'
    >('name');
    return (
        <form
            className="space-y-2 border-b pb-3"
            onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                const data = new FormData(event.currentTarget);
                const value = String(data.get('value') ?? '');
                setBusy(true);
                setMessage('');
                const patch =
                    field === 'url' || field === 'phone'
                        ? { contact: { ...resource?.contact, [field]: value } }
                        : { [field]: value };
                const result = await decideResourceCorrectionViaApi({
                    id: correction.id,
                    revision: correction.revision,
                    action,
                    response: data.get('response'),
                    ...(action === 'applied'
                        ? {
                              patch,
                              expectedUpdatedAt: resource?.updatedAt,
                              sourceUrl: data.get('sourceUrl'),
                          }
                        : {}),
                });
                setBusy(false);
                if (result.ok) onRefresh();
                else setMessage(result.error);
            }}
        >
            <label className="block">
                {t('corrections.decision')}
                <select
                    className="mh-input block w-full"
                    value={action}
                    onChange={(event) =>
                        setAction(event.target.value as typeof action)
                    }
                >
                    {(
                        [
                            'needs-information',
                            'applied',
                            'denied',
                            'duplicate',
                        ] as const
                    ).map((status) => (
                        <option key={status} value={status}>
                            {t(`corrections.status.${status}`)}
                        </option>
                    ))}
                </select>
            </label>
            <label className="block">
                {t('corrections.response')}
                <textarea
                    className="mh-input block w-full"
                    name="response"
                    required
                    minLength={10}
                    maxLength={2000}
                />
            </label>
            {action === 'applied' && (
                <>
                    <Button
                        type="button"
                        variant="neutral"
                        disabled={busy}
                        onClick={async () => {
                            setBusy(true);
                            const result = await fetchResourceViaApi(
                                correction.resource_uri,
                            );
                            setBusy(false);
                            if (result.ok) setResource(result.data);
                            else setMessage(result.error);
                        }}
                    >
                        {t('corrections.loadListing')}
                    </Button>
                    {resource && (
                        <p>
                            {resource.name} · {resource.openHours} ·{' '}
                            {resource.eligibilityNotes} · {resource.contact.url}{' '}
                            · {resource.contact.phone}
                        </p>
                    )}
                    <label className="block">
                        {t('corrections.field')}
                        <select
                            className="mh-input block w-full"
                            value={field}
                            onChange={(event) =>
                                setField(event.target.value as typeof field)
                            }
                        >
                            {(
                                [
                                    'name',
                                    'openHours',
                                    'eligibilityNotes',
                                    'url',
                                    'phone',
                                ] as const
                            ).map((key) => (
                                <option key={key} value={key}>
                                    {t(`corrections.fields.${key}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        {t('corrections.replacement')}
                        <textarea
                            className="mh-input block w-full"
                            name="value"
                            required
                            maxLength={
                                field === 'openHours'
                                    ? 200
                                    : field === 'name'
                                      ? 120
                                      : field === 'phone'
                                        ? 32
                                        : field === 'url'
                                          ? 2000
                                          : 500
                            }
                        />
                    </label>
                    <label className="block">
                        {t('corrections.verifiedSource')}
                        <input
                            className="mh-input block w-full"
                            type="url"
                            name="sourceUrl"
                            required
                            maxLength={2000}
                        />
                    </label>
                </>
            )}
            <Button
                type="submit"
                disabled={busy || (action === 'applied' && !resource)}
            >
                {t('corrections.saveDecision')}
            </Button>
            {message && <p role="status">{message}</p>}
        </form>
    );
}
