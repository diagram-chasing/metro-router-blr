import {
	MODE_CO2E_G_PER_PKM,
	MODE_PM25_MG_PER_PKM,
	MODE_LABEL,
	firstLastMileKm
} from '$lib/exhibit/emissions';
import { legKindToMode } from '$lib/exhibit/grey';
import type { Answers, Decider, Frequency, FunQuestionId, Lifestyle, Mode } from '$lib/exhibit/types';
import type { GeoSnapshot } from '$lib/server/receiptStore';

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

export type Distribution = { percentile: number; n: number; values: number[] };
export type Histogram = { values: number[]; mine: number; n: number };

export type RouteSeg = { mode: Mode; lengthM: number };
// A drawn leg + its CO₂ intensity, for the route-signature minimap.
export type RouteGeoLeg = { coords: [number, number][]; gPerKm: number };

export type ReceiptView = {
	meta: { visitorNo: string; dateLabel: string; timeLabel: string };
	item: {
		origin: string;
		dest: string;
		modeLabel: string;
		freqLabel: string;
		distanceKm: number;
		tripsPerYear: number;
	};
	route: {
		origin: string;
		dest: string;
		distanceKm: number;
		segments: RouteSeg[];
		geo: RouteGeoLeg[]; // drawn per-leg geometry; empty when no route was traced
	};
	modeRank: {
		copy: string;
		histogram: { values: number[]; mine: number } | null; // per-km spread of all so far + you
		cleanerNote: string | null;
	};
	corridor: {
		totalPerDay: number;
		rows: ComputedReceipt['corridor']['rows'];
		copy: string;
	};
	oneTrip: { co2G: number; pm25Mg: number };
	year: { co2Kg: number; pm25G: number; kgPerBlock: number; copy: string; isClean: boolean };
	units: { cylinders: number; trees: number; copy: string; isClean: boolean };
	swap: {
		show: boolean;
		nowKg: number;
		swapKg: number;
		savedKg: number;
		nowPm25G: number;
		swapPm25G: number;
		savedPm25G: number;
		treesSaved: number;
		copy: string;
	};
	archetype: {
		name: string;
		subtitle: string;
		stampSeed: string;
		copy: string;
		basis: string; // plain-language reason this profile was assigned
		// Chladni "resonance" figure: n from per-km dirtiness, m from annual burden,
		// darkness (0..1) the overall ink — dirtier commutes print a darker seal.
		figure: { n: number; m: number; darkness: number };
	};
	counter: { cityCount: number | null };
	parking: { areaM2: number; valueLabel: string; copy: string };
	finePrint: { psCopy: string; disclaimer: string; barcodeSeed: string };
};

// ── Constants ──

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
// Daily vehicle count for the modeled corridor: stable per route (seeded), in a
// ~1,150–1,500 band.
const CORRIDOR_TOTAL_MIN = 1150;
const CORRIDOR_TOTAL_SPAN = 351;

// Real-estate beat (10): a parked car occupies ~13 m² of street. ratePerM2 is an
// illustrative Bengaluru land value (~₹20k/sqft → ~₹2.15 lakh/m²), flagged in the
// fine print as a convention, not an appraisal.
const PARKING_AREA_M2 = 13;
const PARKING_RATE_PER_M2 = 215000;

// Below this annual figure (kg CO2e) the "year" and "units" beats switch to their
// empty-grid / no-unit clean branch — walk/cycle and the lightest trips.
const CLEAN_YEAR_KG = 25;
const KG_PER_BLOCK = 10;

// Profile seal (Chladni figure): n tracks per-km dirtiness, m the annual burden,
// both mapped onto the band [min, min+range] = 2..8; darkness blends the two.
const SEAL = {
	modeMin: 2,
	modeRange: 6,
	annualNormKg: 800, // annual kg that saturates the m axis
	perKmWeight: 0.6, // darkness = 0.6·per-km + 0.4·annual
	annualWeight: 0.4
};

// ── Copy ──

// Headline pitch by decider (recommendation strategy).
const DECIDER_HEADLINE: Record<Decider, string> = {
	speed: 'The metro version is only a few minutes more — and you skip the traffic.',
	cost: 'Switching this trip would save real money every month.',
	comfort: 'AC the whole way, about the same time.',
	habit: 'Change one thing: just the longest leg.',
	no_option: "No good option today. When a line reaches you, here's what changes."
};

