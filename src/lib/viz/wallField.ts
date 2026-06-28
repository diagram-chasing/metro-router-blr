import type { ChoroplethField, Field } from './choroplethField';
import { WALL } from '$lib/config/wall';

// Resting camera: framed on the emissions-grid bbox once it's known.
export const REST = { lng: 77.6199, lat: 12.9885, zoom: 11 };

// Positive-number URL param with a default (rejects NaN, 0 and negatives — callers that
// need 0 to stay meaningful parse it directly instead).
export function numParam(p: URLSearchParams, k: string, d: number): number {
	const v = Number(p.get(k));
	return isFinite(v) && v > 0 ? v : d;
}

// Boolean URL param: absent → default; '0'/'false' → false; anything else → true.
export function flagParam(p: URLSearchParams, k: string, d: boolean): boolean {
	const v = p.get(k);
	return v === null ? d : v !== '0' && v !== 'false';
}

// The emissions-field endpoint for a given cell size (degrees).
export function emissionsFieldUrl(cellDeg: number): string {
	return `/api/emissions?grid=raw&decay=${WALL.decayKm}&cell=${cellDeg}`;
}

// Flatten a line's per-segment coords into one ordered point list.
export function flattenSegments(segments: { coords: [number, number][] }[]): [number, number][] {
	const pts: [number, number][] = [];
	for (const s of segments) for (const c of s.coords) pts.push(c);
	return pts;
}

type BaselineGrid = {
	nLat: number;
	nLon: number;
	bbox: [number, number, number, number];
	values: number[];
};

// Fetch the baked ACAG ambient-PM2.5 baseline and apply it to the field. Failure is
// logged and swallowed — the field still runs (just without the resting baseline).
export async function loadBaseline(field: ChoroplethField, label = 'baseline'): Promise<void> {
	try {
		const res = await fetch('/baseline-grid.json');
		const b = (await res.json()) as BaselineGrid;
		field.setBaseline(b);
	} catch (err) {
		console.warn(`${label} load failed:`, err);
	}
}

// Fetch a fresh emissions snapshot and apply it at clock time `now`. Logged/swallowed.
export async function pollField(
	field: ChoroplethField,
	url: string,
	now: number,
	label = 'field poll'
): Promise<void> {
	try {
		const res = await fetch(url);
		const raw = (await res.json()) as Field;
		field.setSnapshot(raw, now);
	} catch (err) {
		console.warn(`${label} load failed:`, err);
	}
}
