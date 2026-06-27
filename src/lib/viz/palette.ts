// The aesthetic system for the wall projection: a dark MapLibre basemap, the
// cool-clean → warm-dirty colour language shared by trails and the emissions
// cloud, and the easing used for the counterfactual cross-fade.
//
// Encoding (one language everywhere): cool = clean, warm = dirty. Trail hue keys
// off leg mode; the emissions cloud keys off normalised CO₂ intensity through the
// same ramp, so a hot cab trail and the cloud it feeds glow the same colour.

import maplibre from 'maplibre-gl';

import type { LegKind } from '$lib/exhibit/routeCandidates';
import { TILES_URL, GLYPHS_URL } from '$lib/viz/basemapSource';

export type RGB = [number, number, number];

export const WALL_BG = '#04060c';

// ── Trail colour by leg mode (0–255 RGB for deck.gl) ──
// cool greens/cyans for clean transit & walking; amber→red for private vehicles.
export const LEG_RGB: Record<LegKind, RGB> = {
	walk: [150, 232, 245], // pale cyan
	metro: [54, 226, 168], // green-teal
	bus: [60, 206, 210], // teal
	auto: [248, 184, 70], // amber
	cab: [255, 78, 76] // hot red
};

export function legColor(kind: LegKind): RGB {
	return LEG_RGB[kind] ?? LEG_RGB.cab;
}

// ── Emissions cloud ramp: normalised CO₂ (0..1) → glow colour ──
// Deep indigo at the floor, through teal, into amber and a white-hot peak. Tuned
// for additive blending on near-black: midtones read, overlaps bloom to white.
const RAMP: { t: number; rgb: RGB }[] = [
	{ t: 0.0, rgb: [12, 16, 48] },
	{ t: 0.28, rgb: [26, 92, 150] },
	{ t: 0.52, rgb: [44, 200, 178] },
	{ t: 0.72, rgb: [246, 182, 72] },
	{ t: 0.88, rgb: [255, 86, 92] },
	{ t: 1.0, rgb: [255, 232, 228] }
];

export function co2Ramp(t: number): RGB {
	const x = Math.max(0, Math.min(1, t));
	for (let i = 1; i < RAMP.length; i++) {
		if (x <= RAMP[i].t) {
			const a = RAMP[i - 1];
			const b = RAMP[i];
			const f = (x - a.t) / (b.t - a.t || 1);
			return [
				Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
				Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
				Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f)
			];
		}
	}
	return RAMP[RAMP.length - 1].rgb;
}

// ── Diverging health ramp: signed months → colour ──
// Blue = months given back (below the city average), a low-chroma neutral that
// sits close to the dark basemap at the midpoint, warm amber→red = months lost
// (above average). Used by the choropleth wall; semantically the opposite of the
// sequential co2Ramp, so it gets its own stops.
export const DIVERGING: { t: number; rgb: RGB }[] = [
	{ t: 0.0, rgb: [54, 150, 236] }, // strong blue — most given back
	{ t: 0.3, rgb: [96, 172, 224] }, // soft blue
	{ t: 0.5, rgb: [32, 40, 56] }, // neutral, near the basemap
	{ t: 0.62, rgb: [240, 168, 64] }, // warm gold
	{ t: 0.78, rgb: [246, 110, 58] }, // orange
	{ t: 0.9, rgb: [240, 64, 72] }, // red — heavy loss
	{ t: 1.0, rgb: [255, 196, 168] } // hot, near white — worst
];

// Sample the diverging ramp at t∈[0,1] (0.5 = neutral). Hue is driven this way by
// the choropleth (self-scaled against the live field) so it always reads regardless
// of the months calibration.
export function divergingAt(t: number): RGB {
	const x = Math.max(0, Math.min(1, t));
	for (let i = 1; i < DIVERGING.length; i++) {
		if (x <= DIVERGING[i].t) {
			const a = DIVERGING[i - 1];
			const b = DIVERGING[i];
			const f = (x - a.t) / (b.t - a.t || 1);
			return [
				Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f),
				Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f),
				Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f)
			];
		}
	}
	return DIVERGING[DIVERGING.length - 1].rgb;
}

// `months` is a signed deviation mapped across [-ceil, +ceil] (for fixed-scale uses).
export function divergingRamp(months: number, ceil = 12): RGB {
	return divergingAt((months + ceil) / (2 * ceil));
}

// Emit `divergingAt` as a GLSL function so the field shader and the CPU agree on one
// ramp. A chain of `mix(c, stop, linearstep(a,b,t))` reproduces piecewise-linear
// interpolation exactly: each fully-open gate replaces the colour with the next stop,
// the active segment's gate is the fraction. Pass any stop list to bake other ramps.
export function glslColorRamp(fnName: string, stops = DIVERGING): string {
	const v3 = (rgb: RGB) =>
		`vec3(${(rgb[0] / 255).toFixed(5)}, ${(rgb[1] / 255).toFixed(5)}, ${(rgb[2] / 255).toFixed(5)})`;
	let body = `	vec3 c = ${v3(stops[0].rgb)};\n`;
	for (let i = 1; i < stops.length; i++) {
		const a = stops[i - 1].t;
		const b = stops[i].t;
		const span = (b - a || 1).toFixed(5);
		body += `	c = mix(c, ${v3(stops[i].rgb)}, clamp((t - ${a.toFixed(5)}) / ${span}, 0.0, 1.0));\n`;
	}
	return `vec3 ${fnName}(float t) {\n	t = clamp(t, 0.0, 1.0);\n${body}	return c;\n}`;
}

