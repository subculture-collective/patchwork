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

export type LocationAccess =
    | 'idle'
    | 'requesting'
    | 'granted'
    | 'fallback'
    | 'denied';

/**
 * Requests the device location once when no discovery area is set, rounds it
 * to roughly a kilometre, and falls back to the demonstration area when the
 * browser refuses or cannot answer.
 */
export interface ApproximateLocationOptions {
    /** Request location on mount when no area is set (default true). */
    auto?: boolean;
    /**
     * Load the demonstration area when location is unavailable (default
     * true). Must be false wherever the area is published, e.g. posting.
     */
    fallbackToDemo?: boolean;
}

export const useApproximateLocation = (
    state: DiscoveryFilterState,
    onPatch: (patch: Partial<DiscoveryFilterState>) => void,
    { auto = true, fallbackToDemo = true }: ApproximateLocationOptions = {},
) => {
    const { t } = useLocale();
    const [access, setAccess] = useState<LocationAccess>('idle');
    const requestedRef = useRef(false);

    const request = useCallback(() => {
        setAccess('requesting');
        if (!navigator.geolocation) {
            setAccess(fallbackToDemo ? 'fallback' : 'denied');
            if (fallbackToDemo) onPatch(demoAreaPresets.chicagoland);
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
                setAccess(fallbackToDemo ? 'fallback' : 'denied');
                if (fallbackToDemo) onPatch(demoAreaPresets.chicagoland);
            },
            { enableHighAccuracy: false, maximumAge: 300000, timeout: 5000 },
        );
    }, [fallbackToDemo, onPatch, t]);

    // Ask only when the page first opens without an area. If the visitor
    // later clears the area, respect that instead of re-applying one.
    useEffect(() => {
        if (!auto || requestedRef.current) return;
        requestedRef.current = true;
        if (!state.center) request();
    }, [auto, request, state.center]);

    return { access, request };
};
