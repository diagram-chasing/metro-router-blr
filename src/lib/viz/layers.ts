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
	opts: {
		time: number;
		idle?: number;
		smooth?: boolean;
		beforeId?: string;
		blocky?: number;
		steps?: number;
	}
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
		blocky: opts.blocky ?? 1, // heat super-cell size in grid cells (1 = native; >1 chunks it)
		steps: opts.steps ?? 0 // posterize the heat into N discrete bands (0/<2 = continuous ramp)
	};
	const Ctor = deck.FieldLayer as unknown as new (p: Record<string, unknown>) => FieldLayerInstance;
	return new Ctor(props);
}

// The dotted basemap as live points: one dot per occupied grid cell (dottedBasemap.ts), the
// receipt / mapscii 1-bit dot-field rendered as GPU geometry so it stays crisp at every zoom
// instead of aliasing like a baked texture. The radius is in METRES (≈ the cell size), so each dot
// fills its cell and neighbours touch → continuous dotted roads, not loose stipple; the dots grow
// with zoom like the grid itself. `minPx`/`maxPx` keep them visible when far out and sane when
// deep in. `id` separates tiers (major/faint); `beforeId` keeps the place labels on top; `opacity`
// is the zoom-bloom grade driven from the rAF loop.
export function buildDotsLayer(
	deck: Deck,
	points: [number, number][],
	opts: {
		id: string;
		radiusM: number;
		minPx: number;
		maxPx: number;
		color: [number, number, number];
		opacity: number;
		beforeId?: string;
	}
) {
	return new deck.ScatterplotLayer({
		id: opts.id,
		data: points,
		getPosition: (d: [number, number]) => d,
		getRadius: opts.radiusM,
		radiusUnits: 'meters',
		radiusMinPixels: opts.minPx,
		radiusMaxPixels: opts.maxPx,
		getFillColor: [...opts.color, 255],
		stroked: false,
		pickable: false,
		opacity: opts.opacity,
		beforeId: opts.beforeId,
		parameters: { depthTest: false }
	});
}

// One receipt slip per anchor: the place name on white "paper" (black mono) with the years-of-life-
// lost figure as a reverse (white-on-black) bar directly below — the .paper + .rev motif from
// src/lib/receipt/ReceiptDoc (and the wall's routecard/hero). Anchors are pre-spread by the caller —
// on the wall they ride the OSM place labels (maplibre's collision already declutters them), on the
// bare legend they come from field.autoHoods (farthest-point spread) — so no declutter here. Drawn
// last so they composite over the choropleth. The name and figure stack centred on the anchor, name
// above the point, figure below it.
// `fade` is the updateTrigger for the alpha accessors — pass a frame-rate counter so deck re-reads
// each label's eased `opacity` every frame; it defaults to `tick` for callers that don't animate.
export function buildHoodLabels(
	deck: Deck,
	hoods: HoodReading[],
	tick: number,
	scale = 1,
	fade: number = tick
) {
	// Years of life lost, one decimal (months / 12 → years), with a leading minus so it reads as a
	// deficit — "-1.5yr". "yr" cue keeps the bare number decodable from across the room.
	const fmt = (m: number) => `-${(m / 12).toFixed(1)}yr`;
	const font = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
	const a = (op?: number) => Math.round(255 * (op ?? 1)); // per-label fade → alpha
	// Legend hoods carry no name; wall hoods all do. Reuse the same array reference when nothing is
	// filtered out so deck doesn't see the name layer's `data` change (and re-layout) every frame.
	const allNamed = hoods.every((h) => h.name && h.name.trim());
	const named = allNamed ? hoods : hoods.filter((h) => h.name && h.name.trim());
	const common = {
		data: hoods,
		getPosition: (d: HoodReading) => d.c,
		sizeUnits: 'pixels' as const,
		fontFamily: font,
		fontWeight: 700,
		fontSettings: { sdf: true },
		characterSet: 'auto' as const,
		getTextAnchor: 'middle' as const,
		background: true,
		updateTriggers: { getText: tick, getColor: fade, getBackgroundColor: fade }
	};
	return [
		// Place name — black on white paper (ReceiptDoc .paper), sitting above the anchor point.
		new deck.TextLayer({
			...common,
			id: 'hood-names',
			data: named,
			getText: (d: HoodReading) => (d.name ?? '').toUpperCase(),
			getSize: 24 * scale,
			getAlignmentBaseline: 'bottom',
			getPixelOffset: [0, -Math.round(4 * scale)],
			getColor: (d: HoodReading) => [0, 0, 0, a(d.opacity)],
			getBackgroundColor: (d: HoodReading) => [255, 255, 255, a(d.opacity)],
			backgroundPadding: [10, 6, 10, 5]
		}),
		// Years lost — the reverse (white-on-black) hero bar (ReceiptDoc .rev), below the anchor point.
		new deck.TextLayer({
			...common,
			id: 'hood-numbers',
			getText: (d: HoodReading) => fmt(d.months),
			getSize: 46 * scale,
			getAlignmentBaseline: 'top',
			getPixelOffset: [0, Math.round(4 * scale)],
			getColor: (d: HoodReading) => [255, 255, 255, a(d.opacity)],
			getBackgroundColor: (d: HoodReading) => [0, 0, 0, a(d.opacity)],
			backgroundPadding: [12, 8, 12, 6]
		})
	];
}
