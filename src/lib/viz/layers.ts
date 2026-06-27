// deck.gl layer builders for the choropleth map: the field is one GPU-shaded texture
// (FieldLayer, see fieldLayer.ts); animation lives in shader uniforms.

import type { Deck } from './deck';
import type { ChoroplethField, HoodReading } from './choroplethField';

type FieldLayerInstance = InstanceType<Deck['FieldLayer']>;

// The health field as a single shaded texture over the grid bbox. `time` drives the shader
// animation; default is the blocky grid look, `smooth:true` for a bilinear (HD) field.
export function buildFieldLayer(
	deck: Deck,
	field: ChoroplethField,
	opts: { time: number; idle?: number; smooth?: boolean }
): FieldLayerInstance | null {
	const fieldData = field.textureImage();
	if (!fieldData) return null;
	const rec = field.recalcUniforms();
	const path = rec.path; // flattened uv points; pack 2/vec4 for the shader
	const pt = (i: number): [number, number] => [path[i * 2] ?? 0, path[i * 2 + 1] ?? 0];
	const props = {
		id: 'field',
		fieldData, // raw rgba8 the layer uploads to its own texture (ref-stable until changed)
		bounds: field.bounds, // [lonMin, latMin, lonMax, latMax] — drives the quad mesh
		smooth: opts.smooth === true, // default blocky (crisp cells); opt in to bilinear
		pickable: false,
		// fieldFx uniforms — animation happens here, on the GPU.
		time: opts.time,
		idle: opts.idle ?? 1, // master idle-motion amount (?idle=); 0 = the old static look
		dim: field.dim,
		recalcOrigin: rec.origin,
		recalcStart: rec.start,
		recalcDur: rec.dur,
		aspect: field.aspect,
		gridSize: field.gridSize,
		pathA: [...pt(0), ...pt(1)],
		pathB: [...pt(2), ...pt(3)],
		pathC: [...pt(4), ...pt(5)],
		pathD: [...pt(6), ...pt(7)],
		pathCount: path.length / 2
	};
	const Ctor = deck.FieldLayer as unknown as new (p: Record<string, unknown>) => FieldLayerInstance;
	return new Ctor(props);
}

// Spread clustered labels apart: a few iterations of pairwise repulsion (only between labels
// closer than `sepDeg`) nudge crowded ones outward, deterministic so they don't jitter. Works
// in a cos-lat plane. `sepDeg` is the target minimum spacing in degrees.
export function declutterHoods(hoods: HoodReading[], sepDeg = 0.042, iters = 60): HoodReading[] {
	if (hoods.length < 2) return hoods;
	const latMid = hoods.reduce((s, h) => s + h.c[1], 0) / hoods.length;
	const kx = Math.cos((latMid * Math.PI) / 180) || 1;
	const pts = hoods.map((h) => ({ x: h.c[0] * kx, y: h.c[1], h }));
	for (let it = 0; it < iters; it++) {
		for (let i = 0; i < pts.length; i++) {
			for (let j = i + 1; j < pts.length; j++) {
				let dx = pts[i].x - pts[j].x;
				let dy = pts[i].y - pts[j].y;
				const d = Math.hypot(dx, dy) || 1e-6;
				if (d < sepDeg) {
					const push = ((sepDeg - d) / d) * 0.5;
					dx *= push;
					dy *= push;
					pts[i].x += dx;
					pts[i].y += dy;
					pts[j].x -= dx;
					pts[j].y -= dy;
				}
			}
		}
	}
	return pts.map((p) => ({ ...p.h, c: [p.x / kx, p.y] as [number, number] }));
}

// One bold "years of life lost" figure per neighbourhood (place NAMES come from the OSM
// basemap). Drawn last so they composite over the choropleth; dark chip + halo keep them readable.
export function buildHoodLabels(deck: Deck, hoods: HoodReading[], tick: number, scale = 1) {
	// Years of life lost, one decimal (hoodMonths() reports months; /12 → years). "yr" cue keeps
	// the bare number decodable from across the room.
	const fmt = (m: number) => `${(m / 12).toFixed(1)}yr`;
	const font = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
	const placed = declutterHoods(hoods);
	return [
		new deck.TextLayer({
			id: 'hood-numbers',
			data: placed,
			getPosition: (d: HoodReading) => d.c,
			getText: (d: HoodReading) => fmt(d.months),
			getSize: 22 * scale,
			sizeUnits: 'pixels',
			getColor: () => [255, 226, 214, 244],
			fontFamily: font,
			fontWeight: 700,
			background: true,
			getBackgroundColor: [6, 10, 16, 200],
			backgroundPadding: [7, 4, 7, 3],
			outlineWidth: 2,
			outlineColor: [4, 6, 12, 255],
			fontSettings: { sdf: true },
			characterSet: 'auto',
			getTextAnchor: 'middle',
			getAlignmentBaseline: 'center',
			updateTriggers: { getText: tick, getColor: tick }
		})
	];
}
