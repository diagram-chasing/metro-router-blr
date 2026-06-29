import { read } from '$app/server';
import connectivityUrl from '$lib/assets/connectivity.json?url';
import { latLngToCell } from 'h3-js';

import type { Connectivity, ConnectivityMode } from '$lib/receipt/receipt';

// ── Area-to-area transit connectivity ──
// connectivity.json holds the daily public-transport trips between every pair of
// Bengaluru areas, where an "area" is an H3 resolution-8 hexagon. The map is keyed
// origin-hex → destination-hex → counts, with the per-mode totals (bus / ac_bus /
// metro), the overall total, and the busiest few routes serving each mode. We map
// the visitor's drawn origin and destination to their hexes and read off the cell.
//
// Server-only on purpose: the file is ~22 MB, so it stays out of the client bundle
// (receipt.ts is bundled for the browser) and is read once, lazily, at runtime.

const H3_RESOLUTION = 8;

// Counts in the dataset cover both travel directions on a pair; a commute is one
// direction, so we halve them to match the route the visitor actually drew.
const DIRECTION_FACTOR = 2;

type ConnCell = {
	ac_bus: number;
	ac_bus_top_routes: string[]; // busiest route short-names, already top-N
	bus: number;
	bus_top_routes: string[];
	metro: number;
	metro_top_routes: string[];
	total: number;
};

type ConnData = Record<string, Record<string, ConnCell>>;

// Display order is cleanest-first (metro, then AC bus, then ordinary bus); each entry
// names the count field and its parallel top-routes field in the JSON cell.
const MODE_META: { key: ConnectivityMode['key']; label: string; routesField: keyof ConnCell }[] = [
	{ key: 'metro', label: 'Metro', routesField: 'metro_top_routes' },
	{ key: 'ac_bus', label: 'AC Bus', routesField: 'ac_bus_top_routes' },
	{ key: 'bus', label: 'Bus', routesField: 'bus_top_routes' }
];

let cache: Promise<ConnData> | null = null;
function loadConnectivity(): Promise<ConnData> {
	if (!cache) cache = read(connectivityUrl).text().then((t) => JSON.parse(t) as ConnData);
	return cache;
}

/**
 * Transit connectivity between the visitor's drawn origin and destination
 * ([lng, lat] each), or null when either point is missing or the pair has no
 * recorded trips. Counts are symmetric for a pair, so we read either drop order.
 */
export async function lookupConnectivity(
	origin: [number, number] | undefined,
	destination: [number, number] | undefined
): Promise<Connectivity | null> {
	if (!origin || !destination) return null;

	const [originLng, originLat] = origin;
	const [destLng, destLat] = destination;
	const originH3 = latLngToCell(originLat, originLng, H3_RESOLUTION);
	const destH3 = latLngToCell(destLat, destLng, H3_RESOLUTION);

	const data = await loadConnectivity();
	const cell = data[originH3]?.[destH3] ?? data[destH3]?.[originH3];
	if (!cell) return null;

	const oneWay = (n: number) => Math.round(Number(n ?? 0) / DIRECTION_FACTOR);

	const modes: ConnectivityMode[] = MODE_META.map((m) => ({
		key: m.key,
		label: m.label,
		trips: oneWay(cell[m.key]),
		routes: ((cell[m.routesField] as string[]) ?? []).filter((name): name is string => !!name)
	})).filter((m) => m.trips > 0);

	return { originH3, destH3, total: oneWay(cell.total), modes };
}
