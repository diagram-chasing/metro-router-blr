// Synthetic receipt builder for the permutation harness (scripts/receiptMatrix.ts)
// and the dev gallery (/dev/receipts). DOM-free and DB-free: it fabricates the
// Answers, the drawn-route geometry, the geo labels and the comparison-data state,
// then runs the real compute + view pipeline. No network, no sqlite.

import type {
	Answers,
	Decider,
	Frequency,
	FunQuestionId,
	Lifestyle,
	Mode,
	RouteGeometry,
	RouteSegmentGeo
} from '$lib/exhibit/types';
import type { CandidateKind, LegKind } from '$lib/exhibit/routeCandidates';
import type { GeoSnapshot } from '$lib/server/receiptStore';
import type { SwapSuggestion } from '$lib/utils/otp';
import {
	computeReceipt,
	buildReceiptView,
	subjectValence,
	type ComputedReceipt,
	type ReceiptView,
	type Distribution,
	type Histogram,
	type Valence
} from './receipt';

export type DataState = 'empty' | 'sparse' | 'populated';
export type PickedChoice = CandidateKind | 'none';

export type Combo = {
	usualMode: Mode;
	pickedKind: PickedChoice;
	distanceKm: number;
	tripName: string;
	frequency: Frequency;
	lifestyle: Lifestyle;
	decider: Decider;
	funQuestionId?: FunQuestionId;
	funAnswer?: string;
	dataState: DataState;
	seedId: string;
};

export type Case = {
	combo: Combo;
	answers: Answers;
	computed: ComputedReceipt;
	view: ReceiptView;
	valence: Valence;
};

// A fixed timestamp keeps the report deterministic across runs.
const CREATED_AT = Date.UTC(2026, 5, 22, 9, 30); // 2026-06-22 09:30 UTC

// A straight eastward line out of Majestic; legs are 2-point polylines along it, so
// a leg's great-circle length ≈ its (kmTo - kmFrom) span.
const ORIGIN: [number, number] = [77.5806, 12.9719];
const KM_PER_DEG_LNG = 111.32 * Math.cos((12.9719 * Math.PI) / 180);
const at = (km: number): [number, number] => [ORIGIN[0] + km / KM_PER_DEG_LNG, ORIGIN[1]];
const leg = (legKind: LegKind, from: number, to: number): RouteSegmentGeo => ({
	coords: [at(from), at(to)],
	legKind
});

// A drawn route for the map (Q3). Metro/bus get walk-access legs so the blended
// intensity dilutes the way a real multimodal trip does; the rest are single-leg.
function makeRoute(kind: CandidateKind, dist: number): RouteGeometry {
	if ((kind === 'metro' || kind === 'bus') && dist > 1.2) {
		const access = Math.min(0.5, dist * 0.15);
		return {
			chosenKind: kind,
			segments: [
				leg('walk', 0, access),
				leg(kind, access, dist - access),
				leg('walk', dist - access, dist)
			]
		};
	}
	return { chosenKind: kind, segments: [leg(kind, 0, dist)] };
}

const SAMPLE_SWAP: SwapSuggestion = {
	mode: 'SUBWAY',
	routeName: 'Purple',
	boardName: 'Majestic (Kempegowda)',
	access: { meters: 450, auto: false },
	egress: { meters: 700, auto: true },
	headwayMin: 5
};

function makeAnswers(c: Combo): Answers {
	const route = c.pickedKind === 'none' ? undefined : makeRoute(c.pickedKind, c.distanceKm);
	return {
		mode: c.usualMode,
		frequency: c.frequency,
		origin: ORIGIN,
		destination: at(c.distanceKm),
		distanceKm: c.distanceKm,
		chosenRouteId: c.pickedKind === 'none' ? undefined : c.pickedKind,
		route,
		lifestyle: c.lifestyle,
		decider: c.decider,
		funQuestionId: c.funQuestionId,
		funAnswer: c.funAnswer
	};
}

