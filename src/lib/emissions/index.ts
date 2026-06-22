// The carbon model: the single authority that turns a journey into carbon.
// Canonical rule — blend over the actual legs (a walk-access leg counts as 0).
// Everything downstream (receipt headline, wall-map grey bucket, emissions field)
// reads kilometres, intensity, and per-trip kg from here, so they cannot diverge.

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
	car: 130, // private petrol car, BS-IV/VI weighted [1]
	cab_solo: 143, // app cab (CNG/petrol mix) [1]
	cab_shared: 143, // same vehicle as cab_solo; difference is occupancy below
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
	cab_solo: 1.0,
	cab_shared: 2.5,
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

/** Grams CO2e per passenger-km, well-to-wheel. */
export const MODE_CO2E_G_PER_PKM: Record<Mode, number> = derive(
	{ metro: METRO_CO2E_G_PER_PKM, active: 0 },
	TAILPIPE_CO2_G_PER_VKM,
	WTW_UPLIFT
);

// Resulting central values (for reference):
//   CO2e g/pkm : cab_solo 172 · car 120 · auto 74 · cab_shared 69 · metro 40 ·
//                two_wheeler 40 · bus 18 · active 0

export const MODE_LABEL: Record<Mode, string> = {
	auto: 'Auto',
	cab_solo: 'Cab',
	cab_shared: 'Cab (pool)',
	car: 'Own car',
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
			return 'cab_solo';
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
//   walk 0 · bus 18 · metro 40 · two_wheeler 40 · cab_shared 69 · auto 74 ·
//   car 120 · cab_solo 172.
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
