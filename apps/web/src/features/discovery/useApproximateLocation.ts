import { useCallback, useEffect, useRef, useState } from 'react';
import type { DiscoveryFilterState } from '../../discovery-filters';
import { useLocale } from '../../i18n';

const nearbyDefaultRadiusMeters = 20000;
/** Two decimal places ≈ 1 km: coordinates never leave the device more precisely. */
const locationCoordinatePrecision = 100;

export const demoAreaPresets = {
    chicagoland: {
        center: { lat: 41.85, lng: -87.93 },
        areaLabel: 'Cook & DuPage demo',
        radiusMeters: 65000,
        feedTab: 'nearby' as const,
    },
} as const;

export type LocationAccess = 'idle' | 'requesting' | 'granted' | 'fallback';

/**
 * Requests the device location once when no discovery area is set, rounds it
 * to roughly a kilometre, and falls back to the demonstration area when the
 * browser refuses or cannot answer.
 */
export const useApproximateLocation = (
    state: DiscoveryFilterState,
    onPatch: (patch: Partial<DiscoveryFilterState>) => void,
) => {
    const { t } = useLocale();
    const [access, setAccess] = useState<LocationAccess>('idle');
    const requestedRef = useRef(false);

    const request = useCallback(() => {
        setAccess('requesting');
        if (!navigator.geolocation) {
            setAccess('fallback');
            onPatch(demoAreaPresets.chicagoland);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const round = (value: number) =>
                    Math.round(value * locationCoordinatePrecision) /
                    locationCoordinatePrecision;
                setAccess('granted');
                onPatch({
                    center: {
                        lat: round(position.coords.latitude),
                        lng: round(position.coords.longitude),
                    },
                    areaLabel: String(t('discovery.nearYou')),
                    radiusMeters: nearbyDefaultRadiusMeters,
                    feedTab: 'nearby',
                });
            },
            () => {
                setAccess('fallback');
                onPatch(demoAreaPresets.chicagoland);
            },
            { enableHighAccuracy: false, maximumAge: 300000, timeout: 5000 },
        );
    }, [onPatch, t]);

    useEffect(() => {
        if (state.center || requestedRef.current) return;
        requestedRef.current = true;
        request();
    }, [request, state.center]);

    return { access, request };
};
