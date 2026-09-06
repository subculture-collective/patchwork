import type { DiscoveryMapAggregates } from '@patchwork/shared';
type Cell = DiscoveryMapAggregates['cells'][number];
export type CellCluster = Cell & { keys: string[] };
/** Screen-space buckets merge/split the same privacy-safe cells at each zoom. */
export function clusterCells(
    cells: readonly Cell[],
    zoom: number,
): CellCluster[] {
    const groups = new Map<
        string,
        {
            x: number;
            y: number;
            count: number;
            radiusKm: number;
            keys: string[];
        }
    >();
    const scale = 256 * 2 ** zoom;
    for (const cell of cells) {
        const x = ((cell.longitude + 180) / 360) * scale;
        const sin = Math.sin(
            (Math.max(-85, Math.min(85, cell.latitude)) * Math.PI) / 180,
        );
        const y =
            (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
        const key = `${Math.floor(x / 72)}:${Math.floor(y / 72)}`;
        const group = groups.get(key) ?? {
            x: 0,
            y: 0,
            count: 0,
            radiusKm: 0,
            keys: [],
        };
        group.x += cell.longitude * cell.count;
        group.y += cell.latitude * cell.count;
        group.count += cell.count;
        group.radiusKm = Math.max(group.radiusKm, cell.radiusKm);
        group.keys.push(`${cell.latitude}:${cell.longitude}`);
        groups.set(key, group);
    }
    return [...groups.values()].map((g) => ({
        latitude: g.y / g.count,
        longitude: g.x / g.count,
        count: g.count,
        radiusKm: g.radiusKm,
        keys: g.keys,
    }));
}
