import {lookupCountyArea,lookupPostalArea} from '@patchwork/at-lexicons';
import type {DiscoveryMapAggregates} from '@patchwork/shared';

export function postalMapCounts(cells:DiscoveryMapAggregates['cells'],level:'state'|'county'|'zip') {
    const states=new Set<string>();
    const areas=new Map<string,number>();
    for(const cell of cells) {
        const area=cell.countyId ? lookupCountyArea(cell.countyId) : cell.postalCode ? lookupPostalArea(cell.postalCode) : undefined;
        if(!area) continue;
        states.add(area.stateId);
        if(level==='zip' && cell.countyId) continue;
        const id=level==='state' ? area.stateId : level==='county' ? area.countyId : ('postalCode' in area ? String(area.postalCode) : undefined);
        if(id) areas.set(id,(areas.get(id)??0)+cell.count);
    }
    return {states:[...states],areas};
}
