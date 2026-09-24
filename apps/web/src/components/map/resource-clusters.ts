import type { ResourceMapCell } from '@patchwork/shared';

/** Merge nearby server cells in screen space without dropping their counts. */
export function separateResourceClusters(
    cells: readonly ResourceMapCell[],
    project: (cell: ResourceMapCell) => { x: number; y: number },
    spacing = 48,
): ResourceMapCell[] {
    const groups: ResourceMapCell[] = [];
    for (const original of cells) {
        let cell = { ...original, members: [...original.members] };
        // Recheck after each weighted-centre move, including already merged cells.
        for (let i = 0; i < groups.length;) {
            const other = groups[i]!;
            const a = project(cell), b = project(other);
            if (Math.hypot(a.x - b.x, a.y - b.y) >= spacing) { i++; continue; }
            const count = cell.count + other.count;
            cell = {
                latitude: (cell.latitude * cell.count + other.latitude * other.count) / count,
                longitude: (cell.longitude * cell.count + other.longitude * other.count) / count,
                count,
                resourceUri: null,
                members: [...cell.members, ...other.members].slice(0, 20),
                west: Math.min(cell.west, other.west), east: Math.max(cell.east, other.east),
                south: Math.min(cell.south, other.south), north: Math.max(cell.north, other.north),
            };
            groups.splice(i, 1);
            i = 0;
        }
        groups.push(cell);
    }
    return groups;
}
