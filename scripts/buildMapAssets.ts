// Bakes the OSM map overlays both renderers consume, from the same OpenFreeMap vector tiles the
// live map uses (see $lib/viz/basemapSource.ts). One source of truth for the fetch/decode/simplify
// pipeline — the shared helpers live in scripts/lib/osmTiles.ts.
//
//   pnpm map-assets:build            → both
//   pnpm basemap:build  (= receipt)  → static/receipt-basemap.json
//   pnpm wall-roads:build (= wall)   → static/wall-roads.json
//
// Two targets, two purpose-built outputs:
//   • receipt — major roads + water (rings) + place labels, over the BMRCL coverage bbox, for the
//     kiosk's mapscii mini-map (src/lib/receipt/viz/braille.ts).
//   • wall    — major roads + lakes + parks/gardens, over the emissions-grid bbox, for the wall's
//     dotted basemap (src/lib/viz/dottedBasemap.ts).
// Run once with network; commit the output. (The offline pmtiles tile bundle is a separate concern
// built by scripts/tiles/build-tiles.sh — not here.)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	Z,
	type Line,
	type Poly,
	type Place,
	type TileFeature,
	ROAD_MAJOR_CLASSES,
	bboxFromGeojson,
	bboxFromGrid,
	tileTemplate,
	forEachTile,
	extractLines,
	extractPolys,
	extractPoints,
	simplify,
	round,
	polyAreaM2
} from './lib/osmTiles';

// ── target-specific filters ──
const PLACE_CLASSES = new Set(['city', 'town', 'suburb', 'neighbourhood', 'quarter']);
const GREEN_SUBCLASS = new Set(['park', 'garden']);

// ── target config ──
type Bbox = [number, number, number, number];
type LayerSpec =
	| {
			kind: 'lines';
			layer: string;
			pass: (f: TileFeature) => boolean;
			flattenPolygons?: boolean;
			into: string;
	  }
	| { kind: 'polys'; layer: string; pass: (f: TileFeature) => boolean; into: string }
	| { kind: 'points'; layer: string; pass: (f: TileFeature) => boolean; into: string };
type Acc = Record<string, Line[] | Poly[] | Map<string, Place>>;
type Target = {
	name: string;
	out: string;
	bbox: () => Bbox;
	layers: LayerSpec[];
	assemble: (bbox: Bbox, acc: Acc) => object;
};

const RECEIPT: Target = {
	name: 'receipt',
	out: resolve('static/receipt-basemap.json'),
	bbox: () => bboxFromGeojson('static/bmrcl.geojson'),
	layers: [
		{
			kind: 'lines',
			layer: 'transportation',
			pass: (f) => ROAD_MAJOR_CLASSES.has(f.properties.class as string),
			flattenPolygons: true,
			into: 'roads'
		},
		{ kind: 'lines', layer: 'water', pass: () => true, flattenPolygons: true, into: 'water' },
		{
			kind: 'points',
			layer: 'place',
			pass: (f) => PLACE_CLASSES.has(f.properties.class as string),
			into: 'places'
		}
	],
	assemble: (bbox, acc) => {
		const simp = (lines: Line[]) =>
			lines.map((l) => simplify(l, 0.00015).map(round)).filter((l) => l.length >= 2); // ~15m; illegible below at print size
		const places = [...(acc.places as Map<string, Place>).values()].map((p) => ({
			...p,
			c: round(p.c)
		}));
		return {
			z: Z,
			bbox,
			roads: simp(acc.roads as Line[]),
			water: simp(acc.water as Line[]),
			places
		};
	}
};

const WALL: Target = {
	name: 'wall',
	out: resolve('static/wall-roads.json'),
	bbox: () => bboxFromGrid('static/baseline-grid.json'),
	layers: [
		{
			kind: 'lines',
			layer: 'transportation',
			pass: (f) => ROAD_MAJOR_CLASSES.has(f.properties.class as string),
			into: 'roads'
		},
		{ kind: 'lines', layer: 'transportation', pass: () => false, into: 'roadsFaint' }, // nothing below secondary — faint tier intentionally empty
		{ kind: 'polys', layer: 'water', pass: (f) => f.properties.class === 'lake', into: 'water' },
		{
			kind: 'polys',
			layer: 'landcover',
			pass: (f) => GREEN_SUBCLASS.has(f.properties.subclass as string),
			into: 'green'
		}
	],
	assemble: (bbox, acc) => {
		const simp = (lines: Line[]) =>
			lines.map((l) => simplify(l, 0.00008).map(round)).filter((l) => l.length >= 2); // ~9m — finer than print
		// Simplify each ring (~22m), prune tiny sub-cell polygons; rings need ≥4 pts to enclose area.
		const simpPolys = (polys: Poly[]) =>
			polys
				.map((poly) =>
					poly.map((ring) => simplify(ring, 0.0002).map(round)).filter((r) => r.length >= 4)
				)
				.filter((poly) => poly.length > 0 && polyAreaM2(poly) >= 5000);
		return {
			z: Z,
			bbox,
			roads: simp(acc.roads as Line[]),
			roadsFaint: simp(acc.roadsFaint as Line[]),
			water: simpPolys(acc.water as Poly[]),
			green: simpPolys(acc.green as Poly[])
		};
	}
};

const TARGETS: Record<string, Target> = { receipt: RECEIPT, wall: WALL };

async function bake(target: Target) {
	const bbox = target.bbox();
	console.log(`[${target.name}] bbox [${bbox.map((n) => n.toFixed(3)).join(',')}]`);
	const url = await tileTemplate();

	const acc: Acc = {};
	for (const spec of target.layers)
		acc[spec.into] = spec.kind === 'points' ? new Map<string, Place>() : [];

	await forEachTile(bbox, Z, url, (tile, tx, ty) => {
		for (const spec of target.layers) {
			const layer = tile.layers[spec.layer];
			if (spec.kind === 'lines') {
				for (const l of extractLines(layer, tx, ty, Z, spec.pass, spec.flattenPolygons))
					(acc[spec.into] as Line[]).push(l);
			} else if (spec.kind === 'polys') {
				for (const p of extractPolys(layer, tx, ty, Z, spec.pass))
					(acc[spec.into] as Poly[]).push(p);
			} else {
				// points: dedup by name, keeping the lowest rank; first-seen insertion order preserved.
				const m = acc[spec.into] as Map<string, Place>;
				for (const pt of extractPoints(layer, tx, ty, Z, spec.pass)) {
					const e = m.get(pt.name);
					if (!e || pt.rank < e.rank) m.set(pt.name, pt);
				}
			}
		}
	});

	const out = target.assemble(bbox, acc);
	writeFileSync(target.out, JSON.stringify(out), 'utf8');
	const kb = (readFileSync(target.out).length / 1024).toFixed(0);
	const sizes = Object.entries(out)
		.filter(([k, v]) => k !== 'bbox' && Array.isArray(v))
		.map(([k, v]) => `${(v as unknown[]).length} ${k}`)
		.join(', ');
	console.log(`[${target.name}] ${sizes} → ${target.out} (${kb} KB)`);
}

async function main() {
	const arg = (process.argv[2] ?? 'all').toLowerCase();
	const names = arg === 'all' ? ['receipt', 'wall'] : [arg];
	const targets = names.map((n) => TARGETS[n]);
	if (targets.some((t) => !t)) {
		console.error(`usage: buildMapAssets.ts [receipt|wall|all] (got "${arg}")`);
		process.exit(1);
	}
	for (const t of targets) await bake(t);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
