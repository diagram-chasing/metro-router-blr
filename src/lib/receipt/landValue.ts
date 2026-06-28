import guidanceData from '$lib/assets/guidance_value.json';

// ── Guidance-value zones ──
// guidance_value.json tiles Bengaluru into polygons, each carrying the state
// guidance value (₹ per m²) for that patch — the floor the registrar uses for
// stamp duty, a conservative stand-in for market land value. We test the
// destination point against the tiles to ground the parking real-estate beat in
// the actual neighbourhood rate instead of a single city-wide constant.

type Ring = [number, number][];
type Poly = Ring[]; // [outer, ...holes]

type Zone = {
	value: number;
	minLng: number;
	minLat: number;
	maxLng: number;
	maxLat: number;
	polys: Poly[];
};

type GVFeature = {
	properties: { Value?: number | null } | null;
	geometry: { type: string; coordinates: unknown } | null;
};

// Keep references to the original coordinate arrays (no copy) and precompute a
// bbox per zone from its outer rings for a cheap reject before the ring test.
const ZONES: Zone[] = (guidanceData as unknown as { features: GVFeature[] }).features
	.map((f): Zone | null => {
		const value = Number(f.properties?.Value ?? 0);
		const g = f.geometry;
		if (!(value > 0) || !g) return null;

		let polys: Poly[];
		if (g.type === 'Polygon') polys = [g.coordinates as Poly];
		else if (g.type === 'MultiPolygon') polys = g.coordinates as Poly[];
		else return null;

		let minLng = Infinity,
			minLat = Infinity,
			maxLng = -Infinity,
			maxLat = -Infinity;
		for (const poly of polys) {
			for (const [lng, lat] of poly[0]) {
				if (lng < minLng) minLng = lng;
				if (lng > maxLng) maxLng = lng;
				if (lat < minLat) minLat = lat;
				if (lat > maxLat) maxLat = lat;
			}
		}
		return { value, minLng, minLat, maxLng, maxLat, polys };
	})
	.filter((z): z is Zone => z !== null);

// Ray-casting point-in-ring (even-odd rule), [lng, lat] coordinates.
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0],
			yi = ring[i][1],
			xj = ring[j][0],
			yj = ring[j][1];
		if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
			inside = !inside;
		}
	}
	return inside;
}

// Inside the outer ring and outside every hole.
function pointInPoly(lng: number, lat: number, poly: Poly): boolean {
	if (!pointInRing(lng, lat, poly[0])) return false;
	for (let i = 1; i < poly.length; i++) {
		if (pointInRing(lng, lat, poly[i])) return false;
	}
	return true;
}

/**
 * Guidance value (₹ per m²) for the zone containing `point` ([lng, lat]), or null
 * when the point falls outside every tile (lakes, gaps, outside the dataset).
 */
export function landValueAtPoint(point: [number, number]): number | null {
	const [lng, lat] = point;
	for (const z of ZONES) {
		if (lng < z.minLng || lng > z.maxLng || lat < z.minLat || lat > z.maxLat) continue;
		for (const poly of z.polys) {
			if (pointInPoly(lng, lat, poly)) return z.value;
		}
	}
	return null;
}
