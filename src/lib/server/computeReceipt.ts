// Receipt math. Emission factors come from $lib/exhibit/emissions.ts (sourced).
// The projection constants below (trips/year, lifestyle scaler, equivalences)
// are documented inline; the lifestyle scaler is the one acknowledged heuristic.

import {
	MODE_CO2E_G_PER_PKM,
	MODE_PM25_MG_PER_PKM,
	MODE_LABEL,
	firstLastMileKm
} from '$lib/exhibit/emissions';
import type {
	Answers,
	Decider,
	Frequency,
	FunQuestionId,
	Lifestyle,
	Mode
} from '$lib/exhibit/types';

// One-way trips per year for the visitor's single most-regular trip.
// A commute is there-and-back, so "daily" = 2 trips × ~240 working days = 480.
//   few_weekly ≈ 3 round trips/week × 48 weeks ≈ 288
//   weekly     ≈ 1 round trip/week  × 50 weeks = 100
//   occasional ≈ 1 round trip/month × 12       = 24
const TRIPS_PER_YEAR: Record<Frequency, number> = {
	daily: 480,
	few_weekly: 288,
	weekly: 100,
	occasional: 24
};

// Scales commute-only emissions up to all-of-life travel. Heuristic, not from a
// single source: commuting is roughly half to two-thirds of personal urban
// travel, so a homebody's total is a little above their commute and an
// always-out person's is well above it. Illustrative — flagged in the receipt.
const LIFESTYLE_MULTIPLIER: Record<Lifestyle, number> = {
	homebody: 1.2,
	moderate: 1.7,
	always_out: 2.6
};

// CO2 absorbed by one mature urban tree per year (kg). Common communication
// value (Arbor Day ~21.8 kg/yr). EPA's young-tree average is lower (~6 kg/yr);
// 21 is the "mature tree" figure and is labelled as such on the receipt.
const KG_CO2_PER_TREE_YEAR = 21;

// One 14.2 kg domestic LPG cylinder ≈ 42 kg CO2 when burnt (IPCC 2006 default).
// Used for the beat-7 "cooking-gas cylinders" equivalence.
const KG_CO2_PER_LPG_CYLINDER = 42;

// All eight modes we rank against (beat 3, "the 8 ways to move in this city").
const ALL_MODES: Mode[] = [
	'cab_solo',
	'car',
	'auto',
	'cab_shared',
	'metro',
	'two_wheeler',
	'bus',
	'active'
];

// Modeled corridor mode-share for a typical Bengaluru arterial (beat 4). These
// are an illustrative split, NOT measured counts for the visitor's exact road —
// the receipt flags the corridor numbers as a model. Shares must sum to 1.
const CORRIDOR_SHARE: Record<string, number> = {
	bus: 0.38,
	two_wheeler: 0.26,
	auto: 0.12,
	car: 0.12,
	cab: 0.07,
	metro: 0.05
};
const CORRIDOR_KEY_LABEL: Record<string, string> = {
	bus: 'bus',
	two_wheeler: '2wh',
	auto: 'auto',
	car: 'car',
	cab: 'cab',
	metro: 'metro'
};
// The CO2e g/pkm rate shown on each corridor row maps each display key back to a
// representative internal mode in MODE_CO2E_G_PER_PKM.
const CORRIDOR_KEY_MODE: Record<string, Mode> = {
	bus: 'bus',
	two_wheeler: 'two_wheeler',
	auto: 'auto',
	car: 'car',
	cab: 'cab_solo',
	metro: 'metro'
};

// Real-estate beat (10): a parked car occupies ~13 m² of street. ratePerM2 is an
// illustrative Bengaluru land value (~₹20k/sqft → ~₹2.15 lakh/m²), flagged in the
// fine print as a convention, not an appraisal.
const PARKING_AREA_M2 = 13;
const PARKING_RATE_PER_M2 = 215000;

// Map an internal mode to the corridor display key (cabs collapse; walk has no
// corridor row).
function corridorKeyFor(mode: Mode): string | null {
	if (mode === 'cab_solo' || mode === 'cab_shared') return 'cab';
	if (mode === 'active') return null;
	return mode;
}

// Rank of `value` among `values`, 1 = highest (dirtiest). Ties share the rank of
// the first value that beats them (strictly-greater count + 1).
function rankFromDirtiest(value: number, values: number[]): number {
	return values.filter((v) => v > value).length + 1;
}

