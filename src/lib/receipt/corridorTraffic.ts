import trafficData from '$lib/assets/traffic.json';
import { MODE_CO2E_G_PER_PKM, haversineKm } from '$lib/emissions';
import { findClosestPointOnPolyline, type LngLat } from '$lib/utils/polylineGeometry';
import type { RouteSegmentGeo } from '$lib/exhibit/types';

// ── Junction dataset ──
// traffic.json pairs each junction Point with a 250 m buffer Polygon; the points
// carry the same `Daily Traffic Volume`, so we keep only the points and reproduce
// the buffer with a 250 m distance test against the route.
type Junction = { lng: number; lat: number; volume: number };

type TrafficFeature = {
	geometry: { type: string; coordinates: number[] };
	properties: Record<string, unknown> | null;
};

const JUNCTIONS: Junction[] = (trafficData as unknown as { features: TrafficFeature[] }).features
	.filter((f) => f.geometry?.type === 'Point')
	.map((f) => {
		const [lng, lat] = f.geometry.coordinates;
		return { lng, lat, volume: Number(f.properties?.['Daily Traffic Volume'] ?? 0) };
	})
	.filter((j) => j.volume > 0);

const ALL_VOLUMES_ASC = JUNCTIONS.map((j) => j.volume).sort((a, b) => a - b);

// A junction is "on the route" when the route line passes within this distance of it.
const MATCH_RADIUS_KM = 0.25;
// Multiple junctions → the lowest-reasonable estimate: a low percentile resists one
// tiny outlier junction dragging the whole corridor down. Same percentile is the
// city-wide fallback when the route touches no junction at all.
const LOW_PCT = 25;
const PT_SHARE = 0.25; // assumed public-transport modal split (user-specified)

// Blended CO2e for corridor traffic: 25% public transport, 75% private. The private
// sub-mix follows the CTTP arterial split renormalised (2wh 64% / car 28% / auto 8%).
// Illustrative, not measured — flagged as a model on the receipt.
const PRIVATE_MIX: { mode: keyof typeof MODE_CO2E_G_PER_PKM; w: number }[] = [
	{ mode: 'two_wheeler', w: 0.64 },
	{ mode: 'car', w: 0.28 },
	{ mode: 'auto', w: 0.08 }
];
const PRIVATE_G_PER_PKM = PRIVATE_MIX.reduce((s, m) => s + m.w * MODE_CO2E_G_PER_PKM[m.mode], 0);
const BLENDED_G_PER_PKM = PT_SHARE * MODE_CO2E_G_PER_PKM.bus + (1 - PT_SHARE) * PRIVATE_G_PER_PKM;

/** Linear-interpolated percentile of an ascending array. */
function percentile(sortedAsc: number[], p: number): number {
	if (sortedAsc.length === 0) return 0;
	if (sortedAsc.length === 1) return sortedAsc[0];
	const rank = (p / 100) * (sortedAsc.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	if (lo === hi) return sortedAsc[lo];
	return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

export type CorridorTraffic = {
	peoplePerDay: number;
	matchedCount: number;
	isFallback: boolean;
	ptShare: number;
	dailyCo2eKg: number;
};

/**
 * Estimate how many people travel the drawn route each day, grounded in the nearby
 * junction traffic counts. When the route passes several junctions we take the 25th
 * percentile of their volumes (the lowest-reasonable through-traffic); with no
 * junction within 250 m we fall back to the 25th percentile of the whole dataset.
 */
export function estimateCorridorTraffic(
	segments: RouteSegmentGeo[] | undefined,
	distanceKm: number
): CorridorTraffic {
	const routeCoords: LngLat[] = (segments ?? []).flatMap((s) => s.coords as LngLat[]);

	// Junction volumes the route passes within MATCH_RADIUS_KM of (empty when the route
	// has too few points). With matches we take their 25th percentile; with none we fall
	// back to the city-wide 25th percentile.
	const matched: number[] = [];
	if (routeCoords.length >= 2) {
		for (const j of JUNCTIONS) {
			const closest = findClosestPointOnPolyline([j.lng, j.lat], routeCoords);
			if (!closest.point) continue;
			const km = haversineKm(j.lng, j.lat, closest.point[0], closest.point[1]);
			if (km <= MATCH_RADIUS_KM) matched.push(j.volume);
		}
	}
	const matchedCount = matched.length;

	let peoplePerDay: number;
	let isFallback: boolean;
	if (matched.length > 0) {
		matched.sort((a, b) => a - b);
		peoplePerDay = Math.round(percentile(matched, LOW_PCT));
		isFallback = false;
	} else {
		peoplePerDay = Math.round(percentile(ALL_VOLUMES_ASC, LOW_PCT));
		isFallback = true;
	}

	const dailyCo2eKg = (peoplePerDay * Math.max(0, distanceKm) * BLENDED_G_PER_PKM) / 1000;

	return { peoplePerDay, matchedCount, isFallback, ptShare: PT_SHARE, dailyCo2eKg };
}
