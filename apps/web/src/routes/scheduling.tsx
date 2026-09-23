import { useCallback, useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type CoordinationConnection,
    type CoordinationWindow,
    fetchCoordinationViaApi,
    fetchCoordinationWindowsViaApi,
    proposeCoordinationWindowViaApi,
    decideCoordinationWindowViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import { accountLabel } from '../features/identity/AccountName';
import { useHandles } from '../features/identity/useHandles';

const localDateTimeWithOffset = (value: string): string => {
    const date = new Date(value);
    const minutes = -date.getTimezoneOffset();
    const sign = minutes >= 0 ? '+' : '-';
    const absolute = Math.abs(minutes);
    const offset = `${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
    return `${value.length === 16 ? `${value}:00` : value}${sign}${offset}`;
};

export const CoordinationSchedulingRoute = ({ did }: { did: string }) => {
    const { t, fmt } = useLocale();
    const [connections, setConnections] = useState<CoordinationConnection[]>(
        [],
    );
    const handles = useHandles(
        connections.map((connection) => connection.counterpartDid),
    );
    const [windows, setWindows] = useState<CoordinationWindow[]>([]);
    const [connectionId, setConnectionId] = useState('');
    const [startAt, setStartAt] = useState('');
    const [endAt, setEndAt] = useState('');
    const [status, setStatus] = useState(String(t('scheduling.loading')));
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setStatus(String(t('scheduling.loading')));
        const [coordination, scheduling] = await Promise.all([
            fetchCoordinationViaApi(),
            fetchCoordinationWindowsViaApi(),
        ]);
        if (!coordination.ok || !scheduling.ok) {
            setStatus(
                `${t('common.error')}: ${!coordination.ok ? coordination.error : !scheduling.ok ? scheduling.error : ''}`,
            );
            return;
        }
        const active = coordination.data.connections.filter(
            (connection) => connection.status === 'active',
        );
        setConnections(active);
        setWindows(scheduling.data.windows);
        setConnectionId((current) => current || active[0]?.id || '');
        setStatus(
            active.length === 0
                ? String(t('scheduling.empty'))
                : String(t('scheduling.ready')),
        );
    }, [t]);

    useEffect(() => {
        void load();
    }, [load]);
    const current = windows.find(
        (window) => window.connectionId === connectionId,
    );
    const canPropose =
        !current ||
        (current.status === 'proposed' && current.recipientDid === did);

    const finish = async (
        operation: Promise<{ ok: boolean; error?: string }>,
    ) => {
        setBusy(true);
        setStatus(String(t('scheduling.saving')));
        const result = await operation;
        setBusy(false);
        if (!result.ok) {
            setStatus(
                `${t('common.error')}: ${result.error ?? t('scheduling.failed')}`,
            );
            return;
        }
        setStartAt('');
        setEndAt('');
        await load();
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('scheduling.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('scheduling.description')}
                </p>
                <p
                    role={
                        status.startsWith(String(t('common.error')))
                            ? 'alert'
                            : 'status'
                    }
                    className='mt-2 text-sm font-bold'
                >
                    {status}
                </p>
            </header>
            <Panel title={String(t('scheduling.proposeHeading'))}>
                {connections.length === 0 ? (
                    <p>{t('scheduling.empty')}</p>
                ) : (
                    <form
                        className='space-y-4'
                        onSubmit={(event) => {
                            event.preventDefault();
                            if (!connectionId || !startAt || !endAt) return;
                            const timezone =
                                Intl.DateTimeFormat().resolvedOptions()
                                    .timeZone || 'UTC';
                            void finish(
                                proposeCoordinationWindowViaApi({
                                    connectionId,
                                    startAt: localDateTimeWithOffset(startAt),
                                    endAt: localDateTimeWithOffset(endAt),
                                    timezone,
                                    ...(current
                                        ? { expectedVersion: current.version }
                                        : {}),
                                }),
                            );
                        }}
                    >
                        <label className='block text-sm font-bold'>
                            {t('scheduling.connection')}
                            <select
                                className='mh-input mt-1 w-full px-3 py-2'
                                value={connectionId}
                                onChange={(event) =>
                                    setConnectionId(event.target.value)
                                }
                                disabled={busy}
                            >
                                {connections.map((connection) => (
                                    <option
                                        key={connection.id}
                                        value={connection.id}
                                    >
                                        {accountLabel(
                                            connection.counterpartDid,
                                            handles,
                                        )}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className='grid gap-3 sm:grid-cols-2'>
                            <label className='text-sm font-bold'>
                                {t('scheduling.start')}
                                <Input
                                    type='datetime-local'
                                    required
                                    value={startAt}
                                    onChange={(event) =>
                                        setStartAt(event.target.value)
                                    }
                                    disabled={busy || !canPropose}
                                />
                            </label>
                            <label className='text-sm font-bold'>
                                {t('scheduling.end')}
                                <Input
                                    type='datetime-local'
                                    required
                                    value={endAt}
                                    onChange={(event) =>
                                        setEndAt(event.target.value)
                                    }
                                    disabled={busy || !canPropose}
                                />
                            </label>
                        </div>
                        <Button type='submit' disabled={busy || !canPropose}>
                            {current
                                ? t('scheduling.counter')
                                : t('scheduling.propose')}
                        </Button>
                    </form>
                )}
            </Panel>
            <Panel title={String(t('scheduling.currentHeading'))}>
                {!current ? (
                    <p>{t('scheduling.noProposal')}</p>
                ) : (
                    <Card
                        title={String(t(`scheduling.status.${current.status}`))}
                    >
                        <p>
                            {fmt.longDate(current.startAt)} –{' '}
                            {fmt.longDate(current.endAt)}
                        </p>
                        <p className='mt-1 text-xs text-mh-textMuted'>
                            {current.timezone}
                        </p>
                        {current.status === 'proposed' &&
                        current.recipientDid === did ? (
                            <div className='mt-3 flex flex-wrap gap-2'>
                                <Button
                                    disabled={busy}
                                    onClick={() =>
                                        void finish(
                                            decideCoordinationWindowViaApi({
                                                connectionId,
                                                action: 'accept',
                                                expectedVersion:
                                                    current.version,
                                            }),
                                        )
                                    }
                                >
                                    {t('scheduling.accept')}
                                </Button>
                                <Button
                                    variant='secondary'
                                    disabled={busy}
                                    onClick={() =>
                                        void finish(
                                            decideCoordinationWindowViaApi({
                                                connectionId,
                                                action: 'decline',
                                                expectedVersion:
                                                    current.version,
                                            }),
                                        )
                                    }
                                >
                                    {t('scheduling.decline')}
                                </Button>
                            </div>
                        ) : null}
                        {current.status === 'confirmed' ? (
                            <Button
                                className='mt-3'
                                variant='secondary'
                                disabled={busy}
                                onClick={() =>
                                    void finish(
                                        decideCoordinationWindowViaApi({
                                            connectionId,
                                            action: 'cancel',
                                            expectedVersion: current.version,
                                        }),
                                    )
                                }
                            >
                                {t('scheduling.cancel')}
                            </Button>
                        ) : null}
                    </Card>
                )}
            </Panel>
        </section>
    );
};
