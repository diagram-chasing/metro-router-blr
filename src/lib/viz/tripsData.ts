// Turns an accumulated commute (/api/lines) into animated trail geometry.
//
// Each leg becomes its own path so it can carry its mode's colour, but the
// per-vertex timestamps run continuously across the whole trip — so the comet
// head hands off cleanly at leg boundaries (metro→walk changes colour mid-flight
// at constant speed). Speed is normalised to TRIP_DURATION regardless of trip
// length, so a 2 km hop and a 20 km haul read at the same pace on the wall.

import { legColor, type RGB } from './palette';
import type { LegKind } from '$lib/exhibit/routeCandidates';

export type WireLine = {
	id: number;
	greyBucket: number;
	co2PerKmG: number;
	chosenMode: string;
	segments: { coords: [number, number][]; legKind: string }[];
};

export type LegPath = {
	key: string;
	id: number;
	path: [number, number][];
	timestamps: number[];
	color: [number, number, number, number];
	width: number;
	bucket: number; // 0 clean → 4 dirty (drives counterfactual cooling)
	origin: [number, number];
};

export const TRIP_DURATION = 7; // s — visual traversal time per trip
export const LOOP_PERIOD = 22; // s — the animation loop everything repeats on
export const TRAIL_LENGTH = 2.6; // s — comet-tail length

function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
	const R = 6371;
	const d2r = Math.PI / 180;
	const dLat = (lat2 - lat1) * d2r;
	const dLng = (lng2 - lng1) * d2r;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// A stable per-id slot in the loop. Confined to [0, LOOP_PERIOD - TRIP_DURATION]
// so a trip's whole traversal fits inside one loop with no mid-flight wrap.
function startOffset(id: number): number {
	const x = Math.sin(id * 12.9898) * 43758.5453;
	const frac = x - Math.floor(x);
	return frac * (LOOP_PERIOD - TRIP_DURATION);
}

// Mode hue carries the encoding; bucket (0 clean → 4 dirty) nudges alpha + width
// so dirtier trips read a touch hotter and bolder.
function shade(rgb: RGB, bucket: number): [number, number, number, number] {
	return [rgb[0], rgb[1], rgb[2], Math.min(255, 150 + bucket * 24)];
}

export function lineToLegPaths(line: WireLine): LegPath[] {
	const segs = line.segments.filter((s) => s.coords.length >= 2);
	if (!segs.length) return [];

	// Cumulative distance across the concatenated legs → per-vertex timestamps.
	const cums: number[][] = [];
	let acc = 0;
	let prev: [number, number] | null = null;
	for (const s of segs) {
		const cum: number[] = [];
		for (const v of s.coords) {
			if (prev) acc += haversineKm(prev[0], prev[1], v[0], v[1]);
			cum.push(acc);
			prev = v;
		}
		cums.push(cum);
	}
	const total = acc || 1;
	const off = startOffset(line.id);
	const bucket = Math.max(0, Math.min(4, line.greyBucket));
	const origin = segs[0].coords[0];

	return segs.map((s, i) => ({
		key: `${line.id}-${i}`,
		id: line.id,
		path: s.coords,
		timestamps: cums[i].map((d) => off + TRIP_DURATION * (d / total)),
		color: shade(legColor((s.legKind as LegKind) || 'cab'), bucket),
		width: 2 + bucket * 0.6,
		bucket,
		origin
	}));
}
