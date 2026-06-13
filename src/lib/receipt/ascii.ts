// Pure string generators for the receipt's ASCII data-viz.
// Deterministic, no DOM, no side effects — easy to eyeball and unit-test.

import type { Answers, Decider, FunQuestionId, Frequency, Lifestyle, Mode } from '$lib/exhibit/types';

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}

function lerp(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
	if (inMax === inMin) return outMin;
	const t = clamp((v - inMin) / (inMax - inMin), 0, 1);
	return outMin + t * (outMax - outMin);
}

// Receipt-wide target so every viz sits on the same grid and fills the paper.
export const COLS = 28;

// ───────────────────────────────────────────────────────────────────
// Mode-keyed visual vocabulary. Used by both route strip + fingerprint.
// ───────────────────────────────────────────────────────────────────

type ModeGlyph = { tick: string; segment: string };

export const MODE_GLYPH: Record<Mode, ModeGlyph> = {
	metro: { tick: '●', segment: '━' },
	bus: { tick: '▣', segment: '═' },
	car: { tick: '◼', segment: '━' },
	cab_solo: { tick: '▬', segment: '─' },
	cab_shared: { tick: '▬', segment: '╌' },
	auto: { tick: '◆', segment: '━' },
	two_wheeler: { tick: '◇', segment: '─' },
	active: { tick: '·', segment: ' ' }
};

type BorderSet = { tl: string; tr: string; bl: string; br: string; h: string; v: string };

