// OpenTripPlanner client for multimodal trip planning (OTP2 GTFS GraphQL API).
//
// OTP runs on the same machine that serves this app, on a fixed port but a host
// that changes with the network — so we resolve it at call time instead of
// hardcoding: in the browser, reuse the host the page was loaded from; on the
// server (SSR / API routes) it's reachable on localhost. Returns full itineraries
// with per-leg geometry (precision-5 polylines), route names/colours, and stops.

import pkg from '@mapbox/polyline';
const { decode: decodePoly } = pkg;

const OTP_PORT = 8000;
function otpEndpoint(): string {
	const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
	return `http://${host}:${OTP_PORT}/otp/gtfs/v1`;
}

// OTP transport modes we use. (The GraphQL `Mode` enum has many more.)
export type OtpModeName =
	| 'WALK'
	| 'BUS'
	| 'SUBWAY'
	| 'RAIL'
	| 'TRAM'
	| 'CAR'
	| 'BICYCLE'
	| 'TRANSIT'
	| 'FERRY'
	| 'CABLE_CAR'
	| 'FUNICULAR'
	| 'GONDOLA';

export interface OtpStop {
	name: string;
	lat: number;
	lon: number;
	/** "FeedId:StopId"; needed to query a stop's departures. */
	gtfsId?: string;
}

export interface OtpLeg {
	mode: OtpModeName;
	/** seconds */
	duration: number;
	/** meters */
	distance: number;
	transitLeg: boolean;
	from: OtpStop;
	to: OtpStop;
	route?: {
		shortName?: string;
		longName?: string;
		mode?: string;
		/** hex without leading '#', or undefined */
		color?: string;
	};
	headsign?: string;
	/** Decoded to [lng, lat] for direct use by MapLibre / GeoJSON. */
	coords: [number, number][];
	intermediateStops: OtpStop[];
}

export interface OtpItinerary {
	/** seconds */
	duration: number;
	/** meters walked across the whole itinerary */
	walkDistance: number;
	/** epoch ms */
	startTime: number;
	endTime: number;
	legs: OtpLeg[];
	/** Sum of all leg distances, in km. */
	distanceKm: number;
}

interface TransportMode {
	mode: OtpModeName;
	qualifier?: string;
}

const PLAN_QUERY = `
query Plan($from: InputCoordinates!, $to: InputCoordinates!, $modes: [TransportMode!], $num: Int) {
  plan(from: $from, to: $to, numItineraries: $num, transportModes: $modes) {
    itineraries {
      duration
      walkDistance
      startTime
      endTime
      legs {
        mode
        duration
        distance
        transitLeg
        from { name lat lon stop { gtfsId } }
        to { name lat lon stop { gtfsId } }
        route { shortName longName mode color }
        trip { tripHeadsign }
        legGeometry { points }
        intermediateStops { name lat lon }
      }
    }
  }
}`;

// @mapbox/polyline.decode returns [[lat, lng], ...] at precision 5 — which is
// exactly OTP's legGeometry encoding. The rest of the app works in [lng, lat].
function decodeLngLat(encoded: string | undefined | null): [number, number][] {
	if (!encoded) return [];
	return decodePoly(encoded).map(([lat, lng]) => [lng, lat] as [number, number]);
}

// A leg endpoint is OTP's `Place`: coords + an optional linked `stop`.
interface RawPlace {
	name: string;
	lat: number;
	lon: number;
	stop?: { gtfsId?: string } | null;
}

interface RawLeg {
	mode: OtpModeName;
	duration: number;
	distance: number;
	transitLeg: boolean;
	from: RawPlace;
	to: RawPlace;
	route: { shortName?: string; longName?: string; mode?: string; color?: string } | null;
	trip: { tripHeadsign?: string } | null;
	legGeometry: { points?: string } | null;
	intermediateStops: OtpStop[] | null;
}

function flattenPlace(p: RawPlace): OtpStop {
	return { name: p.name, lat: p.lat, lon: p.lon, gtfsId: p.stop?.gtfsId };
}

interface RawItinerary {
	duration: number;
	walkDistance: number;
	startTime: number;
	endTime: number;
	legs: RawLeg[];
}

