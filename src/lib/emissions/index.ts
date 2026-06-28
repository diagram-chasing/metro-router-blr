// The emissions model: the single authority that turns a journey into pollution. Two tracks
// from the same legs — CARBON (g CO2e/pkm, a global greenhouse gas: the receipt's footprint and
// the wall-map grey bucket) and LOCAL AIR QUALITY (g PM2.5/pkm, tailpipe particulate: the wall's
// "years of life lost" field). Canonical rule — blend over the actual legs (a walk-access leg
// counts as 0). Everything downstream reads from here, so the views cannot diverge.

// [1] Aryan, Shinde & Dikshit (2025), "Evaluating the emission reduction
//     potential of first underground metro rail in Mumbai", Discover
//     Sustainability, doi:10.1007/s43621-025-01994-0. Tables 2 & 3 — India
//     BS-IV/BS-VI fleet-weighted tailpipe CO2 factors and occupancies.
// [2] CEA CO2 Baseline Database v20.0 (Dec 2024), FY2023-24 — all-India grid
//     emission factor (weighted average 0.727 kg CO2/kWh).
// [3] TERI (2017), "Estimating vehicular emissions" (Bengaluru) — LPG auto.
// [4] CPCB (2015) / ARAI (2011) road-transport six-cities study — bus factors.

import type { Mode } from '$lib/exhibit/types';
import type { LegKind } from '$lib/exhibit/routeCandidates';

// ── Per-mode factor model ──

// road tailpipe CO2 (g per VEHICLE-km), India fleet-weighted
// Source [1] Table 2, except auto (LPG, Bengaluru) from [3] and bus from [4].
const TAILPIPE_CO2_G_PER_VKM: Record<Mode, number> = {
	car: 130, // own-car tailpipe; the selectable "car / cab" mode is a blend — see CAR_CAB below
	auto: 92, // LPG three-wheeler, Bengaluru [3]
	two_wheeler: 40, // real-world petrol 2W (between [1] 24.8 and ICCT new-fleet 38.2)
	bus: 602, // BMTC diesel, BS-III/IV [4]
	metro: 0, // electric — handled by the grid model below
	active: 0
};

// average occupancy (passengers per vehicle), urban India
// Source [1] Table 3 and Indian urban conventions. Bus is an average city load.
const OCCUPANCY: Record<Mode, number> = {
	car: 1.3,
	auto: 1.5,
	two_wheeler: 1.2,
	bus: 40,
	metro: 1, // metro factor is already per-passenger (see grid model)
	active: 1
};

// Well-to-wheel uplift over tailpipe for fuel extraction/refining/distribution.
const WTW_UPLIFT = 1.2;

// Metro
// Specific energy consumption per passenger-km. Anchor: Mumbai Line 3 [1]
// (1207 MWh/day ÷ 18.72M pkm/day ≈ 64 Wh/pkm at design load), nudged down for
// Namma Metro's mostly-elevated network (lower auxiliary/AC load). Range 50-110.
const METRO_SEC_WH_PER_PKM = 60;
// All-India grid factor [2]. (CEA publishes no separate Karnataka factor — one
// synchronized grid — so the national average is the correct attribution basis.)
const GRID_CO2_G_PER_KWH = 710;
// BMRCL on-site rooftop solar is ~2-3% of consumption with no large green PPA
// confirmed; a small 5% share is generous. (Contrast DMRC's ~35% via Rewa.)
const METRO_SOLAR_SHARE = 0.05;

// Wh × (g/kWh) cancels to g/pkm (Wh→kWh is ÷1000, kept as g).
const METRO_CO2E_G_PER_PKM =
	(METRO_SEC_WH_PER_PKM / 1000) * GRID_CO2_G_PER_KWH * (1 - METRO_SOLAR_SHARE);

function derive<T extends Record<Mode, number>>(
	special: Partial<Record<Mode, number>>,
	base: T,
	uplift: number
): Record<Mode, number> {
	const out = {} as Record<Mode, number>;
	for (const mode of Object.keys(base) as Mode[]) {
		if (mode in special) {
			out[mode] = special[mode] as number;
		} else {
			out[mode] = (base[mode] / OCCUPANCY[mode]) * uplift;
		}
	}
	return out;
}

// Merged "car / cab": one private four-wheeler mode, owned or hailed. Set to the mean
// of the former own-car (120) and solo-cab (172) per-pkm figures — the two single-
// occupant 4-wheeler values this option now spans. (Cab-pool, 69, folds in here too;
// pooling was never separately selectable.) Special-cased like metro/active because it
// represents a behaviour blend, not one vehicle-occupancy pair.
const CAR_CAB_CO2E_G_PER_PKM = 145;

/** Grams CO2e per passenger-km, well-to-wheel. */
export const MODE_CO2E_G_PER_PKM: Record<Mode, number> = derive(
	{ metro: METRO_CO2E_G_PER_PKM, active: 0, car: CAR_CAB_CO2E_G_PER_PKM },
	TAILPIPE_CO2_G_PER_VKM,
	WTW_UPLIFT
);

