import pkg from '@mapbox/polyline';
const { decode, encode } = pkg;

const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

type Costing = 'auto' | 'pedestrian' | 'bicycle';

type ValhallaResponse = {
	trip?: {
		legs?: Array<{ summary: { time: number; length: number }; shape: string }>;
	};
};

export type RoadRoute = {
	encoded: string; // Mapbox precision=5
	durationMin: number;
	distanceKm: number;
};

const cache = new Map<string, Promise<RoadRoute | null>>();

function cacheKey(costing: Costing, from: [number, number], to: [number, number]): string {
	return `${costing}|${from[0].toFixed(5)},${from[1].toFixed(5)}|${to[0].toFixed(5)},${to[1].toFixed(5)}`;
}

export function fetchRoadRoute(
	from: [number, number],
	to: [number, number],
	costing: Costing
): Promise<RoadRoute | null> {
	const key = cacheKey(costing, from, to);
	const hit = cache.get(key);
	if (hit) return hit;
	const p = (async () => {
		try {
			const res = await fetch(VALHALLA_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					locations: [
						{ lat: from[1], lon: from[0] },
						{ lat: to[1], lon: to[0] }
					],
					costing,
					directions_options: { units: 'kilometers' }
				})
			});
			if (!res.ok) return null;
			const data = (await res.json()) as ValhallaResponse;
			const leg = data.trip?.legs?.[0];
			if (!leg) return null;
			// Valhalla returns precision=6; re-encode at 5 so it matches the rest of the app.
			const decoded = decode(leg.shape, 6);
			return {
				encoded: encode(decoded),
				durationMin: leg.summary.time / 60,
				distanceKm: leg.summary.length
			};
		} catch (err) {
			console.warn(`valhalla ${costing} failed`, err);
			return null;
		}
	})();
	cache.set(key, p);
	return p;
}
