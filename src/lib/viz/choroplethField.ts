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

import { easeInOutCubic } from './palette';
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

export type HoodReading = { name: string; c: [number, number]; months: number };

const GROW_S = 1.6; // snapshot cross-fade
const EPS_MONTHS = 1e-3; // below this a cell carries no exposure (transparent base fill)

// Ignite (State B): each route cell rises bright then HOLDS at full capacity until
// the route is cleared (folded into the field on settle).
const IGNITE_RISE = 0.2; // s to full glow
const IGNITE_PLATEAU = 0.92; // held brightness while the route is on screen

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ChoroplethField {
	bounds: [number, number, number, number] = [0, 0, 0, 0];

	// Field texture (rgba8, north row first) the FieldLayer shades on the GPU.
	// `texVersion` bumps only when the bytes change, so deck re-uploads on real data
	// changes — not every frame. Channels: R=hue t, G=intensity, B=ignite, A=mask.
	private texBytes: Uint8Array = new Uint8Array(0);
	private texImage: { width: number; height: number; data: Uint8Array } | null = null;
	private texVersion = 0;
	private texForce = false; // an external change (snapshot/baseline/route) needs a rebuild
	private wasAnimating = false;

	private nLat = 0;
	private nLon = 0;
	private cellDeg = 0;
	// Target µg/m³ our commute layer reaches at the busiest cell when calibration is
	// frozen. After that, the layer COMPOUNDS: as more routes accumulate the absolute
	// deposit grows past this, so corridors keep climbing over the run / the decade.
	private gain = Params.our_gain_per_year * Params.years;
	private ourUnit = 0; // µg/m³ per unit of absolute deposit (frozen on first snapshot)
	private ourUnitFrozen = false;

	// Resting baseline concentration (µg/m³): `base` is resampled onto the CURRENT field
	// grid, `baseRaw` keeps the baked source (with its own header) so the field can run at
	// any cell size without re-baking baseline-grid.json.
	private base: number[] = [];
	private baseRaw: {
		nLat: number;
		nLon: number;
		bbox: [number, number, number, number];
		values: number[];
	} | null = null;
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
	private recPath: number[] = []; // recalc route resampled to uv points (flattened u,v…)

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
	setBaseline(b: {
		nLat: number;
		nLon: number;
		bbox: [number, number, number, number];
		values: number[];
	}): void {
		this.baseRaw = b;
		this.resampleBaseline();
		this.texForce = true;
	}

	// Bilinearly resample the baked baseline onto the field's current grid, so it lines up
	// at any cell size. No-op until both the baseline and a field snapshot are known.
	private resampleBaseline(): void {
		const b = this.baseRaw;
		if (!b || !this.has || this.nLat === 0 || this.nLon === 0) return;
		const { nLat, nLon, bounds, cellDeg } = this;
		const [blonMin, blatMin, blonMax, blatMax] = b.bbox;
		const bw = b.nLon;
		const bh = b.nLat;
		const out = new Array<number>(nLat * nLon);
		for (let i = 0; i < nLat; i++) {
			const lat = bounds[1] + i * cellDeg;
			const fy = bh > 1 ? ((lat - blatMin) / (blatMax - blatMin || 1)) * (bh - 1) : 0;
			const y0 = Math.max(0, Math.min(bh - 1, Math.floor(fy)));
			const y1 = Math.min(bh - 1, y0 + 1);
			const ty = Math.max(0, Math.min(1, fy - y0));
			for (let j = 0; j < nLon; j++) {
				const lon = bounds[0] + j * cellDeg;
				const fx = bw > 1 ? ((lon - blonMin) / (blonMax - blonMin || 1)) * (bw - 1) : 0;
				const x0 = Math.max(0, Math.min(bw - 1, Math.floor(fx)));
				const x1 = Math.min(bw - 1, x0 + 1);
				const tx = Math.max(0, Math.min(1, fx - x0));
				const v00 = b.values[y0 * bw + x0] ?? 0;
				const v10 = b.values[y0 * bw + x1] ?? 0;
				const v01 = b.values[y1 * bw + x0] ?? 0;
				const v11 = b.values[y1 * bw + x1] ?? 0;
				out[i * nLon + j] = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
			}
		}
		this.base = out;
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
		this.growthStart = now;
		this.has = true;

		const key = `${raw.nLat}x${raw.nLon}@${raw.bbox.join(',')}`;
		if (key !== this.headerKey) {
			this.headerKey = key;
			this.rebuildHoods();
			this.resampleBaseline(); // re-fit the baked baseline to the new grid
		}
		if (this.monthsNow.length !== raw.values.length)
			this.monthsNow = new Float64Array(raw.values.length);
		this.texForce = true; // new snapshot → field bytes need a rebuild
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

	// ── Field texture ──
	// Bake the per-cell DATA the shader needs (hue / intensity / ignite / mask) into
	// an rgba8 texture. Colour, opacity curve, the recalc pulse and dim all happen in
	// the shader from uniforms — none of that is here. Cheap (one O(cells) pass), and
	// only rebuilds when the field is actually moving, so a resting wall uploads nothing.
	// Texture row 0 is NORTH (the FieldLayer's uv.y=0 is the top edge), while the field
	// is row-major lat-ascending, so rows are flipped on the way in.
	fillTexture(): void {
		if (!this.has) return;
		const animating = this.nowS - this.growthStart < GROW_S || this.revealAt.size > 0;
		// Rebuild while moving, one frame after it settles, and on any external change.
		const need = this.texForce || animating || this.wasAnimating || !this.texImage;
		this.wasAnimating = animating;
		if (!need) return;

		const { nLat, nLon } = this;
		const n = nLat * nLon;
		if (this.texBytes.length !== n * 4) this.texBytes = new Uint8Array(n * 4);
		const out = this.texBytes;
		const m = this.monthsNow;
		const lo = this.anchorLo || 1e-9;
		const span = Math.max(this.anchorHi - lo, 1e-9);
		const peak = this.baseMax > 0 ? this.baseMax : 1;

		for (let tr = 0; tr < nLat; tr++) {
			const fr = nLat - 1 - tr; // texture top row ← field's northernmost row
			for (let c = 0; c < nLon; c++) {
				const fi = fr * nLon + c;
				const mo = m[fi] ?? 0;
				// WHO-anchored hue: neutral at the cleanest ambient cell, cool extreme = WHO line.
				const t = mo >= lo ? 0.5 + 0.5 * clamp01((mo - lo) / span) : 0.5 * clamp01(mo / lo);
				const ti = (tr * nLon + c) * 4;
				out[ti] = Math.round(t * 255);
				out[ti + 1] = Math.round(clamp01(mo / peak) * 255); // intensity (rel. to peak)
				out[ti + 2] = Math.round(clamp01(this.igniteGlow(fi)) * 255); // ignite bloom
				out[ti + 3] = mo > EPS_MONTHS ? 255 : 0; // mask (0 = empty → basemap)
			}
		}
		this.texImage = { width: nLon, height: nLat, data: out.slice() };
		this.texVersion++;
		this.texForce = false;
	}

	// The current texture; identity is stable until the bytes change (gate deck uploads on it).
	textureImage(): { width: number; height: number; data: Uint8Array } | null {
		return this.texImage;
	}
	get textureVersion(): number {
		return this.texVersion;
	}

	// bbox width/height on screen (cos-lat corrected), so the shader can keep the pulse
	// ring circular instead of stretched to the lattice's aspect.
	get aspect(): number {
		const [lonMin, latMin, lonMax, latMax] = this.bounds;
		const dLat = latMax - latMin || 1;
		const latMid = ((latMin + latMax) / 2) * (Math.PI / 180);
		return ((lonMax - lonMin) * Math.cos(latMid)) / dLat;
	}

	get dim(): number {
		return this.dimK;
	}

	// (cols, rows) — drives the shader's grid lines and per-cell recalc flicker.
	get gridSize(): [number, number] {
		return [this.nLon, this.nLat];
	}

	// The recalc route, resampled to `n` evenly-spaced points and projected to uv
	// (north-flipped to match the texture), so the shader can radiate the pulse along the
	// path's shape. Even spacing is measured in cos-lat-corrected degrees.
	setRecalcPath(route: [number, number][], n = 8): void {
		if (route.length < 2) {
			this.recPath = [];
			return;
		}
		const [lonMin, latMin, lonMax, latMax] = this.bounds;
		const dLon = lonMax - lonMin || 1;
		const dLat = latMax - latMin || 1;
		const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180) || 1;
		const cum = [0];
		for (let i = 1; i < route.length; i++) {
			const dx = (route[i][0] - route[i - 1][0]) * kx;
			const dy = route[i][1] - route[i - 1][1];
			cum.push(cum[i - 1] + Math.hypot(dx, dy));
		}
		const total = cum[cum.length - 1] || 1;
		const out: number[] = [];
		let seg = 1;
		for (let k = 0; k < n; k++) {
			const target = (total * k) / (n - 1);
			while (seg < route.length - 1 && cum[seg] < target) seg++;
			const t = (target - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
			const lng = route[seg - 1][0] + (route[seg][0] - route[seg - 1][0]) * t;
			const lat = route[seg - 1][1] + (route[seg][1] - route[seg - 1][1]) * t;
			out.push((lng - lonMin) / dLon, (latMax - lat) / dLat);
		}
		this.recPath = out;
	}

	// Recalc as shader uniforms: origin in uv (fallback), the route as flattened uv points
	// (the pulse radiates along it), times in the same clock as setFrame. dur=0 disables it.
	recalcUniforms(): { origin: [number, number]; start: number; dur: number; path: number[] } {
		const u = this.nLon > 1 ? this.recOj / (this.nLon - 1) : 0.5;
		const v = this.nLat > 1 ? (this.nLat - 1 - this.recOi) / (this.nLat - 1) : 0.5;
		return { origin: [u, v], start: this.recStart, dur: this.recDur, path: this.recPath };
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
		this.texForce = true;
	}

	// Kick a recalculation sweep from a grid cell (route centroid), lasting `dur`.
	setRecalc(originIdx: number, start: number, dur: number): void {
		this.recOi = Math.floor(originIdx / this.nLon);
		this.recOj = originIdx % this.nLon;
		this.recStart = start;
		this.recDur = dur;
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

	// The months this one route adds across its cells — the figure the recalc
	// notification surfaces ("+N mo"). Synchronous and deterministic (doesn't wait on
	// the server poll): the months gained if the route deposits its standard bump on top
	// of the current field. Matches addRouteDeposit's `strength`, so demo and live agree.
	estimateRouteMonths(cellIdxs: number[], strength = 0.9): number {
		if (!this.has || cellIdxs.length === 0) return 0;
		const amt = strength * this.peakAbs;
		const baseScale = Params.base_scale;
		const useBase = this.base.length === this.monthsNow.length;
		const seen = new Set<number>();
		let sum = 0;
		for (const i of cellIdxs) {
			if (i < 0 || i >= this.monthsNow.length || seen.has(i)) continue;
			seen.add(i);
			const baseUg = useBase ? baseScale * this.base[i] : 0;
			const cur = this.ourTarget[i] ?? 0;
			const before = monthsFromConcentration(baseUg + this.ourUnit * cur);
			const after = monthsFromConcentration(baseUg + this.ourUnit * (cur + amt));
			sum += after - before;
		}
		return sum;
	}

	// The µg/m³ this one route adds along its corridor — the figure the recalc card surfaces.
	// The deposit bump (`strength × peakAbs`) is uniform across the route's cells, so this is a
	// single representative concentration. Decade-compounded (gain already folds in `years`),
	// matching how the wall frames everything; the card copy says "over 10 years".
	estimateRouteUg(strength = 0.9): number {
		if (!this.has) return 0;
		return this.ourUnit * strength * this.peakAbs;
	}

	// ── State B: the submitted route's squares ──
	// Rasterise a polyline onto the grid → ordered, de-duplicated cell indices. Bresenham per
	// segment: one cell per step (8-connected), so the lit route is exactly ONE grid cell wide
	// and snaps to the lattice — not the 2-cell-wide band that half-cell sampling + independent
	// row/column rounding used to produce (which read fatter than the grid).
	rasterizeRoute(coords: [number, number][]): number[] {
		if (!this.has || coords.length < 2) return [];
		const { nLat, nLon, cellDeg, bounds } = this;
		const out: number[] = [];
		let last = -1;
		const emit = (i: number, j: number) => {
			if (i < 0 || i >= nLat || j < 0 || j >= nLon) return;
			const idx = i * nLon + j;
			if (idx !== last) {
				out.push(idx);
				last = idx;
			}
		};
		const cellJ = (lng: number) => Math.round((lng - bounds[0]) / cellDeg);
		const cellI = (lat: number) => Math.round((lat - bounds[1]) / cellDeg);
		for (let k = 1; k < coords.length; k++) {
			let j = cellJ(coords[k - 1][0]);
			let i = cellI(coords[k - 1][1]);
			const j1 = cellJ(coords[k][0]);
			const i1 = cellI(coords[k][1]);
			const dx = Math.abs(j1 - j);
			const dy = Math.abs(i1 - i);
			const sx = j < j1 ? 1 : -1;
			const sy = i < i1 ? 1 : -1;
			let err = dx - dy;
			for (;;) {
				emit(i, j);
				if (i === i1 && j === j1) break;
				const e2 = 2 * err;
				if (e2 > -dy) {
					err -= dy;
					j += sx;
				}
				if (e2 < dx) {
					err += dx;
					i += sy;
				}
			}
		}
		return out;
	}

	// Light the route's cells in sequence across `duration`, starting at `start`.
	igniteRoute(cellIdxs: number[], start: number, duration: number): void {
		this.revealAt.clear();
		this.texForce = true;
		if (cellIdxs.length === 0) return;
		const span = cellIdxs.length > 1 ? duration / (cellIdxs.length - 1) : 0;
		cellIdxs.forEach((idx, k) => this.revealAt.set(idx, start + k * span));
	}

	clearRoute(): void {
		this.revealAt.clear();
		this.texForce = true;
	}
}
