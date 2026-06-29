// mapscii-in-1-bit: rasterize map geometry onto a dot grid and stamp the cells as square
// dots on a canvas. Same idea as mapscii's BrailleBuffer/Canvas (Bresenham strokes, scanline
// fills over a sub-cell grid) but we emit dots instead of braille glyphs, so it survives the
// receipt's monochrome luminance-threshold raster (and dodges thermal glyph quirks).

export type Place = { name: string; c: [number, number]; rank: number; kind: string };

export type Basemap = {
	z: number;
	bbox: [number, number, number, number];
	roads: number[][][];
	water: number[][][];
	places: Place[];
};

type Pt = [number, number];

// Built once by scripts/buildMapAssets.ts (the `receipt` target) and committed; fetched
// same-origin so it works offline. Null on failure → the map degrades to route-only.
let cache: Promise<Basemap | null> | null = null;
export function loadBasemap(): Promise<Basemap | null> {
	if (!cache) {
		cache = fetch('/receipt-basemap.json')
			.then((r) => (r.ok ? (r.json() as Promise<Basemap>) : null))
			.catch(() => null);
	}
	return cache;
}

type StrokeOpts = {
	spacing?: number; // px between dots along the line (≈pitch → near-solid; larger → sparse)
	weight?: 0 | 1 | 2; // extra neighbour cells per dot for a bolder line
	dashOn?: number; // px of "on" run before a gap
	dashOff?: number; // px gap; 0 → continuous
};

export class DotGrid {
	readonly cols: number;
	readonly rows: number;
	private on = new Set<number>();

	constructor(
		readonly width: number,
		readonly height: number,
		readonly pitch: number
	) {
		this.cols = Math.ceil(width / pitch);
		this.rows = Math.ceil(height / pitch);
	}

	private mark(c: number, r: number) {
		if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
		this.on.add(r * this.cols + c);
	}

	private cellOf(x: number, y: number): Pt {
		return [Math.round((x - this.pitch / 2) / this.pitch), Math.round((y - this.pitch / 2) / this.pitch)];
	}

	private stamp(x: number, y: number, weight: number) {
		const [c, r] = this.cellOf(x, y);
		this.mark(c, r);
		if (weight >= 1) {
			this.mark(c + 1, r);
			this.mark(c, r + 1);
			this.mark(c + 1, r + 1);
		}
		if (weight >= 2) {
			this.mark(c - 1, r);
			this.mark(c, r - 1);
			this.mark(c - 1, r - 1);
		}
	}

	// Dotted polyline by arc-length: place a dot every `spacing` px, gated by an optional dash.
	stroke(pts: Pt[], opts: StrokeOpts = {}) {
		const spacing = opts.spacing ?? this.pitch;
		const weight = opts.weight ?? 0;
		const dashOff = opts.dashOff ?? 0;
		const period = (opts.dashOn ?? Infinity) + dashOff;
		const gated = (d: number) => dashOff <= 0 || d % period < (opts.dashOn ?? Infinity);

		let acc = 0; // distance into the current segment where the next dot falls
		let total = 0; // global arc length, for the dash phase
		for (let i = 1; i < pts.length; i++) {
			const [x0, y0] = pts[i - 1];
			const [x1, y1] = pts[i];
			const len = Math.hypot(x1 - x0, y1 - y0);
			if (len === 0) continue;
			const ux = (x1 - x0) / len;
			const uy = (y1 - y0) / len;
			for (let s = acc; s <= len; s += spacing) {
				if (gated(total + s)) this.stamp(x0 + ux * s, y0 + uy * s, weight);
			}
			acc = Math.max(0, acc + Math.ceil((len - acc) / spacing) * spacing - len);
			total += len;
		}
	}

	// Faint dotted area: even-odd scanline fill, but only every `modulo`-th cell.
	fillStipple(rings: Pt[][], modulo = 2) {
		for (let r = 0; r < this.rows; r++) {
			const y = r * this.pitch + this.pitch / 2;
			const xs: number[] = [];
			for (const ring of rings) {
				for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
					const [, yi] = ring[i];
					const [, yj] = ring[j];
					if (yi > y !== yj > y) {
						const [xi] = ring[i];
						const [xj] = ring[j];
						xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
					}
				}
			}
			xs.sort((a, b) => a - b);
			for (let k = 0; k + 1 < xs.length; k += 2) {
				const c0 = Math.ceil((xs[k] - this.pitch / 2) / this.pitch);
				const c1 = Math.floor((xs[k + 1] - this.pitch / 2) / this.pitch);
				for (let c = c0; c <= c1; c++) if ((c + r) % modulo === 0) this.mark(c, r);
			}
		}
	}

	// Square dots print more cleanly than tiny circles at 1-bit; radius is half the side.
	flush(ctx: CanvasRenderingContext2D, radius = 1, color = '#000') {
		ctx.fillStyle = color;
		const side = radius * 2;
		for (const idx of this.on) {
			const c = idx % this.cols;
			const r = (idx - c) / this.cols;
			const x = c * this.pitch + this.pitch / 2;
			const y = r * this.pitch + this.pitch / 2;
			ctx.fillRect(Math.round(x - radius), Math.round(y - radius), side, side);
		}
	}
}
