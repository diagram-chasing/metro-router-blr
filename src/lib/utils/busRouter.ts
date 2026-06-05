import pkg from '@mapbox/polyline';
const { decode } = pkg;

import {
	cropPolylineBetweenPoints,
	findClosestPointOnPolyline,
	type LngLat
} from './polylineGeometry';

type ServicesData = Record<string, { name?: string } & Record<string, string[][]>>;
type RoutesData = Record<string, string[]>;
type RouteEntry = { service: string; destination: string; variantIdx: number };

export type BusLeg = {
	service: string;
	serviceName?: string;
	coords: LngLat[];
	fromStopId: string;
	fromStopCoord: LngLat;
	toStopId: string;
	toStopCoord: LngLat;
};

export type BusRouteMatch = {
	legs: BusLeg[]; // 1 = direct, 2 = single transfer at interchange
	originStopId: string;
	originStopCoord: LngLat;
	destStopId: string;
	destStopCoord: LngLat;
	interchange?: { stopId: string; coord: LngLat };
};

export type BusStopCandidate = { id: string; coord: LngLat };

type LoadedGtfs = {
	services: ServicesData;
	routes: RoutesData;
	stopToRoutes: Map<string, RouteEntry[]>;
	stopCoords: Map<string, LngLat>;
};

let cache: Promise<LoadedGtfs> | null = null;

function loadGtfs(): Promise<LoadedGtfs> {
	if (cache) return cache;
	cache = (async () => {
		const [svcRes, rtRes, stopsRes] = await Promise.all([
			fetch('/data/bmtc-services.min.json'),
			fetch('/data/bmtc-routes.min.json'),
			fetch('/data/bmtc-stops.min.json')
		]);
		if (!svcRes.ok) throw new Error(`services fetch ${svcRes.status}`);
		if (!rtRes.ok) throw new Error(`routes fetch ${rtRes.status}`);
		if (!stopsRes.ok) throw new Error(`stops fetch ${stopsRes.status}`);
		const services = (await svcRes.json()) as ServicesData;
		const routes = (await rtRes.json()) as RoutesData;
		const rawStops = (await stopsRes.json()) as Record<string, [number, number, ...unknown[]]>;

		const stopCoords = new Map<string, LngLat>();
		for (const [id, v] of Object.entries(rawStops)) stopCoords.set(id, [v[0], v[1]]);

		const stopToRoutes = new Map<string, RouteEntry[]>();
		for (const [service, svc] of Object.entries(services)) {
			for (const [destination, value] of Object.entries(svc)) {
				if (destination === 'name') continue;
				const variants = value as string[][];
				for (let i = 0; i < variants.length; i++) {
					for (const stopId of variants[i]) {
						let arr = stopToRoutes.get(stopId);
						if (!arr) {
							arr = [];
							stopToRoutes.set(stopId, arr);
						}
						arr.push({ service, destination, variantIdx: i });
					}
				}
			}
		}

		return { services, routes, stopToRoutes, stopCoords };
	})();
	return cache;
}

function decodeLngLat(encoded: string): LngLat[] {
	return decode(encoded).map(([lat, lng]) => [lng, lat] as LngLat);
}

// Pick the polyline (direction variant) that passes closest to BOTH points, then
// crop it between them — that's the rider's actual on-bus path.
function bestCroppedPolyline(
	servicePolys: string[],
	fromCoord: LngLat,
	toCoord: LngLat
): { coords: LngLat[]; score: number } | null {
	let best: { coords: LngLat[]; score: number } | null = null;
	for (const enc of servicePolys) {
		try {
			const coords = decodeLngLat(enc);
			if (coords.length < 2) continue;
			const s = findClosestPointOnPolyline(fromCoord, coords);
			const e = findClosestPointOnPolyline(toCoord, coords);
			if (!s.point || !e.point) continue;
			const score = s.distance + e.distance;
			if (best && score >= best.score) continue;
			const cropped = cropPolylineBetweenPoints(coords, fromCoord, toCoord);
			if (cropped.length < 2) continue;
			best = { coords: cropped, score };
		} catch {
			// skip bad polyline
		}
	}
	return best;
}

