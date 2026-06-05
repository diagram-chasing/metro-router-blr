import pkg from '@mapbox/polyline';
const { decode } = pkg;

type ServicesData = Record<
	string,
	{ name?: string } & Record<string, string[][]>
>;
type RoutesData = Record<string, string[]>;
type RouteEntry = { service: string; destination: string; variantIdx: number };

export type BusRouteMatch = {
	service: string;
	serviceName?: string;
	// Decoded [lng, lat] coords for the cropped origin→destination portion of the
	// chosen direction's polyline. Already trimmed to the segment the rider uses.
	coords: [number, number][];
	stopsBetween: number;
	// The actual stops the chosen service uses — may differ from the absolute
	// nearest stops if a slightly-farther pair had a direct service.
	originStopId: string;
	originStopCoord: [number, number];
	destStopId: string;
	destStopCoord: [number, number];
};

type LoadedGtfs = {
	services: ServicesData;
	routes: RoutesData;
	stopToRoutes: Map<string, RouteEntry[]>;
};

let cache: Promise<LoadedGtfs> | null = null;

function loadGtfs(): Promise<LoadedGtfs> {
	if (cache) return cache;
	cache = (async () => {
		const [svcRes, rtRes] = await Promise.all([
			fetch('/data/bmtc-services.min.json'),
			fetch('/data/bmtc-routes.min.json')
		]);
		if (!svcRes.ok) throw new Error(`services fetch ${svcRes.status}`);
		if (!rtRes.ok) throw new Error(`routes fetch ${rtRes.status}`);
		const services = (await svcRes.json()) as ServicesData;
		const routes = (await rtRes.json()) as RoutesData;

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

		return { services, routes, stopToRoutes };
	})();
	return cache;
}

function squaredDist(a: [number, number], b: [number, number]): number {
	const dx = a[0] - b[0];
	const dy = a[1] - b[1];
	return dx * dx + dy * dy;
}

function nearestVertexIndex(coord: [number, number], coords: [number, number][]): {
	idx: number;
	dist: number;
} {
	let best = Infinity;
	let idx = -1;
	for (let i = 0; i < coords.length; i++) {
		const d = squaredDist(coord, coords[i]);
		if (d < best) {
			best = d;
			idx = i;
		}
	}
	return { idx, dist: best };
}

// @mapbox/polyline returns [lat, lng]; flip to [lng, lat] for map use.
function decodeLngLat(encoded: string): [number, number][] {
	return decode(encoded).map(([lat, lng]) => [lng, lat] as [number, number]);
}

// Choose the polyline (direction variant) that passes closest to BOTH stops,
// and crop it to the segment between them. Direction is inferred from the
// vertex order (origin's nearest vertex should come before dest's).
function pickAndCropPolyline(
	servicePolys: string[],
	originCoord: [number, number],
	destCoord: [number, number]
): { coords: [number, number][]; score: number } | null {
	let best: { coords: [number, number][]; score: number } | null = null;
	for (const enc of servicePolys) {
		try {
			const coords = decodeLngLat(enc);
			if (coords.length < 2) continue;
			const o = nearestVertexIndex(originCoord, coords);
			const d = nearestVertexIndex(destCoord, coords);
			if (o.idx === -1 || d.idx === -1) continue;
			// Worst-of-the-two: penalize polylines that miss either endpoint badly.
			const score = Math.max(o.dist, d.dist);
			let cropped: [number, number][];
			if (o.idx <= d.idx) {
				cropped = coords.slice(o.idx, d.idx + 1);
			} else {
				// Wrong direction for this variant; reverse so it reads origin → dest.
				cropped = coords.slice(d.idx, o.idx + 1).reverse();
			}
			if (cropped.length < 2) continue;
			if (!best || score < best.score) best = { coords: cropped, score };
		} catch {
			// skip bad polyline
		}
	}
	return best;
}

export type BusStopCandidate = { id: string; coord: [number, number] };

// Try every (origin, dest) pair from the candidate lists and keep the best
// direct match. "Best" = smallest number of stops between, preferring earlier
// candidates (which the caller orders by walk distance) as a tiebreaker.
export async function findBusRouteBetween(
	originCandidates: BusStopCandidate[],
	destCandidates: BusStopCandidate[]
): Promise<BusRouteMatch | null> {
	if (originCandidates.length === 0 || destCandidates.length === 0) return null;
	const { services, routes, stopToRoutes } = await loadGtfs();

	let best: BusRouteMatch | null = null;
	let bestSpan = Infinity;
	let bestWalkRank = Infinity;

	for (let oRank = 0; oRank < originCandidates.length; oRank++) {
		const origin = originCandidates[oRank];
		const originRoutes = stopToRoutes.get(origin.id);
		if (!originRoutes || originRoutes.length === 0) continue;

		for (let dRank = 0; dRank < destCandidates.length; dRank++) {
			const dest = destCandidates[dRank];
			const walkRank = oRank + dRank;

			for (const entry of originRoutes) {
				const seq = services[entry.service]?.[entry.destination]?.[entry.variantIdx];
				if (!seq) continue;
				const oIdx = seq.indexOf(origin.id);
				const dIdx = seq.indexOf(dest.id);
				if (oIdx === -1 || dIdx === -1 || oIdx >= dIdx) continue;

				const servicePolys = routes[entry.service];
				if (!servicePolys || servicePolys.length === 0) continue;
				const chosen = pickAndCropPolyline(servicePolys, origin.coord, dest.coord);
				if (!chosen) continue;

				const span = dIdx - oIdx;
				const better =
					walkRank < bestWalkRank ||
					(walkRank === bestWalkRank && span < bestSpan);
				if (better) {
					bestSpan = span;
					bestWalkRank = walkRank;
					best = {
						service: entry.service,
						serviceName: services[entry.service]?.name,
						coords: chosen.coords,
						stopsBetween: span,
						originStopId: origin.id,
						originStopCoord: origin.coord,
						destStopId: dest.id,
						destStopCoord: dest.coord
					};
				}
			}
		}
		// If we already found a match using this origin rank, don't try worse origins.
		if (best && bestWalkRank <= oRank) break;
	}

	return best;
}
