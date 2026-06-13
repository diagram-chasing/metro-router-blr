// OpenTripPlanner client — replaces the hand-rolled metro/bus/road routing with
// real multimodal trip planning from the OTP2 GTFS GraphQL API.
//
// Endpoint: https://opentripplanner.diagramchasing.fun/otp/gtfs/v1
// Open instance, no auth. Returns full itineraries with per-leg geometry
// (precision-5 polylines), route names/colours, and intermediate stops.

import pkg from '@mapbox/polyline';
const { decode: decodePoly } = pkg;

const OTP_ENDPOINT = 'https://opentripplanner.diagramchasing.fun/otp/gtfs/v1';

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
        from { name lat lon }
        to { name lat lon }
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

interface RawLeg {
	mode: OtpModeName;
	duration: number;
	distance: number;
	transitLeg: boolean;
	from: OtpStop;
	to: OtpStop;
	route: { shortName?: string; longName?: string; mode?: string; color?: string } | null;
	trip: { tripHeadsign?: string } | null;
	legGeometry: { points?: string } | null;
	intermediateStops: OtpStop[] | null;
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
		from: l.from,
		to: l.to,
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
		const res = await doFetch(OTP_ENDPOINT, {
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
