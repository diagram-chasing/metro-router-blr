// The breathing emissions cloud. Takes the server's normalised CO₂ grid
// (/api/emissions) and paints it through the warm-dirty ramp into a small canvas
// that a deck BitmapLayer bilinearly upscales into a soft, glowing field.
//
// Two cross-fades live here, kept separate:
//   • growth  — a slow lerp between successive poll snapshots, so the cloud grows
//               and breathes rather than snapping as new commutes land.
//   • scenario — raw ↔ counterfactual, driven live by the toggle's eased
//               `transition` (0 = actual, 1 = "half shifted to transit").

import { co2Ramp, easeInOutCubic } from './palette';

export type Field = {
	nLat: number;
	nLon: number;
	bbox: [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
	values: number[];
	rawMax: number;
	hasBase: boolean;
};

const GROW_S = 1.6; // growth cross-fade duration
const GAMMA = 0.6; // colour gamma — lifts midtones so faint corridors read
const ALPHA_GAMMA = 0.85; // alpha gamma — low values stay transparent

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class EmissionsField {
	bounds: [number, number, number, number] = [0, 0, 0, 0];
	private nLat = 0;
	private nLon = 0;
	private rawPrev: number[] = [];
	private rawTarget: number[] = [];
	private cfPrev: number[] = [];
	private cfTarget: number[] = [];
	private growthStart = -1e9;
	private has = false;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null;

	constructor() {
		this.canvas = document.createElement('canvas');
		this.ctx = this.canvas.getContext('2d');
	}

	get ready(): boolean {
		return this.has;
	}

	// Latest server snapshot. `cf` may equal `raw` until the counterfactual grid
	// exists; the scenario lerp then collapses to a no-op.
	setSnapshot(raw: Field, cf: Field, now: number): void {
		if (!this.has) {
			this.rawPrev = raw.values;
			this.cfPrev = cf.values;
		} else {
			this.rawPrev = this.rawTarget;
			this.cfPrev = this.cfTarget;
		}
		this.rawTarget = raw.values;
		this.cfTarget = cf.values;
		this.nLat = raw.nLat;
		this.nLon = raw.nLon;
		this.bounds = raw.bbox;
		this.canvas.width = this.nLon;
		this.canvas.height = this.nLat;
		this.growthStart = now;
		this.has = true;
	}

	// Paint the current frame. `transition` 0→1 mixes raw→counterfactual.
	image(now: number, transition: number): HTMLCanvasElement | null {
		if (!this.has || !this.ctx) return null;
		const { nLat, nLon } = this;
		const g = easeInOutCubic(clamp01((now - this.growthStart) / GROW_S));
		const tr = clamp01(transition);
		const img = this.ctx.createImageData(nLon, nLat);

		for (let i = 0; i < nLat; i++) {
			for (let j = 0; j < nLon; j++) {
				const idx = i * nLon + j;
				const rv = lerp(this.rawPrev[idx] ?? 0, this.rawTarget[idx] ?? 0, g);
				const cv = lerp(this.cfPrev[idx] ?? 0, this.cfTarget[idx] ?? 0, g);
				const v = clamp01(lerp(rv, cv, tr));
				const [r, gg, b] = co2Ramp(Math.pow(v, GAMMA));
				const a = Math.round(Math.pow(v, ALPHA_GAMMA) * 255);
				// Flip vertically so north (max latitude) is at the top.
				const px = ((nLat - 1 - i) * nLon + j) * 4;
				img.data[px] = r;
				img.data[px + 1] = gg;
				img.data[px + 2] = b;
				img.data[px + 3] = a;
			}
		}
		this.ctx.putImageData(img, 0, 0);
		return this.canvas;
	}
}