// Resulting central values (for reference):
//   CO2e g/pkm : car/cab 145 · auto 74 · metro 40 · two_wheeler 40 · bus 18 · active 0

// ── Local air-quality (PM2.5) model ──
// The wall is an AIR-QUALITY map: health.ts turns PM2.5 concentration into "years of life lost".
// CO2 (above) is a global greenhouse gas and says nothing about local air quality, so the wall
// field is driven by these tailpipe PM2.5 factors instead.
//
// Source: CSTEP (2023), "Bengaluru 2030: Impact of EVs on Vehicular Emissions", Table 5 (PM2.5
// g/km by class × vehicle age) fleet-weighted by Table 6 (age composition). Per-band PM2.5 (g/km)
// and the age weights (0-5 / 5-10 / 10-15+):
//   2W   : 0.0117 0.0225 0.0225   ·  48% / 37% / 15%
//   3W   : 0.0135 0.0135 0.0135   ·  48% / 37% / 15%
//   4W(P): 0.0018 0.0054 0.0054   ·  35% / 34% / 32%
//   4W(C): 0.4275 0.5085 0.5085   ·  50% / 36% / 14%   (Table 6 has no 4W(C) column; uses 4W(L)
//                                                        as the commercial-fleet age proxy)
//   Bus  : 0.378  2.8845 2.8845   ·  42% / 38% / 20%
// "car" = 50/50 blend of 4W(P) personal and 4W(C) commercial/cab (the car/cab option spans both).
// metro = 0 (electric, zero tailpipe). TAILPIPE PM — no well-to-wheel uplift.

// Fleet-weighted tailpipe PM2.5 (g per VEHICLE-km).
const MODE_PM25_G_PER_VKM: Record<Mode, number> = {
	two_wheeler: 0.0173, // 0.0117·.48 + 0.0225·.37 + 0.0225·.15
	auto: 0.0135, // constant across age bands
	car: 0.236, // 50/50 of 4W(P) 0.0042 and 4W(C) 0.468
	bus: 1.832, // 0.378·.42 + 2.8845·.38 + 2.8845·.20
	metro: 0,
	active: 0
};

// Per-passenger-km PM2.5 (g/pkm): a rider's fair share, dividing by occupancy as the CO2 model
// does. Swap the divisor for 1 to attribute the whole vehicle's PM to the trip instead (which
// would make diesel-bus corridors dominate the field rather than low-occupancy cars).
export const MODE_PM25_G_PER_PKM: Record<Mode, number> = (() => {
	const out = {} as Record<Mode, number>;
	for (const mode of Object.keys(MODE_PM25_G_PER_VKM) as Mode[]) {
		out[mode] = MODE_PM25_G_PER_VKM[mode] / OCCUPANCY[mode];
	}
	return out;
})();

// Central values (g PM2.5/pkm, for reference):
//   car 0.182 · bus 0.046 · two_wheeler 0.014 · auto 0.009 · metro 0
// The dirtiest mode's per-pkm PM2.5 — the reference a route's emission is normalised against when
// scaling its on-screen field bump (so metro → 0, car → full).
export const PM25_MAX_G_PER_PKM = Math.max(...Object.values(MODE_PM25_G_PER_PKM));

// Modeled mode-share of a typical Bengaluru arterial (illustrative CTTP blend, flagged as a model
// on the receipt). Single source of truth — the receipt's corridor beat and the wall's
// represented-traffic model both read it, so they cannot diverge. Shares sum to 1.
export const CORRIDOR_SHARE: Record<string, number> = {
	bus: 0.38,
	two_wheeler: 0.26,
	car: 0.19, // car + cab merged
	auto: 0.12,
	metro: 0.05
};

// Length-weighted PM2.5 intensity of the corridor mode mix (g/passenger-km ≈ 0.0568) — used to turn
// a corridor's people/day into its represented annual PM2.5 for the wall's coverage figure.
export const CORRIDOR_BLEND_PM25_G_PER_PKM = Object.entries(CORRIDOR_SHARE).reduce(
	(sum, [mode, w]) => sum + w * (MODE_PM25_G_PER_PKM[mode as Mode] ?? 0),
	0
);

export const MODE_LABEL: Record<Mode, string> = {
	auto: 'Auto',
	car: 'Car / cab',
	two_wheeler: 'Two-wheeler',
	bus: 'Bus',
	metro: 'Metro',
	active: 'Walk / cycle'
};

// First/last-mile split for multimodal trips: short access leg capped at 1.6 km
// each end (a realistic walk-or-auto access distance to a metro station),
// remainder on the trunk mode.
export function firstLastMileKm(distanceKm: number): {
	firstMile: number;
	main: number;
	lastMile: number;
} {
	const firstMile = Math.min(1.6, distanceKm * 0.2);
	const lastMile = Math.min(1.6, distanceKm * 0.2);
	const main = Math.max(0, distanceKm - firstMile - lastMile);
	return { firstMile, main, lastMile };
}

