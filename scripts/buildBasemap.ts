// Bakes a compact roads+water extract for the receipt's mapscii-style mini-map, so the
// kiosk renders it offline (same-origin static asset, no runtime tile fetch / PBF parse).
//
//   pnpm basemap:build   →   static/receipt-basemap.json
//
// Source is the same OpenFreeMap vector tiles the live map uses ($lib/viz/palette.ts):
// the `transportation` layer (major classes only) + the `water` layer, over the BMRCL
// coverage bbox. Run once with network; commit the output.

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const Z = 13; // ~5km/tile; enough major-road detail for a 520px print, few enough tiles
// TileJSON endpoint (same source as $lib/viz/palette.ts); the real tile template lives
// inside it under a versioned path, resolved at runtime.
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
async function tileTemplate(): Promise<(z: number, x: number, y: number) => string> {
	const tj = await fetch(TILEJSON_URL).then((r) => r.json());
	const tmpl: string = tj.tiles[0];
	return (z, x, y) =>
		tmpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
const BBOX_PAD = 0.15; // grow the metro bbox so route context near the edges is covered
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const PLACE_CLASSES = new Set(['city', 'town', 'suburb', 'neighbourhood', 'quarter']);
const SIMPLIFY_TOL = 0.00015; // ~15m in degrees — illegible detail below this at print size
const COORD_DP = 6;

type LngLat = [number, number];
type Line = LngLat[];
type Place = { name: string; c: LngLat; rank: number; kind: string };

// ── tile math ──
const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat: number, z: number) => {
	const r = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// ── bbox of the metro network ──
function coverageBbox(): [number, number, number, number] {
	const fc = JSON.parse(readFileSync(resolve('static/bmrcl.geojson'), 'utf8'));
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;
	const walk = (c: unknown) => {
		if (typeof (c as number[])[0] === 'number') {
			const [x, y] = c as LngLat;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		} else for (const p of c as unknown[]) walk(p);
	};
	for (const f of fc.features) if (f.geometry) walk(f.geometry.coordinates);
	const dx = (maxX - minX) * BBOX_PAD;
	const dy = (maxY - minY) * BBOX_PAD;
	return [minX - dx, minY - dy, maxX + dx, maxY + dy];
}

// ── Douglas–Peucker ──
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

const round = (p: LngLat): LngLat => [
	+p[0].toFixed(COORD_DP),
	+p[1].toFixed(COORD_DP)
];

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

function extractLines(layer: VectorTile['layers'][string] | undefined, x: number, y: number, z: number, pass: (f: any) => boolean): Line[] {
	if (!layer) return [];
	const out: Line[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (!pass(f)) continue;
		const g = f.toGeoJSON(x, y, z).geometry;
		if (g.type === 'LineString') out.push(g.coordinates as Line);
		else if (g.type === 'MultiLineString') for (const l of g.coordinates) out.push(l as Line);
		else if (g.type === 'Polygon') for (const r of g.coordinates) out.push(r as Line);
		else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const r of poly) out.push(r as Line);
	}
	return out;
}

function extractPoints(
	layer: VectorTile['layers'][string] | undefined,
	x: number,
	y: number,
	z: number,
	pass: (f: any) => boolean
): Place[] {
	if (!layer) return [];
	const out: Place[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (!pass(f)) continue;
		const p = f.properties as Record<string, unknown>;
		const name = String(p['name:en'] || p['name:latin'] || p.name || '').trim();
		if (!name) continue;
		const g = f.toGeoJSON(x, y, z).geometry;
		if (g.type !== 'Point') continue;
		out.push({ name, c: g.coordinates as LngLat, rank: Number(p.rank ?? 99), kind: String(p.class || '') });
	}
	return out;
}

async function main() {
	const [minX, minY, maxX, maxY] = coverageBbox();
	const tx0 = lon2tile(minX, Z),
		tx1 = lon2tile(maxX, Z);
	const ty0 = lat2tile(maxY, Z), // note: y grows southward
		ty1 = lat2tile(minY, Z);
	const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
	console.log(`bbox [${minX.toFixed(3)},${minY.toFixed(3)},${maxX.toFixed(3)},${maxY.toFixed(3)}] → ${total} tiles @ z${Z}`);

	const url = await tileTemplate();
	const roads: Line[] = [];
	const water: Line[] = [];
	const placeMap = new Map<string, Place>();
	let done = 0;
	for (let tx = tx0; tx <= tx1; tx++) {
		for (let ty = ty0; ty <= ty1; ty++) {
			const tile = await fetchTile(url, Z, tx, ty).catch((e) => {
				console.warn(`  skip ${Z}/${tx}/${ty}: ${e.message}`);
				return null;
			});
			done++;
			if (!tile) continue;
			for (const l of extractLines(tile.layers['transportation'], tx, ty, Z, (f) => ROAD_CLASSES.has(f.properties.class)))
				roads.push(l);
			for (const r of extractLines(tile.layers['water'], tx, ty, Z, () => true)) water.push(r);
			for (const pl of extractPoints(tile.layers['place'], tx, ty, Z, (f) => PLACE_CLASSES.has(f.properties.class))) {
				const e = placeMap.get(pl.name);
				if (!e || pl.rank < e.rank) placeMap.set(pl.name, pl);
			}
			if (done % 10 === 0 || done === total) console.log(`  ${done}/${total} tiles`);
		}
	}

	const simp = (lines: Line[]) =>
		lines.map((l) => simplify(l, SIMPLIFY_TOL).map(round)).filter((l) => l.length >= 2);
	const places = [...placeMap.values()].map((p) => ({ ...p, c: round(p.c) }));
	const out = { z: Z, bbox: [minX, minY, maxX, maxY], roads: simp(roads), water: simp(water), places };

	const target = resolve('static/receipt-basemap.json');
	writeFileSync(target, JSON.stringify(out), 'utf8');
	const kb = (readFileSync(target).length / 1024).toFixed(0);
	console.log(
		`receipt-basemap: ${out.roads.length} roads, ${out.water.length} water rings, ${places.length} places → ${target} (${kb} KB)`
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
