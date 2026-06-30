import { planTrip, routeTripStats, type OtpItinerary, type OtpModeName } from '$lib/utils/otp';

import type { Connectivity, ConnectivityMode } from '$lib/receipt/receipt';

// ── Trip-level transit connectivity, derived live from OpenTripPlanner ──
// Rather than reading a precomputed area-to-area dataset, we ask OTP how it would
// actually make this trip:
//   1. plan it twice — once over all transit, once metro-only — taking the first
//      NUM_ITINERARIES suggestions from each;
//   2. for ordinary bus and AC bus: pick the most-common transfer count across the
//      all-transit suggestions, and from that template select the busiest routes
//      (by daily trip count) at each leg of the journey;
//   3. for metro: keep the metro lines that serve at least a quarter of the
//      metro-only suggestions.
// Each mode's trip total sums only the routes it actually surfaces.

const NUM_ITINERARIES = 25;

// A metro line is surfaced when it appears in at least this share of the metro-only
// suggestions.
const METRO_MIN_SHARE = 0.25;

// Metro's GTFS trip count is per single-station run, which dwarfs a bus route's
// end-to-end trips; scale it down so the per-mode totals stay comparable.
const METRO_TRIP_DIVISOR = 10;

// Bus GTFS trips cover both directions of a route; a commute is one direction, so
// halve them to match the trip the visitor actually makes.
const BUS_TRIP_DIVISOR = 2;

// How many routes to surface per journey leg, keyed by the number of transfers
// (transit legs − 1): 0 transfers → top 5 of the single leg; 1 transfer → 3 + 2;
// 2+ transfers → 3 + 1 + 1. Index i is the quota for the i-th transit leg.
const LEG_QUOTAS: Record<number, number[]> = {
	0: [5],
	1: [3, 2],
	2: [3, 1, 1]
};
function legQuotas(transfers: number): number[] {
	return LEG_QUOTAS[Math.min(transfers, 2)];
}

type ClassKey = ConnectivityMode['key'];

const CLASS_ORDER: ClassKey[] = ['metro', 'ac_bus', 'bus'];
const CLASS_LABEL: Record<ClassKey, string> = {
	metro: 'Metro',
	ac_bus: 'AC Bus',
	bus: 'Bus'
};

// Destination/terminal variants ("V-240M KBS-MGD") collapse to a base ("V-240M"),
// which is all we need to spot AC routes.
function baseRoute(shortName: string): string {
	return shortName.trim().split(/\s+/)[0];
}

// BMTC AC services (Vajra / Vayu Vajra) are only distinguishable by their route
// short-name — GTFS marks every bus as route_type 3. Airport Vayu Vajra routes are
// "KIA-*"; the rest of the Vajra AC fleet is "V-*". Everything else on BUS is ordinary.
function classify(mode: OtpModeName, shortName: string): ClassKey {
	if (mode === 'SUBWAY' || mode === 'TRAM' || mode === 'RAIL') return 'metro';
	const base = baseRoute(shortName);
	if (/^KIA-/i.test(base) || /^V-/i.test(base)) return 'ac_bus';
	return 'bus';
}

// The ordered transit legs of a journey (boarded route short-name + its class),
// with the access/transfer walks dropped. Walk-only journeys yield [].
type TransitLeg = { name: string; cls: ClassKey };
function transitLegs(it: OtpItinerary): TransitLeg[] {
	const legs: TransitLeg[] = [];
	for (const l of it.legs) {
		if (l.transitLeg && l.route?.shortName) {
			legs.push({ name: l.route.shortName, cls: classify(l.mode, l.route.shortName) });
		}
	}
	return legs;
}

// The transfer count (transit legs − 1) shared by the most journeys; ties resolve to
// the smaller count. Walk-only journeys don't count.
function mostCommonTransfers(itineraries: OtpItinerary[]): number {
	const counts = new Map<number, number>();
	for (const it of itineraries) {
		const n = transitLegs(it).length;
		if (n > 0) counts.set(n - 1, (counts.get(n - 1) ?? 0) + 1);
	}
	let best = 0;
	let bestCount = -1;
	for (const [transfers, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
		if (count > bestCount) {
			bestCount = count;
			best = transfers;
		}
	}
	return best;
}

type Selection = { routes: string[]; total: number };

// Busiest routes of one bus class, per the leg template: at each leg position take
// the distinct routes of that class boarded there, rank by daily trips, keep the
// position's quota. Routes are unioned across positions; the total sums them once.
function selectBusClass(
	itineraries: OtpItinerary[],
	cls: ClassKey,
	quotas: number[],
	tripsOf: (name: string) => number
): Selection {
	const chosen = new Map<string, number>();
	for (let pos = 0; pos < quotas.length; pos++) {
		const candidates = new Map<string, number>();
		for (const it of itineraries) {
			const leg = transitLegs(it)[pos];
			if (leg && leg.cls === cls && tripsOf(leg.name) > 0) {
				candidates.set(leg.name, tripsOf(leg.name));
			}
		}
		const ranked = [...candidates.entries()].sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
		);
		for (const [name, trips] of ranked.slice(0, quotas[pos])) {
			if (!chosen.has(name)) chosen.set(name, trips);
		}
	}
	return {
		routes: [...chosen.keys()],
		total: Math.round([...chosen.values()].reduce((sum, t) => sum + t, 0) / BUS_TRIP_DIVISOR)
	};
}

