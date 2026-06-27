// Accumulating air-quality raster over the city: a city grid + a spatial decay kernel
// + a grayscale field. Each accumulated route deposits its own tailpipe PM2.5 — by the mode
// actually chosen, per the per-passenger-km factors in emissions.ts — smeared along the real
// polyline. This drives the wall's "years of life lost" health field, so it must be the LOCAL
// pollutant (PM2.5), not CO₂ (a global greenhouse gas that says nothing about air quality).
// Metro deposits nothing (zero tailpipe); a solo car corridor glows brightest.
//
// Three grid types:
//   raw  — absolute annual PM2.5 burden along the corridors people travel.
//   diff — excess over a cleaner choice along the same route (factor − metro); since metro PM2.5
//          is 0 this equals raw (any tailpipe PM above zero-emission transit is excess).
//   cf   — counterfactual "more public transport" (see GridType below).

import { MODE_PM25_G_PER_PKM, legKindToMode, haversineKm } from '$lib/emissions';
import { listLines, type LineRow } from './db';

// ── Grid: cell centres on a uniform lattice over Bengaluru ──
// The bbox corners are fixed; cell size is a per-build knob so the same kernel can
// be sampled at 0.01° (the 3D wall, ~1.1 km) or 0.005° (the choropleth, ~500 m,
// matching the CHETNA-Road grid). Default reproduces the original 34×35 grid.
const CELL = 0.01;
const LAT_MIN = 12.8235;
const LON_MIN = 77.4499;
const LAT_MAX = 13.1535;
const LON_MAX = 77.7899;

type Grid = {
	cell: number;
	latMin: number;
	lonMin: number;
	lonMax: number;
	latMax: number;
	nLat: number;
	nLon: number;
};

function makeGrid(cell: number): Grid {
	return {
		cell,
		latMin: LAT_MIN,
		lonMin: LON_MIN,
		lonMax: LON_MAX,
		latMax: LAT_MAX,
		nLat: Math.round((LAT_MAX - LAT_MIN) / cell) + 1, // 0.01 → 34, 0.005 → 67
		nLon: Math.round((LON_MAX - LON_MIN) / cell) + 1 // 0.01 → 35, 0.005 → 67
	};
}

// Resampling + kernel.
const STEP_KM = 0.25; // polyline sample spacing
const KM_PER_DEG_LAT = 111.32;
const DEFAULT_DECAY_KM = 1.2;
const FALLBACK_TRIPS_PER_YEAR = 288; // legacy rows with NULL trips_per_year

// Slow rolling decay: a route's contribution halves every HALF_LIFE_DAYS, so the field
// stays "live" and bounded over a long exhibition run instead of accreting to all-red.
// Operators can still hard-reset via /api/admin purge; this just keeps it legible untouched.
const DEFAULT_HALF_LIFE_DAYS = 7;
// Robust normalisation percentile: scale to the 99.5th-percentile deposit, not the raw
// peak, so a single hot corridor can't crush every other cell's dynamic range (a soft
// saturation ceiling — cells at/above it clamp to 1).
const SATURATION_PCTL = 0.995;

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
	return MODE_PM25_G_PER_PKM[legKindToMode(kind)];
}

// The "cleaner choice" baseline for diff = the metro per-pkm factor (0 for PM2.5). We store the
// chosen route, not the alternative's geometry, so we apply metro's factor along the visitor's
// own corridor: excess = max(0, chosen − metro).
function cleanFactor(): number {
	return MODE_PM25_G_PER_PKM.metro;
}