function makeGeo(c: Combo): GeoSnapshot {
	const route = c.pickedKind === 'none' ? undefined : makeRoute(c.pickedKind, c.distanceKm);
	// Collapse adjacent same-mode legs into a length breakdown, like the server does.
	let segments: GeoSnapshot['segments'];
	if (route) {
		segments = [];
		for (const s of route.segments) {
			const mode = legKindToModeLocal(s.legKind);
			const lengthM = Math.max(1, Math.round(spanKm(s) * 1000));
			const last = segments[segments.length - 1];
			if (last && last.mode === mode) last.lengthM += lengthM;
			else segments.push({ mode, lengthM });
		}
	} else {
		segments = [{ mode: c.usualMode, lengthM: Math.round(c.distanceKm * 1000) }];
	}
	return {
		originLabel: 'Majestic',
		destinationLabel: 'Whitefield',
		segments,
		swap: c.distanceKm >= 5 ? SAMPLE_SWAP : undefined
	};
}

const spanKm = (s: RouteSegmentGeo): number => {
	const [a, b] = s.coords;
	return Math.abs(b[0] - a[0]) * KM_PER_DEG_LNG;
};

function legKindToModeLocal(kind: LegKind): Mode {
	switch (kind) {
		case 'walk':
			return 'active';
		case 'bus':
			return 'bus';
		case 'metro':
			return 'metro';
		case 'auto':
			return 'auto';
		default:
			return 'car'; // the road / taxi leg is the merged car/cab mode
	}
}

// A spread of per-km intensities across the grey buckets, for the histogram.
const POP_PER_KM = [
	0, 0, 16, 18, 18, 22, 40, 40, 40, 55, 69, 72, 74, 74, 90, 110, 120, 120, 130, 172
];
// Same-band per-trip kg, for the distribution fallback.
const POP_TRIP_KG = [0.4, 0.6, 0.9, 1.1, 1.4, 1.4, 1.8, 2.1, 2.6, 3.2, 3.9, 4.8];

function makeData(
	state: DataState,
	mine: number,
	perTripKg: number
): { hist: Histogram | undefined; dist: Distribution | undefined } {
	if (state === 'empty') {
		return { hist: undefined, dist: undefined };
	}
	const below = POP_TRIP_KG.filter((v) => v < perTripKg).length;
	const dist: Distribution = {
		percentile: Math.round((below / POP_TRIP_KG.length) * 100),
		n: POP_TRIP_KG.length,
		values: POP_TRIP_KG
	};
	if (state === 'sparse') {
		return { hist: undefined, dist };
	}
	const hist: Histogram = { values: POP_PER_KM, mine: Math.round(mine * 10) / 10, n: POP_PER_KM.length };
	return { hist, dist };
}

/** Build one case end-to-end through the real compute + view pipeline. */
export function buildCase(c: Combo): Case {
	const answers = makeAnswers(c);
	const computed = computeReceipt(answers);
	const geo = makeGeo(c);
	const mine = computed.comparison.usual.gPerKm; // histogram marker = the habit
	const { hist, dist } = makeData(c.dataState, mine, computed.perTripKg);
	const view = buildReceiptView(computed, answers, geo, dist, hist, c.seedId, CREATED_AT);
	const valence = subjectValence(computed.trip.mode, computed.trip.decider);
	return { combo: c, answers, computed, view, valence };
}

// ── Dimension sets ──

export const USUAL_MODES: Mode[] = ['auto', 'car', 'two_wheeler', 'bus', 'metro'];
export const PICKED: PickedChoice[] = ['cab', 'auto', 'metro', 'bus', 'walk', 'none'];
export const FREQUENCIES: Frequency[] = ['daily', 'few_weekly', 'weekly', 'occasional'];
export const LIFESTYLES: Lifestyle[] = ['homebody', 'moderate', 'always_out'];
export const DECIDERS: Decider[] = ['speed', 'cost', 'comfort', 'habit', 'no_option'];
export const DATA_STATES: DataState[] = ['empty', 'sparse', 'populated'];
export const TRIPS: { name: string; km: number }[] = [
	{ name: 'very-short', km: 0.8 },
	{ name: 'short', km: 2 },
	{ name: 'medium', km: 6 },
	{ name: 'long', km: 18 }
];
export const FUN: { id?: FunQuestionId; ans?: string }[] = [
	{},
	{ id: 'walking', ans: 'delivered' },
	{ id: 'crowd_tolerance', ans: 'front' },
	{ id: 'last_mile', ans: 'auto' },
	{ id: 'last_mile', ans: 'walk' }
];
export const SEEDS = ['seed-a3f', 'seed-b7c', 'seed-c1e', 'seed-d9k'];
