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
		dither?: number;
		ditherType?: number;
		ditherPx?: number;
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
		steps: opts.steps ?? 0, // posterize the heat into N discrete bands (0/<2 = continuous ramp)
		dither: opts.dither ?? 0, // ordered-dither stipple amount (0 = smooth; 1 = full 1-bit)
		ditherType: opts.ditherType ?? 4, // Bayer matrix size: 2 | 4 | 8
		ditherPx: opts.ditherPx ?? 3 // dither grid cell size in device pixels
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

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const M_PER_DEG = 111320;

// Sample the route into an ordered run of grid-snapped square cells — the same dot/cell language as
// the heat field and the receipt's mapscii route, instead of a smooth vector line. Each road point
// is snapped to a fixed metric grid (`blockM`) and we keep one cell per occupied square, in path
// order (origin → destination), so the run can be revealed cell-by-cell as the route draws.
function routeBlocks(route: [number, number][], blockM: number) {
	const refLat = route[0][1];
	const kx = Math.cos((refLat * Math.PI) / 180) || 1; // lng→metric squash at this latitude
	const dLat = blockM / M_PER_DEG; // degrees lat per block
	const dLng = dLat / kx; // degrees lng per block → a square in metres
	const colOf = (lng: number) => Math.round(lng / dLng);
	const rowOf = (lat: number) => Math.round(lat / dLat);
	const cells: [number, number][] = []; // ordered cell centres
	const seen = new Set<number>();
	const add = (lng: number, lat: number) => {
		const c = colOf(lng);
		const r = rowOf(lat);
		const key = r * 100003 + c;
		if (seen.has(key)) return;
		seen.add(key);
		cells.push([c * dLng, r * dLat]);
	};
	const stepDeg = dLat / 2; // ≤½-cell steps → no skipped cells on a fast diagonal
	for (let i = 1; i < route.length; i++) {
		const [x0, y0] = route[i - 1];
		const [x1, y1] = route[i];
		const segDeg = Math.hypot((x1 - x0) * kx, y1 - y0);
		const n = Math.max(1, Math.ceil(segDeg / stepDeg));
		for (let k = 0; k <= n; k++) {
			const t = k / n;
			add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
		}
	}
	return { cells, dLat, dLng };
}