function tryDirectMatch(
	loaded: LoadedGtfs,
	origin: BusStopCandidate,
	dest: BusStopCandidate
): BusLeg | null {
	const { services, routes, stopToRoutes, stopCoords } = loaded;
	const originRoutes = stopToRoutes.get(origin.id);
	if (!originRoutes) return null;

	let best: BusLeg | null = null;
	let bestSpan = Infinity;

	for (const entry of originRoutes) {
		const seq = services[entry.service]?.[entry.destination]?.[entry.variantIdx];
		if (!seq) continue;
		const oIdx = seq.indexOf(origin.id);
		const dIdx = seq.indexOf(dest.id);
		if (oIdx === -1 || dIdx === -1 || oIdx >= dIdx) continue;

		const servicePolys = routes[entry.service];
		if (!servicePolys || servicePolys.length === 0) continue;
		const chosen = bestCroppedPolyline(servicePolys, origin.coord, dest.coord);
		if (!chosen) continue;

		const span = dIdx - oIdx;
		if (span < bestSpan) {
			bestSpan = span;
			best = {
				service: entry.service,
				serviceName: services[entry.service]?.name,
				coords: chosen.coords,
				fromStopId: origin.id,
				fromStopCoord: origin.coord,
				toStopId: dest.id,
				toStopCoord: dest.coord
			};
		}
		// Keep stopCoords reference happy for the linter
		void stopCoords;
	}
	return best;
}

type DownstreamRoute = {
	entry: RouteEntry;
	tailStops: Set<string>; // stops reachable from `origin.id` (inclusive of origin)
	tailSequence: string[]; // ordered, origin -> end-of-variant
};

type UpstreamRoute = {
	entry: RouteEntry;
	headStops: Set<string>; // stops from start-of-variant up to dest (inclusive)
	headSequence: string[];
};

function downstreamRoutesFrom(loaded: LoadedGtfs, stopId: string): DownstreamRoute[] {
	const { services, stopToRoutes } = loaded;
	const out: DownstreamRoute[] = [];
	const entries = stopToRoutes.get(stopId);
	if (!entries) return out;
	for (const entry of entries) {
		const seq = services[entry.service]?.[entry.destination]?.[entry.variantIdx];
		if (!seq) continue;
		const idx = seq.indexOf(stopId);
		if (idx === -1) continue;
		const tail = seq.slice(idx);
		out.push({ entry, tailStops: new Set(tail), tailSequence: tail });
	}
	return out;
}

function upstreamRoutesTo(loaded: LoadedGtfs, stopId: string): UpstreamRoute[] {
	const { services, stopToRoutes } = loaded;
	const out: UpstreamRoute[] = [];
	const entries = stopToRoutes.get(stopId);
	if (!entries) return out;
	for (const entry of entries) {
		const seq = services[entry.service]?.[entry.destination]?.[entry.variantIdx];
		if (!seq) continue;
		const idx = seq.indexOf(stopId);
		if (idx === -1) continue;
		const head = seq.slice(0, idx + 1);
		out.push({ entry, headStops: new Set(head), headSequence: head });
	}
	return out;
}

