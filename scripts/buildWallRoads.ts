// Bakes the wall's dotted road network over the emissions-grid bbox so CollectiveMap can
// render it as a constant GeoJSON source — the live vector tiles only ship minor/service
// roads at z12+, so they pop in on zoom-in and vanish at the resting (wide) view. Baked
// once at a fixed zoom, the whole network is present at every display scale (same trick as
// the receipt mini-map, scripts/buildBasemap.ts), and it covers the full grid (the receipt
// extract stops ~7km short of the grid's north edge).
//
//   pnpm wall-roads:build   →   static/wall-roads.json
//
// Secondary and above only (motorway → secondary) baked into `roads`; tertiary/minor/service are
// dropped so the wall shows just the arterial skeleton. `roadsFaint` is kept (empty) for the
// consumer's shape. Also bakes the city's lakes (`water`) and greenery (`park` + select
// `landcover`) as polygons, which CollectiveMap rasterises into dot-fields the same way as the
// roads (mapscii draws filled polygons as dots). Run once with network; commit the output.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const Z = 13; // minor (z12) + service (z13) are present here; few enough tiles to fetch
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const BBOX_PAD = 0.15; // grow the grid bbox so the resting "cover" overflow stays road-filled
const ROAD_MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary']); // secondary and above
const ROAD_FAINT = new Set<string>(); // nothing below secondary — faint tier intentionally empty
// Greenery landcover classes worth showing as a dot-field; parks come from the `park` layer (all of it).
const GREEN_LANDCOVER = new Set(['wood', 'grass', 'scrub', 'wetland']);
const SIMPLIFY_TOL = 0.00008; // ~9m in degrees — finer than the print extract, for the wall
const AREA_TOL = 0.0002; // ~22m — coarser for area outlines; the dot grid is ~70–90m so fine edges are moot
const MIN_AREA_M2 = 5000; // drop polygons smaller than ~70m² square — they'd yield ≤1 dot, just noise+bytes
const COORD_DP = 6;

type LngLat = [number, number];
type Line = LngLat[];
type Ring = LngLat[];
type Poly = Ring[]; // [outer, ...holes]

