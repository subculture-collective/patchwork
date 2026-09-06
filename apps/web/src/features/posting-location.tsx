import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { useLocale } from '../i18n';
import type { DiscoveryFilterState } from '../discovery-filters';

export function PostingLocation({ hasLocation, onSelect }: {
    hasLocation: boolean; onSelect: (patch: Partial<DiscoveryFilterState>) => void;
}) {
    const { t } = useLocale();
    const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
    const current = useRef(onSelect);
    current.current = onSelect;
    const mounted = useRef(true);
    const requested = useRef(false);
    const locate = () => {
        setState('loading');
        if (!navigator.geolocation) { setState('failed'); return; }
        navigator.geolocation.getCurrentPosition(position => {
            if (!mounted.current) return;
            const { latitude, longitude } = position.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) { setState('failed'); return; }
            current.current({ center: { lat: Math.round(latitude * 100) / 100, lng: Math.round(longitude * 100) / 100 },
                areaLabel: t('discovery.nearYou'), radiusMeters: 20_000, feedTab: 'nearby' });
            setState('idle');
        }, () => { if (mounted.current) setState('failed'); },
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 5000 });
    };
    useEffect(() => {
        mounted.current = true;
        if (!hasLocation && !requested.current) { requested.current = true; locate(); }
        return () => { mounted.current = false; };
    }, []);
    return <div className='mt-3 space-y-3'>
        <Button type='button' disabled={state === 'loading'} onClick={locate}>{t('discovery.updateLocation')}</Button>
        {state === 'loading' && <p role='status'>{t('handoff.findingArea')}</p>}
        {state === 'failed' && <p role='alert'>{t('handoff.areaUnavailable')}</p>}
        {!hasLocation && state !== 'loading' && <Button type='button' variant='neutral' onClick={() => {
            current.current({ center: { lat: 41.85, lng: -87.93 }, areaLabel: t('handoff.fallbackArea'), radiusMeters: 50_000, feedTab: 'nearby' });
            setState('idle');
        }}>{t('handoff.useFallbackArea')}</Button>}
    </div>;
}
