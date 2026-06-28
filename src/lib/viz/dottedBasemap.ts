// The wall's dotted basemap: the road network (static/wall-roads.json) sampled into a field of
// points, one dot every N metres along each road, drawn as GPU geometry (a deck ScatterplotLayer
// — see buildDotsLayer in layers.ts). Same dotted look as the printed receipt map
// (src/lib/receipt/viz/RouteMap), but rendered as live points so it stays crisp at every zoom.
//
// Why not a baked raster: a fine, regular dot lattice baked to a texture aliases into moiré
// stripes under maplibre's mercator warp (sub-pixel, non-integer resampling) — `nearest`
// minification literally drops lattice columns. Live points have no texture, so no moiré.

type Line = [number, number][];
export type WallRoads = {
	bbox: [number, number, number, number]; // [west, south, east, north]
	roads: Line[];
	roadsFaint: Line[];
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

// '#rrggbb' → [r, g, b] for deck's 0–255 colour arrays.
export function hexToRgb(hex: string): [number, number, number] {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return [0, 0, 0];
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
