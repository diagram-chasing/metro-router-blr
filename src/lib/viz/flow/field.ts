// The pollution field. Two things live here:
//   • the emissions accumulation grid (the same /api/emissions raster the city builds
//     up over time) — lerped between snapshots, sampled per-pixel as intensityAt(); it
//     governs WHERE the pollution clouds form and how they're coloured.
//   • a gentle divergence-free curl-noise drift — sampled as a unit direction that makes
//     the clouds meander and diffuse around the corridors rather than sit still.
// No gravity, no upward lift: the clouds pool where emissions accumulate, on and around
// the lines, and drift organically.

import { easeInOutCubic } from '$lib/viz/palette';
import { makeNoise } from './noise';
import type { Projector } from './projection';
import type { Field } from '$lib/viz/emissionsField';

export type Vec2 = [number, number];

export type FieldParams = {
	noiseScale: number; // per-pixel noise frequency
	noiseStrength: number; // drift swirl magnitude
	drift: number; // slow translation of the noise field over time
};

export const DEFAULT_FIELD_PARAMS: FieldParams = {
	noiseScale: 0.0035,
	noiseStrength: 1,
	drift: 0.025
};

const GROW_S = 1.6; // snapshot cross-fade (mirrors EmissionsField)
const HEADROOM = 1.5;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class FlowFieldModel {
	params: FieldParams;
	private noise: ReturnType<typeof makeNoise>;
	private proj: Projector | null = null;

	private nLat = 0;
	private nLon = 0;
	private bbox: [number, number, number, number] = [0, 0, 0, 0];
	private rawPrev: number[] = [];
	private rawTarget: number[] = [];
	private cfPrev: number[] = [];
	private cfTarget: number[] = [];
	private peakRef = 0;
	private growthStart = -1e9;
	private has = false;

	private nowS = 0;
	private tr = 0;
	private driftX = 0;
	private cur: Float32Array = new Float32Array(0);

	// pixel→grid affine inverse (mercator ≈ linear over a city bbox)
	private p0: Vec2 = [0, 0];
	private inv = [0, 0, 0, 0];

	constructor(params: FieldParams = DEFAULT_FIELD_PARAMS, seed = 9173) {
		this.params = params;
		this.noise = makeNoise(seed);
	}

	get ready(): boolean {
		return this.has;
	}

	setProjector(p: Projector): void {
		this.proj = p;
		this.rebuildProjectionCache();
	}

	private rebuildProjectionCache(): void {
		if (!this.proj || !this.has) return;
		const [x0, y0, x1, y1] = this.bbox;
		const P00 = this.proj.project(x0, y0);
		const P10 = this.proj.project(x1, y0);
		const P01 = this.proj.project(x0, y1);
		this.p0 = P00;
		const ex: Vec2 = [P10[0] - P00[0], P10[1] - P00[1]];
		const ey: Vec2 = [P01[0] - P00[0], P01[1] - P00[1]];
		const det = ex[0] * ey[1] - ey[0] * ex[1] || 1;
		this.inv = [ey[1] / det, -ey[0] / det, -ex[1] / det, ex[0] / det];
	}

	private gridUV(x: number, y: number): Vec2 {
		const dx = x - this.p0[0];
		const dy = y - this.p0[1];
		const u = this.inv[0] * dx + this.inv[1] * dy;
		const v = this.inv[2] * dx + this.inv[3] * dy;
		return [u * (this.nLon - 1), v * (this.nLat - 1)];
	}

	setEmissions(raw: Field, cf: Field, now: number): void {
		const rawAbs = raw.values.map((v) => v * raw.rawMax);
		const cfAbs = cf.values.map((v) => v * cf.rawMax);
		if (!this.has) {
			this.rawPrev = rawAbs;
			this.cfPrev = cfAbs;
		} else {
			this.rawPrev = this.rawTarget;
			this.cfPrev = this.cfTarget;
		}
		this.rawTarget = rawAbs;
		this.cfTarget = cfAbs;
		this.nLat = raw.nLat;
		this.nLon = raw.nLon;
		this.bbox = raw.bbox;
		const want = raw.rawMax * HEADROOM;
		this.peakRef = this.peakRef === 0 || raw.rawMax > this.peakRef ? want : this.peakRef;
		this.growthStart = now;
		this.has = true;
		if (this.cur.length !== rawAbs.length) this.cur = new Float32Array(rawAbs.length);
		this.rebuildProjectionCache();
	}

	// recompute the lerped, normalised grid once per frame; clouds + colours read it
	setFrame(now: number, transition: number): void {
		this.nowS = now;
		this.tr = clamp01(transition);
		this.driftX = this.params.drift * now;
		if (!this.has) return;
		const g = easeInOutCubic(clamp01((now - this.growthStart) / GROW_S));
		const peak = this.peakRef || 1;
		for (let k = 0; k < this.cur.length; k++) {
			const ra = lerp(this.rawPrev[k] ?? 0, this.rawTarget[k] ?? 0, g);
			const ca = lerp(this.cfPrev[k] ?? 0, this.cfTarget[k] ?? 0, g);
			this.cur[k] = clamp01(lerp(ra, ca, this.tr) / peak);
		}
	}

	// emissions accumulation at a pixel, 0..1 (bilinear). Drives cloud spawn + colour.
	intensityAt(x: number, y: number): number {
		if (!this.has) return 0;
		const [fj, fi] = this.gridUV(x, y);
		if (fj < 0 || fi < 0 || fj > this.nLon - 1 || fi > this.nLat - 1) return 0;
		const j0 = Math.floor(fj);
		const i0 = Math.floor(fi);
		const j1 = Math.min(j0 + 1, this.nLon - 1);
		const i1 = Math.min(i0 + 1, this.nLat - 1);
		const tj = fj - j0;
		const ti = fi - i0;
		const c = this.cur;
		const w = this.nLon;
		const a = c[i0 * w + j0];
		const b = c[i0 * w + j1];
		const d = c[i1 * w + j0];
		const e = c[i1 * w + j1];
		return lerp(lerp(a, b, tj), lerp(d, e, tj), ti);
	}

	// gentle unit drift direction (curl of fbm) — clouds meander, never pile or rise.
	sample(x: number, y: number, out: Vec2): void {
		const p = this.params;
		const k = p.noiseScale;
		const d = this.driftX;
		const { fbm2 } = this.noise;
		const e = 0.75;
		const nx = fbm2((x + e) * k + d, y * k) - fbm2((x - e) * k + d, y * k);
		const ny = fbm2(x * k + d, (y + e) * k) - fbm2(x * k + d, (y - e) * k);
		const vx = ny * p.noiseStrength;
		const vy = -nx * p.noiseStrength;
		const len = Math.hypot(vx, vy);
		if (len > 1e-4) {
			out[0] = vx / len;
			out[1] = vy / len;
		} else {
			out[0] = 0;
			out[1] = 0;
		}
	}
}
