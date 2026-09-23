import { useCallback, useEffect, useState } from 'react';
import { defaultDiscoveryFilterState } from '../discovery-filters';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type ActivityInboxItem,
    type CoordinationConnection,
    type CoordinationOffer,
    type MatchCandidate,
    type OutcomeFeedback,
    createCoordinationOfferViaApi,
    fetchActivityInboxViaApi,
    fetchCoordinationViaApi,
    fetchFeedRecordsFromApi,
    fetchMyOutcomeFeedbackViaApi,
    decideCoordinationOfferViaApi,
    markActivityInboxReadViaApi,
    matchRequestViaApi,
    transitionCoordinationConnectionViaApi,
    submitOutcomeFeedbackViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import { ExactLocationExchange } from '../features/exact-location-exchange';
import { type FeedRecordEnvelope } from '../features/discovery-runtime';
import {
    formatLocalizedLabel,
    parseCommaList,
} from '../features/shell-shared';

const outcomeOptions = [
    'successful',
    'partially-successful',
    'unsuccessful',
    'no-response',
    'cancelled',
] as const;

export const CoordinationInboxRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [offers, setOffers] = useState<CoordinationOffer[]>([]);
    const [connections, setConnections] = useState<CoordinationConnection[]>(
        [],
    );
    const [items, setItems] = useState<ActivityInboxItem[]>([]);
    const [feedback, setFeedback] = useState<OutcomeFeedback[]>([]);
    const [requests, setRequests] = useState<FeedRecordEnvelope[]>([]);
    const [matches, setMatches] = useState<
        Readonly<Record<string, MatchCandidate[]>>
    >({});
    const [offerRequestUri, setOfferRequestUri] = useState<string>();
    const [offerNote, setOfferNote] = useState('');
    const [languages, setLanguages] = useState('en');
    const [accessibility, setAccessibility] = useState('');
    const [outcomes, setOutcomes] = useState<
        Readonly<
            Record<
                string,
                {
                    outcome: (typeof outcomeOptions)[number];
                    rating: number;
                    comment: string;
                    safetyConcern: boolean;
                }
            >
        >
    >({});
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [status, setStatus] = useState(t('inbox.loading'));

    const load = useCallback(async () => {
        setStatus(t('inbox.loading'));
        const [coordination, inbox, outcomeHistory, discoverable] =
            await Promise.all([
                fetchCoordinationViaApi(),
                fetchActivityInboxViaApi(unreadOnly),
                fetchMyOutcomeFeedbackViaApi(),
                fetchFeedRecordsFromApi(defaultDiscoveryFilterState, 'feed'),
            ]);
        const failure = [
            coordination,
            inbox,
            outcomeHistory,
            discoverable,
        ].find((result) => !result.ok);
        if (failure && !failure.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        if (
            coordination.ok &&
            inbox.ok &&
            outcomeHistory.ok &&
            discoverable.ok
        ) {
            setOffers(coordination.data.offers);
            setConnections(coordination.data.connections);
            setItems(inbox.data.items);
            setFeedback(outcomeHistory.data.feedback);
            setRequests(discoverable.data);
            setStatus(t('inbox.unreadCount', { count: inbox.data.unread }));
        }
    }, [unreadOnly, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const finish = async (
        pendingMessage: string,
        operation: Promise<{ ok: boolean; error?: string }>,
    ) => {
        setStatus(pendingMessage);
        const result = await operation;
        if (!result.ok) {
            setStatus(
                `${t('common.error')}: ${result.error ? t('common.requestFailed') : t('inbox.actionFailed')}`,
            );
            return;
        }
        await load();
    };

    const ownedRequests = requests.filter(
        (request) => request.recipientDid === did,
    );
    const availableRequests = requests.filter(
        (request) => request.recipientDid !== did,
    );
    const offerRequest = offerRequestUri
        ? availableRequests.find(
              (request) => request.aidPostUri === offerRequestUri,
          )
        : undefined;

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('inbox.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('inbox.description')}
                </p>
                <p
                    className='mt-2 text-sm font-bold'
                    role={status.startsWith('Error:') ? 'alert' : 'status'}
                >
                    {status}
                </p>
                <a
                    className='mt-3 inline-block font-bold underline'
                    href='/scheduling'
                >
                    {t('inbox.openScheduling')}
                </a>
            </header>

            <Panel title={String(t('inbox.discover'))}>
                {availableRequests.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noRequests')}
                    </p>
                ) : (
                    <div className='grid gap-3 sm:grid-cols-2'>
                        {availableRequests.map((request) => (
                            <Card
                                key={request.aidPostUri}
                                title={request.card.title}
                            >
                                <p className='text-sm'>
                                    {request.card.description}
                                </p>
                                <p className='mt-2 text-xs text-mh-textMuted'>
                                    {formatLocalizedLabel(
                                        t,
                                        request.card.category,
                                    )}{' '}
                                    ·{' '}
                                    {formatLocalizedLabel(
                                        t,
                                        request.card.status,
                                    )}
                                </p>
                                <Button
                                    className='mt-3'
                                    aria-label={t('inbox.offerHelpFor', {
                                        title: request.card.title,
                                    })}
                                    onClick={() => {
                                        setOfferRequestUri(request.aidPostUri);
                                        setOfferNote('');
                                    }}
                                >
                                    {t('inbox.offerHelp')}
                                </Button>
                            </Card>
                        ))}
                    </div>
                )}
            </Panel>

            {offerRequest ? (
                <div
                    role='dialog'
                    aria-modal='true'
                    aria-labelledby='offer-help-title'
                    className='fixed inset-0 z-50 grid place-items-center bg-black/60 p-4'
                >
                    <section className='mh-card w-full max-w-xl space-y-4 p-5'>
                        <div>
                            <h2 id='offer-help-title' className='font-heading text-xl font-bold'>
                                {t('inbox.offerHelpFor', {
                                    title: offerRequest.card.title,
                                })}
                            </h2>
                            <p className='mt-1 text-sm text-mh-textMuted'>
                                {offerRequest.card.description}
                            </p>
                        </div>
                        <label className='block text-sm font-bold'>
                            {t('inbox.note')}
                            <textarea
                                autoFocus
                                className='mh-input mt-1 min-h-24 w-full px-3 py-2'
                                maxLength={1000}
                                value={offerNote}
                                onChange={(event) => setOfferNote(event.target.value)}
                            />
                        </label>
                        <div className='flex flex-wrap justify-end gap-2'>
                            <Button
                                variant='neutral'
                                onClick={() => setOfferRequestUri(undefined)}
                            >
                                {t('inbox.cancel')}
                            </Button>
                            <Button
                                onClick={() => {
                                    const requestUri = offerRequest.aidPostUri;
                                    setOfferRequestUri(undefined);
                                    void finish(
                                        t('inbox.sendingOffer'),
                                        createCoordinationOfferViaApi({
                                            requestUri,
                                            note: offerNote.trim() || null,
                                        }),
                                    );
                                }}
                            >
                                {t('inbox.offerHelp')}
                            </Button>
                        </div>
                    </section>
                </div>
            ) : null}

            <Panel title={String(t('inbox.offers'))}>
                {offers.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noOffers')}
                    </p>
                ) : (
                    <div className='space-y-3'>
                        {offers.map((offer) => (
                            <Card
                                key={offer.id}
                                title={t('inbox.offerTitle', {
                                    direction: formatLocalizedLabel(
                                        t,
                                        offer.direction,
                                    ),
                                })}
                            >
                                <div className='flex flex-wrap gap-2'>
                                    <Badge
                                        tone={
                                            offer.status === 'accepted'
                                                ? 'success'
                                                : offer.status === 'pending'
                                                  ? 'info'
                                                  : 'neutral'
                                        }
                                    >
                                        {formatLocalizedLabel(t, offer.status)}
                                    </Badge>
                                    <span className='text-xs text-mh-textMuted'>
                                        {t('inbox.expires', {
                                            date: fmt.longDate(offer.expiresAt),
                                        })}
                                    </span>
                                </div>
                                {offer.note ? (
                                    <p className='mt-2 text-sm'>{offer.note}</p>
                                ) : null}
                                {offer.status === 'accepted' ? (
                                    <p className='mt-2 break-all text-xs'>
                                        {t('inbox.requester', {
                                            did: offer.requesterDid,
                                        })}
                                        <br />
                                        {t('inbox.helper', {
                                            did: offer.helperDid,
                                        })}
                                    </p>
                                ) : (
                                    <p className='mt-2 text-xs text-mh-textMuted'>
                                        {t('inbox.privateIdentity')}
                                    </p>
                                )}
                                {offer.status === 'pending' ? (
                                    <div className='mt-3 flex flex-wrap gap-2'>
                                        {offer.direction === 'received' ? (
                                            <>
                                                <Button
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.acceptingOffer',
                                                            ),
                                                            decideCoordinationOfferViaApi(
                                                                {
                                                                    offerId:
                                                                        offer.id,
                                                                    decision:
                                                                        'accept',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.accept')}
                                                </Button>
                                                <Button
                                                    variant='secondary'
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.decliningOffer',
                                                            ),
                                                            decideCoordinationOfferViaApi(
                                                                {
                                                                    offerId:
                                                                        offer.id,
                                                                    decision:
                                                                        'decline',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.decline')}
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                variant='secondary'
                                                onClick={() =>
                                                    void finish(
                                                        t(
                                                            'inbox.cancellingOffer',
                                                        ),
                                                        decideCoordinationOfferViaApi(
                                                            {
                                                                offerId:
                                                                    offer.id,
                                                                decision:
                                                                    'cancel',
                                                            },
                                                        ),
                                                    )
                                                }
                                            >
                                                {t('inbox.cancelOffer')}
                                            </Button>
                                        )}
                                    </div>
                                ) : null}
                            </Card>
                        ))}
                    </div>
                )}
            </Panel>

            <Panel title={String(t('inbox.matching'))}>
                <p className='mb-3 text-sm text-mh-textMuted'>
                    {t('inbox.matchingHelp')}
                </p>
                <div className='grid gap-3 sm:grid-cols-2'>
                    <label className='text-sm font-bold'>
                        {t('inbox.languages')}
                        <Input
                            value={languages}
                            onChange={(event) =>
                                setLanguages(event.target.value)
                            }
                            placeholder={t('inbox.languagesPlaceholder')}
                        />
                    </label>
                    <label className='text-sm font-bold'>
                        {t('inbox.accessibility')}
                        <Input
                            value={accessibility}
                            onChange={(event) =>
                                setAccessibility(event.target.value)
                            }
                            placeholder={t('inbox.accessibilityPlaceholder')}
                        />
                    </label>
                </div>
                {ownedRequests.length === 0 ? (
                    <p className='mt-3 text-sm text-mh-textMuted'>
                        {t('inbox.publishFirst')}
                    </p>
                ) : (
                    ownedRequests.map((request) => (
                        <div
                            key={request.aidPostUri}
                            className='mt-4 border-t border-mh-borderSoft pt-4'
                        >
                            <div className='flex flex-wrap items-center justify-between gap-2'>
                                <h2 className='font-bold'>
                                    {request.card.title}
                                </h2>
                                <Button
                                    onClick={() =>
                                        void (async () => {
                                            setStatus(t('inbox.ranking'));
                                            const result =
                                                await matchRequestViaApi({
                                                    requestUri:
                                                        request.aidPostUri,
                                                    requiredLanguages:
                                                        parseCommaList(
                                                            languages,
                                                        ),
                                                    accessibilityNeeds:
                                                        parseCommaList(
                                                            accessibility,
                                                        ),
                                                });
                                            if (!result.ok) {
                                                setStatus(
                                                    `${t('common.error')}: ${t('common.requestFailed')}`,
                                                );
                                                return;
                                            }
                                            setMatches((current) => ({
                                                ...current,
                                                [request.aidPostUri]:
                                                    result.data.candidates,
                                            }));
                                            setStatus(
                                                t('inbox.ranked', {
                                                    count: result.data
                                                        .candidates.length,
                                                }),
                                            );
                                        })()
                                    }
                                >
                                    {t('inbox.find')}
                                </Button>
                            </div>
                            <ol className='mt-3 space-y-2'>
                                {(matches[request.aidPostUri] ?? []).map(
                                    (candidate) => (
                                        <li
                                            key={candidate.candidateRef}
                                            className='rounded border border-mh-borderSoft p-3'
                                        >
                                            <p className='font-bold'>
                                                #{candidate.rank}{' '}
                                                {candidate.label}
                                            </p>
                                            <p className='text-xs text-mh-textMuted'>
                                                {candidate.kind} ·{' '}
                                                {candidate.availability} ·{' '}
                                                {t('inbox.verification', {
                                                    status: candidate.verification,
                                                })}
                                            </p>
                                            <ul className='mt-2 list-disc pl-5 text-sm'>
                                                {candidate.explanations.map(
                                                    (explanation) => (
                                                        <li key={explanation}>
                                                            {explanation}
                                                        </li>
                                                    ),
                                                )}
                                            </ul>
                                            <p className='mt-2 text-xs font-bold'>
                                                {t('inbox.manual')}
                                            </p>
                                        </li>
                                    ),
                                )}
                            </ol>
                        </div>
                    ))
                )}
            </Panel>

            <Panel title={String(t('inbox.connections'))}>
                {connections.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noConnections')}
                    </p>
                ) : (
                    <div className='space-y-3'>
                        {connections.map((connection) => {
                            const submittedFeedback = feedback.find(
                                (entry) => entry.connectionId === connection.id,
                            );
                            const alreadySubmitted = Boolean(submittedFeedback);
                            const draft = outcomes[connection.id] ?? {
                                outcome: 'successful',
                                rating: 5,
                                comment: '',
                                safetyConcern: false,
                            };
                            return (
                                <Card
                                    key={connection.id}
                                    title={t('inbox.connectionTitle', {
                                        status: formatLocalizedLabel(
                                            t,
                                            connection.status,
                                        ),
                                    })}
                                >
                                    <p className='break-all text-xs'>
                                        {t('inbox.connected', {
                                            did: connection.counterpartDid,
                                        })}
                                    </p>
                                    {connection.status === 'active' ? (
                                        <>
                                            <ExactLocationExchange
                                                connectionId={connection.id}
                                            />
                                            <div className='mt-3 flex flex-wrap gap-2'>
                                                <Button
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.completing',
                                                            ),
                                                            transitionCoordinationConnectionViaApi(
                                                                {
                                                                    connectionId:
                                                                        connection.id,
                                                                    action: 'complete',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.complete')}
                                                </Button>
                                                <Button
                                                    variant='secondary'
                                                    onClick={() =>
                                                        void finish(
                                                            t(
                                                                'inbox.cancellingConnection',
                                                            ),
                                                            transitionCoordinationConnectionViaApi(
                                                                {
                                                                    connectionId:
                                                                        connection.id,
                                                                    action: 'cancel',
                                                                },
                                                            ),
                                                        )
                                                    }
                                                >
                                                    {t('inbox.cancel')}
                                                </Button>
                                            </div>
                                        </>
                                    ) : connection.status === 'completed' &&
                                      !alreadySubmitted ? (
                                        <form
                                            className='mt-3 space-y-3 border-t border-mh-borderSoft pt-3'
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                void finish(
                                                    t('inbox.savingOutcome'),
                                                    submitOutcomeFeedbackViaApi(
                                                        {
                                                            connectionId:
                                                                connection.id,
                                                            outcome:
                                                                draft.outcome,
                                                            rating: draft.rating,
                                                            comment:
                                                                draft.comment.trim() ||
                                                                null,
                                                            tags: draft.safetyConcern
                                                                ? [
                                                                      'safety-concern',
                                                                  ]
                                                                : [],
                                                        },
                                                    ),
                                                );
                                            }}
                                        >
                                            <h3 className='font-bold'>
                                                {t('inbox.recordOutcome')}
                                            </h3>
                                            <div className='grid gap-3 sm:grid-cols-2'>
                                                <label className='text-sm font-bold'>
                                                    {t('inbox.outcome')}
                                                    <select
                                                        className='mh-input mt-1 w-full px-3 py-2'
                                                        value={draft.outcome}
                                                        onChange={(event) =>
                                                            setOutcomes(
                                                                (current) => ({
                                                                    ...current,
                                                                    [connection.id]:
                                                                        {
                                                                            ...draft,
                                                                            outcome:
                                                                                event
                                                                                    .target
                                                                                    .value as (typeof outcomeOptions)[number],
                                                                        },
                                                                }),
                                                            )
                                                        }
                                                    >
                                                        {outcomeOptions.map(
                                                            (value) => (
                                                                <option
                                                                    key={value}
                                                                    value={
                                                                        value
                                                                    }
                                                                >
                                                                    {formatLocalizedLabel(
                                                                        t,
                                                                        value,
                                                                    )}
                                                                </option>
                                                            ),
                                                        )}
                                                    </select>
                                                </label>
                                                <label className='text-sm font-bold'>
                                                    {t('inbox.rating')}
                                                    <Input
                                                        type='number'
                                                        min={1}
                                                        max={5}
                                                        value={draft.rating}
                                                        onChange={(event) =>
                                                            setOutcomes(
                                                                (current) => ({
                                                                    ...current,
                                                                    [connection.id]:
                                                                        {
                                                                            ...draft,
                                                                            rating: Number(
                                                                                event
                                                                                    .target
                                                                                    .value,
                                                                            ),
                                                                        },
                                                                }),
                                                            )
                                                        }
                                                    />
                                                </label>
                                            </div>
                                            <label className='block text-sm font-bold'>
                                                {t('inbox.comment')}
                                                <textarea
                                                    className='mh-input mt-1 min-h-20 w-full px-3 py-2'
                                                    maxLength={2000}
                                                    value={draft.comment}
                                                    onChange={(event) =>
                                                        setOutcomes(
                                                            (current) => ({
                                                                ...current,
                                                                [connection.id]:
                                                                    {
                                                                        ...draft,
                                                                        comment:
                                                                            event
                                                                                .target
                                                                                .value,
                                                                    },
                                                            }),
                                                        )
                                                    }
                                                />
                                            </label>
                                            <label className='block text-sm'>
                                                <input
                                                    type='checkbox'
                                                    checked={
                                                        draft.safetyConcern
                                                    }
                                                    onChange={(event) =>
                                                        setOutcomes(
                                                            (current) => ({
                                                                ...current,
                                                                [connection.id]:
                                                                    {
                                                                        ...draft,
                                                                        safetyConcern:
                                                                            event
                                                                                .target
                                                                                .checked,
                                                                    },
                                                            }),
                                                        )
                                                    }
                                                />{' '}
                                                {t('inbox.safety')}
                                            </label>
                                            <Button type='submit'>
                                                {t('inbox.submitOutcome')}
                                            </Button>
                                        </form>
                                    ) : alreadySubmitted ? (
                                        <p className='mt-3 text-sm text-mh-textMuted'>
                                            {submittedFeedback?.tags.includes(
                                                'safety-concern',
                                            )
                                                ? t('inbox.recordedSafety')
                                                : t('inbox.recorded')}
                                        </p>
                                    ) : null}
                                </Card>
                            );
                        })}
                    </div>
                )}
            </Panel>

            <Panel title={String(t('inbox.activity'))}>
                <label className='mb-3 block text-sm'>
                    <input
                        type='checkbox'
                        checked={unreadOnly}
                        onChange={(event) =>
                            setUnreadOnly(event.target.checked)
                        }
                    />{' '}
                    {t('inbox.unreadOnly')}
                </label>
                {items.length === 0 ? (
                    <p className='text-sm text-mh-textMuted'>
                        {t('inbox.noActivity')}
                    </p>
                ) : (
                    <div className='space-y-2'>
                        {items.map((item) => (
                            <Card key={item.id} title={item.title}>
                                <p className='text-sm'>{item.summary}</p>
                                <p className='mt-1 text-xs text-mh-textMuted'>
                                    {formatLocalizedLabel(t, item.type)} ·{' '}
                                    {fmt.longDate(item.occurredAt)}
                                </p>
                                {!item.readAt ? (
                                    <Button
                                        className='mt-3'
                                        variant='neutral'
                                        aria-label={t('inbox.markReadFor', {
                                            title: item.title,
                                        })}
                                        onClick={() =>
                                            void finish(
                                                t('inbox.markingRead'),
                                                markActivityInboxReadViaApi(
                                                    item.id,
                                                ),
                                            )
                                        }
                                    >
                                        {t('inbox.markRead')}
                                    </Button>
                                ) : null}
                            </Card>
                        ))}
                    </div>
                )}
            </Panel>
        </section>
    );
};