// Friction overlays per Q6 friction (the "personal nudge").
const FRICTION_OVERLAY: Record<FunQuestionId, string> = {
	walking: 'A short auto stand-in for the walking legs keeps this realistic.',
	planning_slack: 'Keep it to one transfer max. The simpler the swap, the more likely it sticks.',
	crowd_tolerance:
		"Crowds don't faze you, so the only thing left is comfort — and the metro has AC.",
	boredom: 'Add up the dead time and you get hours back per week to read, podcast, or doze.'
};
const PERSONAL_NUDGE_FALLBACK = 'One easy switch on the heaviest leg is the easiest place to start.';

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

// The "you told us …" premise for the swap beat, drawn from the Q6 friction answer.
const PREMISE: Record<FunQuestionId, string> = {
	walking: "you'd happily walk for a good coffee",
	planning_slack: 'you cut it fine most mornings',
	crowd_tolerance: "crowds don't faze you",
	boredom: 'your commute is mostly dead time'
};

const DISCLAIMER =
	'Estimates use India-specific operational (well-to-wheel) emission factors; actual figures vary with vehicle, occupancy and traffic.';

function multiplierPhrase(m: number): string {
	if (!isFinite(m) || m <= 1.2) return 'about the same';
	const rounded = Math.round(m);
	return `about ${rounded}×`;
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
	return '';
}

function modeRankCopy(c: ComputedReceipt, id: string): string {
	const { modeLabel } = c.trip;
	const lc = modeLabel.toLowerCase();
	if (c.modeRank.isClean) {
		return pick(id, 'mode-clean', [
			`You travel by ${lc}. You're in the cleanest tenth. We had a roast written. You've spoiled it.`,
			`You travel by ${lc}. Cleanest tenth in the city — we sharpened a verdict for nothing.`,
			`${modeLabel}, most days. Top tenth for clean. The receipt was meant to sting; it doesn't.`,
			`You travel by ${lc}. We had a whole paragraph of judgement queued. Deleted — you're in the cleanest tenth.`,
			`${modeLabel}. The cleanest tenth of the city moves like you. Annoyingly virtuous.`,
			`You travel by ${lc}. The machine was hoping for worse. Cleanest tenth, instead.`,
			`You travel by ${lc}. We print these to make a point. Yours quietly undercuts it.`
		]);
	}
	if (c.modeRank.isTwoWheeler) {
		return pick(id, 'mode-2w', [
			`You travel by two-wheeler, which is a trick question. Near the cleanest on carbon, near the dirtiest on the particulate you breathe. Two ranks. Pick one.`,
			`Two-wheeler. Clean on carbon, filthy on the PM2.5 in your lungs. The plot twist rides with you.`,
			`You're on a two-wheeler. The atmosphere thanks you; your lungs file a complaint.`,
			`Two-wheeler: a clean-carbon, dirty-air compromise in a helmet. Two scores, no winner.`,
			`You travel by two-wheeler. Light on CO₂, heavy on what you inhale. Same vehicle, opposite verdicts.`,
			`Two-wheeler. You spared the sky and taxed your own breathing. Bold trade.`,
			`You ride a two-wheeler — the asterisk of clean travel. Good for carbon, rough on the particulate.`
		]);
	}
	const ord = ordinal(c.modeRank.carbonRankFromDirtiest);
	const tot = c.modeRank.totalModes;
	return pick(id, 'mode-dirty', [
		`You travel by ${lc}. Per kilometre that's the ${ord} dirtiest of the ${tot} ways to move in this city.`,
		`${modeLabel}. Per km, the ${ord} dirtiest of ${tot} ways this city gets around. Congratulations are not in order :/`,
		`You move by ${lc}, which is ${ord} dirtiest per km of ${tot} options.`,
		`${modeLabel}, per kilometre, ranks ${ord} dirtiest of ${tot}. Yer a cigarrete salesman, Harry.`,
		`Of the ${tot} ways to cross this city, ${lc} is the ${ord} dirtiest per km. Come on man.`,
		`Per km, ${lc} is the ${ord} dirtiest of ${tot} here. We're not judging but...eh.`,
		`You travel by ${lc}: ${ord} dirtiest per km among ${tot} modes. Many cleaner options declined.`
	]);
}

