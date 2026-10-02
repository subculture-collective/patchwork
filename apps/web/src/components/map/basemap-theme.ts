import { namedFlavor, type Flavor } from '@protomaps/basemaps';
import { labelRules, paintRules } from 'protomaps-leaflet';

/**
 * Basemap colours for the canvas tile renderer, tuned to the paper palette
 * in `styles/tokens.css` (the renderer cannot read CSS custom properties).
 * Land and roads recede so pine markers and ink labels carry the map.
 */
const paperFlavor: Flavor = {
    ...namedFlavor('light'),
    background: '#e8e2d4',
    earth: '#efeadd',
    water: '#b9d2cd',
    park_a: '#dbe5d3',
    park_b: '#c3d9bf',
    wood_a: '#d7e2cf',
    wood_b: '#c3d9bf',
    scrub_a: '#dbe4d3',
    scrub_b: '#c8dac2',
    buildings: '#ddd6c6',
    hospital: '#ecdfd6',
    school: '#ebe4d3',
    industrial: '#e2ddcf',
    pedestrian: '#ebe6d8',
    aerodrome: '#dedbcf',
    other: '#f6f2e8',
    minor_service: '#f6f2e8',
    minor_a: '#f6f2e8',
    minor_b: '#fffdf7',
    link: '#fffdf7',
    major: '#fffdf7',
    highway: '#fffdf7',
    railway: '#b7b3a6',
    boundaries: '#aaa99f',
    ocean_label: '#3f6f69',
    city_label: '#172019',
    city_label_halo: '#fffdf7',
    subplace_label: '#4f5a51',
    subplace_label_halo: '#fffdf7',
    state_label: '#626a62',
    state_label_halo: '#fffdf7',
    roads_label_minor: '#626a62',
    roads_label_minor_halo: '#fffdf7',
    roads_label_major: '#4f5a51',
    roads_label_major_halo: '#fffdf7',
};

/** Layer options shared by every Patchwork map. */
export const basemapTheme = (lang: string) => ({
    paintRules: paintRules(paperFlavor),
    labelRules: labelRules(paperFlavor, lang),
    backgroundColor: paperFlavor.background,
});
