// Pure deck.gl layer builders for the homepage choropleth map. The animation lives
// in a cheap uniform (tick) while geometry buffers only regenerate when their `data`
// reference changes (i.e. on a new emissions snapshot).

import type { Deck } from './deck';
import type { ChoroplethField, HoodReading } from './choroplethField';

// The flat health choropleth: one filled square per grid cell, full coverage
// (coverage:1, extruded:false). Colour is the only channel — diverging months,
// transparent where there's no data. `data` (field.cols) is a stable reference, so
// deck keeps its buffers and only re-runs getFillColor when `tick` advances.
export function buildChoroplethLayer(deck: Deck, field: ChoroplethField, tick: number) {
	return new deck.GridCellLayer({
		id: 'choropleth',
		data: field.cols,
		cellSize: field.cellMeters,
		coverage: 1,
		extruded: false,
		material: false,
		pickable: false,
		getPosition: (d: { position: [number, number] }) => d.position,
		getFillColor: (d: { idx: number }) => field.colorOf(d.idx),
		updateTriggers: { getFillColor: tick }
	});
}

// Our numbers: one bold "months of life lost" figure per neighbourhood. The place
// NAMES come from the OSM basemap (darkStyle); these are just the values. Drawn last
// so they composite on top of the choropleth; the dark chip + halo keep them readable
// over any cell colour.
export function buildHoodLabels(deck: Deck, hoods: HoodReading[], tick: number, scale = 1) {
	// Months of life lost (always ≥ 0 under the WHO-anchored scale). The "mo" unit cue keeps
	// the bare number decodable cold, for a viewer who arrives mid-cycle from across the room.
	const fmt = (m: number) => `${Math.round(m)}mo`;
	const font = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
	return [
		new deck.TextLayer({
			id: 'hood-numbers',
			data: hoods,
			getPosition: (d: HoodReading) => d.c,
			getText: (d: HoodReading) => fmt(d.months),
			getSize: 22 * scale,
			sizeUnits: 'pixels',
			getColor: () => [255, 226, 214, 244],
			fontFamily: font,
			fontWeight: 700,
			background: true,
			getBackgroundColor: [6, 10, 16, 200],
			backgroundPadding: [7, 4, 7, 3],
			outlineWidth: 2,
			outlineColor: [4, 6, 12, 255],
			fontSettings: { sdf: true },
			characterSet: 'auto',
			getTextAnchor: 'middle',
			getAlignmentBaseline: 'center',
			updateTriggers: { getText: tick, getColor: tick }
		})
	];
}
