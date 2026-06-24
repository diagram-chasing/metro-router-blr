// Pure deck.gl layer builders. Each is called from the FlowMap frame loop; the
// animation lives in cheap uniforms (currentTime, t) while geometry buffers only
// regenerate when their `data` reference changes (i.e. on a new arrival).

import type { Deck } from './deck';
import type { EmissionsField } from './emissionsField';
import type { ChoroplethField, HoodReading } from './choroplethField';
import { easeOutCubic } from './palette';
import { LOOP_PERIOD, TRAIL_LENGTH, type LegPath } from './tripsData';

export type Pulse = { lng: number; lat: number; bornAt: number };
export const PULSE_LIFE = 3; // s — arrival ring lifetime

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// The emissions field: a grid of extruded cells, one tower per lit cell, height
// and colour both keyed to CO₂. `data` (field.cols) is a stable reference between
// snapshots, so deck keeps its buffers and only re-runs the elevation/colour
// accessors when `tick` advances. material:false → flat emissive on the dark map.
export function buildEmissionsColumns(deck: Deck, field: EmissionsField, tick: number) {
	return new deck.GridCellLayer({
		id: 'emissions',
		data: field.cols,
		cellSize: field.cellMeters,
		coverage: 0.82, // shrink within the footprint so the grid lattice reads
		extruded: true,
		elevationScale: 1,
		material: false,
		pickable: false,
		getPosition: (d: { position: [number, number] }) => d.position,
		getElevation: (d: { idx: number }) => field.elevationOf(d.idx),
		getFillColor: (d: { idx: number }) => field.colorOf(d.idx),
		updateTriggers: { getElevation: tick, getFillColor: tick }
	});
}

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
export function buildHoodLabels(deck: Deck, hoods: HoodReading[], tick: number) {
	const fmt = (m: number) => (m < 0 ? '−' : '') + Math.round(Math.abs(m)).toString();
	const font = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
	return [
		new deck.TextLayer({
			id: 'hood-numbers',
			data: hoods,
			getPosition: (d: HoodReading) => d.c,
			getText: (d: HoodReading) => fmt(d.months),
			getSize: 22,
			sizeUnits: 'pixels',
			getColor: (d: HoodReading) => (d.months < 0 ? [206, 230, 255, 244] : [255, 226, 214, 244]),
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

// The colour a dirty trail is pulled toward as the counterfactual engages.
const COOL: [number, number, number] = [60, 206, 210];

// As `transition` rises (0→1), dirty trails (bucket ≥ 2) cool toward teal and
// fade — the visible half of "what if these trips moved to transit".
function tripColor(d: LegPath, transition: number): [number, number, number, number] {
	if (transition < 0.001 || d.bucket < 2) return d.color;
	const k = transition;
	return [
		Math.round(d.color[0] + (COOL[0] - d.color[0]) * 0.6 * k),
		Math.round(d.color[1] + (COOL[1] - d.color[1]) * 0.6 * k),
		Math.round(d.color[2] + (COOL[2] - d.color[2]) * 0.6 * k),
		Math.round(d.color[3] * (1 - 0.55 * k))
	];
}

// The hero: animated comet trails along real route geometry, coloured per leg.
export function buildTripsLayer(deck: Deck, data: LegPath[], t: number, transition = 0) {
	return new deck.TripsLayer({
		id: 'trips',
		data,
		getPath: (d: LegPath) => d.path,
		getTimestamps: (d: LegPath) => d.timestamps,
		getColor: (d: LegPath) => tripColor(d, transition),
		getWidth: (d: LegPath) => d.width,
		widthUnits: 'pixels',
		widthMinPixels: 1.5,
		capRounded: true,
		jointRounded: true,
		fadeTrail: true,
		trailLength: TRAIL_LENGTH,
		currentTime: t % LOOP_PERIOD,
		opacity: 0.92,
		// Quantised so the colour buffer regenerates a handful of times across a
		// toggle, not every frame.
		updateTriggers: { getColor: Math.round(transition * 10) }
	});
}

// A radiating white ring at the origin of each newly-arrived trip.
export function buildArrivalLayer(deck: Deck, pulses: Pulse[], t: number) {
	return new deck.ScatterplotLayer({
		id: 'arrivals',
		data: pulses,
		getPosition: (d: Pulse) => [d.lng, d.lat],
		stroked: true,
		filled: false,
		radiusUnits: 'pixels',
		lineWidthUnits: 'pixels',
		getRadius: (d: Pulse) => 6 + easeOutCubic(clamp01((t - d.bornAt) / PULSE_LIFE)) * 70,
		getLineWidth: 2,
		getLineColor: (d: Pulse) => {
			const a = 1 - clamp01((t - d.bornAt) / PULSE_LIFE);
			return [235, 245, 255, Math.round(210 * a)];
		},
		updateTriggers: { getRadius: t, getLineColor: t }
	});
}