// ── Easing ──
export const easeInOutCubic = (t: number): number =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

// ── Dark basemap ──
// Same OpenFreeMap vector source as the exhibit/accumulation maps, restyled to a
// near-black canvas with faint cool water and road context the glow sits over.

// "mapscii" roads: round-capped lines with a zero-length dash → a dotted track,
// echoing the receipt's 1-bit dot map (see receipt/viz/braille.ts). Dash gap is in
// line-widths, so dot spacing scales with the road width across zoom.
const roadLayer = (
	id: string,
	classes: string[],
	w: [number, number][],
	opacity: number
): maplibre.LayerSpecification => ({
	id,
	type: 'line',
	source: 'openmaptiles',
	'source-layer': 'transportation',
	filter: ['in', 'class', ...classes],
	layout: { 'line-cap': 'round', 'line-join': 'round' },
	paint: {
		'line-color': '#5a7798',
		'line-width': ['interpolate', ['linear'], ['zoom'], ...w.flat()],
		'line-dasharray': [0, 2.2],
		'line-opacity': opacity
	}
});

// OSM place labels (neighbourhood / suburb / town / city names) from the vector
// tiles, for geographic context. The wall's own numbers sit on top via a deck TextLayer.
const placeLayer = (
	id: string,
	classes: string[],
	font: string,
	size: [number, number][],
	color: string,
	opacity: number
): maplibre.LayerSpecification => ({
	id,
	type: 'symbol',
	source: 'openmaptiles',
	'source-layer': 'place',
	filter: ['in', 'class', ...classes],
	layout: {
		'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
		'text-font': [font],
		'text-size': ['interpolate', ['linear'], ['zoom'], ...size.flat()],
		'text-transform': 'uppercase',
		'text-letter-spacing': 0.08,
		'text-max-width': 7
	},
	paint: {
		'text-color': color,
		'text-halo-color': '#04060c',
		'text-halo-width': 1.4,
		'text-halo-blur': 0.4,
		'text-opacity': opacity
	}
});

// Map-label font: IBM Plex Mono Medium, matching the receipt/legend monospace language.
// MapLibre wants a self-hosted glyph stack — openfreemap only serves Noto — so this stack is
// staged at static/fonts/IBM Plex Mono Medium/ (baked once with maplibre.org/font-maker); the
// name must match that folder exactly. Needs PUBLIC_GLYPHS_URL pointed at the local /fonts
// (dev included), else labels fall back/blank on the remote default.
const LABEL_FONT = 'IBM Plex Mono Medium';

// Shared place-name labels: minor (suburb/neighbourhood) + major (city/town). The hood
// figures (layers.ts) sit beside these names, so every basemap variant keeps them.
const placeLabels = (): maplibre.LayerSpecification[] => [
	placeLayer(
		'place-minor',
		['suburb', 'neighbourhood', 'quarter', 'village'],
		LABEL_FONT,
		[
			[10, 9],
			[14, 13]
		],
		'#9fb1c8',
		0.85
	),
	placeLayer(
		'place-major',
		['city', 'town'],
		LABEL_FONT,
		[
			[9, 12],
			[14, 18]
		],
		'#d7e4f5',
		0.95
	)
];

export function darkStyle(bg: string = WALL_BG): maplibre.StyleSpecification {
	// Roads + place labels only — no water or greenery. The dotted street network as
	// context under the field, with names for orientation.
	return {
		version: 8,
		name: 'Wall',
		glyphs: GLYPHS_URL,
		sources: {
			openmaptiles: { type: 'vector', url: TILES_URL }
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': bg } },
			roadLayer('road-secondary', ['secondary', 'tertiary'], [
				[9, 0.9],
				[16, 2.2]
			], 0.22),
			roadLayer('road-primary', ['primary', 'trunk', 'motorway'], [
				[6, 0.9],
				[16, 3.0]
			], 0.94),
			...placeLabels()
		]
	};
}

// ── Roads-only basemap (receipt aesthetic) ──
// The wall basemap restyled to match the printed route-map (receipt/viz/RouteMap.svelte):
// one uniform, evenly-dotted street network as faint ground — no water or greenery, and no
// primary/secondary emphasis — echoing the receipt's flat 1-bit dot field. Place names are
// kept for orientation (the hood figures sit beside them).
export function roadsOnlyStyle(bg: string = WALL_BG): maplibre.StyleSpecification {
	return {
		version: 8,
		name: 'Wall roads',
		glyphs: GLYPHS_URL,
		sources: {
			openmaptiles: { type: 'vector', url: TILES_URL }
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': bg } },
			// Incidental tracks (service/path/track): kept on but very faint, so they only
			// surface here and there without thickening the field. Drawn under the network.
			roadLayer(
				'roads-faint',
				['service', 'path', 'track'],
				[
					[9, 0.7],
					[16, 1.6]
				],
				0.18
			),
			// The street network at one weight/opacity → an even dotted field, not tiered.
			roadLayer(
				'roads',
				['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'],
				[
					[9, 0.9],
					[16, 2.2]
				],
				0.6
			),
			...placeLabels()
		]
	};
}