const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat: number, z: number) => {
	const r = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

async function tileTemplate(): Promise<(z: number, x: number, y: number) => string> {
	const tj = await fetch(TILEJSON_URL).then((r) => r.json());
	const tmpl: string = tj.tiles[0];
	return (z, x, y) =>
		tmpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

// The field's extent (baseline-grid is baked to the same lattice the live field uses),
// padded so the resting camera — which COVERS the viewport, overflowing the looser axis —
// never reveals bare background past the road network.
function gridBbox(): [number, number, number, number] {
	const g = JSON.parse(readFileSync(resolve('static/baseline-grid.json'), 'utf8'));
	const [minX, minY, maxX, maxY] = g.bbox as [number, number, number, number];
	const dx = (maxX - minX) * BBOX_PAD;
	const dy = (maxY - minY) * BBOX_PAD;
	return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

// ── Douglas–Peucker (verbatim from buildBasemap) ──
function simplify(pts: Line, tol: number): Line {
	if (pts.length <= 2) return pts;
	const sqTol = tol * tol;
	const keep = new Uint8Array(pts.length);
	keep[0] = keep[pts.length - 1] = 1;
	const stack: [number, number][] = [[0, pts.length - 1]];
	const segDistSq = (p: LngLat, a: LngLat, b: LngLat) => {
		let [x, y] = a;
		let dx = b[0] - x,
			dy = b[1] - y;
		if (dx || dy) {
			const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
			if (t > 1) [x, y] = b;
			else if (t > 0) {
				x += dx * t;
				y += dy * t;
			}
		}
		dx = p[0] - x;
		dy = p[1] - y;
		return dx * dx + dy * dy;
	};
	while (stack.length) {
		const [lo, hi] = stack.pop()!;
		let maxD = 0,
			idx = -1;
		for (let i = lo + 1; i < hi; i++) {
			const d = segDistSq(pts[i], pts[lo], pts[hi]);
			if (d > maxD) {
				maxD = d;
				idx = i;
			}
		}
		if (maxD > sqTol && idx > 0) {
			keep[idx] = 1;
			stack.push([lo, idx], [idx, hi]);
		}
	}
	return pts.filter((_, i) => keep[i]);
}

const round = (p: LngLat): LngLat => [+p[0].toFixed(COORD_DP), +p[1].toFixed(COORD_DP)];

async function fetchTile(
	url: (z: number, x: number, y: number) => string,
	z: number,
	x: number,
	y: number
): Promise<VectorTile | null> {
	const res = await fetch(url(z, x, y));
	if (!res.ok) {
		if (res.status === 404 || res.status === 204) return null;
		throw new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`);
	}
	let buf = new Uint8Array(await res.arrayBuffer());
	if (buf.length === 0) return null;
	if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(gunzipSync(buf)); // gzip magic
	return new VectorTile(new Pbf(buf));
}

function extractLines(
	layer: VectorTile['layers'][string] | undefined,
	x: number,
	y: number,
	z: number,
	pass: (f: any) => boolean
): Line[] {
	if (!layer) return [];
	const out: Line[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (!pass(f)) continue;
		const g = f.toGeoJSON(x, y, z).geometry;
		if (g.type === 'LineString') out.push(g.coordinates as Line);
		else if (g.type === 'MultiLineString') for (const l of g.coordinates) out.push(l as Line);
	}
	return out;
}

function extractPolys(
	layer: VectorTile['layers'][string] | undefined,
	x: number,
	y: number,
	z: number,
	pass: (f: any) => boolean
): Poly[] {
	if (!layer) return [];
	const out: Poly[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (!pass(f)) continue;
		const g = f.toGeoJSON(x, y, z).geometry;
		if (g.type === 'Polygon') out.push(g.coordinates as Poly);
		else if (g.type === 'MultiPolygon') for (const p of g.coordinates) out.push(p as Poly);
	}
	return out;
}

// Rough bbox area in m² (good enough at city scale) — used to prune sub-cell noise polygons.
function polyAreaM2(poly: Poly): number {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const ring of poly)
		for (const [x, y] of ring) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	if (!isFinite(minX)) return 0;
	const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
	return (maxX - minX) * kx * 111320 * ((maxY - minY) * 111320);
}

async function main() {
	const [minX, minY, maxX, maxY] = gridBbox();
	const tx0 = lon2tile(minX, Z),
		tx1 = lon2tile(maxX, Z);
	const ty0 = lat2tile(maxY, Z), // y grows southward
		ty1 = lat2tile(minY, Z);
	const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
	console.log(
		`grid bbox [${minX.toFixed(3)},${minY.toFixed(3)},${maxX.toFixed(3)},${maxY.toFixed(3)}] → ${total} tiles @ z${Z}`
	);

	const url = await tileTemplate();
	const roads: Line[] = [];
	const roadsFaint: Line[] = [];
	const water: Poly[] = [];
	const green: Poly[] = [];
	let done = 0;
	for (let tx = tx0; tx <= tx1; tx++) {
		for (let ty = ty0; ty <= ty1; ty++) {
			const tile = await fetchTile(url, Z, tx, ty).catch((e) => {
				console.warn(`  skip ${Z}/${tx}/${ty}: ${e.message}`);
				return null;
			});
			done++;
			if (tile) {
				const t = tile.layers['transportation'];
				for (const l of extractLines(t, tx, ty, Z, (f) => ROAD_MAJOR.has(f.properties.class)))
					roads.push(l);
				for (const l of extractLines(t, tx, ty, Z, (f) => ROAD_FAINT.has(f.properties.class)))
					roadsFaint.push(l);
				// Lakes/reservoirs (whole `water` layer) and greenery (`park` layer + select landcover).
				for (const p of extractPolys(tile.layers['water'], tx, ty, Z, () => true)) water.push(p);
				for (const p of extractPolys(tile.layers['park'], tx, ty, Z, () => true)) green.push(p);
				for (const p of extractPolys(
					tile.layers['landcover'],
					tx,
					ty,
					Z,
					(f) => GREEN_LANDCOVER.has(f.properties.class)
				))
					green.push(p);
			}
			if (done % 10 === 0 || done === total) console.log(`  ${done}/${total} tiles`);
		}
	}

	const simp = (lines: Line[]) =>
		lines.map((l) => simplify(l, SIMPLIFY_TOL).map(round)).filter((l) => l.length >= 2);
	// Simplify each ring, prune tiny sub-cell polygons (noise + bytes); rings need ≥4 pts to enclose area.
	const simpPolys = (polys: Poly[]) =>
		polys
			.map((poly) => poly.map((ring) => simplify(ring, AREA_TOL).map(round)).filter((r) => r.length >= 4))
			.filter((poly) => poly.length > 0 && polyAreaM2(poly) >= MIN_AREA_M2);
	const out = {
		z: Z,
		bbox: [minX, minY, maxX, maxY],
		roads: simp(roads),
		roadsFaint: simp(roadsFaint),
		water: simpPolys(water),
		green: simpPolys(green)
	};

	const target = resolve('static/wall-roads.json');
	writeFileSync(target, JSON.stringify(out), 'utf8');
	const kb = (readFileSync(target).length / 1024).toFixed(0);
	console.log(
		`wall-roads: ${out.roads.length} major lines, ${out.water.length} water + ${out.green.length} green polys → ${target} (${kb} KB)`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