export const MODE_BORDER: Record<Mode, BorderSet | null> = {
	metro: { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║' },
	bus: { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃' },
	car: { tl: '▛', tr: '▜', bl: '▙', br: '▟', h: '▀', v: '▌' },
	cab_solo: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' },
	cab_shared: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '╌', v: '╎' },
	auto: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' },
	two_wheeler: { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '┄', v: '┆' },
	active: null
};

// ───────────────────────────────────────────────────────────────────
// 1. Route strip
// ───────────────────────────────────────────────────────────────────

const FREQ_TICK_GAP: Record<Frequency, number> = {
	daily: 3,
	few_weekly: 4,
	weekly: 5,
	occasional: 6
};

export function routeStrip(mode: Mode, frequency: Frequency, distanceKm: number): string {
	const glyph = MODE_GLYPH[mode];
	const len = Math.round(clamp(lerp(distanceKm, 1, 25, 18, COLS), 16, COLS));
	const gap = FREQ_TICK_GAP[frequency];
	const out: string[] = [];
	for (let i = 0; i < len; i++) {
		out.push(i % gap === 0 ? glyph.tick : glyph.segment);
	}
	if (out[out.length - 1] !== glyph.tick) out[out.length - 1] = glyph.tick;
	return out.join('');
}

const MODE_PHRASE: Record<Mode, string> = {
	metro: 'on the metro',
	bus: 'on the bus',
	car: 'in your car',
	cab_solo: 'by cab',
	cab_shared: 'in a pooled cab',
	auto: 'by auto',
	two_wheeler: 'on a two-wheeler',
	active: 'on foot or cycling'
};

const FREQ_PHRASE: Record<Frequency, string> = {
	daily: 'most days',
	few_weekly: 'a few times a week',
	weekly: 'about once a week',
	occasional: 'now and then'
};

export function routeCaption(mode: Mode, frequency: Frequency): string {
	return `${FREQ_PHRASE[frequency]}, ${MODE_PHRASE[mode]}`;
}

// ───────────────────────────────────────────────────────────────────
// 1b. Segmented route strip — when a trip has multiple legs (walk + metro
// + walk, etc.) render each leg with its own mode glyph, sized in proportion
// to the leg's length.
// ───────────────────────────────────────────────────────────────────

export type RouteSeg = { mode: Mode; lengthM: number };

export function routeStripSegments(segs: RouteSeg[], cols = COLS): string {
	if (!segs.length) return ' '.repeat(cols);
	const MIN_SEG = 2;
	// If we can't even fit a minimum-width glyph for every segment, drop the
	// smallest legs until what's left can fit. (In practice this only triggers
	// for very fragmented inputs; the API collapses same-mode runs first.)
	let working = segs.slice();
	while (working.length * MIN_SEG > cols && working.length > 1) {
		const tiniest = working.reduce(
			(best, s, i) => (s.lengthM < working[best].lengthM ? i : best),
			0
		);
		working.splice(tiniest, 1);
	}
	const total = working.reduce((s, x) => s + Math.max(1, x.lengthM), 0);
	const counts = working.map((s) =>
		Math.max(MIN_SEG, Math.round((Math.max(1, s.lengthM) / total) * cols))
	);
	let sum = counts.reduce((a, b) => a + b, 0);
	// Shrink the longest until we fit; then grow the longest until we hit cols.
	while (sum > cols) {
		const idx = counts.indexOf(Math.max(...counts));
		if (counts[idx] <= MIN_SEG) break;
		counts[idx]--;
		sum--;
	}
	while (sum < cols) {
		const idx = counts.indexOf(Math.max(...counts));
		counts[idx]++;
		sum++;
	}
	const out = working
		.map((s, idx) => {
			const g = MODE_GLYPH[s.mode];
			const lineCh = g.segment.trim() === '' ? '·' : g.segment;
			const n = counts[idx];
			let part = g.tick + lineCh.repeat(Math.max(0, n - 1));
			if (idx === working.length - 1) part = part.slice(0, -1) + g.tick;
			return part;
		})
		.join('');
	// Last-line defence in case the math drifts; never overflow the grid.
	return out.length > cols ? out.slice(0, cols) : out;
}

// ───────────────────────────────────────────────────────────────────
// 2. Scale stack
// ───────────────────────────────────────────────────────────────────

const KG_PER_LPG = 43;

export type ScaleStack = {
	full: string;
	ghost: string;
	kgPerCell: number;
	cylinders: number;
};

export function scaleStack(annualCommuteKg: number, annualAllInKg: number): ScaleStack {
	const kgPerCell = Math.max(2, Math.round(annualCommuteKg / COLS));
	const fullCells = clamp(Math.round(annualCommuteKg / kgPerCell), 1, COLS);
	const extraKg = Math.max(0, annualAllInKg - annualCommuteKg);
	const extraCells = clamp(Math.round(extraKg / kgPerCell), 0, COLS);
	return {
		full: '█'.repeat(fullCells),
		ghost: '░'.repeat(extraCells),
		kgPerCell,
		cylinders: Math.max(1, Math.round(annualCommuteKg / KG_PER_LPG))
	};
}

// ───────────────────────────────────────────────────────────────────
// 3. Distribution bell
// ───────────────────────────────────────────────────────────────────

const BELL_GLYPHS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function makeBellHeights(cols: number, peak = 7): number[] {
	const center = (cols - 1) / 2;
	const spread = cols * 1.6;
	return Array.from({ length: cols }, (_, i) => {
		const h = peak * Math.exp(-((i - center) ** 2) / spread);
		return clamp(Math.round(h), 0, peak);
	});
}

export type DistributionBell = {
	bell: string;
	marker: string;
};

export function distributionBell(multiplier: number): DistributionBell {
	const heights = makeBellHeights(COLS);
	const bell = heights.map((h) => BELL_GLYPHS[h]).join('');
	// Map multiplier (≈1 = light, ≈5+ = heavy) to a column inside the bell body.
	const col = Math.round(clamp(lerp(multiplier || 1, 1, 5, 3, COLS - 4), 0, COLS - 1));
	const marker = ' '.repeat(col) + '▼';
	return { bell, marker };
}

// ───────────────────────────────────────────────────────────────────
// 4. Switch bars
// ───────────────────────────────────────────────────────────────────

export type SwitchBars = {
	now: string;
	switched: string;
	savedCells: number;
};

export function switchBars(nowKg: number, switchedKg: number): SwitchBars {
	const peak = Math.max(nowKg, switchedKg, 1);
	const nowCells = clamp(Math.round((nowKg / peak) * COLS), 0, COLS);
	const switchedFilled = clamp(Math.round((switchedKg / peak) * COLS), 0, COLS);
	const savedCells = Math.max(0, nowCells - switchedFilled);
	return {
		now: '█'.repeat(nowCells) + '░'.repeat(COLS - nowCells),
		switched: '█'.repeat(switchedFilled) + '░'.repeat(COLS - switchedFilled),
		savedCells
	};
}

// ───────────────────────────────────────────────────────────────────
// 5. Fingerprint patch
// ───────────────────────────────────────────────────────────────────

const PATCH_W = 18;
const PATCH_H = 7;

function hashString(s: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

function fingerprintRows(a: Answers): string[] {
	const seedKey = [
		a.mode ?? '_',
		a.frequency ?? '_',
		a.lifestyle ?? '_',
		a.decider ?? '_',
		a.funQuestionId ?? '_',
		a.funAnswer ?? '_'
	].join('|');
	const base = hashString(seedKey);
	const lifestyleBias =
		a.lifestyle === 'always_out' ? 0.4 : a.lifestyle === 'homebody' ? -0.25 : 0;
	const rows: string[] = [];
	for (let y = 0; y < PATCH_H; y++) {
		let row = '';
		for (let x = 0; x < PATCH_W; x++) {
			const cell = hashString(`${seedKey}|${x}|${y}|${base}`) / 0xffffffff;
			const v = clamp(cell + lifestyleBias, 0, 0.999);
			if (v < 0.3) row += ' ';
			else if (v < 0.56) row += '░';
			else if (v < 0.82) row += '▓';
			else row += '█';
		}
		rows.push(row);
	}
	return rows;
}

export function fingerprintPatch(a: Answers): string[] {
	const mode: Mode = a.mode ?? 'cab_solo';
	const border = MODE_BORDER[mode];
	const inner = fingerprintRows(a);
	if (!border) return inner.map((r) => ` ${r} `);
	const top = border.tl + border.h.repeat(PATCH_W + 2) + border.tr;
	const bot = border.bl + border.h.repeat(PATCH_W + 2) + border.br;
	const mid = inner.map((r) => `${border.v} ${r} ${border.v}`);
	return [top, ...mid, bot];
}

// ───────────────────────────────────────────────────────────────────
// Ad-libbed blurbs. Aman's voice: short, friendly, no em dashes.
// One or two sentences each. They observe, they don't lecture.
// ───────────────────────────────────────────────────────────────────

// Weekly km derived from frequency, for use inside route blurbs.
const FREQ_PER_WEEK: Record<Frequency, number> = {
	daily: 5,
	few_weekly: 3,
	weekly: 1,
	occasional: 0.5
};

export function routeBlurb(mode: Mode, frequency: Frequency, distanceKm: number): string {
	const weeklyKm = Math.round(distanceKm * 2 * FREQ_PER_WEEK[frequency]);
	if (mode === 'active') {
		return 'Walking or cycling this is as low as the per-trip number gets.';
	}
	if (mode === 'metro') {
		return `Metro covers most of the distance, which keeps the per-trip CO₂ low. That's about ${weeklyKm} km a week.`;
	}
	if (mode === 'bus') {
		return `The bus is one of the lowest-emission options at this distance. Roughly ${weeklyKm} km a week.`;
	}
	if (mode === 'cab_shared') {
		return `A pooled cab is about half the footprint of a solo one. Around ${weeklyKm} km a week.`;
	}
	if (mode === 'two_wheeler') {
		return `Two-wheelers sit between the bus and a car on emissions. That's about ${weeklyKm} km a week.`;
	}
	if ((mode === 'cab_solo' || mode === 'car') && frequency === 'daily') {
		return `A private vehicle every weekday is where most of the year's emissions come from. Around ${weeklyKm} km a week.`;
	}
	if (mode === 'auto') {
		return `Autos run around 110 g CO₂ per km. That works out to about ${weeklyKm} km a week here.`;
	}
	return `Around ${weeklyKm} km a week of road time.`;
}

export function scaleBlurb(
	annualCommuteKg: number,
	annualAllInKg: number,
	lifestyle: Lifestyle
): string {
	const extra = annualAllInKg - annualCommuteKg;
	if (lifestyle === 'always_out' && extra > annualCommuteKg) {
		return `The commute is the smaller part. The rest of your trips add another ${extra} kg.`;
	}
	if (extra > annualCommuteKg * 0.5) {
		return `The lighter blocks are everything else you travel for in a year, around ${extra} kg.`;
	}
	if (annualCommuteKg < 100) {
		return 'Lower than the average single-commute footprint for the city.';
	}
	if (annualCommuteKg > 800) {
		return 'On the higher end for a single commute pattern.';
	}
	return 'A full year of these trips, stacked together.';
}

export function distributionBlurb(multiplier: number, band: string, decider: Decider): string {
	if (!multiplier || multiplier <= 1.2) {
		return `You're on the lighter side for ${band} commuters.`;
	}
	if (multiplier < 2.5) {
		return `Roughly middle of the pack for ${band} commuters.`;
	}
	if (multiplier < 4) {
		return `On the heavier side for ${band} commuters.`;
	}
	if (decider === 'no_option') {
		return `Far end of the curve. No metro or bus reaches your route yet.`;
	}
	return `Far end of the curve for ${band} commuters.`;
}

export function switchBlurb(annualSavingKg: number, treeYearsEquivalent: number): string {
	if (annualSavingKg <= 0) {
		return 'No real saving available on this swap.';
	}
	if (annualSavingKg < 40) {
		return `About ${annualSavingKg} kg less every year.`;
	}
	const trees = treeYearsEquivalent > 0 ? ` Same as what ${treeYearsEquivalent} trees pull down in that time.` : '';
	return `${annualSavingKg} kg less every year.${trees}`;
}

export function fingerprintBlurb(archetypeName: string, _funId?: FunQuestionId, _funAnswer?: string): string {
	switch (archetypeName) {
		case 'The Lane-Splitter':
			return 'Two-wheelers cover ground fast and emit roughly a third of a private car.';
		case 'The Optimizer':
			return 'One of the lowest-emission commute patterns the city has.';
		case 'The Auto-Pilot':
			return 'Autos are usually a habit choice, not a cost or speed one.';
		case 'The Meter Runner':
			return 'Autos run around 110 g CO₂ per km. Half a private car, almost triple a bus.';
		case 'The Cruiser':
			return 'Solo cabs and private cars have the highest per-km footprint of the common modes.';
		case 'The Cab-and-Pray Commuter':
			return 'Solo cabs average about 150 g CO₂ per km.';
		case 'The Door-to-Door Spender':
			return 'Door-to-door cabs are the most expensive option in both rupees and CO₂.';
		case 'The Reluctant Rider':
			return 'Without a real alternative on this route, the footprint stays where it is.';
		default:
			return 'A pattern built from the answers you gave.';
	}
}
