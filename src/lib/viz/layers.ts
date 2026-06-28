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
	opts: { time: number; idle?: number; smooth?: boolean; beforeId?: string; blocky?: number }
): FieldLayerInstance | null {
	const fieldData = field.textureImage();
	if (!fieldData) return null;
	const rec = field.recalcUniforms();
	const path = rec.path; // flattened uv points; pack 2/vec4 for the shader
	const pt = (i: number): [number, number] => [path[i * 2] ?? 0, path[i * 2 + 1] ?? 0];
	const props = {
		id: 'field',
		// Interleaved z-order: insert the heat BELOW the basemap roads + place labels, so they
		// composite on top of it (and fade in with zoom) instead of being washed out beneath it.
		beforeId: opts.beforeId,
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
		pathCount: path.length / 2,
		blocky: opts.blocky ?? 1 // heat super-cell size in grid cells (1 = native; >1 chunks it)
	};
	const Ctor = deck.FieldLayer as unknown as new (p: Record<string, unknown>) => FieldLayerInstance;
	return new Ctor(props);
}

// One bold "years of life lost" figure per anchor. Anchors are pre-spread by the caller —
// on the wall they ride the OSM place labels (maplibre's collision already declutters them), on
// the bare legend they come from field.autoHoods (farthest-point spread) — so no declutter here.
// Drawn last so they composite over the choropleth; a dark chip + halo keep them readable, and
// the figure is nudged just below its anchor so it sits under the basemap's place name, not on it.
export function buildHoodLabels(deck: Deck, hoods: HoodReading[], tick: number, scale = 1) {
	// Years of life lost, one decimal (months / 12 → years). "yr" cue keeps the bare number
	// decodable from across the room.
	const fmt = (m: number) => `${(m / 12).toFixed(1)}yr`;
	const font = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
	return [
		new deck.TextLayer({
			id: 'hood-numbers',
			data: hoods,
			getPosition: (d: HoodReading) => d.c,
			getText: (d: HoodReading) => fmt(d.months),
			getSize: 22 * scale,
			sizeUnits: 'pixels',
			getPixelOffset: [0, Math.round(15 * scale)], // drop under the OSM place name (y is screen-down)
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
