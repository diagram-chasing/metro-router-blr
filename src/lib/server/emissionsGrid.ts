// Accumulating emissions raster over the city: a city grid + a spatial decay kernel
// + a grayscale field. Each accumulated route deposits its own CO₂e — by the mode
// actually chosen, per the per-passenger-km factors in emissions.ts — smeared along
// the real polyline. Same corridor glows ~10× more for a solo cab than a bus; the
// "difference your choice makes" falls straight out of the factors.
//
// Three grid types:
//   raw  — absolute annual emissions burden along the corridors people travel.
//   diff — excess over a cleaner choice along the same route (factor − metro),
//          so transit/walk legs go dark and only the dirty legs glow.
//   cf   — counterfactual "more public transport" (see GridType below).

import { MODE_CO2E_G_PER_PKM, legKindToMode, haversineKm } from '$lib/emissions';
import { listLines, type LineRow } from './db';

// ── Grid: cell centres on a 0.01° lattice over Bengaluru ──
const CELL = 0.01;
const LAT_MIN = 12.8235;
const LON_MIN = 77.4499;
const N_LAT = 34;
const N_LON = 35;
const LAT_MAX = 13.1535;
const LON_MAX = 77.7899;

// Resampling + kernel.
const STEP_KM = 0.25; // polyline sample spacing
const KM_PER_DEG_LAT = 111.32;
const DEFAULT_DECAY_KM = 1.2;
const FALLBACK_TRIPS_PER_YEAR = 288; // legacy rows with NULL trips_per_year

// raw — emissions as actually travelled.
// diff — excess over metro along the same corridor (only dirty legs glow).
// cf  — counterfactual "more public transport": walk and existing bus/metro legs
//       keep their own factor; private legs (auto/cab) shift a *fraction* of
//       their trips (CF_SHIFT) onto a bus+metro blend. A full switch is
//       unrealistic — at most ~half of a person's trips move to transit.
export type GridType = 'raw' | 'diff' | 'cf';

// Share of private-leg trips assumed to move to public transport in the
// counterfactual. 0.5 = half; the rest stay as driven.
export const DEFAULT_CF_SHIFT = 0.5;

export type Field = {
	nLat: number;
	nLon: number;
	bbox: [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
	values: number[]; // row-major lat(asc) × lon(asc), normalised 0..1
	rawMax: number; // pre-normalisation peak of the deposit (for reference)
};

function factorFor(kind: LineRow['segments'][number]['legKind']): number {
	return MODE_CO2E_G_PER_PKM[legKindToMode(kind)];
}

// The "cleaner choice" baseline for diff = the metro per-pkm factor. We store the
// chosen route, not the alternative's geometry, so we apply metro's factor along
// the visitor's own corridor: excess = max(0, chosen − metro).
function cleanFactor(): number {
	return MODE_CO2E_G_PER_PKM.metro;
}

// "Any public transport" — the bus/metro blend used to re-cost private legs in
// the counterfactual grid. Walk and existing bus/metro legs keep their own.
function publicTransitFactor(): number {
	return (MODE_CO2E_G_PER_PKM.bus + MODE_CO2E_G_PER_PKM.metro) / 2;
}

function cfFactor(kind: LineRow['segments'][number]['legKind'], shift: number): number {
	const own = factorFor(kind);
	const mode = legKindToMode(kind);
	if (mode === 'active' || mode === 'bus' || mode === 'metro') return own; // already clean/transit
	// Private leg: a fraction `shift` of trips move to public transport.
	return (1 - shift) * own + shift * publicTransitFactor();
}

// Stamp one line-source sample (weight already in emissions units) into the grid,
// touching only cells within ~3 decay lengths.
function stamp(
	grid: Float64Array,
	lng: number,
	lat: number,
	weight: number,
	decayKm: number
): void {
	if (weight <= 0) return;
	const ci = Math.round((lat - LAT_MIN) / CELL);
	const cj = Math.round((lng - LON_MIN) / CELL);
	const cellKm = KM_PER_DEG_LAT * CELL;
	const radius = Math.max(1, Math.ceil((3 * decayKm) / cellKm));
	for (let di = -radius; di <= radius; di++) {
		const i = ci + di;
		if (i < 0 || i >= N_LAT) continue;
		const cellLat = LAT_MIN + i * CELL;
		for (let dj = -radius; dj <= radius; dj++) {
			const j = cj + dj;
			if (j < 0 || j >= N_LON) continue;
			const cellLon = LON_MIN + j * CELL;
			const d = haversineKm(lng, lat, cellLon, cellLat);
			grid[i * N_LON + j] += weight * Math.exp(-d / decayKm);
		}
	}
}

// Deposit one route: walk each segment, drop a sample every STEP_KM, each carrying
// (factor or excess) × tripsPerYear × stepKm of that mode's emissions.
function depositLine(
	grid: Float64Array,
	line: LineRow,
	type: GridType,
	decayKm: number,
	shift: number
): void {
	const trips = line.tripsPerYear ?? FALLBACK_TRIPS_PER_YEAR;
	const clean = cleanFactor();
	for (const seg of line.segments) {
		const factor = factorFor(seg.legKind);
		const perKm =
			type === 'cf'
				? cfFactor(seg.legKind, shift)
				: type === 'diff'
					? Math.max(0, factor - clean)
					: factor;
		if (perKm <= 0) continue;
		const coords = seg.coords;
		for (let k = 1; k < coords.length; k++) {
			const [lng1, lat1] = coords[k - 1];
			const [lng2, lat2] = coords[k];
			const legKm = haversineKm(lng1, lat1, lng2, lat2);
			if (legKm <= 0) continue;
			const nSub = Math.max(1, Math.ceil(legKm / STEP_KM));
			const stepKm = legKm / nSub;
			const weight = perKm * trips * stepKm;
			for (let s = 0; s < nSub; s++) {
				const t = (s + 0.5) / nSub;
				stamp(grid, lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t, weight, decayKm);
			}
		}
	}
}

export type FieldOpts = {
	type: GridType;
	decayKm?: number;
	shift?: number; // cf only: share of private-leg trips moved to transit
};

export function buildField(opts: FieldOpts): Field {
	const { type, decayKm = DEFAULT_DECAY_KM, shift = DEFAULT_CF_SHIFT } = opts;

	const grid = new Float64Array(N_LAT * N_LON);
	for (const line of listLines({})) depositLine(grid, line, type, decayKm, shift);

	let depMax = 0;
	for (const v of grid) if (v > depMax) depMax = v;

	const values = new Array<number>(grid.length);
	for (let i = 0; i < grid.length; i++) values[i] = depMax > 0 ? grid[i] / depMax : 0;

	return {
		nLat: N_LAT,
		nLon: N_LON,
		bbox: [LON_MIN, LAT_MIN, LON_MAX, LAT_MAX],
		values,
		rawMax: depMax
	};
}