// "Any public transport" — the bus/metro blend used to re-cost private legs in
// the counterfactual grid. Walk and existing bus/metro legs keep their own.
function publicTransitFactor(): number {
	return (MODE_PM25_G_PER_PKM.bus + MODE_PM25_G_PER_PKM.metro) / 2;
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
	g: Grid,
	lng: number,
	lat: number,
	weight: number,
	decayKm: number
): void {
	if (weight <= 0) return;
	const ci = Math.round((lat - g.latMin) / g.cell);
	const cj = Math.round((lng - g.lonMin) / g.cell);
	const cellKm = KM_PER_DEG_LAT * g.cell;
	const radius = Math.max(1, Math.ceil((3 * decayKm) / cellKm));
	for (let di = -radius; di <= radius; di++) {
		const i = ci + di;
		if (i < 0 || i >= g.nLat) continue;
		const cellLat = g.latMin + i * g.cell;
		for (let dj = -radius; dj <= radius; dj++) {
			const j = cj + dj;
			if (j < 0 || j >= g.nLon) continue;
			const cellLon = g.lonMin + j * g.cell;
			const d = haversineKm(lng, lat, cellLon, cellLat);
			grid[i * g.nLon + j] += weight * Math.exp(-d / decayKm);
		}
	}
}

// Deposit one route: walk each segment, drop a sample every STEP_KM, each carrying
// (factor or excess) × tripsPerYear × stepKm of that mode's emissions.
function depositLine(
	grid: Float64Array,
	g: Grid,
	line: LineRow,
	type: GridType,
	decayKm: number,
	shift: number,
	timeWeight: number // 0..1 temporal decay for this route's age
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
			const weight = perKm * trips * stepKm * timeWeight;
			for (let s = 0; s < nSub; s++) {
				const t = (s + 0.5) / nSub;
				stamp(grid, g, lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t, weight, decayKm);
			}
		}
	}
}

export type FieldOpts = {
	type: GridType;
	decayKm?: number;
	shift?: number; // cf only: share of private-leg trips moved to transit
	cell?: number; // grid cell size in degrees (default 0.01 ≈ 1.1 km; 0.005 ≈ 500 m)
	halfLifeDays?: number; // temporal decay half-life (default 7d); ≤0 disables decay
	nowMs?: number; // injectable "now" for testing; defaults to Date.now()
};

// Robust peak = the SATURATION_PCTL-th percentile of non-zero deposits, so one hot
// corridor doesn't define (and crush) the whole scale. Cells at/above it clamp to 1.
function robustPeak(grid: Float64Array): number {
	const nz: number[] = [];
	for (const v of grid) if (v > 0) nz.push(v);
	if (nz.length === 0) return 0;
	nz.sort((a, b) => a - b);
	return nz[Math.min(nz.length - 1, Math.floor(nz.length * SATURATION_PCTL))];
}

export function buildField(opts: FieldOpts): Field {
	const { type, decayKm = DEFAULT_DECAY_KM, shift = DEFAULT_CF_SHIFT, cell = CELL } = opts;
	const g = makeGrid(cell);

	const grid = new Float64Array(g.nLat * g.nLon);
	const now = opts.nowMs ?? Date.now();
	const halfLifeDays = opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
	const lambda = halfLifeDays > 0 ? Math.LN2 / (halfLifeDays * 86_400_000) : 0;
	for (const line of listLines({})) {
		const tw = lambda > 0 ? Math.exp(-lambda * Math.max(0, now - line.createdAt)) : 1;
		if (tw < 1e-3) continue; // faded out — negligible contribution, skip
		depositLine(grid, g, line, type, decayKm, shift, tw);
	}

	// Soft saturation ceiling: normalise to the robust peak (and report it as rawMax) so the
	// absolute deposit the wall reconstructs (value × rawMax) is capped there too.
	const denom = robustPeak(grid);
	const values = new Array<number>(grid.length);
	for (let i = 0; i < grid.length; i++) {
		values[i] = denom > 0 ? Math.min(1, grid[i] / denom) : 0;
	}

	return {
		nLat: g.nLat,
		nLon: g.nLon,
		bbox: [g.lonMin, g.latMin, g.lonMax, g.latMax],
		values,
		rawMax: denom
	};
}
