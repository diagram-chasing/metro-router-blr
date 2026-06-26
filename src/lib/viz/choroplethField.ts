// The choropleth field: turns the server's normalised emissions grid (/api/emissions)
// into a flat field of per-cell "months of life lost", and exposes the per-cell
// colour + the per-neighbourhood aggregate numbers the wall draws.
//
// Three things move here, kept separate (cf. EmissionsField, which does the same for
// the 3D towers):
//   • growth — a slow eased lerp between successive poll snapshots, so cells drift
//              to new values rather than snapping as commutes accumulate.
//   • baseline — the diverging midpoint is the mean exposure of cells that carry any
//                traffic, so a cell reads warm when it's worse than the typical
//                travelled corridor and cool ("months given back") when it's better.
//                Empty no-data cells stay transparent so the basemap shows through.
//   • State B — a transient per-cell ignite glow (the submitted route's squares
//               lighting up in sequence) and a recalculating sweep, layered on top.

import { divergingAt, easeInOutCubic } from './palette';
import { monthsFromConcentration, Params } from './health';
import { NEIGHBOURHOODS } from '$lib/config/neighbourhoods';
import { haversineKm } from '$lib/emissions';

export type Field = {
	nLat: number;
	nLon: number;
	bbox: [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
	values: number[]; // row-major lat(asc) × lon(asc), normalised 0..1
	rawMax: number;
};

export type Cell = { position: [number, number]; idx: number };

export type HoodReading = { name: string; c: [number, number]; months: number };

const GROW_S = 1.6; // snapshot cross-fade
const EPS_MONTHS = 1e-3; // below this a cell carries no exposure (transparent base fill)
const BASE_FILL: [number, number, number] = [40, 48, 64]; // faint grid over the bbox

// Ignite (State B): each route cell rises bright then HOLDS at full capacity until
// the route is cleared (folded into the field on settle).
const IGNITE_RISE = 0.2; // s to full glow
const IGNITE_PLATEAU = 0.92; // held brightness while the route is on screen

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ChoroplethField {
	bounds: [number, number, number, number] = [0, 0, 0, 0];
	cellMeters = 0;
	cols: Cell[] = []; // every cell (full coverage); transparent where empty

	private nLat = 0;
	private nLon = 0;
	private cellDeg = 0;
	// Target µg/m³ our commute layer reaches at the busiest cell when calibration is
	// frozen. After that, the layer COMPOUNDS: as more routes accumulate the absolute
	// deposit grows past this, so corridors keep climbing over the run / the decade.
	private gain = Params.our_gain_per_year * Params.years;
	private ourUnit = 0; // µg/m³ per unit of absolute deposit (frozen on first snapshot)
	private ourUnitFrozen = false;

	// Resting baseline concentration (µg/m³) per cell, from the ACAG annual-mean PM2.5 grid.
	private base: number[] = [];
	// Our accumulating commute layer — ABSOLUTE deposit (normalised × peak), lerped
	// between snapshots so the field grows smoothly as commutes compound.
	private ourPrev: number[] = [];
	private ourTarget: number[] = [];
	private serverAbs: number[] = []; // latest server deposit (without local extra)
	private extra: number[] = []; // persistent local deposit (demo routes) — compounds
	private peakAbs = 1; // busiest server cell — the unit a route bump is measured in
	private growthStart = -1e9;
	private has = false;

	// Recalculation sweep (State B): an expanding ring of brightness from the new
	// route, so the compounding recompute is visible.
	private recStart = -1e9;
	private recDur = 0;
	private recOi = 0;
	private recOj = 0;
	private recMaxDist = 1;

	// Per-frame caches (one O(n) pass in setFrame).
	private monthsNow: Float64Array = new Float64Array(0);
	private baseMax = 0; // busiest active cell this frame — drives per-cell opacity
	// Months attributable to the commute layer ALONE: Σ months(base+ours) − months(base).
	// The marginal what-if over the ambient bed, for the headline figure.
	private marginal = 0;
	// Absolute WHO-anchored hue scale (months). Neutral (the diverging midpoint) sits at the
	// city's cleanest ambient cell; the cool extreme is the WHO line (0 months). So no cell the
	// city actually breathes ever renders cool — honest for a public-health wall. Computed once.
	private anchorLo = 1; // months at the cleanest ambient cell → diverging neutral (t=0.5)
	private anchorHi = 60; // months at the hottest expected cell → hottest red (t=1)
	private nowS = 0;
	private dimK = 1; // background dim during a submit animation

	// Route ignite state.
	private revealAt = new Map<number, number>();

	// Neighbourhood → member cell indices (rebuilt only when the grid header changes).
	private hoodCells: number[][] = [];
	private headerKey = '';

	get ready(): boolean {
		return this.has;
	}

	// µg/m³ our commute layer adds at the busiest cell (per-year × years).
	setGain(perYear: number, years: number): void {
		if (perYear > 0) this.gain = perYear * years;
		this.recomputeAnchors();
	}

	setDim(k: number): void {
		this.dimK = clamp01(k);
	}

	// The resting baseline concentration (µg/m³ per cell), from the ACAG annual-mean PM2.5
	// grid baked to this grid. Set once; aligns to the same row-major lat(asc) order.
	setBaseline(baseUg: number[]): void {
		this.base = baseUg;
		this.recomputeAnchors();
	}

	// Fix the absolute hue anchors from the baseline + commute gain (months, not µg). The
	// neutral midpoint is the city's cleanest ambient cell; the hot end is the dirtiest
	// ambient cell with the full commute peak on top.
	private recomputeAnchors(): void {
		if (this.base.length === 0) return;
		const s = Params.base_scale;
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of this.base) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		this.anchorLo = monthsFromConcentration(s * lo);
		this.anchorHi = monthsFromConcentration(s * hi + this.gain);
		if (this.anchorHi <= this.anchorLo) this.anchorHi = this.anchorLo + 1;
	}

	// The most recent server snapshot of our accumulating commute field. We take the
	// ABSOLUTE deposit (value × peak) so the layer compounds as routes pile up; the
	// per-unit µg (`ourUnit`) is frozen on the first snapshot, so subsequent growth in
	// the deposit reads as the corridors genuinely climbing rather than renormalising.
	setSnapshot(raw: Field, now: number): void {
		const abs = raw.values.map((v) => v * raw.rawMax);
		if (!this.ourUnitFrozen && raw.rawMax > 0) {
			this.ourUnit = this.gain / raw.rawMax; // current peak → `gain` µg; future peaks exceed it
			this.ourUnitFrozen = true;
		}
		this.serverAbs = abs;
		this.peakAbs = Math.max(1, raw.rawMax);
		if (this.extra.length !== abs.length) this.extra = new Array(abs.length).fill(0);
		const combined = abs.map((v, i) => v + this.extra[i]);
		this.ourPrev = this.has ? this.ourTarget : combined;
		this.ourTarget = combined;
		this.nLat = raw.nLat;
		this.nLon = raw.nLon;
		this.bounds = raw.bbox;
		this.cellDeg = this.nLon > 1 ? (raw.bbox[2] - raw.bbox[0]) / (this.nLon - 1) : 0.01;
		this.cellMeters = this.cellDeg * 111320;
		this.growthStart = now;
		this.has = true;

		const key = `${raw.nLat}x${raw.nLon}@${raw.bbox.join(',')}`;
		if (key !== this.headerKey) {
			this.headerKey = key;
			this.rebuildCols();
			this.rebuildHoods();
		}
		if (this.monthsNow.length !== raw.values.length)
			this.monthsNow = new Float64Array(raw.values.length);
	}

	// Bottom-left corner per GridCellLayer; the cell extends +cellSize east/north.
	private rebuildCols(): void {
		const { nLat, nLon, cellDeg, bounds } = this;
		const half = cellDeg / 2;
		const cols: Cell[] = [];
		for (let i = 0; i < nLat; i++) {
			for (let j = 0; j < nLon; j++) {
				cols.push({
					position: [bounds[0] + j * cellDeg - half, bounds[1] + i * cellDeg - half],
					idx: i * nLon + j
				});
			}
		}
		this.cols = cols;
	}

	private rebuildHoods(): void {
		const { nLat, nLon, cellDeg, bounds } = this;
		this.hoodCells = NEIGHBOURHOODS.map((h) => {
			const members: number[] = [];
			for (let i = 0; i < nLat; i++) {
				const lat = bounds[1] + i * cellDeg;
				for (let j = 0; j < nLon; j++) {
					const lon = bounds[0] + j * cellDeg;
					if (haversineKm(h.c[0], h.c[1], lon, lat) <= h.r) members.push(i * nLon + j);
				}
			}
			return members;
		});
	}

	// One pass per frame: combine resting baseline + our decade-compounded commute
	// increment into a concentration, convert to months, track the per-frame peak (for
	// opacity) and the marginal commute months (for the headline). Hue uses fixed
	// WHO-anchored anchors, so no live mean/span is needed.
	setFrame(now: number): void {
		this.nowS = now;
		if (!this.has) return;
		const g = easeInOutCubic(clamp01((now - this.growthStart) / GROW_S));
		const m = this.monthsNow;
		const baseScale = Params.base_scale;
		const useBase = this.base.length === m.length; // ignore baseline if grid size differs
		let max = 0;
		let marginal = 0;
		for (let i = 0; i < m.length; i++) {
			const our = lerp(this.ourPrev[i] ?? 0, this.ourTarget[i] ?? 0, g);
			const baseUg = useBase ? baseScale * this.base[i] : 0;
			const ug = baseUg + this.ourUnit * our;
			const mo = monthsFromConcentration(ug);
			m[i] = mo;
			marginal += mo - monthsFromConcentration(baseUg); // months the commutes add here
			if (mo > max) max = mo;
		}
		this.baseMax = max;
		this.marginal = marginal;
	}

	// Route cells rise to full brightness then HOLD (plateau) so the drawn line reads
	// "full of capacity" through the hold, instead of flickering out immediately. The
	// plateau ends when the route is cleared (the cells have folded into the field).
	private igniteGlow(idx: number): number {
		const at = this.revealAt.get(idx);
		if (at === undefined) return 0;
		const dt = this.nowS - at;
		if (dt < 0) return 0;
		if (dt < IGNITE_RISE) return dt / IGNITE_RISE;
		return IGNITE_PLATEAU;
	}

	// The expanding recalculation ring: 1 at the wavefront, fading ahead/behind it.
	private recalcWave(idx: number): number {
		if (this.nowS < this.recStart || this.nowS > this.recStart + this.recDur) return 0;
		const p = (this.nowS - this.recStart) / this.recDur;
		const ci = Math.floor(idx / this.nLon);
		const cj = idx % this.nLon;
		const dist = Math.hypot(ci - this.recOi, cj - this.recOj);
		const front = p * this.recMaxDist;
		const env = Math.sin(Math.PI * clamp01(p)); // rise then fall over the sweep
		return env * Math.exp(-Math.pow((dist - front) / 2.4, 2));
	}

	colorOf(idx: number): [number, number, number, number] {
		const m = this.monthsNow[idx] ?? 0;
		const glow = this.igniteGlow(idx);
		const wave = this.recalcWave(idx);

		// Empty cell: a faint neutral fill so the whole grid reads across the bbox
		// (the lattice "fits" the box) instead of a ragged blob of lit corridors.
		if (m <= EPS_MONTHS && glow <= 0.001 && wave <= 0.001) {
			return [BASE_FILL[0], BASE_FILL[1], BASE_FILL[2], Math.round(16 * this.dimK)];
		}

		// Absolute WHO-anchored hue: neutral sits at the city's cleanest ambient cell, the
		// cool extreme is the WHO line (0 months). Everything the city actually breathes is at
		// or above neutral, so no cell ever reads "clean" — the dirtier the cell, the warmer.
		const lo = this.anchorLo || 1e-9;
		const span = Math.max(this.anchorHi - lo, 1e-9);
		const t = m >= lo ? 0.5 + 0.5 * clamp01((m - lo) / span) : 0.5 * clamp01(m / lo);
		let [r, g, b] = divergingAt(t);
		// Opacity follows how busy the cell is relative to the peak.
		let a = 54 + 192 * Math.pow(clamp01(this.baseMax > 0 ? m / this.baseMax : 0), 0.6);

		// Recalculation sweep: a cool-white wavefront brightening cells as it passes.
		if (wave > 0) {
			const W: [number, number, number] = [196, 226, 255];
			const k = 0.7 * wave;
			r = Math.round(r + (W[0] - r) * k);
			g = Math.round(g + (W[1] - g) * k);
			b = Math.round(b + (W[2] - b) * k);
			a = a + (255 - a) * (0.6 * wave);
		}

		// Route ignite: a hot, near-white bloom — brighter and fuller than the field.
		if (glow > 0) {
			const IGN: [number, number, number] = [255, 246, 224];
			r = Math.round(r + (IGN[0] - r) * glow);
			g = Math.round(g + (IGN[1] - g) * glow);
			b = Math.round(b + (IGN[2] - b) * glow);
			a = Math.max(a, 235) + (255 - Math.max(a, 235)) * glow;
		}

		return [r, g, b, Math.round(clamp01(a / 255) * 255 * this.dimK)];
	}

	// Nearest cell index to a lng/lat (clamped to the grid).
	cellIndexAt(lng: number, lat: number): number {
		const j = Math.max(0, Math.min(this.nLon - 1, Math.round((lng - this.bounds[0]) / this.cellDeg)));
		const i = Math.max(0, Math.min(this.nLat - 1, Math.round((lat - this.bounds[1]) / this.cellDeg)));
		return i * this.nLon + j;
	}

	// Permanently add a route's deposit to the local layer (used by the demo so a new
	// route genuinely compounds; real submissions arrive via the server field). Re-lerps
	// from the currently-displayed values so the corridors climb smoothly.
	addRouteDeposit(cellIdxs: number[], now: number, strength = 0.9): void {
		if (cellIdxs.length === 0 || this.extra.length === 0) return;
		const g = easeInOutCubic(clamp01((now - this.growthStart) / GROW_S));
		this.ourPrev = this.ourTarget.map((v, i) => lerp(this.ourPrev[i] ?? 0, v, g));
		const amt = strength * this.peakAbs;
		for (const i of cellIdxs) if (i >= 0 && i < this.extra.length) this.extra[i] += amt;
		this.ourTarget = this.serverAbs.map((v, i) => v + this.extra[i]);
		this.growthStart = now;
	}

	// Kick a recalculation sweep from a grid cell (route centroid), lasting `dur`.
	setRecalc(originIdx: number, start: number, dur: number): void {
		this.recOi = Math.floor(originIdx / this.nLon);
		this.recOj = originIdx % this.nLon;
		this.recStart = start;
		this.recDur = dur;
		this.recMaxDist = Math.hypot(this.nLat, this.nLon);
	}

	// Per-neighbourhood number: the mean estimated months of life lost for a resident
	// of that zone (average over its travelled cells). Always ≥ 0 in the default view;
	// "given back" (negative) is produced by the what-if scenarios (later phase).
	hoodMonths(): HoodReading[] {
		const out: HoodReading[] = [];
		for (let k = 0; k < NEIGHBOURHOODS.length; k++) {
			const cells = this.hoodCells[k] ?? [];
			let sum = 0;
			let n = 0;
			for (const idx of cells) {
				const mo = this.monthsNow[idx] ?? 0;
				if (mo > EPS_MONTHS) {
					sum += mo;
					n++;
				}
			}
			if (n === 0) continue;
			out.push({ name: NEIGHBOURHOODS[k].name, c: NEIGHBOURHOODS[k].c, months: sum / n });
		}
		return out;
	}

	// City-wide headline: total estimated months of life lost across all cells.
	totalMonths(): number {
		let s = 0;
		for (let i = 0; i < this.monthsNow.length; i++) s += this.monthsNow[i];
		return s;
	}

	// Months attributable to the submitted commutes alone (total air − ambient-only air),
	// summed over the grid. The marginal what-if the wall headlines, not the city's full burden.
	marginalMonths(): number {
		return this.marginal;
	}

	// ── State B: the submitted route's squares ──
	// Rasterise a polyline onto the grid → ordered, de-duplicated cell indices.
	rasterizeRoute(coords: [number, number][]): number[] {
		if (!this.has || coords.length < 2) return [];
		const { nLat, nLon, cellDeg, bounds } = this;
		const out: number[] = [];
		let last = -1;
		const push = (lng: number, lat: number) => {
			const j = Math.round((lng - bounds[0]) / cellDeg);
			const i = Math.round((lat - bounds[1]) / cellDeg);
			if (i < 0 || i >= nLat || j < 0 || j >= nLon) return;
			const idx = i * nLon + j;
			if (idx !== last) {
				out.push(idx);
				last = idx;
			}
		};
		for (let k = 1; k < coords.length; k++) {
			const [lng1, lat1] = coords[k - 1];
			const [lng2, lat2] = coords[k];
			const km = haversineKm(lng1, lat1, lng2, lat2);
			const steps = Math.max(1, Math.ceil(km / (this.cellMeters / 1000 / 2)));
			for (let s = 0; s <= steps; s++) {
				const t = s / steps;
				push(lng1 + (lng2 - lng1) * t, lat1 + (lat2 - lat1) * t);
			}
		}
		return out;
	}

	// Light the route's cells in sequence across `duration`, starting at `start`.
	igniteRoute(cellIdxs: number[], start: number, duration: number): void {
		this.revealAt.clear();
		if (cellIdxs.length === 0) return;
		const span = cellIdxs.length > 1 ? duration / (cellIdxs.length - 1) : 0;
		cellIdxs.forEach((idx, k) => this.revealAt.set(idx, start + k * span));
	}

	clearRoute(): void {
		this.revealAt.clear();
	}
}
