// Owns the 2D context and the visual character: the exponential decay-fade that
// makes trails accumulate into a painterly wash, additive bloom so overlaps glow
// toward white, and the brush-stroke draw. The crisp↔painterly balance is the
// fade-alpha ↔ stroke-alpha pair — both URL-tunable in the component.

import { co2Ramp, type RGB, WALL_BG } from '$lib/viz/palette';

export type RenderParams = {
	fadeAlpha: number; // background rect alpha/frame → exponential trail decay
	strokeWidth: number;
	strokeAlpha: number;
	bloom: boolean;
};

export const DEFAULT_RENDER_PARAMS: RenderParams = {
	fadeAlpha: 0.03,
	strokeWidth: 1.2,
	strokeAlpha: 0.1,
	bloom: true
};

const COOL: RGB = [60, 206, 210]; // the colour warm strokes cool toward (mirrors layers.ts)

function hexToRgb(hex: string): RGB {
	const h = hex.replace('#', '');
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export class FlowRenderer {
	params: RenderParams;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private cssW = 0;
	private cssH = 0;
	private bgRgb: RGB;
	private transition = 0;
	private strCache = new Map<number, string>();

	constructor(canvas: HTMLCanvasElement, params: RenderParams = DEFAULT_RENDER_PARAMS) {
		this.params = params;
		const ctx = canvas.getContext('2d', { alpha: false });
		if (!ctx) throw new Error('2d context unavailable');
		this.canvas = canvas;
		this.ctx = ctx;
		this.bgRgb = hexToRgb(WALL_BG);
	}

	resize(cssW: number, cssH: number, dpr: number): void {
		this.cssW = cssW;
		this.cssH = cssH;
		this.canvas.width = Math.round(cssW * dpr);
		this.canvas.height = Math.round(cssH * dpr);
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// prime to background so the first frames aren't transparent-black
		this.ctx.globalCompositeOperation = 'source-over';
		this.ctx.globalAlpha = 1;
		this.ctx.fillStyle = WALL_BG;
		this.ctx.fillRect(0, 0, cssW, cssH);
	}

	setTransition(t: number): void {
		this.transition = t;
	}

	// Exponential decay: paint a translucent bg over everything. Old paint decays by
	// (1 - fadeAlpha)/frame; hot, re-painted corridors persist and bloom.
	fade(): void {
		const c = this.ctx;
		c.globalCompositeOperation = 'source-over';
		c.globalAlpha = 1;
		const [r, g, b] = this.bgRgb;
		c.fillStyle = `rgba(${r},${g},${b},${this.params.fadeAlpha})`;
		c.fillRect(0, 0, this.cssW, this.cssH);
	}

	// Main flow lines: opaque so they read as crisp emission-coloured corridors rather
	// than blooming to white under additive accumulation.
	beginLines(): void {
		const c = this.ctx;
		c.globalCompositeOperation = 'source-over';
		c.lineCap = 'round';
		c.lineJoin = 'round';
	}

	// Emission puffs: additive so overlapping wisps glow.
	beginStrokes(): void {
		const c = this.ctx;
		c.globalCompositeOperation = this.params.bloom ? 'lighter' : 'source-over';
		c.lineCap = 'round';
		c.lineJoin = 'round';
	}

	private rgbString(r: number, g: number, b: number): string {
		const key = (r << 16) | (g << 8) | b;
		let s = this.strCache.get(key);
		if (!s) {
			s = `rgb(${r},${g},${b})`;
			this.strCache.set(key, s);
		}
		return s;
	}

	// A single square dot in the receipt's pixelated language (used for the stepped,
	// animated route lines). Drawn in the source-over line phase so dots stay crisp.
	dot(x: number, y: number, rgb: RGB, alpha: number, size: number): void {
		const c = this.ctx;
		c.globalAlpha = alpha;
		c.fillStyle = this.rgbString(rgb[0] | 0, rgb[1] | 0, rgb[2] | 0);
		const h = size / 2;
		c.fillRect(Math.round(x - h), Math.round(y - h), Math.round(size), Math.round(size));
	}

	stroke(x0: number, y0: number, x1: number, y1: number, rgb: RGB, alpha: number, width: number): void {
		const c = this.ctx;
		c.globalAlpha = alpha;
		c.strokeStyle = this.rgbString(rgb[0] | 0, rgb[1] | 0, rgb[2] | 0);
		c.lineWidth = width;
		c.beginPath();
		c.moveTo(x0, y0);
		c.lineTo(x1, y1);
		c.stroke();
	}

	endStrokes(): void {
		const c = this.ctx;
		c.globalCompositeOperation = 'source-over';
		c.globalAlpha = 1;
	}

	// Hue from the dirtiness/intensity, warm pulled toward COOL as the counterfactual
	// engages. `max` (not average) of the two drivers keeps additive mixing clean.
	hueColor(hueT: number, intensity: number, out: RGB): RGB {
		const base = co2Ramp(Math.max(hueT, intensity * 0.85));
		const tr = this.transition;
		if (tr < 0.001) {
			out[0] = base[0];
			out[1] = base[1];
			out[2] = base[2];
			return out;
		}
		const warmth = Math.max(0, Math.min(1, (base[0] - base[2]) / 255)); // only warm hues cool
		const k = tr * warmth;
		out[0] = base[0] + (COOL[0] - base[0]) * k;
		out[1] = base[1] + (COOL[1] - base[1]) * k;
		out[2] = base[2] + (COOL[2] - base[2]) * k;
		return out;
	}
}
