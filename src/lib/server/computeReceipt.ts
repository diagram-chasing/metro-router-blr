// Receipt math. All numbers here are PLACEHOLDERS per §8 of the spec —
// validate against real Bengaluru figures before going live.

import { MODE_FACTOR_G_PER_KM, MODE_LABEL } from '$lib/exhibit/emissions';
import type {
	Answers,
	Decider,
	Frequency,
	FunQuestionId,
	Lifestyle,
	Mode
} from '$lib/exhibit/types';

// trips per year, one-way (placeholder)
const TRIPS_PER_YEAR: Record<Frequency, number> = {
	daily: 480,
	few_weekly: 200,
	weekly: 100,
	occasional: 24
};

// lifestyle scaler from §5.3 (placeholder)
const LIFESTYLE_MULTIPLIER: Record<Lifestyle, number> = {
	homebody: 1.1,
	moderate: 1.6,
	always_out: 2.5
};

// Headline pitch by decider (recommendation strategy from §5.7)
const DECIDER_HEADLINE: Record<Decider, string> = {
	speed: 'The metro version is only a few minutes more — and you skip the traffic.',
	cost: 'Switching this trip would save real money every month.',
	comfort: 'AC the whole way, about the same time.',
	habit: 'Change one thing: just the longest leg.',
	no_option: "No good option today. When a line reaches you, here's what changes."
};

// Friction overlays per Q6 friction
const FRICTION_OVERLAY: Record<FunQuestionId, string> = {
	walking: 'A short auto stand-in for the walking legs keeps this realistic.',
	time_pressure: 'On bad days the cab gets booked — that single panic move is the heaviest km of your week.',
	planning_slack: 'Keep it to one transfer max. The simpler the swap, the more likely it sticks.',
	crowd_tolerance: 'Crowds don\'t faze you, so the only thing left is comfort — and the metro has AC.',
	boredom: 'Add up the dead time and you get hours back per week to read, podcast, or doze.'
};

const FREQUENCY_LABEL: Record<Frequency, string> = {
	daily: 'most days',
	few_weekly: 'a few times a week',
	weekly: 'about once a week',
	occasional: 'now and then'
};

const LIFESTYLE_LABEL: Record<Lifestyle, string> = {
	homebody: 'mostly home',
	moderate: 'moderately out',
	always_out: 'always on the move'
};

const DECIDER_LABEL: Record<Decider, string> = {
	speed: 'speed',
	cost: 'cost',
	comfort: 'comfort',
	habit: 'habit',
	no_option: 'no real alternative'
};

export type ComputedReceipt = {
	// Inputs echoed back in readable form
	trip: {
		mode: Mode;
		modeLabel: string;
		frequency: Frequency;
		frequencyLabel: string;
		distanceKm: number;
		originStation?: string;
		destinationStation?: string;
		lifestyle: Lifestyle;
		lifestyleLabel: string;
		decider: Decider;
		deciderLabel: string;
	};

	// Per-trip emissions
	perTripKg: number; // their mode
	bestComboPerTripKg: number; // best transit-led alternative for this route
	multiplier: number; // perTripKg / bestComboPerTripKg
	multiplierPhrase: string; // human ("about 3×")

	// Yearly
	tripsPerYear: number;
	annualCommuteKg: number; // perTripKg × tripsPerYear
	annualAllInKg: number; // annualCommuteKg × lifestyleScaler

	// If switched
	annualSwitchedKg: number;
	annualSavingKg: number;
	twoYearSavingKg: number;
	treeYearsEquivalent: number; // illustrative: 21 kg per tree-year

	// Recommendation
	recommendation: {
		deciderHeadline: string;
		recommendedCombo: string;
	};

	// Archetype
	archetype: {
		name: string;
		subtitle: string;
	};

	// Distance band string (e.g. "6-10 km")
	distanceBand: string;

	// One personal nudge line
	personalNudge: string;

	// Disclaimer — every number here is illustrative
	disclaimer: string;
};

function round(n: number, digits = 0): number {
	const f = Math.pow(10, digits);
	return Math.round(n * f) / f;
}

function distanceBand(km: number): string {
	if (km < 3) return '0-3 km';
	if (km < 6) return '3-6 km';
	if (km < 10) return '6-10 km';
	if (km < 15) return '10-15 km';
	if (km < 20) return '15-20 km';
	return '20+ km';
}

function multiplierPhrase(m: number): string {
	if (!isFinite(m) || m <= 1.2) return 'about the same';
	const rounded = Math.round(m);
	return `about ${rounded}×`;
}

// Best alternative for the same route: assume a short auto for first/last mile
// + metro for the middle. If the route is very short, walk + bus instead.
function bestComboPerTripKg(distanceKm: number): {
	totalKg: number;
	comboLabel: string;
} {
	if (distanceKm < 2) {
		// short trip — just walk
		return { totalKg: 0, comboLabel: 'a 15-min walk' };
	}
	const firstMileKm = Math.min(1.6, distanceKm * 0.2);
	const lastMileKm = Math.min(1.6, distanceKm * 0.2);
	const mainKm = Math.max(0, distanceKm - firstMileKm - lastMileKm);
	const grams =
		firstMileKm * MODE_FACTOR_G_PER_KM.auto +
		mainKm * MODE_FACTOR_G_PER_KM.metro +
		lastMileKm * MODE_FACTOR_G_PER_KM.auto;
	return { totalKg: grams / 1000, comboLabel: 'metro + a short auto' };
}