// Build two-leg routes when no single bus serves both stops. We look for any
// stop that's reachable from `origin` on some service A AND lies on the path
// of some service B reaching `dest`. Pick the option with the fewest total
// stops as a rough proxy for "least painful transfer".
function tryTransferMatch(
	loaded: LoadedGtfs,
	origin: BusStopCandidate,
	dest: BusStopCandidate
): BusRouteMatch | null {
	const { services, routes, stopCoords } = loaded;
	const fromOrigin = downstreamRoutesFrom(loaded, origin.id);
	if (fromOrigin.length === 0) return null;
	const toDest = upstreamRoutesTo(loaded, dest.id);
	if (toDest.length === 0) return null;

	let bestTotalSpan = Infinity;
	let best: BusRouteMatch | null = null;

	for (const fwd of fromOrigin) {
		for (const back of toDest) {
			if (fwd.entry.service === back.entry.service) continue;
			// Find a shared interchange stop (≠ origin, ≠ dest).
			const [smaller, larger] =
				fwd.tailStops.size < back.headStops.size
					? [fwd.tailStops, back.headStops]
					: [back.headStops, fwd.tailStops];
			let pickedInterchange: string | null = null;
			let pickedSpan = Infinity;
			for (const s of smaller) {
				if (!larger.has(s)) continue;
				if (s === origin.id || s === dest.id) continue;
				const aSpan = fwd.tailSequence.indexOf(s);
				const bSpan = back.headSequence.length - 1 - back.headSequence.indexOf(s);
				if (aSpan <= 0 || bSpan <= 0) continue;
				const total = aSpan + bSpan;
				if (total < pickedSpan) {
					pickedSpan = total;
					pickedInterchange = s;
				}
			}
			if (!pickedInterchange) continue;
			if (pickedSpan >= bestTotalSpan) continue;

			const interchangeCoord = stopCoords.get(pickedInterchange);
			if (!interchangeCoord) continue;

			const polyA = routes[fwd.entry.service];
			const polyB = routes[back.entry.service];
			if (!polyA?.length || !polyB?.length) continue;
			const segA = bestCroppedPolyline(polyA, origin.coord, interchangeCoord);
			const segB = bestCroppedPolyline(polyB, interchangeCoord, dest.coord);
			if (!segA || !segB) continue;

			bestTotalSpan = pickedSpan;
			best = {
				legs: [
					{
						service: fwd.entry.service,
						serviceName: services[fwd.entry.service]?.name,
						coords: segA.coords,
						fromStopId: origin.id,
						fromStopCoord: origin.coord,
						toStopId: pickedInterchange,
						toStopCoord: interchangeCoord
					},
					{
						service: back.entry.service,
						serviceName: services[back.entry.service]?.name,
						coords: segB.coords,
						fromStopId: pickedInterchange,
						fromStopCoord: interchangeCoord,
						toStopId: dest.id,
						toStopCoord: dest.coord
					}
				],
				originStopId: origin.id,
				originStopCoord: origin.coord,
				destStopId: dest.id,
				destStopCoord: dest.coord,
				interchange: { stopId: pickedInterchange, coord: interchangeCoord }
			};
		}
	}

	return best;
}

export async function findBusRouteBetween(
	originCandidates: BusStopCandidate[],
	destCandidates: BusStopCandidate[]
): Promise<BusRouteMatch | null> {
	if (originCandidates.length === 0 || destCandidates.length === 0) return null;
	const loaded = await loadGtfs();

	let bestDirect: BusRouteMatch | null = null;
	let bestDirectRank = Infinity;
	let bestDirectSpan = Infinity;

	for (let oRank = 0; oRank < originCandidates.length; oRank++) {
		for (let dRank = 0; dRank < destCandidates.length; dRank++) {
			const walkRank = oRank + dRank;
			if (walkRank > bestDirectRank) continue;
			const leg = tryDirectMatch(loaded, originCandidates[oRank], destCandidates[dRank]);
			if (!leg) continue;
			const span = leg.coords.length;
			const better =
				walkRank < bestDirectRank || (walkRank === bestDirectRank && span < bestDirectSpan);
			if (better) {
				bestDirectRank = walkRank;
				bestDirectSpan = span;
				bestDirect = {
					legs: [leg],
					originStopId: leg.fromStopId,
					originStopCoord: leg.fromStopCoord,
					destStopId: leg.toStopId,
					destStopCoord: leg.toStopCoord
				};
			}
		}
	}

	if (bestDirect) return bestDirect;

	// Fall back to single-transfer routes when no direct service exists.
	for (let oRank = 0; oRank < originCandidates.length; oRank++) {
		for (let dRank = 0; dRank < destCandidates.length; dRank++) {
			const m = tryTransferMatch(loaded, originCandidates[oRank], destCandidates[dRank]);
			if (m) return m;
		}
	}

	return null;
}
