import { describe, it, expect } from 'vitest';
import { clusterCells, cellExpansionZoom } from './cluster-cells';
describe('privacy-safe zoom clusters', () => {
    it('splits on zoom in and merges on zoom out without losing counts', () => {
        const cells = Array.from({ length: 80 }, (_, i) => ({
            latitude: 41.88,
            longitude: -88 + i * 0.015,
            count: 3,
            radiusKm: 5,
        }));
        const far = clusterCells(cells, 8),
            near = clusterCells(cells, 11);
        expect(near.length).toBeGreaterThan(far.length);
        expect(far.reduce((sum, c) => sum + c.count, 0)).toBe(240);
        expect(near.reduce((sum, c) => sum + c.count, 0)).toBe(240);
        expect(clusterCells(cells, 8)).toEqual(far);
    });
    it('keeps coincident approximate locations together instead of inventing addresses', () => {
        const cells = [
            { latitude: 41.88, longitude: -87.63, count: 8, radiusKm: 5 },
        ];
        expect(clusterCells(cells, 18)).toEqual([
            { ...cells[0], keys: ['41.88:-87.63'] },
        ]);
    });
});

it('jumps to a real split and stops zooming at a shared public location', () => {
    const cells = [
        { latitude: 41.88, longitude: -87.63, count: 8, radiusKm: 5 },
        { latitude: 41.89, longitude: -87.62, count: 3, radiusKm: 5 },
    ];
    const group = clusterCells(cells, 7)[0]!;
    const next = cellExpansionZoom(cells, group.keys, 7);
    expect(next).not.toBeNull();
    expect(clusterCells(cells, next!)).toHaveLength(2);
    expect(cellExpansionZoom(cells, ['41.88:-87.63'], 9)).toBeNull();
});