// Small deterministic hash so the modeled corridor total is stable per receipt
// but varies between routes (FNV-1a).
function hashSeed(seed: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

// Headline pitch by decider (recommendation strategy).
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
	time_pressure:
		'On bad days the cab gets booked — that single panic move is the heaviest km of your week.',
	planning_slack: 'Keep it to one transfer max. The simpler the swap, the more likely it sticks.',
	crowd_tolerance:
		"Crowds don't faze you, so the only thing left is comfort — and the metro has AC.",
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

	// Per-trip emissions (their mode vs the best transit-led alternative)
	perTripKg: number; // CO2e, kg
	perTripPm25Mg: number; // PM2.5, mg
	bestComboPerTripKg: number; // CO2e, kg
	bestComboPerTripPm25Mg: number; // PM2.5, mg
	multiplier: number; // CO2 perTripKg / bestComboPerTripKg
	multiplierPhrase: string; // human ("about 3×")
	comboLabel: string; // the recommended alternative

	// Yearly CO2e (kg)
	tripsPerYear: number;
	annualCommuteKg: number; // perTripKg × tripsPerYear
	annualAllInKg: number; // annualCommuteKg × lifestyle scaler
	annualSwitchedKg: number;
	annualSavingKg: number;
	twoYearSavingKg: number;
	treeYearsEquivalent: number; // annualSavingKg / 21

	// Yearly PM2.5 (grams)
	annualCommutePm25G: number;
	annualAllInPm25G: number;
	annualSwitchedPm25G: number;
	annualSavingPm25G: number;

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

	// Beat 3 — where the visitor's mode sits among all 8 (1 = dirtiest)
	modeRank: {
		totalModes: number;
		carbonRankFromDirtiest: number;
		pm25RankFromDirtiest: number;
		isClean: boolean; // bus / metro / walk-cycle — the "roast spoiled" branch
		isTwoWheeler: boolean; // the carbon-clean / particulate-dirty trick branch
	};

	// Beat 4 — modeled corridor traffic (illustrative mode-share, not measured)
	corridor: {
		totalPerDay: number;
		rows: { key: string; label: string; countPerDay: number; gPerKm: number; isYou: boolean }[];
	};

	// Beat 7 — equivalences for the YEAR-TOTAL commute (not the saving)
	cylindersYear: number; // annualCommuteKg / 42
	treesYear: number; // annualCommuteKg / 21

	// Beat 8 — moving HALF the trips onto metro+auto (the spec swaps half, not all)
	halfSwap: {
		annualKg: number;
		annualPm25G: number;
		savedKg: number;
		savedPm25G: number;
		treesSaved: number;
	};

	// Beat 10 — the real estate a parked car sits on
	parking: {
		areaM2: number;
		ratePerM2: number;
		rupees: number;
		areaLabel: string;
	};

	distanceBand: string; // e.g. "6-10 km"
	personalNudge: string;
	disclaimer: string;
};

function round(n: number, digits = 0): number {
	const f = Math.pow(10, digits);
	return Math.round(n * f) / f;
}

