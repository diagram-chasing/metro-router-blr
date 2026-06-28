// The choropleth field: turns the server's normalised emissions grid (/api/emissions) into a
// flat field of per-cell "months of life lost", and exposes the per-cell colour + the
// per-neighbourhood aggregate numbers. Three things move, kept separate:
//   • growth   — a slow eased lerp between poll snapshots, so cells drift to new values.
//   • baseline — the resting ACAG ambient PM2.5 bed the commute layer adds onto.
//   • State B  — a transient per-cell ignite glow (the route's squares) + a recalc sweep.

import { easeInOutCubic } from './palette';
import { monthsFromConcentration, Params } from './health';
import { WALL } from '$lib/config/wall';
import { haversineKm, pm25GramsOverYears } from '$lib/emissions';

export type Field = {
	nLat: number;
	nLon: number;
	bbox: [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
	values: number[]; // row-major lat(asc) × lon(asc), normalised 0..1
	rawMax: number;
	refDeposit?: number; // deposit of the reference corridor — the absolute scale unit
	coverage?: number; // 0..1 — fraction of the city's vehicular PM2.5 the logged corridors reveal
	personYears?: number; // aggregate person-years of life lost the logged corridors reveal (headline)
};

// A label anchor + its aggregated number. `name` is informational only (the figure, not the
// name, is rendered — place names come from the OSM basemap on the wall); it's absent for
// field-derived anchors.
export type HoodReading = { c: [number, number]; months: number; name?: string; opacity?: number };

const GROW_S = 1.6; // snapshot cross-fade
const EPS_MONTHS = 1e-3; // below this a cell carries no exposure (transparent base fill)

// Ignite (State B): each route cell rises bright then HOLDS until the route is cleared.
const IGNITE_RISE = 0.2; // s to full glow
const IGNITE_PLATEAU = 0.92; // held brightness while the route is on screen

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ChoroplethField {
	bounds: [number, number, number, number] = [0, 0, 0, 0];

	// Field texture (rgba8, north row first). `texVersion` bumps only when the bytes change, so
	// deck re-uploads on real changes, not every frame. Channels: R=hue t, G=intensity, B=ignite, A=mask.
	private texBytes: Uint8Array = new Uint8Array(0);
	private texImage: { width: number; height: number; data: Uint8Array } | null = null;
	private texVersion = 0;
	private texForce = false; // an external change (snapshot/baseline/route) needs a rebuild
	private wasAnimating = false;

	private nLat = 0;
	private nLon = 0;
	private cellDeg = 0;
	// µg/m³ that one reference *level* of commuting (saturationRoutes commutes) adds at a corridor —
	// the palette's red point (gainPerYear × years). Busier corridors exceed it: the colour caps at
	// red, the reported µg/years keep climbing.
	private gain = WALL.gainPerYear * WALL.years;
	private ourUnit = 0; // µg/m³ per unit of absolute deposit (set from the reference-commute scale)
	private refDeposit = 1; // deposit units of one reference commute — the per-route + scale unit
	private satRoutes = WALL.saturationRoutes; // overlapping commutes that saturate a corridor

	// Resting baseline (µg/m³): `base` resampled onto the current grid, `baseRaw` the baked source
	// (own header) so the field can run at any cell size without re-baking baseline-grid.json.
	private base: number[] = [];
	private baseRaw: {
		nLat: number;
		nLon: number;
		bbox: [number, number, number, number];
		values: number[];
	} | null = null;
	// Our accumulating commute layer — ABSOLUTE deposit (normalised × peak), lerped between
	// snapshots so the field grows smoothly as commutes compound.
	private ourPrev: number[] = [];
	private ourTarget: number[] = [];
	private serverAbs: number[] = []; // latest server deposit (without local extra)
	private extra: number[] = []; // persistent local deposit (demo routes) — compounds
	private peakAbs = 1; // busiest server cell this snapshot — only the "affected cells" threshold
	private growthStart = -1e9;
	private has = false;

	// Snapshot gating: while frozen, server snapshots are buffered (not applied) so the displayed
	// field holds dead steady through a route's reveal/recalc. releaseSnapshots() applies the latest
	// at the reflect beat (the zoom-out), tying the corridor's climb to the route rather than to
	// whenever a background poll happens to land.
	private snapsFrozen = false;
	private pendingRaw: Field | null = null;

	// Recalc sweep (State B): an expanding ring of brightness from the new route.
	private recStart = -1e9;
	private recDur = 0;
	private recOi = 0;
	private recOj = 0;
	private recPath: number[] = []; // recalc route resampled to uv points (flattened u,v…)

	// Per-frame caches (one O(n) pass in setFrame).
	private monthsNow: Float64Array = new Float64Array(0);
	private baseMax = 0; // busiest active cell this frame — drives per-cell opacity
	// Months attributable to the commute layer ALONE: Σ months(base+ours) − months(base).
	private marginal = 0;
	// Same marginal, averaged over only the cells the commutes touch (deposit ≥ 1% of peak).
	private marginalAffMonths = 0;
	// The wall headline: aggregate PERSON-YEARS of life lost the logged corridors reveal, computed
	// server-side (coverage × per-capita transport AQLI burden × city population) and lerped between
	// snapshots so it climbs smoothly. See emissionsGrid.buildField / health.personYearsLost.
	private headlinePrev = 0;
	private headlineTarget = 0;
	private headlineNow = 0;
	// Absolute WHO-anchored hue scale (months): neutral at the cleanest ambient cell, cool extreme
	// = the WHO line (0 months), so no cell the city actually breathes renders cool. Computed once.
	private anchorLo = 1; // months at the cleanest ambient cell → diverging neutral (t=0.5)
	private anchorHi = 60; // months at the hottest expected cell → hottest red (t=1)
	private nowS = 0;
	private dimK = 1; // background dim during a submit animation

	// Route ignite state.
	private revealAt = new Map<number, number>();

	// Tracks the grid header so the baked baseline is re-fit only when the grid changes.
	private headerKey = '';

	get ready(): boolean {
		return this.has;
	}

	setDim(k: number): void {
		this.dimK = clamp01(k);
	}

	// The resting baseline (µg/m³ per cell) from the ACAG grid baked to this grid. Set once.
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

	// Bilinearly resample the baked baseline onto the current grid. No-op until both baseline and
	// a field snapshot are known.
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

	// Fix the absolute hue anchors from the baseline + commute gain (months). Neutral = cleanest
	// ambient cell; hot end = dirtiest ambient cell with the full commute peak on top.
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

	// The most recent server snapshot. Take the ABSOLUTE deposit (value × peak) so the layer
	// compounds as routes pile up; `ourUnit` is frozen on the first snapshot so later growth reads
	// as the corridors genuinely climbing rather than renormalising.
	setSnapshot(raw: Field, now: number): void {
		// Frozen: buffer the freshest snapshot but don't climb yet — released at the reflect beat.
		if (this.snapsFrozen && this.has) {
			this.pendingRaw = raw;
			return;
		}
		const abs = raw.values.map((v) => v * raw.rawMax);
		// Absolute, load-independent calibration: a FIXED linear coefficient (µg/m³ per unit of
		// deposit), pinned to a stable reference commute (refDeposit, computed server-side) — never to
		// the live peak, which made early entries balloon then snap back on reload. One reference
		// commute adds gain/saturation_routes µg at its corridor; concentration then scales LINEARLY
		// with real cumulative traffic — 2× the commutes is 2× the µg, uncapped. A corridor reaches the
		// palette's red point (`gain`) at ~saturation_routes commutes and keeps climbing honestly past
		// it: the hue saturates at red (a colour limit), but the µg/years it reports do not.
		this.refDeposit = raw.refDeposit && raw.refDeposit > 0 ? raw.refDeposit : Math.max(1, raw.rawMax);
		this.ourUnit = this.gain / Math.max(this.satRoutes * this.refDeposit, 1);
		this.serverAbs = abs;
		this.peakAbs = Math.max(1, raw.rawMax);
		if (this.extra.length !== abs.length) this.extra = new Array(abs.length).fill(0);
		const combined = abs.map((v, i) => v + this.extra[i]);
		this.ourPrev = this.has ? this.ourTarget : combined;
		this.ourTarget = combined;
		// Headline: cross-fade from the currently-displayed figure to the new snapshot's.
		this.headlinePrev = this.has ? this.headlineNow : (raw.personYears ?? 0);
		this.headlineTarget = raw.personYears ?? 0;
		this.nLat = raw.nLat;
		this.nLon = raw.nLon;
		this.bounds = raw.bbox;
		this.cellDeg = this.nLon > 1 ? (raw.bbox[2] - raw.bbox[0]) / (this.nLon - 1) : 0.01;
		this.growthStart = now;
		this.has = true;

		const key = `${raw.nLat}x${raw.nLon}@${raw.bbox.join(',')}`;
		if (key !== this.headerKey) {
			this.headerKey = key;
			this.resampleBaseline(); // re-fit the baked baseline to the new grid
		}
		if (this.monthsNow.length !== raw.values.length)
			this.monthsNow = new Float64Array(raw.values.length);
		this.texForce = true; // new snapshot → field bytes need a rebuild
	}

	// One pass per frame: combine baseline + the decade-compounded commute increment into a
	// concentration, convert to months, and track the per-frame peak (opacity) + marginal months.
	setFrame(now: number): void {
		this.nowS = now;
		if (!this.has) return;
		const g = easeInOutCubic(clamp01((now - this.growthStart) / GROW_S));
		this.headlineNow = lerp(this.headlinePrev, this.headlineTarget, g); // headline cross-fade
		const m = this.monthsNow;
		const baseScale = Params.base_scale;
		const useBase = this.base.length === m.length; // ignore baseline if grid size differs
		let max = 0;
		let marginal = 0;
		let affMarginal = 0;
		let affCount = 0;
		const affEps = this.peakAbs * 0.01; // "touched by the commutes" = ≥1% of peak deposit
		for (let i = 0; i < m.length; i++) {
			const our = lerp(this.ourPrev[i] ?? 0, this.ourTarget[i] ?? 0, g);
			const baseUg = useBase ? baseScale * this.base[i] : 0;
			const ug = baseUg + this.ourUnit * our;
			const mo = monthsFromConcentration(ug);
			m[i] = mo;
			const add = mo - monthsFromConcentration(baseUg); // months the commutes add here
			marginal += add;
			if (our > affEps) {
				affMarginal += add;
				affCount++;
			}
			if (mo > max) max = mo;
		}
		this.baseMax = max;
		this.marginal = marginal;
		this.marginalAffMonths = affCount > 0 ? affMarginal / affCount : 0;
	}

	// Route cells rise to full then HOLD (plateau) so the line reads "full of capacity"; the
	// plateau ends when the route is cleared.
	private igniteGlow(idx: number): number {
		const at = this.revealAt.get(idx);
		if (at === undefined) return 0;
		const dt = this.nowS - at;
		if (dt < 0) return 0;
		if (dt < IGNITE_RISE) return dt / IGNITE_RISE;
		return IGNITE_PLATEAU;
	}

	// ── Field texture ──
	// Bake the per-cell DATA (hue/intensity/ignite/mask) into an rgba8 texture; colour, opacity,
	// recalc and dim all happen in the shader. One O(cells) pass, rebuilt only while moving (a
	// resting wall uploads nothing). Row 0 is NORTH, so rows are flipped on the way in.
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

	// bbox width/height on screen (cos-lat corrected), so the shader keeps the pulse ring circular.
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

	// The recalc route resampled to `n` evenly-spaced points and projected to uv (north-flipped),
	// so the shader can radiate the pulse along the path's shape. Spacing measured in cos-lat degrees.
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

	// Recalc as shader uniforms: origin in uv (fallback), the route as flattened uv points, times
	// in setFrame's clock. dur=0 disables it.
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

	// Permanently add a route's deposit to the local layer (the demo so a new route compounds; real
	// submissions arrive via the server field). Re-lerps from the displayed values so it climbs
	// smoothly. `emissionScale` (0..1) scales the bump by the route's PM2.5 vs the dirtiest mode, so
	// a metro route (scale 0) adds nothing — no spurious bright thread — and a car adds the most.
	addRouteDeposit(cellIdxs: number[], now: number, strength = 0.9, emissionScale = 1): void {
		const amt = strength * this.refDeposit * clamp01(emissionScale);
		if (amt <= 0 || cellIdxs.length === 0 || this.extra.length === 0) return;
		const g = easeInOutCubic(clamp01((now - this.growthStart) / GROW_S));
		this.ourPrev = this.ourTarget.map((v, i) => lerp(this.ourPrev[i] ?? 0, v, g));
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

	// Mean estimated months of life lost over the ACTIVE cells within `radiusKm` of a point —
	// the number that rides a label anchor. `null` when no cell there carries exposure, so the
	// caller drops the label (the same gate that leaves the field transparent). Bounded scan: only
	// the cells inside the radius's bbox are visited, so this is cheap to call per anchor per frame.
	monthsAround(lng: number, lat: number, radiusKm: number): number | null {
		if (!this.has || this.nLon === 0 || this.cellDeg === 0) return null;
		const { nLat, nLon, cellDeg, bounds } = this;
		const kx = Math.cos((lat * Math.PI) / 180) || 1;
		const dLat = radiusKm / 111; // ° per km of latitude
		const dLon = radiusKm / (111 * kx); // ° per km of longitude at this latitude
		const iMin = Math.max(0, Math.floor((lat - dLat - bounds[1]) / cellDeg));
		const iMax = Math.min(nLat - 1, Math.ceil((lat + dLat - bounds[1]) / cellDeg));
		const jMin = Math.max(0, Math.floor((lng - dLon - bounds[0]) / cellDeg));
		const jMax = Math.min(nLon - 1, Math.ceil((lng + dLon - bounds[0]) / cellDeg));
		let sum = 0;
		let n = 0;
		for (let i = iMin; i <= iMax; i++) {
			const clat = bounds[1] + i * cellDeg;
			for (let j = jMin; j <= jMax; j++) {
				const clng = bounds[0] + j * cellDeg;
				if (haversineKm(lng, lat, clng, clat) > radiusKm) continue;
				const mo = this.monthsNow[i * nLon + j] ?? 0;
				if (mo > EPS_MONTHS) {
					sum += mo;
					n++;
				}
			}
		}
		return n > 0 ? sum / n : null;
	}

	// Field-derived label anchors for the bare (no-basemap) legend, where there are no OSM place
	// labels to ride: sample a coarse, grid-aligned lattice (stable positions, so figures never
	// jitter), aggregate months around each, keep the active ones, then farthest-point-spread down
	// to `maxN` — seeded by the worst — so the survivors stay spread across the frame.
	autoHoods(maxN: number, radiusKm = 1.8, stepKm = 2.4): HoodReading[] {
		if (!this.has || maxN <= 0) return [];
		const [lonMin, latMin, lonMax, latMax] = this.bounds;
		const kx = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180) || 1;
		const dLat = stepKm / 111;
		const dLon = stepKm / (111 * kx);
		const cand: HoodReading[] = [];
		for (let lat = latMin + dLat / 2; lat < latMax; lat += dLat) {
			for (let lng = lonMin + dLon / 2; lng < lonMax; lng += dLon) {
				const mo = this.monthsAround(lng, lat, radiusKm);
				if (mo !== null) cand.push({ c: [lng, lat], months: mo });
			}
		}
		if (cand.length <= maxN) return cand;
		const dist = (a: HoodReading, b: HoodReading) =>
			Math.hypot((a.c[0] - b.c[0]) * kx, a.c[1] - b.c[1]);
		const rest = cand.slice();
		const seed = rest.reduce((bi, h, i) => (h.months > rest[bi].months ? i : bi), 0);
		const picked = [rest.splice(seed, 1)[0]];
		while (picked.length < maxN && rest.length) {
			let bestI = 0;
			let bestD = -1;
			for (let i = 0; i < rest.length; i++) {
				let d = Infinity;
				for (const q of picked) d = Math.min(d, dist(rest[i], q));
				if (d > bestD) {
					bestD = d;
					bestI = i;
				}
			}
			picked.push(rest.splice(bestI, 1)[0]);
		}
		return picked;
	}

	// City-wide headline: total estimated months of life lost across all cells.
	totalMonths(): number {
		let s = 0;
		for (let i = 0; i < this.monthsNow.length; i++) s += this.monthsNow[i];
		return s;
	}

	// Months attributable to the submitted commutes alone (total air − ambient-only air), summed.
	marginalMonths(): number {
		return this.marginal;
	}

	// The wall's headline: aggregate PERSON-YEARS of life lost the logged corridors reveal
	// (server-computed coverage × per-capita transport AQLI burden × city population), lerped per frame.
	// NOT added on top of ambient — it apportions a share of the existing burden, so it can't double-count.
	headlinePersonYears(): number {
		return this.headlineNow;
	}

	// The months this one route adds across its cells (the "+N mo" the recalc card surfaces).
	// Synchronous/deterministic; matches addRouteDeposit's `strength`/`emissionScale` so demo and
	// live agree (a metro route, scale 0, adds 0 months).
	estimateRouteMonths(cellIdxs: number[], strength = 0.9, emissionScale = 1): number {
		if (!this.has || cellIdxs.length === 0) return 0;
		const amt = strength * this.refDeposit * clamp01(emissionScale);
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

	// Grams of PM2.5 this one commute deposits over the decade — the recalc card's tangible figure:
	// the route's blended per-pkm PM2.5 factor × its km × trips/year × WALL.years. 0 for a
	// metro/walk commute (zero tailpipe).
	estimateRouteGrams(km: number, tripsPerYear: number, gPerPkm: number): number {
		return pm25GramsOverYears(gPerPkm, km, tripsPerYear, WALL.years);
	}

	// ── State B: the submitted route's squares ──
	// Rasterise a polyline → ordered, de-duplicated cell indices. Bresenham per segment (one cell
	// per step, 8-connected), so the lit route is exactly ONE grid cell wide and snaps to the lattice.
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

	// Hold the field steady: incoming server snapshots are buffered, not applied.
	freezeSnapshots(): void {
		this.snapsFrozen = true;
	}

	// Reflect beat: apply the latest buffered snapshot so the field climbs to its new state now,
	// then re-arm the freeze so it stays steady until the next reflect. No-op (stays put) when no
	// new server data arrived — the local demo deposit handles that case.
	releaseSnapshots(now: number): void {
		const raw = this.pendingRaw;
		this.pendingRaw = null;
		if (raw) {
			this.snapsFrozen = false;
			this.setSnapshot(raw, now);
			this.snapsFrozen = true;
		}
	}
}