function normalizeItinerary(raw: RawItinerary): OtpItinerary {
	const legs: OtpLeg[] = raw.legs.map((l) => ({
		mode: l.mode,
		duration: l.duration,
		distance: l.distance,
		transitLeg: l.transitLeg,
		from: flattenPlace(l.from),
		to: flattenPlace(l.to),
		route: l.route
			? {
					shortName: l.route.shortName ?? undefined,
					longName: l.route.longName ?? undefined,
					mode: l.route.mode ?? undefined,
					color: l.route.color ?? undefined
				}
			: undefined,
		headsign: l.trip?.tripHeadsign ?? undefined,
		coords: decodeLngLat(l.legGeometry?.points),
		intermediateStops: l.intermediateStops ?? []
	}));
	const distanceKm = legs.reduce((sum, l) => sum + l.distance, 0) / 1000;
	return {
		duration: raw.duration,
		walkDistance: raw.walkDistance,
		startTime: raw.startTime,
		endTime: raw.endTime,
		legs,
		distanceKm
	};
}

export interface PlanOptions {
	modes: TransportMode[];
	numItineraries?: number;
	/** Inject SvelteKit's `event.fetch` when calling from the server. */
	fetcher?: typeof fetch;
}

/**
 * Plan a trip from `from` to `to`. Coordinates are [lng, lat] (the app's
 * convention); they're swapped to OTP's {lat, lon} internally.
 * Returns [] on any failure (network, GraphQL error, no itineraries).
 */
export async function planTrip(
	from: [number, number],
	to: [number, number],
	opts: PlanOptions
): Promise<OtpItinerary[]> {
	const doFetch = opts.fetcher ?? fetch;
	const variables = {
		from: { lat: from[1], lon: from[0] },
		to: { lat: to[1], lon: to[0] },
		modes: opts.modes,
		num: opts.numItineraries ?? 3
	};

	try {
		const res = await doFetch(otpEndpoint(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: PLAN_QUERY, variables })
		});
		if (!res.ok) {
			console.warn('OTP plan request failed:', res.status, res.statusText);
			return [];
		}
		const json = (await res.json()) as {
			data?: { plan?: { itineraries?: RawItinerary[] } };
			errors?: { message: string }[];
		};
		if (json.errors?.length) {
			console.warn('OTP GraphQL errors:', json.errors.map((e) => e.message).join('; '));
			return [];
		}
		const itineraries = json.data?.plan?.itineraries ?? [];
		return itineraries.map(normalizeItinerary);
	} catch (err) {
		console.warn('OTP plan request threw:', err);
		return [];
	}
}

export type PlanBundle = {
	metro: OtpItinerary[];
	bus: OtpItinerary[];
	car: OtpItinerary[];
	walk: OtpItinerary[];
};

/**
 * Fetch the four mode families the exhibit surfaces, in parallel. Each call is
 * mode-scoped so we reliably get one itinerary of each kind rather than relying
 * on OTP's pareto mix.
 */
export async function planAllModes(
	from: [number, number],
	to: [number, number],
	fetcher?: typeof fetch
): Promise<PlanBundle> {
	const [metro, bus, car, walk] = await Promise.all([
		planTrip(from, to, { modes: [{ mode: 'WALK' }, { mode: 'SUBWAY' }], numItineraries: 3, fetcher }),
		planTrip(from, to, { modes: [{ mode: 'WALK' }, { mode: 'BUS' }], numItineraries: 3, fetcher }),
		planTrip(from, to, { modes: [{ mode: 'CAR' }], numItineraries: 1, fetcher }),
		planTrip(from, to, { modes: [{ mode: 'WALK' }], numItineraries: 1, fetcher })
	]);
	return { metro, bus, car, walk };
}

/** First itinerary containing a leg of the given transit mode, if any. */
export function firstWithMode(
	itineraries: OtpItinerary[],
	mode: OtpModeName
): OtpItinerary | null {
	return itineraries.find((it) => it.legs.some((l) => l.mode === mode)) ?? null;
}

// ── swap suggestion (best viable transit alternative) ───────────────────────