// ── Leg → mode ──

/** Map a route-candidate leg kind to the emissions Mode it should be costed as.
 *  CandidateKind shares its members with LegKind, so this also maps a route's
 *  primary mode (chosenKind) to its representative Mode. */
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
			return 'car'; // the road / taxi leg is costed as the merged car/cab mode
	}
}

// ── Geometry: the one haversine ──

const R_KM = 6371;
const D2R = Math.PI / 180;

/** Great-circle distance between two [lng,lat] points, in km. */
export function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
	const dLat = (lat2 - lat1) * D2R;
	const dLng = (lng2 - lng1) * D2R;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLng / 2) ** 2;
	return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Great-circle length of a [lng,lat] polyline, in km. */
export function lengthKm(coords: [number, number][]): number {
	if (coords.length < 2) return 0;
	let km = 0;
	for (let i = 1; i < coords.length; i++) {
		const [lng1, lat1] = coords[i - 1];
		const [lng2, lat2] = coords[i];
		km += haversineKm(lng1, lat1, lng2, lat2);
	}
	return km;
}

// ── Grey bucket ──

// Thresholds anchored to the per-passenger-km values above:
//   walk 0 · bus 18 · metro 40 · two_wheeler 40 · auto 74 · car/cab 145.
// bucket i is gPerKm < BUCKET_MAX[i]; values at/above the last threshold are the top bucket.
export const BUCKET_MAX = [15, 45, 80, 130] as const;

/** Bucket a blended CO2/pkm value into 0..4 (brighter grey = dirtier). */
export function bucket(gPerKm: number): number {
	for (let i = 0; i < BUCKET_MAX.length; i++) {
		if (gPerKm < BUCKET_MAX[i]) return i;
	}
	return BUCKET_MAX.length; // 4
}

// ── Journey emissions ──

export type Leg = { coords: [number, number][]; legKind: LegKind };

export type Emissions = {
	km: number; // summed great-circle length over all legs
	gPerKm: number; // length-weighted blended intensity (g CO2e per passenger-km)
	kgPerTrip: number; // total CO2e for one trip, kg
	bucket: number; // 0..4 grey bucket
};

/**
 * Canonical journey emissions: blend each leg's per-pkm factor by its length.
 * A walk-access leg contributes distance but 0 emissions, diluting intensity —
 * the honest figure for a multimodal trip. Returns zeros for an empty route.
 */
export function routeEmissions(legs: Leg[]): Emissions {
	let weighted = 0;
	let totalKm = 0;
	for (const leg of legs) {
		const km = lengthKm(leg.coords);
		if (km <= 0) continue;
		weighted += km * MODE_CO2E_G_PER_PKM[legKindToMode(leg.legKind)];
		totalKm += km;
	}
	const gPerKm = totalKm > 0 ? weighted / totalKm : 0;
	return { km: totalKm, gPerKm, kgPerTrip: weighted / 1000, bucket: bucket(gPerKm) };
}

/**
 * Single-mode fallback for a journey with no leg geometry: one mode over the
 * whole distance. Equivalent to a one-leg route of that mode.
 */
export function tripEmissions(mode: Mode, km: number): Emissions {
	const gPerKm = MODE_CO2E_G_PER_PKM[mode];
	return { km, gPerKm, kgPerTrip: (km * gPerKm) / 1000, bucket: bucket(gPerKm) };
}

// ── Journey PM2.5 (local air quality) ──

export type RoutePM25 = { km: number; gPerKm: number; gPerTrip: number };

/**
 * PM2.5 counterpart of routeEmissions: length-blend each leg's per-passenger-km PM2.5 factor.
 * Walk and metro legs contribute 0. Returns zeros for an empty route.
 */
export function routePM25(legs: Leg[]): RoutePM25 {
	let weighted = 0;
	let totalKm = 0;
	for (const leg of legs) {
		const km = lengthKm(leg.coords);
		if (km <= 0) continue;
		weighted += km * MODE_PM25_G_PER_PKM[legKindToMode(leg.legKind)];
		totalKm += km;
	}
	const gPerKm = totalKm > 0 ? weighted / totalKm : 0;
	return { km: totalKm, gPerKm, gPerTrip: weighted };
}

/**
 * Total grams of PM2.5 a commute deposits over `years` of travel: per-pkm factor × trip km ×
 * trips/year × years. The wall's tangible "this much soot" figure (0 for a metro/walk commute).
 */
export function pm25GramsOverYears(
	gPerPkm: number,
	km: number,
	tripsPerYear: number,
	years: number
): number {
	return gPerPkm * km * tripsPerYear * years;
}
