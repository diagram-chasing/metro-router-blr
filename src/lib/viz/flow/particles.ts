// The pollution cloud: a fixed pool of particles whose spawn is governed by the
// emissions accumulation field. Most are rejection-sampled across the map weighted by
// local CO₂ (so clouds pool where emissions built up — on and around the busy
// corridors); the rest are seeded right on the route lines. Each drifts through the
// gentle noise field leaving a soft additive wisp, then fades. Colour comes from the
// accumulated intensity where it lives. Struct-of-arrays → allocation-free.

import type { FlowFieldModel, Vec2 } from './field';

// A route line particles can also be seeded along (so corridors stay smoky even before
// the grid resolves). `pts` are projected pixels.
export type Emitter = { pts: [number, number][]; weight: number };

export type ParticleParams = {
	count: number;
	speed: number; // px/s
	lifeMin: number;
	lifeMax: number;
	jitter: number; // perpendicular spray, px/s
	lineShare: number; // 0..1 fraction seeded on lines vs field-weighted
};

export const DEFAULT_PARTICLE_PARAMS: ParticleParams = {
	count: 3200,
	speed: 24,
	lifeMin: 1.6,
	lifeMax: 4.5,
	jitter: 9,
	lineShare: 0.3
};

const hueOf = (intensity: number) => 0.35 + Math.max(0, Math.min(1, intensity)) * 0.6;

type EmitFn = (x0: number, y0: number, x1: number, y1: number, hueT: number, ageFrac: number) => void;

export class ParticleSystem {
	params: ParticleParams;
	count = 0;
	private px = new Float32Array(0);
	private py = new Float32Array(0);
	private age = new Float32Array(0);
	private life = new Float32Array(0);
	private hueT = new Float32Array(0);
	private seed = new Float32Array(0);

	private emitters: Emitter[] = [];
	private pick: number[] = [];
	private readonly _v: Vec2 = [0, 0];

	constructor(params: ParticleParams = DEFAULT_PARTICLE_PARAMS) {
		this.params = params;
		this.resize(params.count);
	}

	resize(count: number): void {
		this.count = Math.max(1, Math.floor(count));
		this.px = new Float32Array(this.count);
		this.py = new Float32Array(this.count);
		this.age = new Float32Array(this.count);
		this.life = new Float32Array(this.count);
		this.hueT = new Float32Array(this.count);
		this.seed = new Float32Array(this.count);
		for (let i = 0; i < this.count; i++) {
			this.life[i] = this.randLife();
			this.age[i] = Math.random() * this.life[i];
			this.seed[i] = Math.random() * 1000;
			this.px[i] = -100;
			this.py[i] = -100;
		}
	}

	setEmitters(emitters: Emitter[]): void {
		this.emitters = emitters.filter((e) => e.pts.length >= 2);
		const pool: number[] = [];
		this.emitters.forEach((e, i) => {
			const reps = Math.max(1, Math.min(6, Math.round(e.weight)));
			for (let r = 0; r < reps; r++) pool.push(i);
		});
		this.pick = pool;
	}

	private randLife(): number {
		return this.params.lifeMin + Math.random() * (this.params.lifeMax - this.params.lifeMin);
	}

	private hash(n: number): number {
		const x = Math.sin(n * 12.9898) * 43758.5453;
		return x - Math.floor(x);
	}

	private spawnOnLine(i: number, field: FlowFieldModel): boolean {
		if (!this.pick.length) return false;
		const e = this.emitters[this.pick[(Math.random() * this.pick.length) | 0]];
		const segs = e.pts.length - 1;
		const s = Math.min(segs - 1, (Math.random() * segs) | 0);
		const t = Math.random();
		const a = e.pts[s];
		const b = e.pts[s + 1];
		const x = a[0] + (b[0] - a[0]) * t + (Math.random() - 0.5) * 4;
		const y = a[1] + (b[1] - a[1]) * t + (Math.random() - 0.5) * 4;
		this.place(i, x, y, hueOf(field.ready ? field.intensityAt(x, y) : 0.5));
		return true;
	}

	private spawnInField(i: number, field: FlowFieldModel, w: number, h: number): boolean {
		if (!field.ready) return false;
		for (let tries = 0; tries < 14; tries++) {
			const x = Math.random() * w;
			const y = Math.random() * h;
			const it = field.intensityAt(x, y);
			if (Math.random() < it) {
				this.place(i, x, y, hueOf(it));
				return true;
			}
		}
		return false;
	}

	private place(i: number, x: number, y: number, hue: number): void {
		this.px[i] = x;
		this.py[i] = y;
		this.hueT[i] = hue;
		this.age[i] = 0;
		this.life[i] = this.randLife();
		this.seed[i] = Math.random() * 1000;
	}

	private respawn(i: number, field: FlowFieldModel, w: number, h: number): void {
		const onLine = Math.random() < this.params.lineShare;
		const ok = onLine
			? this.spawnOnLine(i, field) || this.spawnInField(i, field, w, h)
			: this.spawnInField(i, field, w, h) || this.spawnOnLine(i, field);
		if (!ok) {
			// nothing to seed from yet — park off-screen and retry next cycle
			this.px[i] = -100;
			this.py[i] = -100;
			this.age[i] = 0;
			this.life[i] = this.randLife();
		}
	}

	step(field: FlowFieldModel, dt: number, w: number, h: number, emit: EmitFn): void {
		const { speed, jitter } = this.params;
		const clampedDt = Math.min(dt, 0.05);
		for (let i = 0; i < this.count; i++) {
			const x0 = this.px[i];
			const y0 = this.py[i];
			field.sample(x0, y0, this._v);
			const vx = this._v[0];
			const vy = this._v[1];
			const j = (this.hash(this.seed[i] + this.age[i] * 3) - 0.5) * jitter;
			const x1 = x0 + (vx * speed - vy * j) * clampedDt;
			const y1 = y0 + (vy * speed + vx * j) * clampedDt;
			this.px[i] = x1;
			this.py[i] = y1;
			this.age[i] += clampedDt;

			const ageFrac = this.age[i] / this.life[i];
			if (x0 > -50) emit(x0, y0, x1, y1, this.hueT[i], ageFrac);

			if (ageFrac >= 1 || x1 < -8 || y1 < -8 || x1 > w + 8 || y1 > h + 8) this.respawn(i, field, w, h);
		}
	}
}
