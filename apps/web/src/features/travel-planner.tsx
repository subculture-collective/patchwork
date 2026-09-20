import { useEffect, useRef, useState } from 'react';
import { useLocale } from '../i18n';
import { planTravelViaApi, type TravelItinerary } from './api-client';

const initialDateTime = () => {
    const value = new Date(Date.now() + 15 * 60_000);
    value.setMinutes(Math.ceil(value.getMinutes() / 5) * 5, 0, 0);
    const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
};

const position = () => new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 10_000,
    });
});

export function TravelPlanner({ resourceUri }: { resourceUri: string }) {
    const { t, locale } = useLocale();
    const [mode, setMode] = useState<'transit' | 'walk'>('transit');
    const [arriveBy, setArriveBy] = useState(false);
    const [wheelchair, setWheelchair] = useState(false);
    const [dateTime, setDateTime] = useState(initialDateTime);
    const [itineraries, setItineraries] = useState<TravelItinerary[]>([]);
    const [status, setStatus] = useState<'idle' | 'locating' | 'planning'>('idle');
    const [error, setError] = useState('');
    const request = useRef<AbortController | undefined>(undefined);

    useEffect(() => () => request.current?.abort(), [resourceUri]);

    const plan = async () => {
        request.current?.abort();
        setItineraries([]);
        setError('');
        if (!navigator.geolocation) {
            setError(String(t('travel.locationUnavailable')));
            return;
        }
        setStatus('locating');
        try {
            const origin = await position();
            const controller = new AbortController();
            request.current = controller;
            setStatus('planning');
            const result = await planTravelViaApi({
                resourceUri,
                origin: {
                    latitude: origin.coords.latitude,
                    longitude: origin.coords.longitude,
                },
                dateTime: new Date(dateTime).toISOString(),
                arriveBy,
                mode,
                wheelchair,
            }, controller.signal);
            if (controller.signal.aborted) return;
            if (!result.ok) setError(result.error);
            else if (result.data.length === 0) setError(String(t('travel.noTrips')));
            else setItineraries(result.data);
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === 'AbortError') return;
            setError(String(t('travel.locationDenied')));
        } finally {
            setStatus('idle');
        }
    };

    const formatTime = (value: string) => new Intl.DateTimeFormat(locale, {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
    }).format(new Date(value));

    return <section aria-labelledby={`travel-${resourceUri}`} className='space-y-3 border-t pt-4'>
        <h3 id={`travel-${resourceUri}`} className='font-semibold'>{t('travel.title')}</h3>
        <p className='text-sm'>{t('travel.privacy')}</p>
        <div className='grid gap-3 sm:grid-cols-2'>
            <label className='space-y-1 text-sm'>{t('travel.mode')}
                <select className='mh-input block w-full' value={mode} onChange={event => setMode(event.target.value as 'transit' | 'walk')}>
                    <option value='transit'>{t('travel.transit')}</option>
                    <option value='walk'>{t('travel.walk')}</option>
                </select>
            </label>
            <label className='space-y-1 text-sm'>{arriveBy ? t('travel.arriveAt') : t('travel.departAt')}
                <input className='mh-input block w-full' type='datetime-local' value={dateTime} onChange={event => setDateTime(event.target.value)} required />
            </label>
        </div>
        <div className='flex flex-wrap gap-4 text-sm'>
            <label><input type='checkbox' checked={arriveBy} onChange={event => setArriveBy(event.target.checked)} /> {t('travel.arriveBy')}</label>
            <label><input type='checkbox' checked={wheelchair} onChange={event => setWheelchair(event.target.checked)} /> {t('travel.wheelchair')}</label>
        </div>
        <button className='mh-button px-3 py-2 text-sm' type='button' disabled={status !== 'idle' || !dateTime} onClick={() => void plan()}>
            {status === 'locating' ? t('travel.locating') : status === 'planning' ? t('travel.planning') : t('travel.useLocation')}
        </button>
        {error && <p role='alert' className='text-sm'>{error}</p>}
        {itineraries.length > 0 && <ol aria-label={t('travel.options')} className='space-y-3'>
            {itineraries.map((itinerary, index) => <li className='rounded border p-3' key={`${itinerary.startTime}-${index}`}>
                <strong>{t('travel.option', {number:index + 1})}</strong>
                <p className='text-sm'>{formatTime(itinerary.startTime)}–{formatTime(itinerary.endTime)} · {Math.round(itinerary.durationSeconds / 60)} {t('travel.minutes')}</p>
                <ol className='mt-2 space-y-1 text-sm'>
                    {itinerary.legs.map((leg, legIndex) => <li key={`${leg.startTime}-${legIndex}`}>
                        {leg.route ? `${leg.mode} ${leg.route}` : leg.mode} · {Math.round(leg.durationSeconds / 60)} {t('travel.minutes')} · {leg.from} → {leg.to}
                    </li>)}
                </ol>
            </li>)}
        </ol>}
    </section>;
}