export interface SwapSuggestion {
	mode: 'SUBWAY' | 'BUS';
	/** metro line ('Purple') or bus route ('KIA-14'), destination variant stripped */
	routeName: string;
	/** boarding stop / station name */
	boardName: string;
	/** getting from the origin to the boarding stop */
	access: { meters: number; auto: boolean };
	/** getting from the final stop to the destination */
	egress: { meters: number; auto: boolean };
	/** this route's ~headway at the boarding stop, minutes; null if not derivable */
	headwayMin: number | null;
}

// Up to here is a short walk; beyond it we frame the access leg as a short auto.
const SHORT_WALK_M = 700;
// Beyond this even an auto hop to the stop is unreasonable → the option isn't viable.
const MAX_ACCESS_M = 2500;

const STOPTIMES_QUERY = `
query Departures($id: String!, $num: Int!) {
  stop(id: $id) {
    stoptimesWithoutPatterns(numberOfDepartures: $num) {
      scheduledDeparture
      trip { tripHeadsign route { shortName } }
    }
  }
}`;

// "362-C SBS-YLH" / "144-E SBS-NLS-KRM" → "362-C" / "144-E"; "144" stays "144".
// Collapses destination/terminal variants so a route reads as one line.
function baseRoute(shortName: string): string {
	return shortName.trim().split(/\s+/)[0];
}

export interface RouteStat {
	/** the exact GTFS route short-name this stat is for */
	shortName: string;
	/** route mode (BUS / SUBWAY / …) — used to classify metro vs bus */
	mode: OtpModeName;
	/** total scheduled trips on the route (≈ daily, the feed uses one calendar) */
	trips: number;
}

/**
 * Daily trip counts for a set of exact route short-names, looked up from OTP in a
 * single aliased GraphQL query. `routes(name:)` matches by substring, so each
 * result is filtered back to an exact short-name match (and summed when a name maps
 * to several GTFS routes). Names with no match are simply absent from the result.
 */
export async function routeTripStats(
	names: string[],
	fetcher: typeof fetch = fetch
): Promise<Map<string, RouteStat>> {
	const result = new Map<string, RouteStat>();
	if (!names.length) return result;

	const varDefs = names.map((_, i) => `$n${i}: String!`).join(', ');
	const fields = names
		.map((_, i) => `r${i}: routes(name: $n${i}) { shortName mode trips { id } }`)
		.join('\n');
	const query = `query RouteTrips(${varDefs}) {\n${fields}\n}`;
	const variables: Record<string, string> = {};
	names.forEach((n, i) => (variables[`n${i}`] = n));

	type RawRoute = { shortName: string; mode: OtpModeName; trips: { id: string }[] | null };
	const data = await otpQuery<Record<string, RawRoute[]>>(query, variables, fetcher);
	if (!data) return result;

	names.forEach((n, i) => {
		const matches = (data[`r${i}`] ?? []).filter((r) => r.shortName === n);
		if (!matches.length) return;
		const trips = matches.reduce((sum, r) => sum + (r.trips?.length ?? 0), 0);
		result.set(n, { shortName: n, mode: matches[0].mode, trips });
	});
	return result;
}

async function otpQuery<T>(
	query: string,
	variables: Record<string, unknown>,
	fetcher: typeof fetch
): Promise<T | null> {
	try {
		const res = await fetcher(otpEndpoint(), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query, variables })
		});
		if (!res.ok) {
			console.warn('OTP request failed:', res.status, res.statusText);
			return null;
		}
		const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
		if (json.errors?.length) {
			console.warn('OTP GraphQL errors:', json.errors.map((e) => e.message).join('; '));
			return null;
		}
		return json.data ?? null;
	} catch (err) {
		console.warn('OTP request threw:', err);
		return null;
	}
}

// Total walking distance of the non-transit legs before/after the transit core.
function walkMetersBefore(legs: OtpLeg[], firstTransitIdx: number): number {
	return legs.slice(0, firstTransitIdx).reduce((m, l) => (l.transitLeg ? m : m + l.distance), 0);
}
function walkMetersAfter(legs: OtpLeg[], lastTransitIdx: number): number {
	return legs.slice(lastTransitIdx + 1).reduce((m, l) => (l.transitLeg ? m : m + l.distance), 0);
}

