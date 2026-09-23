import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { useLocale } from '../i18n';
import {
    consentToExactLocationViaApi,
    fetchExactLocationSessionViaApi,
    revokeExactLocationSessionViaApi,
    sendExactLocationSignalViaApi,
    type ExactLocationSessionState,
    type ExactLocationSignal,
} from './api-client';

type ExchangePhase =
    | 'idle'
    | 'consenting'
    | 'waiting'
    | 'connecting'
    | 'active'
    | 'stopped'
    | 'failed';

interface TransientLocation {
    latitude: number;
    longitude: number;
    capturedAt: string;
}

const isTransientLocation = (value: unknown): value is TransientLocation => {
    if (typeof value !== 'object' || value === null) return false;
    const candidate = value as Record<string, unknown>;
    return (
        candidate['kind'] === 'location' &&
        typeof candidate['latitude'] === 'number' &&
        candidate['latitude'] >= -90 &&
        candidate['latitude'] <= 90 &&
        typeof candidate['longitude'] === 'number' &&
        candidate['longitude'] >= -180 &&
        candidate['longitude'] <= 180 &&
        typeof candidate['capturedAt'] === 'string'
    );
};

export const ExactLocationExchange = ({
    connectionId,
}: {
    connectionId: string;
}) => {
    const { t } = useLocale();
    const [phase, setPhase] = useState<ExchangePhase>('idle');
    const [notice, setNotice] = useState(t('exactLocation.initial'));
    const [received, setReceived] = useState<TransientLocation | null>(null);
    const peerRef = useRef<RTCPeerConnection | null>(null);
    const channelRef = useRef<RTCDataChannel | null>(null);
    const sessionRef = useRef<ExactLocationSessionState['session']>(null);
    const lastSequenceRef = useRef(0);
    const pollingRef = useRef<number | null>(null);
    const expiryRef = useRef<number | null>(null);
    const authenticatedRef = useRef(false);
    const configuringRef = useRef(false);
    const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
    const mountedRef = useRef(true);

    const clearTimers = useCallback(() => {
        if (pollingRef.current !== null) {
            window.clearTimeout(pollingRef.current);
            pollingRef.current = null;
        }
        if (expiryRef.current !== null) {
            window.clearTimeout(expiryRef.current);
            expiryRef.current = null;
        }
    }, []);

    const clearBrowserState = useCallback(() => {
        clearTimers();
        authenticatedRef.current = false;
        configuringRef.current = false;
        lastSequenceRef.current = 0;
        pendingCandidatesRef.current = [];
        sessionRef.current = null;
        setReceived(null);
        const channel = channelRef.current;
        channelRef.current = null;
        channel?.close();
        const peer = peerRef.current;
        peerRef.current = null;
        peer?.close();
    }, [clearTimers]);

    const fail = useCallback(
        (message: string) => {
            clearBrowserState();
            if (!mountedRef.current) return;
            setPhase('failed');
            setNotice(message);
        },
        [clearBrowserState],
    );

    const postSignal = useCallback(
        async (
            signal:
                | {
                      kind: 'description';
                      payload: {
                          type: 'offer' | 'answer';
                          sdp: string;
                      };
                  }
                | {
                      kind: 'candidate';
                      payload: {
                          candidate: string;
                          sdpMid: string | null;
                          sdpMLineIndex: number | null;
                          usernameFragment: string | null;
                      };
                  }
                | {
                      kind: 'end-of-candidates';
                      payload: Record<string, never>;
                  },
        ) => {
            const session = sessionRef.current;
            if (!session) throw new Error('Location session unavailable.');
            const result = await sendExactLocationSignalViaApi({
                connectionId,
                sessionId: session.id,
                ...signal,
            });
            if (!result.ok) throw new Error(result.error);
        },
        [connectionId],
    );

    const wireChannel = useCallback(
        (channel: RTCDataChannel) => {
            channelRef.current = channel;
            channel.onopen = () => {
                const proof = sessionRef.current?.participantProof;
                if (!proof) {
                    fail(t('exactLocation.peerAuthStart'));
                    return;
                }
                channel.send(JSON.stringify({ kind: 'auth', proof }));
            };
            channel.onmessage = (event) => {
                try {
                    if (
                        typeof event.data !== 'string' ||
                        event.data.length > 2_048
                    ) {
                        throw new Error('Peer payload exceeded its boundary.');
                    }
                    const message: unknown = JSON.parse(event.data);
                    if (typeof message !== 'object' || message === null) {
                        throw new Error('Invalid peer payload.');
                    }
                    const record = message as Record<string, unknown>;
                    if (record['kind'] === 'auth') {
                        if (
                            record['proof'] !==
                            sessionRef.current?.expectedPeerProof
                        ) {
                            throw new Error('Peer authentication failed.');
                        }
                        authenticatedRef.current = true;
                        setPhase('active');
                        setNotice(t('exactLocation.active'));
                        return;
                    }
                    if (
                        !authenticatedRef.current ||
                        !isTransientLocation(message)
                    ) {
                        throw new Error('Unauthenticated peer payload.');
                    }
                    setReceived({
                        latitude: message.latitude,
                        longitude: message.longitude,
                        capturedAt: message.capturedAt,
                    });
                } catch {
                    fail(t('exactLocation.invalidData'));
                }
            };
            channel.onerror = () => fail(t('exactLocation.channelFailed'));
            channel.onclose = () => {
                if (authenticatedRef.current) {
                    clearBrowserState();
                    if (mountedRef.current) {
                        setPhase('stopped');
                        setNotice(t('exactLocation.stopped'));
                    }
                }
            };
        },
        [clearBrowserState, fail, t],
    );

    const flushCandidates = useCallback(async () => {
        const peer = peerRef.current;
        if (!peer?.remoteDescription) return;
        const candidates = pendingCandidatesRef.current.splice(0);
        for (const candidate of candidates) {
            await peer.addIceCandidate(candidate);
        }
    }, []);

    const processSignal = useCallback(
        async (signal: ExactLocationSignal) => {
            const peer = peerRef.current;
            const session = sessionRef.current;
            if (!peer || !session) return;
            if (signal.kind === 'description') {
                if (
                    signal.payload.type === 'offer' &&
                    session.role === 'answerer' &&
                    !peer.remoteDescription
                ) {
                    await peer.setRemoteDescription(signal.payload);
                    await flushCandidates();
                    const answer = await peer.createAnswer();
                    await peer.setLocalDescription(answer);
                    await postSignal({
                        kind: 'description',
                        payload: {
                            type: 'answer',
                            sdp: answer.sdp ?? '',
                        },
                    });
                } else if (
                    signal.payload.type === 'answer' &&
                    session.role === 'offerer' &&
                    !peer.remoteDescription
                ) {
                    await peer.setRemoteDescription(signal.payload);
                    await flushCandidates();
                }
            } else if (signal.kind === 'candidate') {
                if (peer.remoteDescription) {
                    await peer.addIceCandidate(signal.payload);
                } else {
                    pendingCandidatesRef.current.push(signal.payload);
                }
            }
        },
        [flushCandidates, postSignal],
    );

    const configurePeer = useCallback(
        async (session: NonNullable<ExactLocationSessionState['session']>) => {
            if (
                configuringRef.current ||
                peerRef.current ||
                !session.participantProof ||
                !session.expectedPeerProof
            ) {
                return;
            }
            configuringRef.current = true;
            sessionRef.current = session;
            if (expiryRef.current === null) {
                const remaining =
                    new Date(session.expiresAt).getTime() - Date.now();
                expiryRef.current = window.setTimeout(
                    () => fail(t('exactLocation.expired')),
                    Math.max(0, remaining),
                );
            }
            setPhase('connecting');
            setNotice(t('exactLocation.establishing'));
            const peer = new RTCPeerConnection({ iceServers: [] });
            peerRef.current = peer;
            peer.onicecandidate = (event) => {
                const operation = event.candidate
                    ? postSignal({
                          kind: 'candidate',
                          payload: {
                              candidate: event.candidate.candidate,
                              sdpMid: event.candidate.sdpMid,
                              sdpMLineIndex: event.candidate.sdpMLineIndex,
                              usernameFragment:
                                  event.candidate.usernameFragment,
                          },
                      })
                    : postSignal({
                          kind: 'end-of-candidates',
                          payload: {},
                      });
                void operation.catch(() =>
                    fail(t('exactLocation.signalingFailed')),
                );
            };
            peer.onconnectionstatechange = () => {
                if (
                    peer.connectionState === 'failed' ||
                    peer.connectionState === 'disconnected'
                ) {
                    fail(t('exactLocation.interrupted'));
                }
            };
            if (session.role === 'offerer') {
                wireChannel(
                    peer.createDataChannel('exact-location', {
                        ordered: true,
                    }),
                );
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                await postSignal({
                    kind: 'description',
                    payload: { type: 'offer', sdp: offer.sdp ?? '' },
                });
            } else {
                peer.ondatachannel = (event) => wireChannel(event.channel);
            }
            configuringRef.current = false;
        },
        [fail, postSignal, t, wireChannel],
    );

    const poll = useCallback(async () => {
        const result = await fetchExactLocationSessionViaApi(
            connectionId,
            lastSequenceRef.current,
        );
        if (!result.ok) {
            fail(t('exactLocation.sharingStopped'));
            return;
        }
        const session = result.data.session;
        if (!session) {
            setPhase('waiting');
            setNotice(t('exactLocation.waiting'));
        } else if (
            session.status === 'revoked' ||
            session.status === 'expired'
        ) {
            fail(t('exactLocation.sessionEnded'));
            return;
        } else {
            if (!sessionRef.current) {
                sessionRef.current = session;
                await configurePeer(session);
            }
            for (const signal of session.signals) {
                await processSignal(signal);
                lastSequenceRef.current = Math.max(
                    lastSequenceRef.current,
                    signal.sequence,
                );
            }
        }
        if (mountedRef.current) {
            pollingRef.current = window.setTimeout(
                () =>
                    void poll().catch(() =>
                        fail(t('exactLocation.establishFailed')),
                    ),
                500,
            );
        }
    }, [configurePeer, connectionId, fail, processSignal, t]);

    const start = async () => {
        clearBrowserState();
        setPhase('consenting');
        setNotice(t('exactLocation.recording'));
        const result = await consentToExactLocationViaApi(connectionId);
        if (!result.ok) {
            fail(t('exactLocation.startFailed'));
            return;
        }
        setPhase(result.data.session ? 'connecting' : 'waiting');
        setNotice(
            result.data.session
                ? t('exactLocation.establishing')
                : t('exactLocation.waiting'),
        );
        if (result.data.session) {
            await configurePeer(result.data.session).catch(() =>
                fail(t('exactLocation.establishFailed')),
            );
        }
        void poll().catch(() => fail(t('exactLocation.establishFailed')));
    };

    const stop = useCallback(async () => {
        clearBrowserState();
        setPhase('stopped');
        setNotice(t('exactLocation.stopped'));
        await revokeExactLocationSessionViaApi(connectionId);
    }, [clearBrowserState, connectionId, t]);

    const share = () => {
        const channel = channelRef.current;
        if (
            phase !== 'active' ||
            !authenticatedRef.current ||
            channel?.readyState !== 'open'
        ) {
            fail(t('exactLocation.inactive'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (
                    !authenticatedRef.current ||
                    channel.readyState !== 'open'
                ) {
                    return;
                }
                channel.send(
                    JSON.stringify({
                        kind: 'location',
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        capturedAt: new Date().toISOString(),
                    }),
                );
                setNotice(t('exactLocation.sent'));
            },
            () => fail(t('exactLocation.permissionFailed')),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 },
        );
    };

    useEffect(() => {
        mountedRef.current = true;
        const clearForPageExit = () => {
            clearBrowserState();
            void revokeExactLocationSessionViaApi(connectionId);
        };
        const clearWhenHidden = () => {
            if (document.visibilityState === 'hidden') clearForPageExit();
        };
        window.addEventListener('pagehide', clearForPageExit);
        document.addEventListener('visibilitychange', clearWhenHidden);
        return () => {
            mountedRef.current = false;
            window.removeEventListener('pagehide', clearForPageExit);
            document.removeEventListener('visibilitychange', clearWhenHidden);
            clearBrowserState();
        };
    }, [clearBrowserState, connectionId]);

    return (
        <div className='mt-3 border-t border-mh-borderSoft pt-3'>
            <h3 className='font-bold'>{t('exactLocation.heading')}</h3>
            <p className='mt-1 text-xs text-mh-textMuted'>
                {t('exactLocation.description')}
            </p>
            <p
                className='mt-2 text-sm'
                role={phase === 'failed' ? 'alert' : 'status'}
            >
                {notice}
            </p>
            <div className='mt-2 flex flex-wrap gap-2'>
                {phase === 'idle' ||
                phase === 'stopped' ||
                phase === 'failed' ? (
                    <Button onClick={() => void start()}>
                        {t('exactLocation.start')}
                    </Button>
                ) : null}
                {phase === 'active' ? (
                    <Button onClick={share}>{t('exactLocation.share')}</Button>
                ) : null}
                {!['idle', 'stopped'].includes(phase) ? (
                    <Button variant='danger' onClick={() => void stop()}>
                        {t('exactLocation.stop')}
                    </Button>
                ) : null}
            </div>
            {received ? (
                <div className='mt-3 rounded border border-mh-borderSoft p-3'>
                    <p className='font-bold'>{t('exactLocation.received')}</p>
                    <p className='font-mono text-sm'>
                        {received.latitude.toFixed(6)},{' '}
                        {received.longitude.toFixed(6)}
                    </p>
                    <p className='text-xs text-mh-textMuted'>
                        {t('exactLocation.cleared')}
                    </p>
                </div>
            ) : null}
        </div>
    );
};
