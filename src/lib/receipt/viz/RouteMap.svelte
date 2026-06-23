<script lang="ts">
	// A mapscii-style mini-map: the drawn route over a faint 1-bit braille dot-field of the
	// surrounding roads + water (baked offline in static/receipt-basemap.json). The bbox is
	// grown to the canvas aspect so the basemap fills edge-to-edge, then everything is
	// rasterized to dots on a canvas — captured by ReceiptDoc and thresholded to monochrome
	// at print time. Origin/destination names sit by their markers on white chips; a few
	// large-area neighbourhood names label the surrounding context. All labels are upright.
	import { onMount } from 'svelte';
	import { geoMercator } from 'd3-geo';
	import { loadBasemap, DotGrid, type Basemap, type Place } from './braille';

	type Leg = { coords: [number, number][]; gPerKm?: number };
	let {
		segments,
		origin,
		dest,
		width = 576,
		height = 220
	}: {
		segments: Leg[];
		origin?: string;
		dest?: string;
		width?: number;
		height?: number;
	} = $props();

	const PAD = 8; // inner viewport margin (keeps endpoints off the edge)
	const PITCH = 3; // dot grid pitch in px — the braille texture
	const PAD_FACTOR = 1.6; // grow the route bbox so surrounding basemap is visible
	const MIN_HALF = 0.012; // min half-span in degrees (~1.3km) so tiny routes keep context
	const MAX_NBHD = 5; // how many neighbourhood labels to attempt
	const NBHD_FONT = '700 11px ui-sans-serif, system-ui, sans-serif';
	const END_FONT = '700 13px ui-sans-serif, system-ui, sans-serif';
	const PLACE_ORDER: Record<string, number> = { city: 0, town: 1, suburb: 2, neighbourhood: 3, quarter: 4 };

	let canvas = $state<HTMLCanvasElement | null>(null);
	let basemap = $state<Basemap | null>(null);

	const legs = $derived(segments.filter((s) => s.coords && s.coords.length >= 2));

	onMount(() => {
		loadBasemap().then((b) => (basemap = b));
	});

	type Proj = (c: [number, number]) => [number, number] | null;
	type Rect = { x: number; y: number; w: number; h: number };
	type BBox = [number, number, number, number];

	function buildProjection(ls: Leg[]) {
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const l of ls)
			for (const [x, y] of l.coords) {
				minX = Math.min(minX, x);
				minY = Math.min(minY, y);
				maxX = Math.max(maxX, x);
				maxY = Math.max(maxY, y);
			}
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		let hx = Math.max(((maxX - minX) / 2) * PAD_FACTOR, MIN_HALF);
		let hy = Math.max(((maxY - minY) / 2) * PAD_FACTOR, MIN_HALF);
		// Grow the shorter axis so the bbox's projected aspect matches the canvas — fills
		// the map edge-to-edge instead of letterboxing the basemap with white bands.
		const target = (width - 2 * PAD) / (height - 2 * PAD);
		const coslat = Math.cos((cy * Math.PI) / 180);
		const aspect = (hx * coslat) / hy;
		if (aspect < target) hx = (target * hy) / coslat;
		else hy = (hx * coslat) / target;
		const bbox: BBox = [cx - hx, cy - hy, cx + hx, cy + hy];
		const frame = {
			type: 'Feature' as const,
			properties: {},
			geometry: {
				type: 'LineString' as const,
				coordinates: [
					[cx - hx, cy - hy],
					[cx + hx, cy - hy],
					[cx + hx, cy + hy],
					[cx - hx, cy + hy]
				]
			}
		};
		const proj = geoMercator().fitExtent(
			[
				[PAD, PAD],
				[width - PAD, height - PAD]
			],
			frame
		) as unknown as Proj;
		return { proj, bbox };
	}

	// Project only the lines whose bbox overlaps the (padded) view bbox.
	function projectLines(lines: number[][][], proj: Proj, bbox: BBox) {
		const [bx0, by0, bx1, by1] = bbox;
		const out: [number, number][][] = [];
		for (const line of lines) {
			let lx0 = Infinity,
				ly0 = Infinity,
				lx1 = -Infinity,
				ly1 = -Infinity;
			for (const [x, y] of line) {
				lx0 = Math.min(lx0, x);
				ly0 = Math.min(ly0, y);
				lx1 = Math.max(lx1, x);
				ly1 = Math.max(ly1, y);
			}
			if (lx1 < bx0 || lx0 > bx1 || ly1 < by0 || ly0 > by1) continue;
			const pts = line
				.map((c) => proj(c as [number, number]))
				.filter((p): p is [number, number] => !!p);
			if (pts.length >= 2) out.push(pts);
		}
		return out;
	}

	// ── labels ──
	const overlaps = (a: Rect, b: Rect) =>
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
	const inBounds = (r: Rect) => r.x >= 2 && r.y >= 2 && r.x + r.w <= width - 2 && r.y + r.h <= height - 2;

	// Name on a white chip, placed by a marker; tries 4 corners, then clamps in-bounds.
	function drawChip(ctx: CanvasRenderingContext2D, text: string, ax: number, ay: number, placed: Rect[]) {
		ctx.font = END_FONT;
		const padX = 4,
			padY = 2,
			off = 9,
			th = 13;
		const w = ctx.measureText(text).width + padX * 2;
		const h = th + padY * 2;
		const cands: [number, number][] = [
			[ax + off, ay - h - off / 2],
			[ax - w - off, ay - h - off / 2],
			[ax + off, ay + off / 2],
			[ax - w - off, ay + off / 2]
		];
		let pick = cands.find((c) => inBounds({ x: c[0], y: c[1], w, h }) && !placed.some((p) => overlaps({ x: c[0], y: c[1], w, h }, p)));
		if (!pick)
			pick = [
				Math.min(Math.max(ax + off, 2), width - 2 - w),
				Math.min(Math.max(ay - h - off / 2, 2), height - 2 - h)
			];
		const r: Rect = { x: pick[0], y: pick[1], w, h };
		ctx.fillStyle = '#fff';
		ctx.fillRect(r.x, r.y, r.w, r.h);
		ctx.strokeStyle = '#000';
		ctx.lineWidth = 1;
		ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
		ctx.fillStyle = '#000';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillText(text, r.x + padX, r.y + padY);
		placed.push(r);
	}

	// Map-style label: white outline halo so the black text reads over the dot field.
	function drawOutlineLabel(ctx: CanvasRenderingContext2D, text: string, cxp: number, cyp: number, placed: Rect[]): boolean {
		ctx.font = NBHD_FONT;
		const tw = ctx.measureText(text).width;
		const th = 11;
		const x = cxp - tw / 2;
		const y = cyp - th / 2;
		const r: Rect = { x: x - 2, y: y - 1, w: tw + 4, h: th + 2 };
		if (!inBounds(r) || placed.some((p) => overlaps(r, p))) return false;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.lineJoin = 'round';
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 3;
		ctx.strokeText(text, x, y);
		ctx.fillStyle = '#000';
		ctx.fillText(text, x, y);
		placed.push(r);
		return true;
	}

	function drawNeighbourhoods(ctx: CanvasRenderingContext2D, places: Place[], proj: Proj, bbox: BBox, placed: Rect[]) {
		const [bx0, by0, bx1, by1] = bbox;
		const within = places
			.filter((p) => p.c[0] > bx0 && p.c[0] < bx1 && p.c[1] > by0 && p.c[1] < by1)
			.sort((a, b) => (PLACE_ORDER[a.kind] ?? 9) - (PLACE_ORDER[b.kind] ?? 9) || a.rank - b.rank);
		let n = 0;
		for (const p of within) {
			if (n >= MAX_NBHD) break;
			const xy = proj(p.c);
			if (xy && drawOutlineLabel(ctx, p.name.toUpperCase(), xy[0], xy[1], placed)) n++;
		}
	}

	function endpoints(ls: Leg[], proj: Proj) {
		const first = ls[0].coords[0];
		const lastLeg = ls[ls.length - 1].coords;
		const last = lastLeg[lastLeg.length - 1];
		return { a: proj(first), b: proj(last) };
	}

	function draw() {
		if (!canvas) return;
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.fillStyle = '#fff';
		ctx.fillRect(0, 0, width, height);
		if (!legs.length) return;

		const { proj, bbox } = buildProjection(legs);

		if (basemap) {
			const base = new DotGrid(width, height, PITCH);
			base.fillStipple(projectLines(basemap.water, proj, bbox), 4); // faint water area
			for (const pts of projectLines(basemap.roads, proj, bbox))
				base.stroke(pts, { spacing: PITCH * 2 }); // sparse dotted roads
			base.flush(ctx, 1);
		}

		const route = new DotGrid(width, height, PITCH);
		for (const leg of legs) {
			const pts = leg.coords.map((c) => proj(c)).filter((p): p is [number, number] => !!p);
			if (pts.length < 2) continue;
			route.stroke(pts, { spacing: PITCH, weight: 1 }); // one uniform bold dotted line
		}
		route.flush(ctx, 1.5);

		// markers
		const { a, b } = endpoints(legs, proj);
		const placed: Rect[] = [];
		const marker = (p: [number, number], fill: boolean) => {
			ctx.fillStyle = '#fff';
			ctx.beginPath();
			ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = '#000';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(p[0], p[1], 4.5, 0, Math.PI * 2);
			if (fill) {
				ctx.fillStyle = '#000';
				ctx.fill();
			} else ctx.stroke();
			placed.push({ x: p[0] - 8, y: p[1] - 8, w: 16, h: 16 });
		};
		if (a) marker(a, false); // origin: hollow ring
		if (b) marker(b, true); // destination: filled disc

		// endpoint name chips (drawn first so neighbourhood labels yield to them)
		const trim = (s: string) => (s.length > 18 ? s.slice(0, 17) + '…' : s);
		if (a && origin) drawChip(ctx, trim(origin), a[0], a[1], placed);
		if (b && dest) drawChip(ctx, trim(dest), b[0], b[1], placed);

		if (basemap) drawNeighbourhoods(ctx, basemap.places, proj, bbox, placed);
	}

	$effect(() => {
		// re-runs when inputs change
		void [legs, basemap, origin, dest, width, height];
		draw();
	});
</script>

<canvas
	bind:this={canvas}
	{width}
	{height}
	class="block h-auto w-full"
	aria-label="your route"
></canvas>
