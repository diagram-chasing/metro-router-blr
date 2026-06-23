// The emissions field as a grid of extruded columns. Takes the server's
// normalised CO₂ grid (/api/emissions) and exposes per-cell elevation + colour
// that a deck GridCellLayer draws as towers — height & hue both keyed to CO₂.
//
// Three things move here, kept separate:
//   • growth   — a slow lerp between successive poll snapshots, so towers rise
//                and settle rather than snapping as new commutes land.
//   • scenario — raw ↔ counterfactual, driven live by the toggle's eased
//                `transition` (0 = actual, 1 = "half shifted to transit"); cf
//                deposits are genuinely lower, so the towers visibly sink.
//   • peakRef  — a ratcheting reference height. Snapshots are *not* renormalised
//                to their own peak each poll (that froze the shape); instead the
//                whole field is scaled against a peak that sits HEADROOM above the
//                busiest corridor, so accumulation reads as the city rising into
//                the headroom rather than re-flattening.

import { co2Ramp, easeInOutCubic } from './palette';

export type Field = {
	nLat: number;
	nLon: number;
	bbox: [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
	values: number[]; // row-major lat(asc) × lon(asc), normalised 0..1
	rawMax: number; // pre-normalisation peak of the deposit
	hasBase?: boolean;
};

// One drawn cell: a stable {bottom-left corner, grid index} pair. The array
// reference only changes when the visible set does (on a snapshot), so deck
// keeps its buffers and re-runs accessors via updateTriggers each frame.
export type Column = { position: [number, number]; idx: number };

const GROW_S = 1.6; // growth cross-fade duration
const COLOR_GAMMA = 0.6; // lifts midtone hues so faint corridors read
const ELEV_GAMMA = 0.8; // height curve — close to linear so big emitters tower
const HEADROOM = 1.5; // peakRef sits this far above the busiest corridor
const VIS_EPS = 0.012; // a cell becomes a tower above this fraction of peakRef
const BREATHE_AMP = 0.05; // ± height shimmer so the field is never frozen
const BREATHE_HZ = 0.18;
const TWO_PI = Math.PI * 2;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class EmissionsField {
	bounds: [number, number, number, number] = [0, 0, 0, 0];
	cellMeters = 0; // GridCellLayer footprint
	elevMeters = 6000; // peak tower height (m); set from URL on mount
	cols: Column[] = [];

	private nLat = 0;
	private nLon = 0;
	private cellDeg = 0;
	// Absolute deposits (normalised value × that snapshot's peak), so growth can
	// lerp across polls whose self-normalisation peaks differ.
	private rawPrev: number[] = [];
	private rawTarget: number[] = [];
	private cfPrev: number[] = [];
	private cfTarget: number[] = [];
	private peakRef = 0;
	private growthStart = -1e9;
	private has = false;
	// Frame state the deck accessors read.
	private nowS = 0;
	private tr = 0;

	get ready(): boolean {
		return this.has;
	}

	// Latest server snapshot. `cf` may equal `raw` until the counterfactual grid
	// exists; the scenario lerp then collapses to a no-op.
	setSnapshot(raw: Field, cf: Field, now: number): void {
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
		this.bounds = raw.bbox;
		this.cellDeg = this.nLon > 1 ? (raw.bbox[2] - raw.bbox[0]) / (this.nLon - 1) : 0.01;
		this.cellMeters = this.cellDeg * 111320;

		// Ratchet the reference up only when a corridor outgrows the current
		// headroom; otherwise hold it so accumulation reads as rising towers.
		const want = raw.rawMax * HEADROOM;
		this.peakRef = this.peakRef === 0 || raw.rawMax > this.peakRef ? want : this.peakRef;

		this.growthStart = now;
		this.has = true;
		this.rebuildCols();
	}

	// Cells worth drawing: anything that lights up in the current or previous raw
	// snapshot (cf is always ≤ raw, so raw bounds visibility). Bottom-left corner
	// per GridCellLayer; cell extends +cellSize east/north from there.
	private rebuildCols(): void {
		const { nLat, nLon, cellDeg, bounds } = this;
		const thresh = VIS_EPS * this.peakRef;
		const half = cellDeg / 2;
		const cols: Column[] = [];
		for (let i = 0; i < nLat; i++) {
			for (let j = 0; j < nLon; j++) {
				const idx = i * nLon + j;
				if ((this.rawTarget[idx] ?? 0) <= thresh && (this.rawPrev[idx] ?? 0) <= thresh) continue;
				cols.push({ position: [bounds[0] + j * cellDeg - half, bounds[1] + i * cellDeg - half], idx });
			}
		}
		this.cols = cols;
	}

	// Called once per frame before the layer is rebuilt; the accessors below read
	// nowS/tr so geometry stays a pure function of (data, time, transition).
	setFrame(now: number, transition: number): void {
		this.nowS = now;
		this.tr = clamp01(transition);
	}

	// Normalised 0..1 height of a cell this frame, after growth + scenario lerps.
	private valueOf(idx: number): number {
		const g = easeInOutCubic(clamp01((this.nowS - this.growthStart) / GROW_S));
		const ra = lerp(this.rawPrev[idx] ?? 0, this.rawTarget[idx] ?? 0, g);
		const ca = lerp(this.cfPrev[idx] ?? 0, this.cfTarget[idx] ?? 0, g);
		const abs = lerp(ra, ca, this.tr);
		return this.peakRef > 0 ? clamp01(abs / this.peakRef) : 0;
	}

	elevationOf(idx: number): number {
		const v = this.valueOf(idx);
		if (v <= 0) return 0;
		const breathe = 1 + BREATHE_AMP * Math.sin(this.nowS * TWO_PI * BREATHE_HZ + idx * 0.7);
		return Math.pow(v, ELEV_GAMMA) * this.elevMeters * breathe;
	}

	colorOf(idx: number): [number, number, number, number] {
		const v = this.valueOf(idx);
		const [r, g, b] = co2Ramp(Math.pow(v, COLOR_GAMMA));
		return [r, g, b, Math.round(160 + 95 * v)];
	}
}