export function distanceBand(km: number): string {
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

// Best realistic alternative for the same route: a short auto for the first/last
// mile + public transport for the trunk. The trunk uses a bus-and-metro blend
// (mirrors publicTransitFactor in aqiGrid.ts) rather than the metro alone, since
// the realistic transit option is a mix of the two. Very short trips just walk.
function bestCombo(distanceKm: number): {
	co2Kg: number;
	pm25Mg: number;
	comboLabel: string;
} {
	if (distanceKm < 2) {
		return { co2Kg: 0, pm25Mg: 0, comboLabel: 'a 15-min walk' };
	}
	const { firstMile, main, lastMile } = firstLastMileKm(distanceKm);
	const accessKm = firstMile + lastMile;
	const transitCo2 = (MODE_CO2E_G_PER_PKM.bus + MODE_CO2E_G_PER_PKM.metro) / 2;
	const transitPm25 = (MODE_PM25_MG_PER_PKM.bus + MODE_PM25_MG_PER_PKM.metro) / 2;
	const co2Kg = (accessKm * MODE_CO2E_G_PER_PKM.auto + main * transitCo2) / 1000;
	const pm25Mg = accessKm * MODE_PM25_MG_PER_PKM.auto + main * transitPm25;
	return { co2Kg, pm25Mg, comboLabel: 'public transport + a short auto' };
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

	// Per-trip
	const perTripKg = (distanceKm * MODE_CO2E_G_PER_PKM[mode]) / 1000;
	const perTripPm25Mg = distanceKm * MODE_PM25_MG_PER_PKM[mode];
	const combo = bestCombo(distanceKm);
	const multiplier = combo.co2Kg > 0 ? perTripKg / combo.co2Kg : 0;

	// Annual CO2e (kg)
	const annualCommuteKg = perTripKg * tripsPerYear;
	const annualAllInKg = annualCommuteKg * lifestyleMul;
	const annualSwitchedKg = combo.co2Kg * tripsPerYear;
	const annualSavingKg = Math.max(0, annualCommuteKg - annualSwitchedKg);
	const twoYearSavingKg = annualSavingKg * 2;
	const treeYearsEquivalent = annualSavingKg / KG_CO2_PER_TREE_YEAR;

	// Annual PM2.5 (grams = mg/trip × trips ÷ 1000)
	const annualCommutePm25G = (perTripPm25Mg * tripsPerYear) / 1000;
	const annualAllInPm25G = annualCommutePm25G * lifestyleMul;
	const annualSwitchedPm25G = (combo.pm25Mg * tripsPerYear) / 1000;
	const annualSavingPm25G = Math.max(0, annualCommutePm25G - annualSwitchedPm25G);

	const arch = archetypeFor(mode, decider);
	const subtitle = subtitleFor(a.funQuestionId, a.funAnswer);

	const personalNudge = a.funQuestionId
		? FRICTION_OVERLAY[a.funQuestionId]
		: 'One easy switch on the heaviest leg is the easiest place to start.';

	// Beat 3 — mode ranking among all 8 ways to move
	const carbonValues = ALL_MODES.map((m) => MODE_CO2E_G_PER_PKM[m]);
	const pm25Values = ALL_MODES.map((m) => MODE_PM25_MG_PER_PKM[m]);
	const carbonRankFromDirtiest = rankFromDirtiest(MODE_CO2E_G_PER_PKM[mode], carbonValues);
	const pm25RankFromDirtiest = rankFromDirtiest(MODE_PM25_MG_PER_PKM[mode], pm25Values);

	// Beat 4 — modeled corridor traffic
	const seed = hashSeed(`${a.originStation ?? a.origin ?? ''}|${a.destinationStation ?? a.destination ?? ''}|${round(distanceKm, 1)}`);
	const totalPerDay = 1150 + (seed % 351); // stable ~1,150–1,500 per route
	const youKey = corridorKeyFor(mode);
	const corridorRows = Object.keys(CORRIDOR_SHARE)
		.map((key) => ({
			key,
			label: CORRIDOR_KEY_LABEL[key],
			countPerDay: Math.round(totalPerDay * CORRIDOR_SHARE[key]),
			gPerKm: Math.round(MODE_CO2E_G_PER_PKM[CORRIDOR_KEY_MODE[key]]),
			isYou: key === youKey
		}))
		.sort((x, y) => y.gPerKm - x.gPerKm); // dirtiest first — bar length encodes g/km

	// Beat 7 — year-total equivalences
	const cylindersYear = annualCommuteKg / KG_CO2_PER_LPG_CYLINDER;
	const treesYear = annualCommuteKg / KG_CO2_PER_TREE_YEAR;

	// Beat 8 — move HALF the trips onto metro+auto
	const halfAnnualKg = 0.5 * annualCommuteKg + 0.5 * annualSwitchedKg;
	const halfAnnualPm25G = 0.5 * annualCommutePm25G + 0.5 * annualSwitchedPm25G;
	const halfSavedKg = Math.max(0, annualCommuteKg - halfAnnualKg);
	const halfSavedPm25G = Math.max(0, annualCommutePm25G - halfAnnualPm25G);

	// Beat 10 — parking footprint as real estate
	const parkingRupees = PARKING_AREA_M2 * PARKING_RATE_PER_M2;
	const parkingAreaLabel = a.destinationStation ?? a.originStation ?? 'this part of the city';

	const isClean = mode === 'bus' || mode === 'metro' || mode === 'active';

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
		perTripPm25Mg: round(perTripPm25Mg, 1),
		bestComboPerTripKg: round(combo.co2Kg, 2),
		bestComboPerTripPm25Mg: round(combo.pm25Mg, 1),
		multiplier: round(multiplier, 1),
		multiplierPhrase: multiplierPhrase(multiplier),
		comboLabel: combo.comboLabel,
		tripsPerYear,
		annualCommuteKg: round(annualCommuteKg, 0),
		annualAllInKg: round(annualAllInKg, 0),
		annualSwitchedKg: round(annualSwitchedKg, 0),
		annualSavingKg: round(annualSavingKg, 0),
		twoYearSavingKg: round(twoYearSavingKg, 0),
		treeYearsEquivalent: round(treeYearsEquivalent, 0),
		annualCommutePm25G: round(annualCommutePm25G, 1),
		annualAllInPm25G: round(annualAllInPm25G, 1),
		annualSwitchedPm25G: round(annualSwitchedPm25G, 1),
		annualSavingPm25G: round(annualSavingPm25G, 1),
		recommendation: {
			deciderHeadline: DECIDER_HEADLINE[decider],
			recommendedCombo: combo.comboLabel
		},
		archetype: {
			name: arch.name,
			subtitle: subtitle || arch.subtitle
		},
		modeRank: {
			totalModes: ALL_MODES.length,
			carbonRankFromDirtiest,
			pm25RankFromDirtiest,
			isClean,
			isTwoWheeler: mode === 'two_wheeler'
		},
		corridor: {
			totalPerDay,
			rows: corridorRows
		},
		cylindersYear: round(cylindersYear, 0),
		treesYear: round(treesYear, 0),
		halfSwap: {
			annualKg: round(halfAnnualKg, 0),
			annualPm25G: round(halfAnnualPm25G, 1),
			savedKg: round(halfSavedKg, 0),
			savedPm25G: round(halfSavedPm25G, 1),
			treesSaved: round(halfSavedKg / KG_CO2_PER_TREE_YEAR, 0)
		},
		parking: {
			areaM2: PARKING_AREA_M2,
			ratePerM2: PARKING_RATE_PER_M2,
			rupees: parkingRupees,
			areaLabel: parkingAreaLabel
		},
		distanceBand: distanceBand(distanceKm),
		personalNudge,
		disclaimer:
			'Estimates use India-specific operational (well-to-wheel) emission factors; actual figures vary with vehicle, occupancy and traffic.'
	};
}
