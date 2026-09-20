import { useEffect, useRef, useState } from 'react';
import type {
    SavedDiscoveryInput,
    SavedDiscoveryItem,
} from '@patchwork/shared';
import { useLocale } from '../i18n';
import { Button } from '../components/Button';
import { Panel } from '../components/Panel';
import {
    applyDiscoveryFilterPatch,
    serializeDiscoveryFilterState,
    type DiscoveryFilterState,
} from '../discovery-filters';
import {
    listSavedDiscoveryViaApi,
    saveDiscoveryViaApi,
    removeSavedDiscoveryViaApi,
    setSavedDiscoveryAlertsViaApi,
} from './api-client';

export function SaveDiscoveryButton({ input }: { input: SavedDiscoveryInput }) {
    const { t } = useLocale();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [saved, setSaved] = useState(false);
    const identity = JSON.stringify(input);
    const activeIdentity = useRef(identity);
    activeIdentity.current = identity;
    useEffect(() => {
        setSaved(false);
        setMessage('');
        setBusy(false);
    }, [identity]);
    return (
        <div className="space-y-1">
            <Button
                variant="neutral"
                disabled={busy || saved}
                onClick={async () => {
                    const submittedIdentity = identity;
                    setBusy(true);
                    setMessage('');
                    const result = await saveDiscoveryViaApi(input);
                    if (activeIdentity.current !== submittedIdentity) return;
                    setBusy(false);
                    if (result.ok) {
                        setSaved(true);
                        setMessage(t('saved.confirmed'));
                    } else setMessage(result.error);
                }}
            >
                {saved
                    ? t('saved.saved')
                    : input.kind === 'resource'
                      ? t('saved.saveResource')
                      : t('saved.saveSearch')}
            </Button>
            {message && (
                <p role="status" className="text-sm">
                    {message}
                </p>
            )}
            <a className="mh-link text-sm" href="/activity#saved-discovery">
                {t('saved.view')}
            </a>
        </div>
    );
}
export function SaveSearchButton({ state }: { state: DiscoveryFilterState }) {
    const search = {
        nearbyIntent: state.nearbyIntent ?? 'resources',
        postalCode: state.postalCode,
        center: state.postalCode
            ? undefined
            : state.center
              ? {
                    lat: Number(state.center.lat.toFixed(2)),
                    lng: Number(state.center.lng.toFixed(2)),
                }
              : undefined,
        radiusMeters: state.radiusMeters,
        text: state.text,
        resourceCategory: state.resourceCategory,
        resourceService: state.resourceService,
        resourceProgram: state.resourceProgram,
        includeLibraries: state.includeLibraries === true ? true as const : undefined,
        category: state.category,
        status: state.status,
        minUrgency: state.minUrgency,
        feedTab: state.feedTab,
    };
    return <SaveDiscoveryButton input={{ kind: 'search', search }} />;
}
export function SavedDiscoveryPanel({ did }: { did: string }) {
    const { t } = useLocale();
    const [items, setItems] = useState<SavedDiscoveryItem[]>([]);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [loaded, setLoaded] = useState(false);
    const load = async () => {
        setBusy(true);
        setMessage('');
        const result = await listSavedDiscoveryViaApi();
        setBusy(false);
        if (result.ok) {
            setItems(result.data.items);
            setLoaded(true);
        } else setMessage(result.error);
    };
    useEffect(() => {
        setItems([]);
        setMessage('');
        setLoaded(false);
        void load();
    }, [did]);
    return (
        <section id="saved-discovery">
            <Panel title={t('saved.heading')}>
                <p>{t('saved.privacy')}</p>
                <p>{t('saved.alertHelp')}</p>
                <Button
                    variant="neutral"
                    disabled={busy}
                    onClick={() => void load()}
                >
                    {t('saved.load')}
                </Button>
                {message && <p role="status">{message}</p>}
                {loaded && !items.length && (
                    <p role="status">{t('saved.empty')}</p>
                )}
                <ul className="space-y-3">
                    {items.map((item) => {
                        const state = item.search
                            ? applyDiscoveryFilterPatch(
                                  { feedTab: 'nearby' },
                                  item.search as Partial<DiscoveryFilterState>,
                              )
                            : undefined;
                        const label =
                            item.name ??
                            (item.kind === 'resource'
                                ? t('saved.unavailable')
                                : [
                                      t('saved.search'),
                                      item.search?.text,
                                      item.search?.postalCode,
                                      item.search?.resourceProgram,
                                      item.search?.resourceService,
                                  ]
                                      .filter(Boolean)
                                      .join(' · '));
                        return (
                            <li
                                key={item.id}
                                className="flex flex-wrap items-center gap-3"
                            >
                                <a
                                    className="mh-link"
                                    href={
                                        item.kind === 'resource'
                                            ? `/resources?resource=${encodeURIComponent(item.resourceUri!)}`
                                            : `/nearby?${serializeDiscoveryFilterState(state!)}`
                                    }
                                >
                                    {label}
                                </a>
                                <label className="inline-flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        disabled={busy}
                                        checked={item.alertsEnabled ?? false}
                                        onChange={async (event) => {
                                            const enabled =
                                                event.target.checked;
                                            setBusy(true);
                                            const result =
                                                await setSavedDiscoveryAlertsViaApi(
                                                    item.id,
                                                    enabled,
                                                );
                                            setBusy(false);
                                            if (result.ok)
                                                setItems((current) =>
                                                    current.map((saved) =>
                                                        saved.id === item.id
                                                            ? {
                                                                  ...saved,
                                                                  alertsEnabled:
                                                                      enabled,
                                                              }
                                                            : saved,
                                                    ),
                                                );
                                            else setMessage(result.error);
                                        }}
                                    />
                                    {t('saved.alerts')}
                                </label>
                                <Button
                                    variant="neutral"
                                    disabled={busy}
                                    aria-label={t('saved.removeNamed', {
                                        name: label,
                                    })}
                                    onClick={async () => {
                                        setBusy(true);
                                        const result =
                                            await removeSavedDiscoveryViaApi(
                                                item.id,
                                            );
                                        setBusy(false);
                                        if (result.ok)
                                            setItems((current) =>
                                                current.filter(
                                                    (saved) =>
                                                        saved.id !== item.id,
                                                ),
                                            );
                                        else setMessage(result.error);
                                    }}
                                >
                                    {t('saved.remove')}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
            </Panel>
        </section>
    );
}