function archetypeFor(mode: Mode, decider: Decider): { name: string; subtitle: string } {
	const subtitleBase = '';
	if (mode === 'two_wheeler') {
		return { name: 'The Lane-Splitter', subtitle: subtitleBase };
	}
	if (mode === 'bus' || mode === 'metro' || mode === 'active') {
		return { name: 'The Quiet Optimizer', subtitle: subtitleBase };
	}
	if (mode === 'auto') {
		if (decider === 'habit') return { name: 'The Auto-Pilot', subtitle: subtitleBase };
		return { name: 'The Meter Runner', subtitle: subtitleBase };
	}
	// cab / car
	switch (decider) {
		case 'comfort':
			return { name: 'The Comfort Cruiser', subtitle: subtitleBase };
		case 'speed':
			return { name: 'The Cab-and-Pray Commuter', subtitle: subtitleBase };
		case 'cost':
			return { name: 'The Door-to-Door Spender', subtitle: subtitleBase };
		case 'no_option':
			return { name: 'The Reluctant Rider', subtitle: subtitleBase };
		default:
			return { name: 'The Comfort Cruiser', subtitle: subtitleBase };
	}
}

function subtitleFor(funId: FunQuestionId | undefined, funAnswer: string | undefined): string {
	if (!funId) return '';
	if (funId === 'crowd_tolerance' && funAnswer === 'front') return '…who can handle a crowd anyway';
	if (funId === 'planning_slack' && funAnswer === 'many') return '…always running, always booking';
	if (funId === 'boredom' && funAnswer === 'scroll') return '…with hours to reclaim';
	if (funId === 'walking' && funAnswer === 'delivered') return '…allergic to a five-minute walk';
	if (funId === 'time_pressure' && funAnswer === 'cab') return '…panic mode = open the cab app';
	return '';
}

export function computeReceipt(a: Answers): ComputedReceipt {
	const mode: Mode = a.mode ?? 'cab_solo';
	const frequency: Frequency = a.frequency ?? 'few_weekly';
	const lifestyle: Lifestyle = a.lifestyle ?? 'moderate';
	const decider: Decider = a.decider ?? 'habit';
	const distanceKm = a.distanceKm ?? 0;
	const tripsPerYear = TRIPS_PER_YEAR[frequency];
	const lifestyleMul = LIFESTYLE_MULTIPLIER[lifestyle];

	const perTripKg = (distanceKm * MODE_FACTOR_G_PER_KM[mode]) / 1000;
	const { totalKg: bestKg, comboLabel } = bestComboPerTripKg(distanceKm);
	const multiplier = bestKg > 0 ? perTripKg / bestKg : 0;

	const annualCommuteKg = perTripKg * tripsPerYear;
	const annualAllInKg = annualCommuteKg * lifestyleMul;
	const annualSwitchedKg = bestKg * tripsPerYear;
	const annualSavingKg = Math.max(0, annualCommuteKg - annualSwitchedKg);
	const twoYearSavingKg = annualSavingKg * 2;
	const treeYearsEquivalent = annualSavingKg / 21;

	const arch = archetypeFor(mode, decider);
	const subtitle = subtitleFor(a.funQuestionId, a.funAnswer);

	const personalNudge = a.funQuestionId
		? FRICTION_OVERLAY[a.funQuestionId]
		: 'One easy switch on the heaviest leg is the easiest place to start.';

	return {
		trip: {
			mode,
			modeLabel: MODE_LABEL[mode],
			frequency,
			frequencyLabel: FREQUENCY_LABEL[frequency],
			distanceKm: round(distanceKm, 2),
			originStation: a.originStation,
			destinationStation: a.destinationStation,
			lifestyle,
			lifestyleLabel: LIFESTYLE_LABEL[lifestyle],
			decider,
			deciderLabel: DECIDER_LABEL[decider]
		},
		perTripKg: round(perTripKg, 2),
		bestComboPerTripKg: round(bestKg, 2),
		multiplier: round(multiplier, 1),
		multiplierPhrase: multiplierPhrase(multiplier),
		tripsPerYear,
		annualCommuteKg: round(annualCommuteKg, 0),
		annualAllInKg: round(annualAllInKg, 0),
		annualSwitchedKg: round(annualSwitchedKg, 0),
		annualSavingKg: round(annualSavingKg, 0),
		twoYearSavingKg: round(twoYearSavingKg, 0),
		treeYearsEquivalent: round(treeYearsEquivalent, 0),
		recommendation: {
			deciderHeadline: DECIDER_HEADLINE[decider],
			recommendedCombo: comboLabel
		},
		archetype: {
			name: arch.name,
			subtitle: subtitle || arch.subtitle
		},
		distanceBand: distanceBand(distanceKm),
		personalNudge,
		disclaimer: 'Every figure on this receipt is illustrative — for the exhibit.'
	};
}
