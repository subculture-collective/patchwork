import { describe, it, expect } from 'vitest';
import { clusterCells } from './cluster-cells';
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
