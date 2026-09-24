import { lookupPostalArea } from '@patchwork/at-lexicons';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useLocale } from '../i18n';
import { Badge } from '../components/Badge';
import { Panel } from '../components/Panel';
import { Button } from '../components/Button';
import {
    fetchAidPostViaApi,
    createCoordinationOfferViaApi,
} from './api-client';
import type { FeedRecordEnvelope } from './discovery-runtime';
import { RequestLifecycleActions } from './request-actions';

export function RequestDetail() {
    const { session } = useAuth();
    const { t, fmt } = useLocale();
    const uri = new URLSearchParams(window.location.search).get('uri') ?? '';
    const [record, setRecord] = useState<FeedRecordEnvelope>();
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [profileRequired, setProfileRequired] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    const [reload, setReload] = useState(0);
    const command = useRef<{ note: string | null; key: string } | undefined>(
        undefined,
    );
    useEffect(() => {
        setRecord(undefined);
        setSent(false);
        command.current = undefined;
    }, [uri]);
    useEffect(() => {
        const controller = new AbortController();
        setError('');
        setLoading(true);
        void fetchAidPostViaApi(uri, controller.signal).then((result) => {
            if (controller.signal.aborted) return;
            setLoading(false);
            if (result.ok) setRecord(result.data);
            else setError(t('handoff.requestUnavailable'));
        });
        return () => controller.abort();
    }, [uri, reload, t]);
    const offer = async (event: FormEvent) => {
        event.preventDefault();
        if (
            busy ||
            sent ||
            !session ||
            !record ||
            record.recordOrigin === 'synthetic'
        )
            return;
        setBusy(true);
        setError('');
        const trimmed = note.trim() || null;
        if (command.current?.note !== trimmed)
            command.current = { note: trimmed, key: crypto.randomUUID() };
        const result = await createCoordinationOfferViaApi(
            { requestUri: uri, note: trimmed },
            undefined,
            command.current!.key,
        );
        setBusy(false);
        if (result.ok) setSent(true);
        else {
            setError(t('handoff.offerFailed'));
            if (result.code === 'ACTIVE_VOLUNTEER_PROFILE_REQUIRED') {
                setProfileRequired(true);
                command.current = undefined;
            }
        }
    };
    const postalArea = record?.postalCode ? lookupPostalArea(record.postalCode) : undefined;
    const area = postalArea ? { lat: postalArea.latitude, lng: postalArea.longitude, precisionKm: 1 } : undefined;
    const mapParams = new URLSearchParams({ uri });
    if (record?.postalCode) mapParams.set('zip', record.postalCode);
    const mapHref = `/nearby?${mapParams}`;
    const resourceParams = new URLSearchParams({ tab: 'nearby' });
    if (record?.postalCode) resourceParams.set('area', `ZIP ${record.postalCode} · distances from the ZIP area`);
    if (area) {
        resourceParams.set('lat', String(area.lat));
        resourceParams.set('lng', String(area.lng));
        resourceParams.set('r', '20000');
    }
    const owner = session?.did === record?.recipientDid;
    return (
        <section className='mx-auto max-w-5xl space-y-5'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
                <a href='/nearby' className='underline'>
                    {t('handoff.backNearby')}
                </a>
                {record && (
                    <Button
                        variant='neutral'
                        onClick={() => {
                            if (!navigator.clipboard) {
                                setError(t('requestPage.copyFailed'));
                                return;
                            }
                            void navigator.clipboard
                                .writeText(
                                    `${window.location.origin}/requests/view?uri=${encodeURIComponent(uri)}`,
                                )
                                .then(
                                    () => setCopied(true),
                                    () => setError(t('requestPage.copyFailed')),
                                );
                        }}
                    >
                        {t(copied ? 'requestPage.copied' : 'requestPage.share')}
                    </Button>
                )}
            </div>
            {error && <p role='alert'>{error}</p>}
            {!record ? (
                loading ? (
                    <p role='status'>{t('handoff.loadingRequest')}</p>
                ) : (
                    <Button onClick={() => setReload((value) => value + 1)}>
                        {t('handoff.retry')}
                    </Button>
                )
            ) : (
                <>
                    <header className='space-y-3'>
                        <div className='flex flex-wrap gap-2'>
                            <Badge tone='info'>
                                {t(`labels.${record.card.category}`)}
                            </Badge>
                            <Badge
                                tone={
                                    record.card.status === 'open'
                                        ? 'info'
                                        : 'neutral'
                                }
                            >
                                {t(`labels.${record.card.status}`)}
                            </Badge>
                            <Badge
                                tone={
                                    record.card.urgency >= 4
                                        ? 'danger'
                                        : 'neutral'
                                }
                            >
                                {t('map.urgencyLabel', {
                                    level: record.card.urgency,
                                })}
                            </Badge>
                            {record.recordOrigin === 'synthetic' && (
                                <Badge tone='neutral'>
                                    {t('feed.synthetic')}
                                </Badge>
                            )}
                        </div>
                        <h1 className='mh-route-title'>{record.card.title}</h1>
                    </header>
                    <div className='grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]'>
                        <div className='space-y-5'>
                            <Panel title={t('requestPage.needed')}>
                                <p className='whitespace-pre-wrap text-base leading-relaxed'>
                                    {record.card.description}
                                </p>
                            </Panel>
                            <Panel title='ZIP area'>
                                <p>
                                    {postalArea ? `ZIP ${postalArea.postalCode} · ${postalArea.stateName}` : 'The author has not supplied a ZIP code.'}
                                </p>
                                <p className='mt-2 text-sm text-mh-textMuted'>
                                    {t('requestPage.locationPrivacy')}
                                </p>
                                <div className='mt-3 flex flex-wrap gap-3'>
                                    {area && (
                                        <a
                                            href={mapHref}
                                            className='mh-button inline-flex px-3 py-2'
                                        >
                                            {t('requestPage.viewArea')}
                                        </a>
                                    )}
                                    <a
                                        href={`/resources?${resourceParams}`}
                                        className='underline'
                                    >
                                        {t('requestPage.resources')}
                                    </a>
                                </div>
                            </Panel>
                            <Panel title={t('requestPage.updates')}>
                                <dl className='grid grid-cols-2 gap-3 text-sm'>
                                    <div>
                                        <dt className='font-bold'>
                                            {t('requestPage.posted')}
                                        </dt>
                                        <dd>
                                            <time
                                                dateTime={record.card.createdAt}
                                            >
                                                {fmt.longDate(
                                                    record.card.createdAt,
                                                )}
                                            </time>
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className='font-bold'>
                                            {t('requestPage.updated')}
                                        </dt>
                                        <dd>
                                            <time
                                                dateTime={record.card.updatedAt}
                                            >
                                                {fmt.longDate(
                                                    record.card.updatedAt,
                                                )}
                                            </time>
                                        </dd>
                                    </div>
                                </dl>
                            </Panel>
                        </div>
                        <Panel
                            title={t(
                                owner
                                    ? 'requestPage.manage'
                                    : 'requestPage.next',
                            )}
                        >
                            {owner ? (
                                <div className='space-y-4'>
                                    <p>{t('requestPage.ownerHelp')}</p>
                                    <RequestLifecycleActions
                                        record={record}
                                        onRefresh={() =>
                                            setReload((value) => value + 1)
                                        }
                                    />
                                    <a
                                        className='mh-button inline-flex px-3 py-2'
                                        href={`/activity?uri=${encodeURIComponent(uri)}`}
                                    >
                                        {t('handoff.reviewOffers')}
                                    </a>
                                </div>
                            ) : record.recordOrigin === 'synthetic' ? (
                                <div className='space-y-4'>
                                    <p>{t('handoff.demoRequest')}</p>
                                    <a
                                        href='/posting'
                                        className='mh-button inline-flex px-3 py-2'
                                    >
                                        {t('requestPage.ask')}
                                    </a>
                                </div>
                            ) : !session ? (
                                <div className='space-y-4'>
                                    <p>{t('requestPage.helperHelp')}</p>
                                    <a
                                        className='mh-button inline-flex px-3 py-2'
                                        href={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                                    >
                                        {t('handoff.signInOffer')}
                                    </a>
                                </div>
                            ) : sent ? (
                                <div role='status'>
                                    <p>{t('handoff.offerSent')}</p>
                                    <a
                                        href={`/activity?uri=${encodeURIComponent(uri)}`}
                                        className='underline'
                                    >
                                        {t('handoff.viewActivity')}
                                    </a>
                                </div>
                            ) : record.card.status !== 'open' ? (
                                <p>{t('handoff.notAcceptingOffers')}</p>
                            ) : (
                                <form
                                    className='space-y-3'
                                    onSubmit={(event) => void offer(event)}
                                >
                                    <p>{t('requestPage.helperHelp')}</p>
                                    <p className='text-sm text-mh-textMuted'>
                                        {t('handoff.offerPrivacy')}
                                    </p>
                                    {profileRequired && (
                                        <p role='status'>
                                            {t('requestPage.profileHelp')}{' '}
                                            <a
                                                className='underline'
                                                href='/volunteer'
                                                target='_blank'
                                                rel='noopener noreferrer'
                                            >
                                                {t('requestPage.profile')}
                                            </a>
                                        </p>
                                    )}
                                    <label className='block'>
                                        {t('handoff.offerNote')}
                                        <textarea
                                            className='mh-input mt-2 min-h-28 w-full p-3'
                                            maxLength={1000}
                                            value={note}
                                            onChange={(event) =>
                                                setNote(event.target.value)
                                            }
                                        />
                                    </label>
                                    <Button type='submit' disabled={busy}>
                                        {t(
                                            busy
                                                ? 'handoff.saving'
                                                : 'handoff.offerHelp',
                                        )}
                                    </Button>
                                </form>
                            )}
                            <p className='mt-5 border-t border-mh-borderSoft pt-3 text-sm text-mh-textMuted'>
                                {t('requestPage.sequence')}
                            </p>
                        </Panel>
                    </div>
                </>
            )}
        </section>
    );
}