// Metro lines serving at least METRO_MIN_SHARE of the metro-only suggestions,
// ordered by the journey leg they're first boarded on (first-leg lines first), then
// by how widely they serve the suggestions.
function selectMetro(itineraries: OtpItinerary[], tripsOf: (name: string) => number): Selection {
	const denom = itineraries.length;
	if (denom === 0) return { routes: [], total: 0 };

	const appearances = new Map<string, number>();
	const firstLeg = new Map<string, number>(); // earliest transit-leg index a line is boarded at
	for (const it of itineraries) {
		const legs = transitLegs(it);
		const seen = new Set<string>();
		legs.forEach((l, pos) => {
			if (l.cls !== 'metro') return;
			firstLeg.set(l.name, Math.min(firstLeg.get(l.name) ?? pos, pos));
			if (!seen.has(l.name)) {
				seen.add(l.name);
				appearances.set(l.name, (appearances.get(l.name) ?? 0) + 1);
			}
		});
	}

	const routes = [...appearances.entries()]
		.filter(([name, count]) => count / denom >= METRO_MIN_SHARE && tripsOf(name) > 0)
		.sort(
			(a, b) =>
				(firstLeg.get(a[0]) ?? 0) - (firstLeg.get(b[0]) ?? 0) ||
				b[1] - a[1] ||
				tripsOf(b[0]) - tripsOf(a[0]) ||
				a[0].localeCompare(b[0])
		)
		.map(([name]) => name);

	const total = Math.round(
		routes.reduce((sum, name) => sum + tripsOf(name), 0) / METRO_TRIP_DIVISOR
	);
	return { routes, total };
}

/**
 * Transit connectivity for the visitor's drawn origin→destination ([lng, lat] each).
 * Returns null when either point is missing or OTP finds no transit serving the trip.
 * Pass SvelteKit's `event.fetch` when calling from the server.
 */
export async function lookupConnectivity(
	origin: [number, number] | undefined,
	destination: [number, number] | undefined,
	fetcher?: typeof fetch
): Promise<Connectivity | null> {
	if (!origin || !destination) return null;

	const [allTransit, metroOnly] = await Promise.all([
		planTrip(origin, destination, {
			modes: [{ mode: 'WALK' }, { mode: 'TRANSIT' }],
			numItineraries: NUM_ITINERARIES,
			fetcher
		}),
		planTrip(origin, destination, {
			modes: [{ mode: 'WALK' }, { mode: 'SUBWAY' }],
			numItineraries: NUM_ITINERARIES,
			fetcher
		})
	]);

	// Daily trip counts for every route any suggestion boards, looked up in one go.
	const names = new Set<string>();
	for (const it of [...allTransit, ...metroOnly]) {
		for (const leg of transitLegs(it)) names.add(leg.name);
	}
	if (names.size === 0) return null;
	const stats = await routeTripStats([...names], fetcher);
	const tripsOf = (name: string) => stats.get(name)?.trips ?? 0;

	const quotas = legQuotas(mostCommonTransfers(allTransit));
	const selections: Record<ClassKey, Selection> = {
		metro: selectMetro(metroOnly, tripsOf),
		ac_bus: selectBusClass(allTransit, 'ac_bus', quotas, tripsOf),
		bus: selectBusClass(allTransit, 'bus', quotas, tripsOf)
	};

	const modes: ConnectivityMode[] = CLASS_ORDER.map((key) => ({
		key,
		label: CLASS_LABEL[key],
		trips: selections[key].total,
		routes: selections[key].routes
	})).filter((m) => m.routes.length > 0 && m.trips > 0);
	if (!modes.length) return null;

	const total = modes.reduce((sum, m) => sum + m.trips, 0);
	return { total, modes };
}
