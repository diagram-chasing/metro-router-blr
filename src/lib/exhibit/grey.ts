// Grayscale encoding for the accumulation map.
//
// Each accumulated route is drawn in ONE of five greys, chosen by the route's
// blended CO2 intensity (grams CO2e per passenger-km). The rendered map can be
// captured and recoloured by luminance downstream, so the convention here matters:
//
//   CONVENTION: brighter grey = dirtier route, on a black background.
//   bucket 0 (cleanest, e.g. walk/metro) -> dim grey
//   bucket 4 (dirtiest, e.g. solo cab)   -> near-white

import type { Mode } from './types';
import type { LegKind } from './routeCandidates';
import { MODE_CO2E_G_PER_PKM } from './emissions';

/** Background the lines are drawn on when the base map is hidden. */
export const GREY_BG = '#000000';

/** Five greys, index = bucket. Brightness rises with emissions (see convention). */
export const GREY_SHADES = ['#404040', '#6e6e6e', '#9c9c9c', '#cacaca', '#f5f5f5'] as const;

/** Map a route-candidate leg kind to the emissions Mode it should be costed as. */
export function legKindToMode(kind: LegKind): Mode {
	switch (kind) {
		case 'walk':
			return 'active';
		case 'bus':
			return 'bus';
		case 'metro':
			return 'metro';
		case 'auto':
			return 'auto';
		case 'cab':
		default:
			return 'cab_solo';
	}
}

/** Great-circle length of a [lng,lat] polyline, in km (haversine). */
function polylineKm(coords: [number, number][]): number {
	if (coords.length < 2) return 0;
	const R = 6371;
	const d2r = Math.PI / 180;
	let km = 0;
	for (let i = 1; i < coords.length; i++) {
		const [lng1, lat1] = coords[i - 1];
		const [lng2, lat2] = coords[i];
		const dLat = (lat2 - lat1) * d2r;
		const dLng = (lng2 - lng1) * d2r;
		const a =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
		km += 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
	}
	return km;
}

/**
 * Blended CO2e intensity (g per passenger-km) for a multimodal route: each leg's
 * factor weighted by its length. Returns 0 for an empty/zero-length route.
 */
export function blendedCo2PerKm(
	segments: { coords: [number, number][]; legKind: LegKind }[]
): number {
	let weighted = 0;
	let totalKm = 0;
	for (const seg of segments) {
		const km = polylineKm(seg.coords);
		if (km <= 0) continue;
		weighted += km * MODE_CO2E_G_PER_PKM[legKindToMode(seg.legKind)];
		totalKm += km;
	}
	return totalKm > 0 ? weighted / totalKm : 0;
}

// Thresholds anchored to the per-passenger-km values in emissions.ts:
//   walk 0 · bus 18 · metro 40 · two_wheeler 40 · cab_shared 69 · auto 74 ·
//   car 120 · cab_solo 172.
const BUCKET_MAX = [15, 45, 80, 130]; // bucket i is co2PerKmG < BUCKET_MAX[i]; else top bucket

/** Bucket a blended CO2/pkm value into 0..4. */
export function greyBucket(co2PerKmG: number): number {
	for (let i = 0; i < BUCKET_MAX.length; i++) {
		if (co2PerKmG < BUCKET_MAX[i]) return i;
	}
	return BUCKET_MAX.length; // 4
}
