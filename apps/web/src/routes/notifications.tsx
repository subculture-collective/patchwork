import {
    useCallback,
    useEffect,
    useState,
    type FormEvent,
} from 'react';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Input } from '../components/Input';
import { Panel } from '../components/Panel';
import {
    type NotificationChannelState,
    fetchAccountPreferencesViaApi,
    fetchNotificationChannelsViaApi,
    fetchNotificationsViaApi,
    markAllNotificationsReadViaApi,
    markNotificationReadViaApi,
    requestNotificationEmailVerificationViaApi,
    confirmNotificationEmailViaApi,
    disableNotificationEmailViaApi,
    archiveNotificationViaApi,
    registerPushSubscriptionViaApi,
    revokePushSubscriptionViaApi,
    updateAccountPreferencesViaApi,
} from '../features/api-client';
import { useLocale } from '../i18n';
import { type Notification as DurableNotification, type NotificationFilter } from '@patchwork/shared';

const applicationServerKey = (value: string): ArrayBuffer => {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
    const decoded = window.atob(base64);
    const buffer = new ArrayBuffer(decoded.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
    }
    return buffer;
};

export const NotificationCenterRoute = () => {
    const { t, fmt } = useLocale();
    const [notifications, setNotifications] = useState<DurableNotification[]>(
        [],
    );
    const [filter, setFilter] = useState<NotificationFilter>('all');
    const [total, setTotal] = useState(0);
    const [unread, setUnread] = useState(0);
    const [nextCursor, setNextCursor] = useState<string>();
    const [channels, setChannels] = useState<NotificationChannelState>();
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState(t('notifications.loading'));
    const [isLoading, setIsLoading] = useState(true);

    const load = useCallback(async () => {
        setIsLoading(true);
        const [items, channelState] = await Promise.all([
            fetchNotificationsViaApi({ filter }),
            fetchNotificationChannelsViaApi(),
        ]);
        if (!items.ok || !channelState.ok) {
            setStatus(
                `${t('common.error')}: ${t('notifications.unavailable')}`,
            );
            setIsLoading(false);
            return;
        }
        setNotifications(items.data.items);
        setTotal(items.data.total);
        setUnread(items.data.unread);
        setNextCursor(items.data.nextCursor);
        setChannels(channelState.data);
        setEmail(channelState.data.email?.address ?? '');
        setStatus(t('notifications.unreadCount', { count: items.data.unread }));
        setIsLoading(false);
    }, [filter, t]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        const token = new URLSearchParams(window.location.search).get(
            'emailToken',
        );
        if (!token) return;
        void confirmNotificationEmailViaApi(token).then((result) => {
            setStatus(
                result.ok
                    ? t('notifications.emailConfirmed')
                    : `${t('common.error')}: ${t('common.requestFailed')}`,
            );
            window.history.replaceState({}, '', '/notifications');
            if (result.ok) void load();
        });
    }, [load]);

    const updateChannelPreference = async (
        channel: 'inApp' | 'email' | 'push',
        enabled: boolean,
    ) => {
        const current = await fetchAccountPreferencesViaApi();
        if (!current.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return false;
        }
        const updated = await updateAccountPreferencesViaApi({
            ...current.data,
            notifications: {
                ...current.data.notifications,
                [channel]: enabled,
            },
        });
        if (!updated.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return false;
        }
        return true;
    };

    const markRead = async (
        notification: DurableNotification,
        read: boolean,
    ) => {
        const result = await markNotificationReadViaApi(notification.id, read);
        if (result.ok) await load();
        setStatus(
            result.ok
                ? read
                    ? t('notifications.markedRead')
                    : t('notifications.markedUnread')
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const markAllRead = async () => {
        const result = await markAllNotificationsReadViaApi();
        if (result.ok) await load();
        setStatus(
            result.ok
                ? t('notifications.markedAll', { count: result.data.updated })
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const archive = async (notification: DurableNotification) => {
        const result = await archiveNotificationViaApi(notification.id);
        if (result.ok) await load();
        setStatus(
            result.ok
                ? t('notifications.archived')
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const result = await requestNotificationEmailVerificationViaApi(email);
        const preferenceEnabled = result.ok
            ? await updateChannelPreference('email', true)
            : false;
        setStatus(
            result.ok && preferenceEnabled
                ? t('notifications.emailSent')
                : !result.ok
                  ? `${t('common.error')}: ${t('common.requestFailed')}`
                  : `${t('common.error')}: ${t('notifications.emailPreferenceFailed')}`,
        );
    };

    const disableEmail = async () => {
        const result = await disableNotificationEmailViaApi();
        if (result.ok) {
            await updateChannelPreference('email', false);
            await load();
        }
        setStatus(
            result.ok
                ? t('notifications.emailDisabled')
                : `${t('common.error')}: ${t('common.requestFailed')}`,
        );
    };

    const enablePush = async () => {
        try {
            if (
                !channels?.push.supported ||
                !channels.push.publicKey ||
                !('serviceWorker' in navigator) ||
                !('PushManager' in window)
            ) {
                setStatus(
                    `${t('common.error')}: ${t('notifications.pushUnavailable')}`,
                );
                return;
            }
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                setStatus(t('notifications.pushDenied'));
                return;
            }
            if (!(await updateChannelPreference('push', true))) return;
            await navigator.serviceWorker.register('/push-service-worker.js', {
                scope: '/',
            });
            const registration = await navigator.serviceWorker.ready;
            const existing = await registration.pushManager.getSubscription();
            const subscription =
                existing ??
                (await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: applicationServerKey(
                        channels.push.publicKey,
                    ),
                }));
            const serialized = subscription.toJSON();
            if (
                !serialized.endpoint ||
                !serialized.keys?.p256dh ||
                !serialized.keys.auth
            ) {
                throw new Error(t('notifications.pushIncomplete'));
            }
            const result = await registerPushSubscriptionViaApi({
                endpoint: serialized.endpoint,
                keys: {
                    p256dh: serialized.keys.p256dh,
                    auth: serialized.keys.auth,
                },
            });
            if (!result.ok) throw new Error(result.error);
            await load();
            setStatus(t('notifications.pushEnabled'));
        } catch (error) {
            await updateChannelPreference('push', false);
            setStatus(
                `${t('common.error')}: ${error instanceof Error && error.message === t('notifications.pushIncomplete') ? error.message : t('notifications.pushEnableFailed')}`,
            );
        }
    };

    const disablePush = async () => {
        try {
            const registration =
                'serviceWorker' in navigator
                    ? await navigator.serviceWorker.getRegistration('/')
                    : undefined;
            const subscription =
                await registration?.pushManager.getSubscription();
            const result = await revokePushSubscriptionViaApi(
                subscription?.endpoint,
            );
            if (!result.ok) throw new Error(result.error);
            await subscription?.unsubscribe();
            await updateChannelPreference('push', false);
            await load();
            setStatus(t('notifications.pushRevoked'));
        } catch (error) {
            setStatus(
                `${t('common.error')}: ${t('notifications.pushRevokeFailed')}`,
            );
        }
    };

    const loadMore = async () => {
        if (!nextCursor) return;
        const result = await fetchNotificationsViaApi({
            filter,
            cursor: nextCursor,
        });
        if (!result.ok) {
            setStatus(`${t('common.error')}: ${t('common.requestFailed')}`);
            return;
        }
        setNotifications((current) => [...current, ...result.data.items]);
        setNextCursor(result.data.nextCursor);
    };

    return (
        <section className='space-y-6'>
            <header className='mh-route-header'>
                <h1 className='mh-route-title'>{t('notifications.heading')}</h1>
                <p className='mt-2 text-sm text-mh-textMuted'>
                    {t('notifications.description')}
                </p>
            </header>
            <Panel title={String(t('notifications.delivery'))}>
                <p className='text-sm'>{t('notifications.privacy')}</p>
                <div className='mt-4 grid gap-4 md:grid-cols-2'>
                    <form className='space-y-2' onSubmit={verifyEmail}>
                        <label
                            htmlFor='notification-email'
                            className='block text-sm font-bold'
                        >
                            {t('notifications.email')}
                        </label>
                        <Input
                            id='notification-email'
                            type='email'
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            required
                        />
                        <p className='text-xs text-mh-textMuted'>
                            {channels?.email?.verified
                                ? t('notifications.verified')
                                : t('notifications.unverified')}
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            <Button type='submit'>
                                {t('notifications.confirm')}
                            </Button>
                            {channels?.email ? (
                                <Button
                                    type='button'
                                    variant='neutral'
                                    onClick={() => void disableEmail()}
                                >
                                    {t('notifications.disableEmail')}
                                </Button>
                            ) : null}
                        </div>
                    </form>
                    <div className='space-y-2'>
                        <h3 className='text-sm font-bold'>
                            {t('notifications.push')}
                        </h3>
                        <p className='text-xs text-mh-textMuted'>
                            {t('notifications.pushCount', {
                                count: channels?.push.activeSubscriptions ?? 0,
                            })}
                        </p>
                        <div className='flex flex-wrap gap-2'>
                            <Button
                                type='button'
                                onClick={() => void enablePush()}
                                disabled={!channels?.push.supported}
                            >
                                {t('notifications.enablePush')}
                            </Button>
                            <Button
                                type='button'
                                variant='neutral'
                                onClick={() => void disablePush()}
                                disabled={
                                    (channels?.push.activeSubscriptions ?? 0) ===
                                    0
                                }
                            >
                                {t('notifications.revokePush')}
                            </Button>
                        </div>
                    </div>
                </div>
            </Panel>
            <Panel title={String(t('notifications.updates'))}>
                <div className='mb-4 flex flex-wrap items-end gap-3'>
                    <label className='text-sm font-bold'>
                        {t('notifications.show')}
                        <select
                            className='mh-input ml-2 px-3 py-2'
                            aria-label={String(t('notifications.filter'))}
                            value={filter}
                            onChange={(event) =>
                                setFilter(
                                    event.target.value as NotificationFilter,
                                )
                            }
                        >
                            <option value='all'>
                                {t('notifications.active')}
                            </option>
                            <option value='unread'>
                                {t('notifications.unread')}
                            </option>
                            <option value='read'>
                                {t('notifications.read')}
                            </option>
                            <option value='archived'>
                                {t('notifications.archived')}
                            </option>
                        </select>
                    </label>
                    <Badge tone={unread ? 'info' : 'neutral'}>
                        {t('notifications.counts', { unread, total })}
                    </Badge>
                    <Button
                        type='button'
                        variant='neutral'
                        onClick={() => void markAllRead()}
                        disabled={unread === 0}
                    >
                        {t('notifications.markAll')}
                    </Button>
                    <Button
                        type='button'
                        variant='neutral'
                        onClick={() => void load()}
                    >
                        {t('notifications.refresh')}
                    </Button>
                </div>
                {isLoading ? (
                    <p role='status'>{t('notifications.loading')}</p>
                ) : notifications.length === 0 ? (
                    <p>{t('notifications.empty')}</p>
                ) : (
                    <div className='space-y-3'>
                        {notifications.map((notification) => (
                            <Card
                                key={notification.id}
                                title={notification.title}
                            >
                                <p>{notification.body}</p>
                                <p className='mt-2 text-xs text-mh-textMuted'>
                                    {notification.type.replaceAll('_', ' ')} ·{' '}
                                    {notification.priority} ·{' '}
                                    {fmt.longDate(notification.createdAt)}
                                </p>
                                <div className='mt-3 flex flex-wrap gap-2'>
                                    <Button
                                        type='button'
                                        variant='neutral'
                                        onClick={() =>
                                            void markRead(
                                                notification,
                                                !notification.read,
                                            )
                                        }
                                    >
                                        {notification.read
                                            ? t('notifications.markUnread')
                                            : t('notifications.markRead')}
                                    </Button>
                                    {!notification.archived ? (
                                        <Button
                                            type='button'
                                            variant='neutral'
                                            onClick={() =>
                                                void archive(notification)
                                            }
                                        >
                                            {t('notifications.archive')}
                                        </Button>
                                    ) : null}
                                    {notification.actionUrl ? (
                                        <a
                                            className='font-bold underline'
                                            href={notification.actionUrl}
                                        >
                                            {t('notifications.open')}
                                        </a>
                                    ) : null}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
                {nextCursor ? (
                    <p className='mt-4'>
                        <Button
                            type='button'
                            variant='neutral'
                            onClick={() => void loadMore()}
                        >
                            {t('notifications.more')}
                        </Button>
                    </p>
                ) : null}
            </Panel>
            <p
                role={status.startsWith('Error:') ? 'alert' : 'status'}
                className='text-sm'
            >
                {status}
            </p>
        </section>
    );
};