// The featured route drawn the receipt way (src/lib/receipt/viz/RouteMap): a blocky run of square
// cells (matching the heat field's blocky look) with a hollow-ring origin marker, a filled-disc
// destination marker, and the origin/destination names on white "paper" chips — all in the same
// 1-bit language as the printed slip. `opacity` fades the whole set with the highlight envelope;
// `progress` (0..1) reveals the blocks origin→destination in lockstep with the heat cells igniting;
// `scale` sizes the markers/labels for viewing distance; `bg` is the wall background (disc rim);
// `names` are the endpoint labels (omitted → no chip, e.g. demo routes).
export function buildRouteLayers(
	deck: Deck,
	route: [number, number][],
	opts: {
		opacity: number;
		bg: [number, number, number];
		beforeId?: string;
		scale?: number;
		progress?: number;
		blockM?: number;
		names?: { origin?: string; dest?: string };
	}
) {
	if (route.length < 2) return [];
	const s = opts.scale ?? 1;
	const op = clamp01(opts.opacity);
	const progress = clamp01(opts.progress ?? 1);
	const origin = route[0];
	const dest = route[route.length - 1];

	// Blocky route: reveal the leading `progress` fraction of the cell run, snapped to the grid.
	const { cells, dLat, dLng } = routeBlocks(route, opts.blockM ?? 150);
	const shown = progress >= 1 ? cells : cells.slice(0, Math.ceil(cells.length * progress));
	const cov = 0.82; // cell coverage (<1 leaves a hairline gap → reads as discrete blocks)
	const hx = (dLng * cov) / 2;
	const hy = (dLat * cov) / 2;
	const squares = shown.map(([lng, lat]) => [
		[lng - hx, lat - hy],
		[lng + hx, lat - hy],
		[lng + hx, lat + hy],
		[lng - hx, lat + hy]
	]);
	const destReveal = clamp01((progress - 0.85) / 0.15); // disc + dest chip arrive with the line

	const common = { beforeId: opts.beforeId, parameters: { depthTest: false } };
	const marker = {
		...common,
		getPosition: (d: [number, number]) => d,
		radiusUnits: 'pixels' as const,
		getRadius: 0,
		lineWidthUnits: 'pixels' as const
	};

	// Name chips — white paper, black mono, like the receipt's endpoint chips. Each name is pushed OFF
	// THE END of the route (origin behind the start, destination beyond the end) along the
	// origin↔destination axis, so the chips never sit over the drawn blocks. The map holds bearing and
	// pitch at 0, so screen space is geo with the y-axis flipped (+lat = up); the text anchor grows the
	// label further outward. Per-chip alpha so the destination chip fades in as the line reaches it.
	const kxr = Math.cos((origin[1] * Math.PI) / 180) || 1; // lng→metric squash at this latitude
	let ax = (dest[0] - origin[0]) * kxr;
	let ay = -(dest[1] - origin[1]); // flip lat → screen-y (down)
	const al = Math.hypot(ax, ay) || 1;
	ax /= al;
	ay /= al;
	const anchorOf = (dx: number): 'start' | 'middle' | 'end' => (dx > 0.3 ? 'start' : dx < -0.3 ? 'end' : 'middle');
	const chips: { pos: [number, number]; text: string; anchor: 'start' | 'middle' | 'end'; off: [number, number]; a: number }[] = [];
	const trim = (t: string) => (t.length > 18 ? t.slice(0, 17) + '…' : t).toUpperCase();
	if (opts.names?.origin) {
		const d = 9 * s + 22; // clear the origin ring (and the chip's own height when stacked vertically)
		chips.push({ pos: origin, text: trim(opts.names.origin), anchor: anchorOf(-ax), off: [Math.round(-ax * d), Math.round(-ay * d)], a: op });
	}
	if (opts.names?.dest && destReveal > 0.001) {
		const d = 8 * s + 22; // clear the destination disc
		chips.push({ pos: dest, text: trim(opts.names.dest), anchor: anchorOf(ax), off: [Math.round(ax * d), Math.round(ay * d)], a: op * destReveal });
	}

	return [
		// Blocky route cells (drawn under the markers/labels).
		...(squares.length
			? [
					new deck.SolidPolygonLayer({
						...common,
						opacity: op,
						id: 'route-blocks',
						data: squares,
						getPolygon: (d: number[][]) => d,
						getFillColor: [255, 255, 255],
						filled: true
					})
				]
			: []),
		// Origin: hollow white ring, present for the whole overlay.
		new deck.ScatterplotLayer({
			...marker,
			opacity: op,
			id: 'route-origin',
			data: [origin],
			stroked: true,
			filled: false,
			getLineColor: [255, 255, 255],
			lineWidthMinPixels: 3 * s,
			radiusMinPixels: 9 * s,
			radiusMaxPixels: 9 * s
		}),
		// Destination: filled white disc with a thin bg rim — fades in as the blocks reach it.
		...(destReveal > 0.001
			? [
					new deck.ScatterplotLayer({
						...marker,
						opacity: op * destReveal,
						id: 'route-dest',
						data: [dest],
						stroked: true,
						filled: true,
						getFillColor: [255, 255, 255],
						getLineColor: opts.bg,
						lineWidthMinPixels: 2 * s,
						radiusMinPixels: 8 * s,
						radiusMaxPixels: 8 * s
					})
				]
			: []),
		// Endpoint name chips.
		...(chips.length
			? [
					new deck.TextLayer({
						...common,
						id: 'route-names',
						data: chips,
						getPosition: (d: (typeof chips)[number]) => d.pos,
						getText: (d: (typeof chips)[number]) => d.text,
						getSize: 24 * s, // same as the neighbourhood name labels (buildHoodLabels)
						sizeUnits: 'pixels' as const,
						fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace',
						fontWeight: 700,
						fontSettings: { sdf: true },
						characterSet: 'auto' as const,
						getTextAnchor: (d: (typeof chips)[number]) => d.anchor,
						getAlignmentBaseline: 'center' as const,
						getPixelOffset: (d: (typeof chips)[number]) => d.off,
						background: true,
						getColor: (d: (typeof chips)[number]) => [0, 0, 0, Math.round(255 * d.a)],
						getBackgroundColor: (d: (typeof chips)[number]) => [255, 255, 255, Math.round(255 * d.a)],
						backgroundPadding: [10, 6, 10, 5],
						updateTriggers: { getText: chips.map((c) => c.text).join('|') }
					})
				]
			: [])
	];
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
	fade: number = tick,
	mul = 1, // global opacity factor — fades all labels out while a route is featured
	deltaMul = 1 // zoom gate for the delta caption only: 0 at the wide resting frame, 1 zoomed in
) {
	// Years of life lost, one decimal (months / 12 → years), with a leading minus so it reads as a
	// deficit — "-1.5yr". "yr" cue keeps the bare number decodable from across the room.
	const fmt = (m: number) => `-${(m / 12).toFixed(1)}yr`;
	// Commute-attributable delta vs the ACAG satellite baseline, same unit (years) as the hero, with a
	// leading ▲+ so it reads as burden the logged commutes ADDED on top of the ambient air. Shown only
	// where it rounds to ≥0.1yr ("for those that have it") — below that we render nothing for the label.
	const DELTA_MIN_YR = 0.05; // 0.05yr → "+0.1yr"; under this the label carries no delta line
	const deltaYr = (d: HoodReading) => (d.delta ?? 0) / 12;
	const fmtDelta = (d: HoodReading) =>
		deltaYr(d) >= DELTA_MIN_YR ? `▲ +${deltaYr(d).toFixed(1)}yr` : '';
	const font = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
	const a = (op?: number) => Math.round(255 * (op ?? 1)); // per-label fade → alpha
	const deltaAlpha = (d: HoodReading) =>
		deltaYr(d) >= DELTA_MIN_YR ? a((d.opacity ?? 1) * mul * deltaMul) : 0;
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
			getColor: (d: HoodReading) => [0, 0, 0, a(d.opacity * mul)],
			getBackgroundColor: (d: HoodReading) => [255, 255, 255, a(d.opacity * mul)],
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
			getColor: (d: HoodReading) => [255, 255, 255, a(d.opacity * mul)],
			getBackgroundColor: (d: HoodReading) => [0, 0, 0, a(d.opacity * mul)],
			backgroundPadding: [12, 8, 12, 6]
		}),
		// Commute-attributable delta — a smaller reverse caption tucked under the years hero. A zoom-in
		// detail: `deltaMul` is 0 at the wide resting frame so nothing shows, and fades it in only as the
		// camera moves in on a sub-region (annotating just the labels in that closer view). Even then it's
		// present only on hoods whose logged-commute share rounds to ≥0.1yr. Empty text + zero alpha
		// elsewhere keeps the data array the stable `named` reference (no per-frame re-layout); the `tick`
		// trigger re-reads as a hood crosses the threshold, `fade`/`deltaMul` as its opacity eases.
		new deck.TextLayer({
			...common,
			id: 'hood-delta',
			data: named,
			getText: fmtDelta,
			getSize: 26 * scale,
			getAlignmentBaseline: 'top',
			getPixelOffset: [0, Math.round(62 * scale)],
			getColor: (d: HoodReading) => [255, 255, 255, deltaAlpha(d)],
			getBackgroundColor: (d: HoodReading) => [0, 0, 0, deltaAlpha(d)],
			backgroundPadding: [10, 5, 10, 5],
			updateTriggers: {
				getText: tick,
				getColor: `${fade}|${tick}|${Math.round(deltaMul * 255)}`,
				getBackgroundColor: `${fade}|${tick}|${Math.round(deltaMul * 255)}`
			}
		})
	];
}
