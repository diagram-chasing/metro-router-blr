// The aesthetic system for the wall projection: a dark MapLibre basemap, the
// cool-clean → warm-dirty colour language shared by trails and the emissions
// cloud, and the easing used for the counterfactual cross-fade.
//
// Encoding (one language everywhere): cool = clean, warm = dirty. Trail hue keys
// off leg mode; the emissions cloud keys off normalised CO₂ intensity through the
// same ramp, so a hot cab trail and the cloud it feeds glow the same colour.

import maplibre from 'maplibre-gl';

import type { LegKind } from '$lib/exhibit/routeCandidates';

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

// ── Easing ──
export const easeInOutCubic = (t: number): number =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

// ── Dark basemap ──
// Same OpenFreeMap vector source as the exhibit/accumulation maps, restyled to a
// near-black canvas with faint cool water and road context the glow sits over.
export function darkStyle(bg: string = WALL_BG): maplibre.StyleSpecification {
	const road = (
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
		paint: {
			'line-color': '#3a4a66',
			'line-width': ['interpolate', ['linear'], ['zoom'], ...w.flat()],
			'line-opacity': opacity
		}
	});

	return {
		version: 8,
		name: 'Wall',
		glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
		sources: {
			openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' }
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': bg } },
			{
				id: 'water',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'water',
				paint: { 'fill-color': '#0a1426', 'fill-opacity': 0.55 }
			},
			road('road-secondary', ['secondary', 'tertiary'], [
				[9, 0.3],
				[16, 1.2]
			], 0.05),
			road('road-primary', ['primary', 'trunk', 'motorway'], [
				[6, 0.4],
				[16, 2.2]
			], 0.08)
		]
	};
}
