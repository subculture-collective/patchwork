// @vitest-environment jsdom
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { InteractiveMap } from './InteractiveMap.js';

// Mock matchMedia for reduced motion check
beforeEach(() => {
    if (!window.localStorage) {
        const values = new Map<string, string>();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                clear: () => values.clear(),
                getItem: (key: string) => values.get(key) ?? null,
                setItem: (key: string, value: string) => values.set(key, value),
                removeItem: (key: string) => values.delete(key),
            },
        });
    }
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

const leafletMock = vi.hoisted(() => {
    const remove = vi.fn();
    const circleOn = vi.fn();
    const circle: any = vi.fn(() => circle);
    circle.addTo = vi.fn(() => circle);
    circle.remove = remove;
    circle.on = circleOn;
    circle.bindTooltip = vi.fn(() => circle);
    const placeOn = vi.fn();
    const circleMarker: any = vi.fn(() => circleMarker);
    circleMarker.addTo = vi.fn(() => circleMarker);
    circleMarker.remove = remove;
    circleMarker.on = placeOn;
    circleMarker.bindTooltip = vi.fn(() => circleMarker);
    const getContainer = vi.fn(() => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const on = vi.fn();
    const off = vi.fn();
    const mapState = {
        getZoom: () => 9,
        getContainer,
        on,
        off,
        remove,
        attributionControl: { addAttribution: vi.fn() },
        setView: vi.fn(() => mapState),
    };
    const map = vi.fn(() => mapState);
    return { remove, circleOn, circle, circleMarker, placeOn, map, on, off };
});

vi.mock('leaflet', () => ({
    default: {
        map: leafletMock.map,
        circle: leafletMock.circle,
        circleMarker: leafletMock.circleMarker,
        control: { attribution: vi.fn(() => ({ addTo: vi.fn() })) },
    },
}));

const tileLayer = { on: vi.fn(), addTo: vi.fn() };
vi.mock('protomaps-leaflet', () => ({
    leafletLayer: vi.fn(() => tileLayer),
}));

describe('InteractiveMap', () => {
    afterEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('renders circles without pins and synchronizes selection', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        const onSelectPostId = vi.fn();
        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[{ id: 'card-1', title: 'Need rice', summary: 'Help', category: 'food', status: 'open', urgency: 3, updatedAt: '2026-07-01T00:00:00.000Z', location: { lat: 1.3, lng: 103.8, precisionKm: 1 } }]}
                    selectedPostId='card-1'
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={onSelectPostId}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        expect(leafletMock.circle).toHaveBeenCalled();
        expect(leafletMock.map).toHaveBeenCalled();
        expect(tileLayer.addTo).toHaveBeenCalled();
        const circleArgs = (leafletMock.circle.mock.calls as unknown as Array<[unknown, { className?: string }]>)[0]?.[1];
        expect(circleArgs).toMatchObject({ className: 'mh-map-circle is-selected' });
        (leafletMock.circleOn.mock.calls as unknown as Array<[string, () => void]>)[0]?.[1]?.();
        expect(onSelectPostId).toHaveBeenCalledWith('card-1');
        await act(async () => root.unmount());
    });

    it('requires an explicit map point before confirming an approximate area', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const onConfirmArea = vi.fn();

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                    onConfirmArea={onConfirmArea}
                />,
            );
        });

        const confirm = [...container.querySelectorAll('button')].find(
            button => button.textContent === 'Confirm approximate area',
        );
        expect(confirm?.disabled).toBe(true);
        const clickHandler = (leafletMock.on.mock.calls as unknown as Array<[
            string,
            (event: { latlng: { lat: number; lng: number } }) => void,
        ]>).find(([event]) => event === 'click')?.[1];
        await act(async () => clickHandler?.({ latlng: { lat: 12.3456, lng: -45.6789 } }));
        expect(confirm?.disabled).toBe(false);
        await act(async () => confirm?.click());
        expect(onConfirmArea).toHaveBeenCalledWith({ lat: 12.3456, lng: -45.6789 });
        await act(async () => root.unmount());
    });

    it('does not recreate Leaflet when the area-confirm callback changes', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => root.render(<InteractiveMap cards={[]} onSelectPostId={vi.fn()} onTilesFailed={vi.fn()} onConfirmArea={vi.fn()} />));
        await act(async () => root.render(<InteractiveMap cards={[]} onSelectPostId={vi.fn()} onTilesFailed={vi.fn()} onConfirmArea={vi.fn()} />));
        expect(leafletMock.map).toHaveBeenCalledTimes(1);
        await act(async () => root.unmount());
    });

    it('reports tile failure and clears map ref on cleanup', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const onTilesFailed = vi.fn();

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={onTilesFailed}
                />,
            );
        });

        tileLayer.on.mock.calls[0]?.[1]?.(new Event('tileerror'));
        expect(onTilesFailed).toHaveBeenCalled();
        await act(async () => root.unmount());
        expect(leafletMock.remove).toHaveBeenCalled();
    });

    it('shows legend with privacy note and instructions', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[{ id: 'card-1', title: 'Need rice', summary: 'Help', category: 'food', status: 'open', urgency: 3, updatedAt: '2026-07-01T00:00:00.000Z', location: { lat: 1.3, lng: 103.8, precisionKm: 1 } }]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        const legend = document.querySelector('.mh-map-legend');
        expect(legend).not.toBeNull();
        expect(legend?.textContent).toContain('approximate');
        expect(legend?.textContent).toContain('Multiple requests cluster');

        const instructions = document.querySelector('.mh-map-instructions');
        expect(instructions).not.toBeNull();

        await act(async () => root.unmount());
    });

    it('shows empty state message when no cards or clusters', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        const emptyMessage = document.querySelector('.mh-map-empty-message');
        expect(emptyMessage).not.toBeNull();
        expect(emptyMessage?.textContent).toContain('No aid requests');

        await act(async () => root.unmount());
    });

    it('renders cluster circles with distinct styling', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[
                        { id: 'card-1', title: 'Need rice', summary: 'Help', category: 'food', status: 'open', urgency: 3, updatedAt: '2026-07-01T00:00:00.000Z', location: { lat: 1.3, lng: 103.8, precisionKm: 1 } },
                        { id: 'card-2', title: 'Need water', summary: 'Help', category: 'food', status: 'open', urgency: 2, updatedAt: '2026-07-01T00:00:00.000Z', location: { lat: 1.3001, lng: 103.8001, precisionKm: 1 } },
                    ]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        // Should have cluster class for clustered items
        const clusterCalls = leafletMock.circle.mock.calls.filter(
            (call: unknown[]) => (call[1] as { className?: string })?.className === 'mh-map-cluster',
        );
        expect(clusterCalls.length).toBeGreaterThan(0);

        await act(async () => root.unmount());
    });

    it('uses the archive data ceiling so higher zooms overzoom valid tiles', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        const { leafletLayer } = await import('protomaps-leaflet');
        expect(leafletLayer).toHaveBeenCalledWith(
            expect.objectContaining({ maxDataZoom: 10 }),
        );
        await act(async () => root.unmount());
        expect(leafletMock.off).toHaveBeenCalledWith(
            'zoomend',
            expect.any(Function),
        );
    });

    it('centers and filters when a request circle is clicked', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const onFocusArea = vi.fn();

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[{ id: 'card-focus', title: 'Need rice', summary: 'Help', category: 'food', status: 'open', urgency: 3, updatedAt: '2026-07-01T00:00:00.000Z', location: { lat: 1.3, lng: 103.8, precisionKm: 1 } }]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onFocusArea={onFocusArea}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        (leafletMock.circleOn.mock.calls as unknown as Array<[string, () => void]>)[0]?.[1]?.();
        expect(onFocusArea).toHaveBeenCalledWith(
            expect.objectContaining({ radiusMeters: 1000 }),
        );
        expect(leafletMock.map.mock.results[0]?.value.setView).toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('renders only approved current public places at exact coordinates', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const onSelectResource = vi.fn();

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    resources={[{
                        uri: 'at://did:example:org/app.patchwork.directory.resource/clinic',
                        id: 'clinic',
                        name: 'Public Clinic',
                        category: 'clinic',
                        location: { lat: 40.7, lng: -74, precisionMeters: 1000 },
                        contact: {},
                        exactPublicAddress: {
                            kind: 'exact-public-resource',
                            streetAddress: '100 Public Way',
                            latitude: 40.7128,
                            longitude: -74.006,
                            approvalExpiresAt: '2099-01-01T00:00:00.000Z',
                        },
                    }]}
                    center={{ lat: 40.7, lng: -74 }}
                    onSelectPostId={vi.fn()}
                    onSelectResource={onSelectResource}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        expect(leafletMock.circleMarker).toHaveBeenCalledWith(
            [40.7128, -74.006],
            expect.objectContaining({ className: 'mh-map-place' }),
        );
        (leafletMock.placeOn.mock.calls as unknown as Array<[string, () => void]>)[0]?.[1]?.();
        expect(onSelectResource).toHaveBeenCalledWith('at://did:example:org/app.patchwork.directory.resource/clinic');
        await act(async () => root.unmount());
    });

    it('fails closed for expired exact public-place approvals', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    resources={[{
                        uri: 'at://did:example:org/app.patchwork.directory.resource/expired',
                        id: 'expired',
                        name: 'Expired Place',
                        category: 'clinic',
                        location: { lat: 40.7, lng: -74, precisionMeters: 1000 },
                        contact: {},
                        exactPublicAddress: {
                            kind: 'exact-public-resource',
                            streetAddress: '100 Old Way',
                            latitude: 40.7128,
                            longitude: -74.006,
                            approvalExpiresAt: '2020-01-01T00:00:00.000Z',
                        },
                    }]}
                    center={{ lat: 40.7, lng: -74 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        expect(leafletMock.circleMarker).not.toHaveBeenCalled();
        expect(leafletMock.circle).toHaveBeenCalledWith([40.7, -74], expect.objectContaining({ radius: 1000 }));
        await act(async () => root.unmount());
    });

    it('offers filled, outline, and high-contrast circle styles', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <InteractiveMap
                    cards={[]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });

        const choices = container.querySelectorAll<HTMLInputElement>(
            'input[name^="circle-style-"]',
        );
        expect([...choices].map(choice => choice.value)).toEqual([
            'filled',
            'outline',
            'contrast',
        ]);
        await act(async () => {
            choices[1]?.click();
        });
        expect(container.querySelector('.mh-map-style-outline')).not.toBeNull();
        expect(
            window.localStorage.getItem('patchwork.map.circle-style.v1'),
        ).toBe('outline');
        await act(async () => root.unmount());

        const nextContainer = document.createElement('div');
        document.body.appendChild(nextContainer);
        const nextRoot = createRoot(nextContainer);
        await act(async () => {
            nextRoot.render(
                <InteractiveMap
                    cards={[]}
                    center={{ lat: 1.3, lng: 103.8 }}
                    onSelectPostId={vi.fn()}
                    onTilesFailed={vi.fn()}
                />,
            );
        });
        expect(
            nextContainer.querySelector('.mh-map-style-outline'),
        ).not.toBeNull();
        await act(async () => nextRoot.unmount());
    });
});
