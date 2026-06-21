// [1] Aryan, Shinde & Dikshit (2025), "Evaluating the emission reduction
//     potential of first underground metro rail in Mumbai", Discover
//     Sustainability, doi:10.1007/s43621-025-01994-0. Tables 2 & 3 — India
//     BS-IV/BS-VI fleet-weighted tailpipe CO2 factors and occupancies.
// [2] CEA CO2 Baseline Database v20.0 (Dec 2024), FY2023-24 — all-India grid
//     emission factor (weighted average 0.727 kg CO2/kWh).
// [3] TERI (2017), "Estimating vehicular emissions" (Bengaluru) — LPG auto.
// [4] CPCB (2015) / ARAI (2011) road-transport six-cities study — bus factors.

import type { Mode } from './types';

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
