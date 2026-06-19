// Shared geometry + greyscale helpers for the static poster panels.
//
// The panels render the SAME data the live exhibit draws (the AQI field from
// /api/aqi, the accumulated routes from /api/lines, the grey buckets from
// grey.ts) — but as crisp SVG over a faint metro outline, so they place into a
// printed poster without the blur of a screenshot.

import { GREY_SHADES } from '$lib/exhibit/grey';

// [lonMin, latMin, lonMax, latMax] — identical frame to the AQI grid
// (aqiBase.json: latMin 12.8235, lonMin 77.4499, 34×35 cells of 0.01°).
export type Bbox = [number, number, number, number];
// Full AQI grid frame (used for cell-index → lat/lon math).
export const BENGALURU_BBOX: Bbox = [77.4499, 12.8235, 77.7999, 13.1535];
// Tighter view the panels actually draw into — frames the metro core and the
// travelled corridors so the map fills the square instead of floating small in
// the middle. Content outside this box is clipped by the panel viewport.
export const VIEW_BBOX: Bbox = [77.49, 12.88, 77.71, 13.1];

export type Projector = {
	size: number;
	/** Map [lng,lat] to square pixel space, north up. */
	project: (lng: number, lat: number) => [number, number];
};

// Linear lon/lat → square pixels. Latitude is flipped so north is at the top
// (mirrors AqiRaster.svelte's vertical flip), and longitude is scaled by
// cos(lat) so the city keeps its true proportions. The bbox is fitted (contain)
// into `size` with an optional margin, then centred.
export function makeProjector(bbox: Bbox, size: number, margin = 0): Projector {
	const [lonMin, latMin, lonMax, latMax] = bbox;
	const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180);
	const wDeg = (lonMax - lonMin) * kx;
	const hDeg = latMax - latMin;
	const inner = size - 2 * margin;
	const scale = inner / Math.max(wDeg, hDeg);
	const offX = margin + (inner - wDeg * scale) / 2;
	const offY = margin + (inner - hDeg * scale) / 2;
	const project = (lng: number, lat: number): [number, number] => [
		offX + (lng - lonMin) * kx * scale,
		offY + (latMax - lat) * scale
	];
	return { size, project };
}

// ── Greyscale ────────────────────────────────────────────────────────────────
// grey.ts's GREY_SHADES are tuned for a BLACK background (brighter = dirtier).
// On a white poster that's invisible for the dirty (near-white) end, so we use
// the exact luminance-inverse for light backgrounds (darker = dirtier).
export const INK_SHADES: string[] = GREY_SHADES.map((h) => {
	const v = 255 - parseInt(h.slice(1, 3), 16);
	const hex = v.toString(16).padStart(2, '0');
	return `#${hex}${hex}${hex}`;
});

export function isLight(bg: string): boolean {
	const m = /^#?([0-9a-fA-F]{6})$/.exec(bg.replace(/^#/, ''));
	if (!m) return bg.toLowerCase() !== 'black';
	const n = parseInt(m[1], 16);
	const r = (n >> 16) & 255;
	const g = (n >> 8) & 255;
	const b = n & 255;
	return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

/** Bucket → shade ramp appropriate for the given background. */
export function shadesFor(bg: string): readonly string[] {
	return isLight(bg) ? INK_SHADES : GREY_SHADES;
}

/** Grey level (0..255) for a normalised value, with `dirtier = darker` on light bg. */
export function levelFor(v: number, bg: string, gamma = 1): number {
	const b = Math.pow(Math.max(0, Math.min(1, v)), gamma);
	return Math.round((isLight(bg) ? 1 - b : b) * 255);
}
