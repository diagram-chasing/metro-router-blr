// Emission factors and preset math. Shared between the client (Q3 preset panel)
// and the server (receipt math), so swapping placeholders for validated
// Bengaluru figures only happens in one place.

import type { Mode } from './types';

// g CO2 per passenger-km. PLACEHOLDER values per spec §8.
export const MODE_FACTOR_G_PER_KM: Record<Mode, number> = {
	car: 180,
	cab_solo: 150,
	auto: 110,
	cab_shared: 80,
	two_wheeler: 60,
	bus: 40,
	metro: 30,
	active: 0
};

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

export type Preset = {
	key: 'private' | 'metro_mixed' | 'metro_walk';
	name: string;
	description: string;
	perTripKg: number;
};

// Split heuristic — first/last mile capped at 1.6 km, otherwise 20% of route.
function firstLastMileKm(distanceKm: number): { firstMile: number; main: number; lastMile: number } {
	const firstMile = Math.min(1.6, distanceKm * 0.2);
	const lastMile = Math.min(1.6, distanceKm * 0.2);
	const main = Math.max(0, distanceKm - firstMile - lastMile);
	return { firstMile, main, lastMile };
}

export function computePresets(distanceKm: number, mode: Mode): Preset[] {
	if (!distanceKm || distanceKm <= 0) return [];

	const privateKg = (distanceKm * MODE_FACTOR_G_PER_KM[mode]) / 1000;
	const { firstMile, main, lastMile } = firstLastMileKm(distanceKm);

	const mixedG =
		firstMile * MODE_FACTOR_G_PER_KM.auto +
		main * MODE_FACTOR_G_PER_KM.metro +
		lastMile * MODE_FACTOR_G_PER_KM.auto;

	const walkG = main * MODE_FACTOR_G_PER_KM.metro;

	return [
		{
			key: 'private',
			name: 'DOOR TO DOOR',
			description: `${MODE_LABEL[mode]} the whole way`,
			perTripKg: round(privateKg, 2)
		},
		{
			key: 'metro_mixed',
			name: 'METRO + AUTO',
			description: 'short auto · metro · short auto',
			perTripKg: round(mixedG / 1000, 2)
		},
		{
			key: 'metro_walk',
			name: 'METRO + WALK',
			description: 'walk · metro · walk',
			perTripKg: round(walkG / 1000, 2)
		}
	];
}

function round(n: number, digits = 0): number {
	const f = Math.pow(10, digits);
	return Math.round(n * f) / f;
}
