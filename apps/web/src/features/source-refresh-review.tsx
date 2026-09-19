import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import { useLocale } from '../i18n';
import {
    applySourceRefreshContactViaApi,
    dismissSourceRefreshCandidateViaApi,
    listSourceRefreshCandidatesViaApi,
    type SourceRefreshCandidate,
} from './api-client';

const valueSummary = (value: Record<string, unknown> | null) => {
    if (!value) return '—';
    return JSON.stringify(value, null, 2);
};

export function SourceRefreshReview() {
    const { t, fmt } = useLocale();
    const [status, setStatus] = useState<'pending' | 'resolved'>('pending');
    const [items, setItems] = useState<SourceRefreshCandidate[]>([]);
    const [page, setPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const load = async (target = page, targetStatus = status) => {
        setBusy(true);
        setMessage('');
        const result = await listSourceRefreshCandidatesViaApi(targetStatus, target);
        setBusy(false);
        if (!result.ok) { setMessage(result.error); return; }
        setItems(result.data.items);
        setHasNext(result.data.hasNextPage);
        setPage(target);
    };
    useEffect(() => { void load(1, status); }, [status]);
    const act = async (candidate: SourceRefreshCandidate, action: 'dismiss' | 'apply', reason?: string) => {
        setBusy(true);
        setMessage('');
        const result = action === 'apply'
            ? await applySourceRefreshContactViaApi(candidate.candidateId)
            : await dismissSourceRefreshCandidateViaApi({
                candidateId: candidate.candidateId,
                expectedUpdatedAt: candidate.updatedAt,
                reason: reason ?? '',
            });
        setBusy(false);
        if (!result.ok) setMessage(result.error);
        else {
            await load();
            setMessage(t(action === 'apply' ? 'sourceRefresh.applied' : 'sourceRefresh.dismissed'));
        }
    };
    return (
        <Panel title={t('sourceRefresh.title')}>
            <p className='text-sm text-mh-textMuted'>{t('sourceRefresh.help')}</p>
            <div className='mt-3 flex flex-wrap gap-2'>
                <label>
                    {t('sourceRefresh.queue')}
                    <select className='mh-input ml-2' value={status} onChange={event => setStatus(event.target.value as typeof status)}>
                        <option value='pending'>{t('sourceRefresh.pending')}</option>
                        <option value='resolved'>{t('sourceRefresh.resolved')}</option>
                    </select>
                </label>
                <Button variant='neutral' disabled={busy} onClick={() => void load()}>{t('sourceRefresh.refresh')}</Button>
            </div>
            {message && <p className='mt-3' role='status'>{message}</p>}
            {!busy && !message && items.length === 0 && <p className='mt-3'>{t('sourceRefresh.empty')}</p>}
            <div className='mt-3 space-y-4'>
                {items.map(candidate => (
                    <article className='border-2 border-mh-border p-3' key={candidate.candidateId}>
                        <h3 className='font-bold'>{candidate.after?.name ? String(candidate.after.name) : candidate.resourceUri}</h3>
                        <p className='text-sm'>{t('sourceRefresh.summary', {
                            disposition: candidate.disposition,
                            source: candidate.sourceId,
                            date: fmt.longDate(candidate.retrievedAt),
                        })}</p>
                        <p className='break-all text-xs text-mh-textMuted'>{candidate.resourceUri}</p>
                        <dl className='mt-2 grid gap-2 text-sm sm:grid-cols-2'>
                            <div><dt className='font-bold'>{t('sourceRefresh.fields')}</dt><dd>{candidate.changedFields.join(', ') || '—'}</dd></div>
                            <div><dt className='font-bold'>{t('sourceRefresh.reasons')}</dt><dd>{candidate.reasons.join(', ') || '—'}</dd></div>
                        </dl>
                        <details className='mt-2'>
                            <summary className='font-bold'>{t('sourceRefresh.evidence')}</summary>
                            {candidate.evidence?.url && <a className='mh-link break-all' href={candidate.evidence.url} target='_blank' rel='noopener noreferrer'>{candidate.evidence.url}</a>}
                            <p className='break-all text-xs'>SHA-256: {candidate.rawSha256}</p>
                        </details>
                        <details className='mt-2'>
                            <summary className='font-bold'>{t('sourceRefresh.comparison')}</summary>
                            <div className='grid gap-2 sm:grid-cols-2'>
                                <pre className='overflow-auto whitespace-pre-wrap text-xs'>{valueSummary(candidate.before)}</pre>
                                <pre className='overflow-auto whitespace-pre-wrap text-xs'>{valueSummary(candidate.after)}</pre>
                            </div>
                        </details>
                        {candidate.status === 'pending' && (
                            <form className='mt-3 space-y-2' onSubmit={event => {
                                event.preventDefault();
                                const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
                                void act(candidate, 'dismiss', reason);
                            }}>
                                {candidate.disposition === 'contact-automation-candidate' && (
                                    <Button type='button' disabled={busy} onClick={() => void act(candidate, 'apply')}>{t('sourceRefresh.applyContact')}</Button>
                                )}
                                <label className='block'>{t('sourceRefresh.dismissReason')}
                                    <textarea className='mh-input block w-full' name='reason' minLength={10} maxLength={2000} required />
                                </label>
                                <Button type='submit' variant='neutral' disabled={busy}>{t('sourceRefresh.dismiss')}</Button>
                            </form>
                        )}
                    </article>
                ))}
            </div>
            <div className='mt-3 flex gap-2'>
                {page > 1 && <Button variant='neutral' disabled={busy} onClick={() => void load(page - 1)}>{t('sourceRefresh.previous')}</Button>}
                {hasNext && <Button variant='neutral' disabled={busy} onClick={() => void load(page + 1)}>{t('sourceRefresh.next')}</Button>}
            </div>
        </Panel>
    );
}
