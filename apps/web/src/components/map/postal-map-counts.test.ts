import {expect,it} from 'vitest';
import {postalMapCounts} from './postal-map-counts';

it('includes county-only requests in county and state counts without assigning a ZIP bucket',()=>{
    const cells=[{latitude:0,longitude:0,count:2,radiusKm:10,countyId:'17031'},
        {latitude:0,longitude:0,count:3,radiusKm:1,postalCode:'60625'}];
    expect(postalMapCounts(cells,'county').areas.get('17031')).toBe(5);
    expect(postalMapCounts(cells,'state').areas.get('17')).toBe(5);
    expect([...postalMapCounts(cells,'zip').areas.entries()]).toEqual([['60625',3]]);
    expect([...postalMapCounts([cells[0]!],'zip').areas]).toEqual([]);
});
