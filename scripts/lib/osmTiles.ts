// Shared OSM vector-tile pipeline for the baked map overlays (scripts/buildMapAssets.ts).
// Fetches OpenFreeMap planet tiles, decodes the PBF, and exposes the extract/simplify helpers
// both baker targets reuse. Pure Node (no SvelteKit virtuals) so it runs under vite-node.
//
// Separate concern: the self-hosted runtime basemap (scripts/tiles/ → static/tiles/*.pmtiles via
// tilemaker) is the offline maplibre tile source, not a baked overlay — it is intentionally not here.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import Pbf from 'pbf';

export type TileFeature = VectorTileFeature; // a decoded vector-tile feature, for the pass() filters

export type LngLat = [number, number];
export type Line = LngLat[];
export type Ring = LngLat[];
export type Poly = Ring[]; // [outer, ...holes]
export type Place = { name: string; c: LngLat; rank: number; kind: string };

export const Z = 13; // ~5km/tile; minor (z12) + service (z13) present, few enough tiles to fetch
export const BBOX_PAD = 0.15; // grow the source bbox so the resting "cover" overflow stays filled
export const COORD_DP = 6;
export const ROAD_MAJOR_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary']);
// The authoritative source the bakers always read — NOT the runtime TILES_URL (which can be a
// pmtiles:// override on the offline wall). Keep in sync with the fallback literal in
// src/lib/viz/basemapSource.ts (TILES_URL).
export const TILE_SOURCE_URL = 'https://tiles.openfreemap.org/planet';

// ── tile math ──
export const lon2tile = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
export const lat2tile = (lat: number, z: number) => {
	const r = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// ── bbox helpers (apply BBOX_PAD; return the padded extent the output records) ──
const pad = (
	minX: number,
	minY: number,
	maxX: number,
	maxY: number
): [number, number, number, number] => {
	const dx = (maxX - minX) * BBOX_PAD;
	const dy = (maxY - minY) * BBOX_PAD;
	return [minX - dx, minY - dy, maxX + dx, maxY + dy];
};

// Walk every coordinate of a GeoJSON FeatureCollection (the metro network's extent).
export function bboxFromGeojson(path: string): [number, number, number, number] {
	const fc = JSON.parse(readFileSync(resolve(path), 'utf8'));
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
	return pad(minX, minY, maxX, maxY);
}

// Read the precomputed `.bbox` of a lattice file (the emissions/baseline grid).
export function bboxFromGrid(path: string): [number, number, number, number] {
	const g = JSON.parse(readFileSync(resolve(path), 'utf8'));
	const [minX, minY, maxX, maxY] = g.bbox as [number, number, number, number];
	return pad(minX, minY, maxX, maxY);
}

// ── network ──
export async function tileTemplate(): Promise<(z: number, x: number, y: number) => string> {
	const tj = await fetch(TILE_SOURCE_URL).then((r) => r.json());
	const tmpl: string = tj.tiles[0];
	return (z, x, y) =>
		tmpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export async function fetchTile(
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

// ── extractors ──
type Layer = VectorTile['layers'][string] | undefined;

// Lines from a layer. flattenPolygons also emits Polygon/MultiPolygon rings as lines (used for
// water drawn as outlines); off, only LineString/MultiLineString pass.
export function extractLines(
	layer: Layer,
	x: number,
	y: number,
	z: number,
	pass: (f: TileFeature) => boolean,
	flattenPolygons = false
): Line[] {
	if (!layer) return [];
	const out: Line[] = [];
	for (let i = 0; i < layer.length; i++) {
		const f = layer.feature(i);
		if (!pass(f)) continue;
		const g = f.toGeoJSON(x, y, z).geometry;
		if (g.type === 'LineString') out.push(g.coordinates as Line);
		else if (g.type === 'MultiLineString') for (const l of g.coordinates) out.push(l as Line);
		else if (flattenPolygons && g.type === 'Polygon')
			for (const r of g.coordinates) out.push(r as Line);
		else if (flattenPolygons && g.type === 'MultiPolygon')
			for (const poly of g.coordinates) for (const r of poly) out.push(r as Line);
	}
	return out;
}

// Polygons from a layer, preserving [outer, ...holes] structure (MultiPolygons split into Polys).
export function extractPolys(
	layer: Layer,
	x: number,
	y: number,
	z: number,
	pass: (f: TileFeature) => boolean
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

// Named points (place labels), preferring English/Latin names.
export function extractPoints(
	layer: Layer,
	x: number,
	y: number,
	z: number,
	pass: (f: TileFeature) => boolean
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
		out.push({
			name,
			c: g.coordinates as LngLat,
			rank: Number(p.rank ?? 99),
			kind: String(p.class || '')
		});
	}
	return out;
}

// ── geometry ──
// Douglas–Peucker line simplification.
export function simplify(pts: Line, tol: number): Line {
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

export const round = (p: LngLat): LngLat => [+p[0].toFixed(COORD_DP), +p[1].toFixed(COORD_DP)];

// Rough bbox area in m² (good enough at city scale) — used to prune sub-cell noise polygons.
export function polyAreaM2(poly: Poly): number {
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

// ── driver ──
// Iterate the tile range covering bbox, fetching each tile (failures skipped) and handing it to
// onTile. Loop order is tx-outer / ty-inner — keep it; the accumulated feature order depends on it.
export async function forEachTile(
	bbox: [number, number, number, number],
	z: number,
	url: (z: number, x: number, y: number) => string,
	onTile: (tile: VectorTile, tx: number, ty: number) => void
): Promise<void> {
	const [minX, minY, maxX, maxY] = bbox;
	const tx0 = lon2tile(minX, z),
		tx1 = lon2tile(maxX, z);
	const ty0 = lat2tile(maxY, z), // y grows southward
		ty1 = lat2tile(minY, z);
	const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
	console.log(`  ${total} tiles @ z${z}`);
	let done = 0;
	for (let tx = tx0; tx <= tx1; tx++) {
		for (let ty = ty0; ty <= ty1; ty++) {
			const tile = await fetchTile(url, z, tx, ty).catch((e) => {
				console.warn(`  skip ${z}/${tx}/${ty}: ${e.message}`);
				return null;
			});
			done++;
			if (tile) onTile(tile, tx, ty);
			if (done % 10 === 0 || done === total) console.log(`  ${done}/${total} tiles`);
		}
	}
}