// A tight 2-line factual deck. The daily total is shown in the section eyebrow, so
// the deck never repeats it — it carries the same-road comparison instead.
function corridorCopy(c: ComputedReceipt): string {
	const rows = c.corridor.rows;
	const bus = rows.find((r) => r.key === 'bus');
	const you = rows.find((r) => r.isYou);
	const cabG = rows.find((r) => r.key === 'cab')?.gPerKm ?? 0;
	if (!you) {
		return `You skip the road entirely. The cabs on it still pay ${cabG} g/km.`;
	}
	if (c.modeRank.isClean) {
		return `You ride the ${you.label} at ${you.gPerKm} g/km — the cheap seats, environmentally. Cabs pay ${cabG}.`;
	}
	return `The bus does it at ${bus?.gPerKm ?? 18} g/km. You did ${you.gPerKm}  g/km.`;
}

function swapCopy(c: ComputedReceipt, a: Answers, id: string): string {
	if (c.halfSwap.savedKg <= 0) {
		return pick(id, 'swap-none', [
			`Nothing to swap. You're already the cleaner option someone else should be switching to.`,
			`No swap to suggest. You're the benchmark other receipts get measured against.`,
			`Nothing to trade down to. You're already where we'd send everyone else.`,
			`We'd suggest a greener option, but you're it.`,
			`No downgrade available — you're the clean default the rest should copy.`,
			`Skip the swap. You're the version of this commute we wish more people chose.`,
			`Nothing to swap. The advice section is quietly jealous of you.`
		]);
	}
	const premise = a.funQuestionId ? PREMISE[a.funQuestionId] : 'comfort is what you optimise for';
	return `You told us ${premise}, so a short walk isn't the imposition you're treating it as. Move half your trips onto the metro with a short auto at each end and the year drops to about ${comma(
		c.halfSwap.annualKg
	)} kg. You keep ${comma(c.halfSwap.savedKg)} kg out of the air — roughly ${comma(
		c.halfSwap.treesSaved
	)} trees' worth.`;
}

function psCopy(c: ComputedReceipt, areaLabel: string): string {
	const mode = c.trip.mode;
	const rupees = rupeesLakh(c.parking.rupees);
	const where = `${c.parking.areaM2} m² of the city`;
	if (mode === 'car' || mode === 'two_wheeler') {
		return `PS: It isn't only the air. Your parked vehicle sits on about ${where}. At ${areaLabel} rates that's roughly ${rupees} of real estate. Prime real-estate for free! Paid for by everyone who isn't parked on it.`;
	}
	if (mode === 'cab_solo' || mode === 'cab_shared') {
		return `PS: it isn't only the air. The cab you took still parks somewhere — about ${where}, roughly ${rupees} of ${areaLabel} sitting idle between fares.`;
	}
	return `PS: It isn't only the air. You parked nothing today. The car beside you sits on about ${where} — roughly ${rupees} of ${areaLabel}, used for free.`;
}

// A short, branch-aware deck for the parking real-estate graphic (numbers live in
// the footprint box + panel, so the prose stays out of their way).
function parkingCopy(c: ComputedReceipt): string {
	const mode = c.trip.mode;
	if (mode === 'car' || mode === 'two_wheeler')
		return 'Your parked car squats on public street it never pays rent for.';
	if (mode === 'cab_solo' || mode === 'cab_shared')
		return 'The cab you rode still parks somewhere — idle, rent-free, between fares.';
	return 'You parked nothing today. The car beside you sits free — on land you help pay for.';
}

// ── Helpers ──

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

// Rank of `value` among `values`, 1 = highest (dirtiest). Ties share the rank of
// the first value that beats them (strictly-greater count + 1).
function rankFromDirtiest(value: number, values: number[]): number {
	return values.filter((v) => v > value).length + 1;
}

// Map an internal mode to the corridor display key (cabs collapse; walk has no
// corridor row).
function corridorKeyFor(mode: Mode): string | null {
	if (mode === 'cab_solo' || mode === 'cab_shared') return 'cab';
	if (mode === 'active') return null;
	return mode;
}

