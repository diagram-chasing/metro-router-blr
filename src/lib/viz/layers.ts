// Pure deck.gl layer builders for the homepage choropleth map. The field is one
// GPU-shaded texture (FieldLayer) — no per-cell geometry, so no seams at any zoom —
// and all animation lives in shader uniforms (see fieldLayer.ts). The texture only
// re-uploads when the field's data actually changes.

import type { Deck } from './deck';
import type { ChoroplethField, HoodReading } from './choroplethField';
import { easeOutCubic } from './palette';

type FieldLayerInstance = InstanceType<Deck['FieldLayer']>;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInCubic = (t: number) => t * t * t;

// The health field as a single shaded texture stretched over the grid bbox. `time`
// drives the shader animation (recalc pulse / theatre). Default is the blocky grid
// look (NEAREST + shader grid lines + dither); pass `smooth:true` for a bilinear,
// continuous (HD) field instead.
export function buildFieldLayer(
	deck: Deck,
	field: ChoroplethField,
	opts: { time: number; smooth?: boolean }
): FieldLayerInstance | null {
	const fieldData = field.textureImage();
	if (!fieldData) return null;
	const rec = field.recalcUniforms();
	const path = rec.path; // flattened uv points; pack 2/vec4 for the shader
	const pt = (i: number): [number, number] => [path[i * 2] ?? 0, path[i * 2 + 1] ?? 0];
	const props = {
		id: 'field',
		fieldData, // raw rgba8 the layer uploads to its own texture (ref-stable until changed)
		bounds: field.bounds, // [lonMin, latMin, lonMax, latMax] — drives the quad mesh
		smooth: opts.smooth === true, // default blocky (crisp cells); opt in to bilinear
		pickable: false,
		// fieldFx uniforms — animation happens here, on the GPU.
		time: opts.time,
		dim: field.dim,
		recalcOrigin: rec.origin,
		recalcStart: rec.start,
		recalcDur: rec.dur,
		aspect: field.aspect,
		gridSize: field.gridSize,
		pathA: [...pt(0), ...pt(1)],
		pathB: [...pt(2), ...pt(3)],
		pathC: [...pt(4), ...pt(5)],
		pathD: [...pt(6), ...pt(7)],
		pathCount: path.length / 2
	};
	const Ctor = deck.FieldLayer as unknown as new (p: Record<string, unknown>) => FieldLayerInstance;
	return new Ctor(props);
}

// Spread clustered labels apart so they don't pile up. A few iterations of pairwise
// repulsion (only between labels closer than `sepDeg`) nudges crowded ones outward
// while leaving well-spaced ones put — organic, not a grid, and deterministic so the
// positions don't jitter between ticks. Works in a cos-lat plane so pushes read even
// on screen. `sepDeg` is the target minimum spacing in degrees.
export function declutterHoods(hoods: HoodReading[], sepDeg = 0.042, iters = 60): HoodReading[] {
	if (hoods.length < 2) return hoods;
	const latMid = hoods.reduce((s, h) => s + h.c[1], 0) / hoods.length;
	const kx = Math.cos((latMid * Math.PI) / 180) || 1;
	const pts = hoods.map((h) => ({ x: h.c[0] * kx, y: h.c[1], h }));
	for (let it = 0; it < iters; it++) {
		for (let i = 0; i < pts.length; i++) {
			for (let j = i + 1; j < pts.length; j++) {
				let dx = pts[i].x - pts[j].x;
				let dy = pts[i].y - pts[j].y;
				const d = Math.hypot(dx, dy) || 1e-6;
				if (d < sepDeg) {
					const push = ((sepDeg - d) / d) * 0.5;
					dx *= push;
					dy *= push;
					pts[i].x += dx;
					pts[i].y += dy;
					pts[j].x -= dx;
					pts[j].y -= dy;
				}
			}
		}
	}
	return pts.map((p) => ({ ...p.h, c: [p.x / kx, p.y] as [number, number] }));
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
	const placed = declutterHoods(hoods);
	return [
		new deck.TextLayer({
			id: 'hood-numbers',
			data: placed,
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

// A transient recalc notification: the months this route added, rising up out of the
// grid at the route, holding, then fading away — a notification beat. `start` is the
// trigger time, `now` the current clock; returns null once it has played out (the
// caller drops it). Animation is all in props (offset + alpha), so it's cheap.
export type RecalcNotif = { months: number; c: [number, number]; start: number };

const NOTIF_RISE = 0.55;
const NOTIF_HOLD = 1.5;
const NOTIF_FALL = 0.9;
export const NOTIF_TOTAL = NOTIF_RISE + NOTIF_HOLD + NOTIF_FALL;

export function buildRecalcNotif(deck: Deck, notif: RecalcNotif, now: number, scale = 1) {
	const e = now - notif.start;
	if (e < 0 || e > NOTIF_TOTAL) return null;

	// Opacity: ease in, hold, ease out.
	const op =
		e < NOTIF_RISE
			? easeOutCubic(e / NOTIF_RISE)
			: e < NOTIF_RISE + NOTIF_HOLD
				? 1
				: 1 - easeInCubic((e - NOTIF_RISE - NOTIF_HOLD) / NOTIF_FALL);
	// Rise: starts just below the anchor, drifts up over the whole life (deck y+ is down).
	const y = lerp(10, -54, easeOutCubic(clamp01(e / NOTIF_TOTAL)));

	const n = Math.round(notif.months);
	const text = `${n >= 0 ? '+' : '−'}${Math.abs(n)} mo`;
	const rgb = n >= 0 ? [255, 196, 168] : [150, 200, 255]; // added (warm) vs given back (cool)
	const alpha = Math.round(clamp01(op) * 255);

	return new deck.TextLayer({
		id: 'recalc-notif',
		data: [notif],
		getPosition: (d: RecalcNotif) => d.c,
		getText: () => text,
		getSize: 34 * scale,
		sizeUnits: 'pixels',
		getColor: [rgb[0], rgb[1], rgb[2], alpha],
		getPixelOffset: [0, y],
		fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
		fontWeight: 700,
		background: true,
		getBackgroundColor: [6, 10, 16, Math.round(clamp01(op) * 205)],
		backgroundPadding: [11, 7, 11, 7],
		outlineWidth: 2,
		outlineColor: [4, 6, 12, alpha],
		fontSettings: { sdf: true },
		characterSet: 'auto',
		getTextAnchor: 'middle',
		getAlignmentBaseline: 'center',
		updateTriggers: { getText: text, getColor: [alpha, n], getPixelOffset: [y] }
	});
}
