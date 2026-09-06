import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/Button';
import { useLocale } from '../i18n';
import type { FeedRecordEnvelope } from './discovery-runtime';
import {
    queryAidPostLifecycleViaApi,
    reconcileAidPostStatusViaApi,
    transitionAidPostViaApi,
    type LifecycleQueryApiResult,
} from './api-client';

/** Commands are acknowledged by the durable owner API, never by local card state. */
export function RequestLifecycleActions({ record, onRefresh }: {
    record: FeedRecordEnvelope;
    onRefresh: () => void;
}) {
    const { session } = useAuth();
    const { t } = useLocale();
    const owner = session?.did === record.recipientDid;
    const [lifecycle, setLifecycle] = useState<LifecycleQueryApiResult>();
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');
    const [failed, setFailed] = useState(false);
    const [syncPending, setSyncPending] = useState(false);
    const refreshRef = useRef(onRefresh);
    refreshRef.current = onRefresh;
    const command = useRef<{ target: string; key: string; now: string } | undefined>(undefined);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const load = useCallback(async (signal?: AbortSignal) => {
        if (!owner) return;
        const result = await queryAidPostLifecycleViaApi(record.aidPostUri, signal);
        if (signal?.aborted || !mounted.current) return;
        if (result.ok) {
            setLifecycle(result.data);
            if (result.data.publicSyncState === 'pending' || result.data.publicSyncState === 'failed') {
                setSyncPending(true);
                setFailed(result.data.publicSyncState === 'failed');
                setNotice(t('handoff.savedPending'));
            }
        }
        else {
            setFailed(true);
            setNotice(t('handoff.stateUnavailable'));
        }
    }, [owner, record.aidPostUri, t]);

    useEffect(() => {
        const controller = new AbortController();
        setLifecycle(undefined);
        setNotice('');
        setFailed(false);
        setSyncPending(false);
        command.current = undefined;
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const sync = async () => {
        if (!record.cid) {
            setFailed(true);
            setNotice(t('handoff.savedPending'));
            return;
        }
        const result = await reconcileAidPostStatusViaApi({
            uri: record.aidPostUri,
            expectedCid: record.cid,
            updatedAt: command.current?.now ?? new Date().toISOString(),
        });
        if (!mounted.current) return;
        setSyncPending(!result.ok);
        setFailed(!result.ok);
        setNotice(t(result.ok ? 'handoff.savedAwaitingDiscovery' : 'handoff.savedPending'));
        refreshRef.current();
        await load();
    };

    const transition = async (target: string) => {
        if (busy || !owner || !lifecycle?.validTransitions.includes(target)) return;
        setBusy(true);
        setFailed(false);
        setNotice(t('handoff.saving'));
        if (command.current?.target !== target) {
            command.current = { target, key: crypto.randomUUID(), now: new Date().toISOString() };
        }
        try {
            const result = await transitionAidPostViaApi({
                postUri: record.aidPostUri,
                targetStatus: target,
                now: command.current.now,
            }, undefined, command.current.key);
            if (!mounted.current) return;
            if (!result.ok) {
                setFailed(true);
                setNotice(t('handoff.saveFailed'));
                return;
            }
            setSyncPending(true);
            await sync();
        } finally {
            if (mounted.current) setBusy(false);
        }
    };

    if (!owner) return null;
    return <div className='space-y-2'>
        {notice && <p role={failed ? 'alert' : 'status'} className='text-sm'>{notice}</p>}
        <div className='flex flex-wrap gap-2'>
            {!syncPending && lifecycle?.validTransitions.map(target => <Button
                key={target} variant='neutral' disabled={busy}
                onClick={() => void transition(target)}
                aria-label={t('handoff.changeRequest', { action: t(`handoff.actions.${target}`), title: record.card.title })}
            >{t(`handoff.actions.${target}`)}</Button>)}
            {syncPending && <Button disabled={busy} onClick={async () => {
                setBusy(true);
                try { await sync(); } finally { if (mounted.current) setBusy(false); }
            }}>{t('handoff.retrySync')}</Button>}
            {!lifecycle && <Button disabled={busy} onClick={() => void load()}>{t('handoff.retry')}</Button>}
        </div>
    </div>;
}