// Turn a single-mode itinerary into a viable suggestion, or null if the access
// or egress to its stops is too far even for an auto.
function toCandidate(
	it: OtpItinerary | null,
	mode: 'SUBWAY' | 'BUS'
): { s: SwapSuggestion; boardId?: string; headsign?: string } | null {
	if (!it) return null;
	const firstIdx = it.legs.findIndex((l) => l.mode === mode);
	if (firstIdx < 0) return null;
	let lastIdx = firstIdx;
	for (let i = it.legs.length - 1; i >= 0; i--) {
		if (it.legs[i].transitLeg) {
			lastIdx = i;
			break;
		}
	}
	const access = walkMetersBefore(it.legs, firstIdx);
	const egress = walkMetersAfter(it.legs, lastIdx);
	if (access > MAX_ACCESS_M || egress > MAX_ACCESS_M) return null;

	const leg = it.legs[firstIdx];
	const routeName = baseRoute(leg.route?.shortName ?? (mode === 'SUBWAY' ? 'Metro' : 'Bus'));
	return {
		s: {
			mode,
			routeName,
			boardName: leg.from.name,
			access: { meters: Math.round(access), auto: access > SHORT_WALK_M },
			egress: { meters: Math.round(egress), auto: egress > SHORT_WALK_M },
			headwayMin: null
		},
		boardId: leg.from.gtfsId,
		headsign: leg.headsign
	};
}

// Average gap between this route's scheduled departures at its boarding stop, in
// the travelled direction. Stations interleave both directions, so we filter by
// headsign first and fall back to all of this route's departures if too sparse.
async function routeHeadway(
	boardId: string,
	routeName: string,
	headsign: string | undefined,
	fetcher: typeof fetch
): Promise<number | null> {
	const data = await otpQuery<{
		stop?: {
			stoptimesWithoutPatterns?: {
				scheduledDeparture: number;
				trip?: { tripHeadsign?: string; route?: { shortName?: string } };
			}[];
		};
	}>(STOPTIMES_QUERY, { id: boardId, num: 40 }, fetcher);
	const ofRoute = (data?.stop?.stoptimesWithoutPatterns ?? []).filter(
		(s) => s.trip?.route?.shortName && baseRoute(s.trip.route.shortName) === routeName
	);
	const directional = headsign ? ofRoute.filter((s) => s.trip?.tripHeadsign === headsign) : [];
	const times = (directional.length >= 2 ? directional : ofRoute)
		.map((s) => s.scheduledDeparture)
		.sort((a, b) => a - b);
	if (times.length < 2) return null;
	const spanSec = times[times.length - 1] - times[0];
	return Math.max(1, Math.round(spanSec / (times.length - 1) / 60));
}

/**
 * Best single cleaner alternative for the trip `from`→`to` ([lng, lat] each):
 * the metro route if one viably serves both ends, otherwise the best bus. The
 * suggestion names the real route and its frequency. Returns null when no
 * transit reasonably serves the trip (or on any OTP failure).
 */
export async function swapSuggestion(
	from: [number, number],
	to: [number, number],
	opts?: { fetcher?: typeof fetch }
): Promise<SwapSuggestion | null> {
	const fetcher = opts?.fetcher ?? fetch;
	// Ask for a few: on short trips OTP's single optimum is often walk-only, so we
	// need alternatives for firstWithMode to find one that actually uses transit.
	const [metro, bus] = await Promise.all([
		planTrip(from, to, { modes: [{ mode: 'WALK' }, { mode: 'SUBWAY' }], numItineraries: 4, fetcher }),
		planTrip(from, to, { modes: [{ mode: 'WALK' }, { mode: 'BUS' }], numItineraries: 4, fetcher })
	]);

	const candidate =
		toCandidate(firstWithMode(metro, 'SUBWAY'), 'SUBWAY') ??
		toCandidate(firstWithMode(bus, 'BUS'), 'BUS');
	if (!candidate) return null;

	const headwayMin = candidate.boardId
		? await routeHeadway(candidate.boardId, candidate.s.routeName, candidate.headsign, fetcher)
		: null;
	return { ...candidate.s, headwayMin };
}
