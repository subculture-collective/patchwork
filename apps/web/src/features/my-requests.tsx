import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLocale } from '../i18n';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import { fetchAccountRequestsViaApi, type OwnedRequestReceipt } from './api-client';
import { RequestLifecycleActions } from './request-actions';
import { useVisiblePoll } from './use-visible-poll';

export function MyRequests() {
    const { session } = useAuth();
    const { t } = useLocale();
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<OwnedRequestReceipt[]>([]);
    const [hasNext, setHasNext] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const active = useRef<AbortController | undefined>(undefined);
    const load = async () => {
        active.current?.abort();
        const controller = new AbortController();
        active.current = controller;
        setBusy(true);
        const result = await fetchAccountRequestsViaApi(page, controller.signal);
        if (controller.signal.aborted) return false;
        setBusy(false);
        setError(!result.ok);
        if (!result.ok) {
            if (result.kind === 'authentication') { setItems([]); setLoaded(false); setHasNext(false); }
            return false;
        }
        setItems(result.data.items);
        setHasNext(result.data.hasNextPage);
        setLoaded(true);
        return true;
    };
    useEffect(() => {
        setItems([]); setLoaded(false); setHasNext(false);
        void load();
        return () => active.current?.abort();
    }, [page, session?.did, t]);
    useVisiblePoll(load, 15_000, Boolean(session));
    return <Panel title={t('myRequests.heading')}>
        <div className='flex flex-wrap items-center justify-between gap-3'>
            <a className='font-bold underline' href='/posting'>{t('myRequests.newRequest')}</a>
            <Button variant='neutral' disabled={busy} onClick={() => void load()}>{t('myRequests.refresh')}</Button>
        </div>
        {error && <p role='alert' className='mt-3'>{t('myRequests.error')}</p>}
        {!loaded && !error && <p role='status' className='mt-3'>{t('myRequests.loading')}</p>}
        {loaded && items.length === 0 && <p className='mt-3'>{t('myRequests.empty')}</p>}
        <ul className='mt-4 space-y-4'>
            {items.map(item => <li key={item.uri} className='rounded-2xl border border-mh-borderSoft p-4'>
                <h2 className='font-heading text-xl font-bold'>{item.title}</h2>
                <p className='mt-2'>{t(`labels.${item.status}`)}</p>
                <p className='mt-2 text-sm text-mh-textMuted'>{t(item.publication === 'pending' ? 'myRequests.pending' : 'myRequests.published')}</p>
                <div className='mt-3 flex flex-wrap gap-4'>
                    {item.publication === 'projected' && <a className='underline' href={`/requests/view?uri=${encodeURIComponent(item.uri)}`}>{t('myRequests.view')}</a>}
                    <a className='underline' href={`/inbox?uri=${encodeURIComponent(item.uri)}#request-offers`}>{t('handoff.reviewOffers')}</a>
                </div>
                {session && <RequestLifecycleActions record={{ aidPostUri: item.uri, recipientDid: session.did,
                    cid: item.sourceCid ?? undefined, card: { title: item.title } }} onRefresh={() => void load()} />}
            </li>)}
        </ul>
        {(page > 1 || hasNext) && <nav className='mt-4 flex items-center gap-3' aria-label={t('myRequests.pages')}>
            <Button disabled={page === 1 || busy} onClick={() => setPage(value => value - 1)}>{t('myRequests.previous')}</Button>
            <span>{t('myRequests.page', { page })}</span>
            <Button disabled={!hasNext || busy} onClick={() => setPage(value => value + 1)}>{t('myRequests.next')}</Button>
        </nav>}
    </Panel>;
}
