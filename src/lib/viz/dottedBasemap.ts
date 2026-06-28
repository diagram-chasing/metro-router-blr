// The wall's dotted basemap: the road network (static/wall-roads.json) sampled into a field of
// points, one dot every N metres along each road, drawn as GPU geometry (a deck ScatterplotLayer
// — see buildDotsLayer in layers.ts). Same dotted look as the printed receipt map
// (src/lib/receipt/viz/RouteMap), but rendered as live points so it stays crisp at every zoom.
//
// Why not a baked raster: a fine, regular dot lattice baked to a texture aliases into moiré
// stripes under maplibre's mercator warp (sub-pixel, non-integer resampling) — `nearest`
// minification literally drops lattice columns. Live points have no texture, so no moiré.

type Line = [number, number][];
type Ring = [number, number][];
export type Poly = Ring[]; // [outer, ...holes] — a single polygon (MultiPolygons are split into these)
export type WallRoads = {
	bbox: [number, number, number, number]; // [west, south, east, north]
	roads: Line[];
	roadsFaint: Line[];
	water?: Poly[]; // lakes/reservoirs — rasterised to a dot-fill (mapscii draws polygons as dots)
	green?: Poly[]; // parks + woodland/grass landcover, same dot-fill treatment
};

const M_PER_DEG = 111320; // metres per degree latitude (good enough at city scale)

export async function loadWallRoads(url = '/wall-roads.json'): Promise<WallRoads | null> {
	try {
		const res = await fetch(url);
		if (!res.ok) return null; // not baked → caller keeps the vector road fallback
		return (await res.json()) as WallRoads;
	} catch (err) {
		console.warn('wall-roads load failed:', err);
		return null;
	}
}

// mapscii's move: don't scatter dots along the road (that reads as stipple) — snap every road
// point to a fixed grid and emit ONE dot per occupied cell. Bresenham-style stepping (≤½-cell)
// marks every cell a segment crosses, so each road is a connected run of adjacent cells. Rendered
// with metre-sized dots that fill the cell, those adjacent cells touch → a continuous dotted road
// (mapscii), not loose stipple. The grid is metric (square in metres via a reference-latitude
// correction), so it projects to a regular dot-matrix on screen at every zoom.
export function gridDots(
	lines: Line[],
	bbox: [number, number, number, number],
	cellM: number
): [number, number][] {
	const [w, s, e, n] = bbox;
	const refLat = (s + n) / 2;
	const kx = Math.cos((refLat * Math.PI) / 180) || 1; // lng→metric squash at this latitude
	const cellDeg = cellM / M_PER_DEG; // latitude-degrees per cell
	const cols = Math.ceil(((e - w) * kx) / cellDeg) + 2; // for packing (row, col) → one int
	const colOf = (lng: number) => Math.round(((lng - w) * kx) / cellDeg);
	const rowOf = (lat: number) => Math.round((lat - s) / cellDeg);

	const cells = new Set<number>();
	for (const line of lines) {
		for (let i = 1; i < line.length; i++) {
			const [x0, y0] = line[i - 1];
			const [x1, y1] = line[i];
			const latm = (y0 + y1) / 2;
			const dx = (x1 - x0) * Math.cos((latm * Math.PI) / 180);
			const segM = Math.hypot(dx, y1 - y0) * M_PER_DEG;
			const steps = Math.max(1, Math.ceil((segM / cellM) * 2)); // ≤½-cell steps → no gaps
			for (let k = 0; k <= steps; k++) {
				const t = k / steps;
				cells.add(rowOf(y0 + (y1 - y0) * t) * cols + colOf(x0 + (x1 - x0) * t));
			}
		}
	}

	const out: [number, number][] = [];
	for (const idx of cells) {
		const c = idx % cols;
		const r = (idx - c) / cols;
		out.push([w + (c * cellDeg) / kx, s + r * cellDeg]); // one dot at the cell centre
	}
	return out;
}

// mapscii draws a filled polygon by rasterising it onto the same dot buffer as the roads (earcut
// → scanline → braille dots), so water and greenery read as dot-FIELDS, not flat fills. We do the
// same: scan the grid cells inside each polygon's bbox and keep those whose centre is inside the
// polygon (even-odd ray cast across all rings, so holes/islands fall out), one dot per occupied
// cell — on the SAME metric grid as gridDots, so areas and roads share one continuous dot-matrix.
export function gridDotsFill(
	polys: Poly[],
	bbox: [number, number, number, number],
	cellM: number
): [number, number][] {
	const [w, s, e, n] = bbox;
	const refLat = (s + n) / 2;
	const kx = Math.cos((refLat * Math.PI) / 180) || 1;
	const cellDeg = cellM / M_PER_DEG;
	const cols = Math.ceil(((e - w) * kx) / cellDeg) + 2;
	const colOf = (lng: number) => Math.round(((lng - w) * kx) / cellDeg);
	const rowOf = (lat: number) => Math.round((lat - s) / cellDeg);
	const lngOf = (c: number) => w + (c * cellDeg) / kx;
	const latOf = (r: number) => s + r * cellDeg;

	// Even-odd point-in-polygon across every ring of one polygon (outer + holes).
	const inside = (poly: Poly, x: number, y: number): boolean => {
		let isIn = false;
		for (const ring of poly) {
			for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
				const xi = ring[i][0];
				const yi = ring[i][1];
				const xj = ring[j][0];
				const yj = ring[j][1];
				if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi) isIn = !isIn;
			}
		}
		return isIn;
	};

	const cells = new Set<number>();
	for (const poly of polys) {
		let minLng = Infinity;
		let minLat = Infinity;
		let maxLng = -Infinity;
		let maxLat = -Infinity;
		for (const ring of poly)
			for (const [x, y] of ring) {
				if (x < minLng) minLng = x;
				if (x > maxLng) maxLng = x;
				if (y < minLat) minLat = y;
				if (y > maxLat) maxLat = y;
			}
		const c0 = Math.max(0, colOf(minLng));
		const c1 = colOf(maxLng);
		const r0 = Math.max(0, rowOf(minLat));
		const r1 = rowOf(maxLat);
		for (let r = r0; r <= r1; r++) {
			const y = latOf(r);
			for (let c = c0; c <= c1; c++) {
				if (inside(poly, lngOf(c), y)) cells.add(r * cols + c);
			}
		}
	}

	const out: [number, number][] = [];
	for (const idx of cells) {
		const c = idx % cols;
		const r = (idx - c) / cols;
		out.push([lngOf(c), latOf(r)]);
	}
	return out;
}

// '#rrggbb' → [r, g, b] for deck's 0–255 colour arrays.
export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return [0, 0, 0];
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
