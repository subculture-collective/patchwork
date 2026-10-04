// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MapRoute } from './map-route';
import { defaultDiscoveryFilterState, type DiscoveryFilterState } from '../discovery-filters';

vi.mock('../components/map/InteractiveMap.js', () => ({
    InteractiveMap: () => <div data-testid="map">Interactive map</div>,
}));

it('keeps the map usable after clearing and lets the user search again without geolocation', async () => {
    const patch = vi.fn();
    const locate = vi.fn();
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: locate } });
    const center = { lat: 41.85, lng: -87.93 };
    function Harness() {
        const [state, setState] = useState<DiscoveryFilterState>({ ...defaultDiscoveryFilterState, center, radiusMeters: 65000, feedTab: 'nearby' });
        return <MapRoute filters={null} fixtureMode={false} originLabel="Requesting location"
            discoveryState={state} onPushDiscovery={value => { patch(value); setState(current => ({ ...current, ...value })); }}
            feedRecords={[]} resourceCards={[]} isLoading={false} dataOrigin={state.center ? 'api' : 'idle'}
            onRetry={() => {}} hasNextPage={false} total={0} onLoadMore={() => {}}
            onRetryResources={() => {}} onTriageAction={() => {}} onOpenChat={() => {}} />;
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const click = async (name: string) => {
        const button = [...container.querySelectorAll('button')].find(node => node.textContent === name);
        expect(button, name).toBeDefined();
        await act(async () => button!.click());
    };
    try {
        await act(async () => root.render(<Harness />));
        await vi.waitFor(() => expect(container.querySelector('[data-testid="map"]')).not.toBeNull());
        await click('Clear area filter');
        expect(patch).toHaveBeenLastCalledWith(expect.objectContaining({ center: undefined, radiusMeters: undefined }));
        expect(container.querySelector('[data-testid="map"]')).not.toBeNull();
        expect(container.textContent).not.toContain('Requesting location');
        expect(container.textContent).not.toContain('No requests in selected area');
        expect(container.textContent).toContain('Choose an approximate area.');
        await click('Search this area');
        expect(patch).toHaveBeenLastCalledWith({ center, radiusMeters: 65000, feedTab: 'nearby' });
        // Searching consumes the pending viewport; another clear still needs a search action.
        await click('Clear area filter');
        await click('Search this area');
        expect(locate).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