// Small deterministic hash (FNV-1a) so the modeled corridor total is stable per
// receipt but varies between routes.
function hashSeed(seed: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i++) {
		h ^= seed.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

function ordinal(n: number): string {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function comma(n: number): string {
	return Math.round(n).toLocaleString('en-IN');
}

// Deterministic editorial variation: pick one line from a pool using the receipt
// id + a per-beat salt. Every visitor — even one with identical answers — gets a
// different turn of phrase, and it stays stable across re-renders of the same id.
function pick(id: string, salt: string, pool: string[]): string {
	let h = 2166136261 >>> 0;
	const s = `${id}::${salt}`;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return pool[(h >>> 0) % pool.length];
}

function rupeesLakh(r: number): string {
	const lakh = r / 100000;
	if (lakh >= 100) return `₹${(lakh / 100).toFixed(1)} crore`;
	return `₹${Math.round(lakh)} lakh`;
}

// Best realistic alternative for the same route: a short auto for the first/last
// mile + public transport for the trunk. The trunk uses a bus-and-metro blend
// (mirrors publicTransitFactor in aqiGrid.ts) rather than the metro alone, since
// the realistic transit option is a mix of the two. Very short trips just walk.
function bestCombo(distanceKm: number): { co2Kg: number; pm25Mg: number; comboLabel: string } {
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

	const personalNudge = a.funQuestionId ? FRICTION_OVERLAY[a.funQuestionId] : PERSONAL_NUDGE_FALLBACK;

	// Beat 3 — mode ranking among all 8 ways to move
	const carbonValues = ALL_MODES.map((m) => MODE_CO2E_G_PER_PKM[m]);
	const pm25Values = ALL_MODES.map((m) => MODE_PM25_MG_PER_PKM[m]);
	const carbonRankFromDirtiest = rankFromDirtiest(MODE_CO2E_G_PER_PKM[mode], carbonValues);
	const pm25RankFromDirtiest = rankFromDirtiest(MODE_PM25_MG_PER_PKM[mode], pm25Values);

	// Beat 4 — modeled corridor traffic
	const seed = hashSeed(`${a.originStation ?? a.origin ?? ''}|${a.destinationStation ?? a.destination ?? ''}|${round(distanceKm, 1)}`);
	const totalPerDay = CORRIDOR_TOTAL_MIN + (seed % CORRIDOR_TOTAL_SPAN);
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
		disclaimer: DISCLAIMER
	};
}

export function buildReceiptView(
	c: ComputedReceipt,
	a: Answers,
	geo: GeoSnapshot | undefined,
	dist: Distribution | undefined,
	hist: Histogram | undefined,
	cityCount: number | null,
	id: string,
	createdAt: number
): ReceiptView {
	const origin = geo?.originLabel ?? c.trip.originStation ?? 'Origin';
	const dest = geo?.destinationLabel ?? c.trip.destinationStation ?? 'Destination';
	const segments: RouteSeg[] =
		geo?.segments && geo.segments.length
			? geo.segments
			: [{ mode: c.trip.mode, lengthM: Math.round(c.trip.distanceKm * 1000) }];

	const d = new Date(createdAt);
	const dateLabel = d
		.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
		.toUpperCase();
	const timeLabel = d.toLocaleTimeString('en-IN', {
		hour: '2-digit',
		minute: '2-digit',
		hour12: true
	});
	const visitorNo = (id.split('-')[1] ?? id).padStart(4, '0').slice(-4).toUpperCase();

	// "Cleaner than you" prefers the per-km histogram of everyone so far, falling back
	// to the same-band distribution if the histogram is too sparse to show.
	let cleanerPct: number | null = null;
	if (hist && hist.values.length) {
		cleanerPct = Math.round((hist.values.filter((v) => v < hist.mine).length / hist.values.length) * 100);
	} else if (dist) {
		cleanerPct = dist.percentile;
	}
	const cleanerNote =
		cleanerPct != null && !c.modeRank.isClean
			? `About ${Math.round(cleanerPct / 10)} in 10 commuters so far travel cleaner than you.`
			: null;

	const areaLabel = geo?.destinationLabel ?? geo?.originLabel ?? c.parking.areaLabel;
	const yearClean = c.annualCommuteKg < CLEAN_YEAR_KG;

	// Emissions "resonance": the profile seal is a Chladni standing-wave figure.
	// n (a low→high mode) tracks how dirty the trip is per km; m tracks the total
	// annual burden. Clean, light commutes ring calm figures; heavy ones get busy,
	// agitated ones — the pattern *is* the pollution, not decoration.
	const co2Vals = Object.values(MODE_CO2E_G_PER_PKM);
	const cMin = Math.min(...co2Vals);
	const cMax = Math.max(...co2Vals);
	const co2PerKm = MODE_CO2E_G_PER_PKM[c.trip.mode] ?? 0;
	const nNorm = cMax > cMin ? (co2PerKm - cMin) / (cMax - cMin) : 0;
	let figN = SEAL.modeMin + Math.round(nNorm * SEAL.modeRange); // 2..8
	const mNorm = Math.min(1, Math.sqrt(c.annualCommuteKg / SEAL.annualNormKg));
	let figM = SEAL.modeMin + Math.round(mNorm * SEAL.modeRange); // 2..8
	if (figN === figM) figM = figM < 8 ? figM + 1 : figM - 1; // n==m → blank plate
	// Overall seal darkness: mostly per-km dirtiness, with annual burden adding weight.
	const dirtiness = Math.max(0, Math.min(1, SEAL.perKmWeight * nNorm + SEAL.annualWeight * mNorm));

	return {
		meta: { visitorNo, dateLabel, timeLabel },
		item: {
			origin,
			dest,
			modeLabel: c.trip.modeLabel,
			freqLabel: c.trip.frequencyLabel,
			distanceKm: c.trip.distanceKm,
			tripsPerYear: c.tripsPerYear
		},
		route: {
			origin,
			dest,
			distanceKm: c.trip.distanceKm,
			segments,
			geo: (a.route?.segments ?? []).map((s) => ({
				coords: s.coords,
				gPerKm: MODE_CO2E_G_PER_PKM[legKindToMode(s.legKind)]
			}))
		},
		modeRank: {
			copy: modeRankCopy(c, id),
			histogram: hist ? { values: hist.values, mine: hist.mine } : null,
			cleanerNote
		},
		corridor: {
			totalPerDay: c.corridor.totalPerDay,
			rows: c.corridor.rows,
			copy: corridorCopy(c)
		},
		oneTrip: { co2G: Math.round(c.perTripKg * 1000), pm25Mg: Math.round(c.perTripPm25Mg) },
		year: {
			co2Kg: c.annualCommuteKg,
			pm25G: c.annualCommutePm25G,
			kgPerBlock: KG_PER_BLOCK,
			isClean: yearClean,
			copy: yearClean
				? pick(id, 'year-clean', [
					'Barely a mark. The grid stays empty.',
					'Hardly a smudge. The grid barely notices you.',
					'Almost nothing to plot — the blocks stay hollow.',
					"A rounding error, in the city's favour.",
					'Too little to fill a single block. Good.',
					"The tally can't find enough to draw. Keep it that way.",
					'Negligible. We left the grid blank on purpose.'
				])
				: ''
		},
		units: {
			cylinders: c.cylindersYear,
			trees: c.treesYear,
			isClean: yearClean,
			copy: yearClean
				? pick(id, 'units-clean', [
					"Not enough to need one. We keep a unit ready; you didn't fill it.",
					'Too little to convert into anything. The conversion table shrugs.',
					"No cylinders, no trees — there's nothing to translate.",
					'Below the threshold for a single unit. Pleasantly anticlimactic.',
					"The equivalents all come out zero. Nothing to make tangible.",
					"Not enough to picture. We tried; the icons came up empty.",
					"Doesn't add up to one of anything. That's the point."
				])
				: ''
		},
		swap: {
			show: c.halfSwap.savedKg > 0,
			nowKg: c.annualCommuteKg,
			swapKg: c.halfSwap.annualKg,
			savedKg: c.halfSwap.savedKg,
			nowPm25G: c.annualCommutePm25G,
			swapPm25G: c.halfSwap.annualPm25G,
			savedPm25G: c.halfSwap.savedPm25G,
			treesSaved: c.halfSwap.treesSaved,
			copy: swapCopy(c, a, id)
		},
		archetype: {
			name: c.archetype.name.toUpperCase(),
			subtitle: c.archetype.subtitle,
			stampSeed: `${a.mode}|${a.frequency}|${a.lifestyle}|${a.decider}|${a.funAnswer ?? ''}`,
			copy: 'Generated from your four answers. No two are alike.',
			basis: `Assigned from your mode (${c.trip.modeLabel.toLowerCase()}) and why you ride it — ${c.trip.deciderLabel}.`,
			figure: { n: figN, m: figM, darkness: dirtiness }
		},
		counter: { cityCount },
		parking: {
			areaM2: c.parking.areaM2,
			valueLabel: rupeesLakh(c.parking.rupees),
			copy: parkingCopy(c)
		},
		finePrint: {
			psCopy: psCopy(c, areaLabel),
			disclaimer: c.disclaimer,
			barcodeSeed: id
		}
	};
}
