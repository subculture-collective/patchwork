import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLocale } from '../i18n';
import { Button } from '../components/Button';
import { fetchAidPostViaApi, createCoordinationOfferViaApi } from './api-client';
import type { FeedRecordEnvelope } from './discovery-runtime';
import { RequestLifecycleActions } from './request-actions';

export function RequestDetail() {
    const { session } = useAuth();
    const { t } = useLocale();
    const uri = new URLSearchParams(window.location.search).get('uri') ?? '';
    const [record, setRecord] = useState<FeedRecordEnvelope>();
    const [error, setError] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [reload, setReload] = useState(0);
    const command = useRef<{ note: string | null; key: string } | undefined>(undefined);
    useEffect(() => {
        setRecord(undefined); setSent(false); command.current = undefined;
    }, [uri]);
    useEffect(() => {
        const controller = new AbortController();
        setError('');
        void fetchAidPostViaApi(uri, controller.signal).then(result => {
            if (controller.signal.aborted) return;
            if (result.ok) setRecord(result.data);
            else setError(t('handoff.requestUnavailable'));
        });
        return () => controller.abort();
    }, [uri, reload, t]);
    const offer = async (event: FormEvent) => {
        event.preventDefault();
        if (busy || sent || !session || !record || record.recordOrigin === 'synthetic') return;
        setBusy(true); setError('');
        const trimmed = note.trim() || null;
        if (command.current?.note !== trimmed) command.current = { note: trimmed, key: crypto.randomUUID() };
        const result = await createCoordinationOfferViaApi({ requestUri: uri, note: trimmed }, undefined, command.current!.key);
        setBusy(false);
        if (result.ok) setSent(true);
        else setError(t('handoff.offerFailed'));
    };
    return <section className='mx-auto max-w-2xl space-y-5'>
        <a href='/feed' className='underline'>{t('handoff.backNearby')}</a>
        {error && <p role='alert'>{error}</p>}
        {!record ? <Button onClick={() => setReload(value => value + 1)}>{t('handoff.retry')}</Button> : <>
            <h1 className='mh-route-title'>{record.card.title}</h1>
            <p className='whitespace-pre-wrap text-lg'>{record.card.description}</p>
            <p>{t(`labels.${record.card.status}`)}</p>
            {session?.did === record.recipientDid ? <>
                <RequestLifecycleActions record={record} onRefresh={() => setReload(value => value + 1)} />
                <a className='mh-button inline-flex px-3 py-2' href={`/inbox?uri=${encodeURIComponent(uri)}`}>{t('handoff.reviewOffers')}</a>
            </> : record.recordOrigin === 'synthetic' ? <p>{t('handoff.demoRequest')}</p>
                : !session ? <a className='mh-button inline-flex px-3 py-2' href={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}>{t('handoff.signInOffer')}</a>
                : sent ? <div role='status'><p>{t('handoff.offerSent')}</p><a href={`/inbox?uri=${encodeURIComponent(uri)}`} className='underline'>{t('handoff.viewActivity')}</a></div>
                : record.card.status !== 'open' ? <p>{t('handoff.notAcceptingOffers')}</p>
                : <form className='space-y-3' onSubmit={event => void offer(event)}>
                    <p>{t('handoff.offerPrivacy')}</p>
                    <label className='block'>{t('handoff.offerNote')}<textarea className='mh-input mt-2 min-h-28 w-full p-3' maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
                    <Button type='submit' disabled={busy}>{t(busy ? 'handoff.saving' : 'handoff.offerHelp')}</Button>
                </form>}
        </>}
    </section>;
}
