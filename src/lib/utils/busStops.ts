export type BusStop = {
	id: string;
	lon: number;
	lat: number;
	name: string;
};

export type NearestBusStop = {
	stop: BusStop;
	walkMeters: number;
	headwayMin: number;
};

type RawStops = Record<string, [number, number, string, string, string]>;
type RawRanking = Record<string, number>;

type LoadedData = {
	stops: BusStop[];
	headwayById: Map<string, number>;
};

let cache: Promise<LoadedData> | null = null;

export function loadBusData(): Promise<LoadedData> {
	if (cache) return cache;
	cache = (async () => {
		const [stopsRes, rankingRes] = await Promise.all([
			fetch('/data/bmtc-stops.min.json'),
			fetch('/data/bmtc-ranking.min.json')
		]);
		if (!stopsRes.ok) throw new Error(`bmtc stops fetch ${stopsRes.status}`);
		if (!rankingRes.ok) throw new Error(`bmtc ranking fetch ${rankingRes.status}`);
		const rawStops = (await stopsRes.json()) as RawStops;
		const rawRanking = (await rankingRes.json()) as RawRanking;

		const stops: BusStop[] = [];
		for (const [id, entry] of Object.entries(rawStops)) {
			stops.push({ id, lon: entry[0], lat: entry[1], name: entry[2] });
		}

		const headwayById = bucketHeadways(rawRanking);
		return { stops, headwayById };
	})();
	return cache;
}

// Ranking scores are concentrated in a few hub stops; quartiles on a sorted
// list of *ranked* stops are too coarse. Use absolute thresholds picked from a
// quick look at the data: top hubs (>20) get 6 min, mid (>5) 12 min,
// long-tail-but-listed (>1) 20 min, unlisted defaults to 30 min.
function bucketHeadways(ranking: RawRanking): Map<string, number> {
	const out = new Map<string, number>();
	for (const [id, score] of Object.entries(ranking)) {
		out.set(id, headwayForScore(score));
	}
	return out;
}

function headwayForScore(score: number): number {
	if (score >= 20) return 6;
	if (score >= 5) return 12;
	if (score >= 1) return 20;
	return 30;
}

// Haversine distance in meters. Inline to avoid pulling cheap-ruler for one
// caller — accuracy at Bangalore latitudes is well within "walk distance" precision.
function haversineMeters(a: [number, number], b: [number, number]): number {
	const R = 6371000;
	const toRad = Math.PI / 180;
	const dLat = (b[1] - a[1]) * toRad;
	const dLon = (b[0] - a[0]) * toRad;
	const lat1 = a[1] * toRad;
	const lat2 = b[1] * toRad;
	const s = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
	return 2 * R * Math.asin(Math.sqrt(s));
}

export async function nearestBusStop(
	coord: [number, number]
): Promise<NearestBusStop | null> {
	const { stops, headwayById } = await loadBusData();
	if (stops.length === 0) return null;
	let best: BusStop | null = null;
	let bestDist = Infinity;
	for (const s of stops) {
		const d = haversineMeters(coord, [s.lon, s.lat]);
		if (d < bestDist) {
			bestDist = d;
			best = s;
		}
	}
	if (!best) return null;
	const headway = headwayById.get(best.id) ?? 30;
	return { stop: best, walkMeters: bestDist, headwayMin: headway };
}

// Returns up to `limit` stops within `maxMeters` of `coord`, sorted by distance.
// Used by the bus router to try alternate stops when the single nearest pair
// has no direct service between them.
export async function nearbyBusStops(
	coord: [number, number],
	maxMeters = 600,
	limit = 6
): Promise<NearestBusStop[]> {
	const { stops, headwayById } = await loadBusData();
	const within: { stop: BusStop; walkMeters: number; headwayMin: number }[] = [];
	for (const s of stops) {
		const d = haversineMeters(coord, [s.lon, s.lat]);
		if (d <= maxMeters) {
			within.push({ stop: s, walkMeters: d, headwayMin: headwayById.get(s.id) ?? 30 });
		}
	}
	within.sort((a, b) => a.walkMeters - b.walkMeters);
	return within.slice(0, limit);
}
