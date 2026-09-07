import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from 'react';
import type { DiscoveryFilterState } from '../discovery-filters';
export const discoveryFallback = {
    center: { lat: 41.85, lng: -87.93 },
    areaLabel: 'Chicagoland',
    radiusMeters: 65000,
    feedTab: 'nearby' as const,
};
type Status =
    'idle' | 'requesting' | 'granted' | 'denied' | 'timeout' | 'unavailable';
export const DiscoveryLocationContext = createContext({
    status: 'idle' as Status,
    request: () => {},
    cancel: () => {},
});
export const useDiscoveryLocation = () => useContext(DiscoveryLocationContext);
export function useDiscoveryLocationController(
    state: DiscoveryFilterState,
    patch: (value: Partial<DiscoveryFilterState>) => void,
    enabled: boolean,
    nearYou: string,
) {
    const [status, setStatus] = useState<Status>('idle');
    const stateRef = useRef(state);
    stateRef.current = state;
    const patchRef = useRef(patch);
    patchRef.current = patch;
    const generation = useRef(0);
    const initialized = useRef(false);
    const cancel = useCallback(() => {
        generation.current++;
        setStatus('idle');
    }, []);
    const request = useCallback(() => {
        const current = ++generation.current;
        setStatus('requesting');
        const fail = (code: number) => {
            if (current !== generation.current) return;
            setStatus(
                code === 1 ? 'denied' : code === 3 ? 'timeout' : 'unavailable',
            );
            // An unsuccessful refresh never overwrites an existing selected area.
            if (!stateRef.current.center && !stateRef.current.postalCode) patchRef.current(discoveryFallback);
        };
        if (!navigator.geolocation) {
            fail(2);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                if (current !== generation.current) return;
                const center = {
                    lat: Math.round(position.coords.latitude * 100) / 100,
                    lng: Math.round(position.coords.longitude * 100) / 100,
                };
                if (
                    !Number.isFinite(center.lat) ||
                    !Number.isFinite(center.lng)
                ) {
                    fail(2);
                    return;
                }
                setStatus('granted');
                patchRef.current({
                    center,
                    postalCode: undefined,
                    areaLabel: nearYou,
                    radiusMeters: 20000,
                    feedTab: 'nearby',
                });
            },
            (error) => fail(error.code),
            { enableHighAccuracy: false, maximumAge: 300000, timeout: 15000 },
        );
    }, [nearYou]);
    useEffect(() => {
        if (!enabled || initialized.current) return;
        initialized.current = true;
        if (!stateRef.current.center && !stateRef.current.postalCode) request();
    }, [enabled, request]);
    useEffect(
        () => () => {
            generation.current++;
            initialized.current = false;
        },
        [],
    );
    return { status, request, cancel };
}
