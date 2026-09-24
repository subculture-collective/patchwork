import { describe, expect, it } from 'vitest';
import type { ResourceMapCell } from '@patchwork/shared';
import { separateResourceClusters } from './resource-clusters';
const cell = (x: number, y: number, count = 1): ResourceMapCell => ({
    latitude: y, longitude: x, count, resourceUri: count === 1 ? `resource:${x}:${y}` : null,
    members: [{ uri: `resource:${x}:${y}`, name: `Place ${x}` }], west: x, east: x, south: y, north: y,
});
const project = (value: ResourceMapCell) => ({ x: value.longitude, y: value.latitude });
describe('resource marker spacing', () => {
    it('preserves isolated exact public places and input cells', () => {
        const input = [cell(0, 0), cell(100, 100)];
        expect(separateResourceClusters(input, project)).toEqual(input);
    });
    it('merges overlapping hit areas while preserving counts and geographic bounds', () => {
        const input = [cell(0, 0, 20), cell(25, 0, 4), cell(500, 500)];
        const result = separateResourceClusters(input, project);
        expect(result).toHaveLength(2);
        expect(result.reduce((sum, item) => sum + item.count, 0)).toBe(25);
        expect(result[0]).toMatchObject({ count: 24, resourceUri: null, west: 0, east: 25, south: 0, north: 0 });
        expect(input[0]!.count).toBe(20);
    });
    it('rechecks a moved centroid so dense clusters have separate hit targets', () => {
        const input = Array.from({ length: 200 }, (_, i) => cell((i * 47) % 700, (i * 31) % 500));
        const result = separateResourceClusters(input, project);
        expect(result.reduce((sum, item) => sum + item.count, 0)).toBe(input.length);
        for (let i = 0; i < result.length; i++) for (let j = i + 1; j < result.length; j++) {
            expect(Math.hypot(result[i]!.longitude - result[j]!.longitude, result[i]!.latitude - result[j]!.latitude)).toBeGreaterThanOrEqual(48);
        }
    });
    it('retains colocated addresses for the accessible resource chooser', () => {
        const result = separateResourceClusters([cell(5, 5), { ...cell(5, 5), resourceUri: 'second', members: [{ uri: 'second', name: 'Second provider' }] }], project);
        expect(result[0]).toMatchObject({ count: 2, west: 5, east: 5, south: 5, north: 5, resourceUri: null });
        expect(result[0]!.members).toHaveLength(2);
    });
});
