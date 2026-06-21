import { MODE_CO2E_G_PER_PKM, MODE_LABEL, firstLastMileKm } from '$lib/exhibit/emissions';
import { legKindToMode } from '$lib/exhibit/grey';
import type { Answers, Decider, Frequency, FunQuestionId, Lifestyle, Mode } from '$lib/exhibit/types';
import type { GeoSnapshot } from '$lib/server/receiptStore';
import { assignArchetype, archetypeBasis } from './archetype';

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
	bestComboPerTripKg: number; // CO2e, kg
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
		isClean: boolean; // bus / metro / walk-cycle — the "roast spoiled" branch
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
		savedKg: number;
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
	oneTrip: { co2G: number };
	year: { co2Kg: number; kgPerBlock: number; copy: string; isClean: boolean };
	units: { cylinders: number; trees: number; copy: string; isClean: boolean };
	swap: {
		show: boolean;
		nowKg: number;
		swapKg: number;
		savedKg: number;
		treesSaved: number;
		copy: string;
		// Concrete greener options within walking distance of the start, one
		// formatted line each ([] when no nearby-transit data is available).
		ideas: string[];
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

// {token} → value. Pools stay pure data, bound late, so editing them stays safe.
export function interp(s: string, vars: Record<string, string>): string {
	return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// A line is opener (frames the beat, names the mode) + verdict (the numbers) +
// tail (a universal deflation). Every tail reads after any verdict, so the pools
// multiply freely and every combination stays grammatical and in-tone.
const OPENERS = [
	'{lc}, then.',
	'{lc}, i see.',
	'you travel by {lc}.',
	'you, the {lc}, the whole way.',
	'let the record show: {lc}.',
	'so. {lc}.'
];

const TAILS = [
	'but anyway.',
	// 'noted, reluctantly.',
	"i wouldn't dwell on it.",
	'do with that what you will.',
	'i checked twice.',
	"i'd hoped to be wrong.",
	"that's where we are.",
	'but moving on.',
	'it is what it is, i guess.',
	// "i just work here,",
	'make of it what you like.',
	// "there. now we both know.",
	// 'that is all i have.',
	'',
	'',
	''
];

const tail = (id: string, salt: string) => pick(id, salt, TAILS);

// ── Recommendation · decider headline ──
const DECIDER_POOLS: Record<Decider, string[]> = {
	speed: [
		'the metro version is a few minutes longer and skips the part where you sit still behind a bus, reconsidering things.',
		'metro is barely slower here, and nothing on it idles in traffic. you keep those minutes, though.'
	],
	cost: [
		"switching this trip saves big money every month. i won't itemise it; you'd be shocked.",
		"the cheaper version exists and you're not taking it.",
		'this swap pays you back every month. just so you know.'
	],
	comfort: [
		'ac the whole way, about the same time. i do not know what else you want from me.',
		'the comfortable option is also the clean one here. rare. take it.',
		'same time, air-conditioned, fewer decisions. that is the pitch. that is all i have.'
	],
	habit: [
		'change one thing. the longest leg. that is the whole ask.',
		'you do not have to overhaul anything — swap the heaviest leg and stop there.',
		'one leg. the big one. leave the rest of your routine alone.'
	],
	no_option: [
		'no good option today, honestly. when a line reaches you, this is what changes.',
		"there isn't a clean version of this yet. when the network catches up, here is the difference.",
		'fair enough — nothing better exists for you right now. file this for when it does.'
	]
};

function deciderHeadline(decider: Decider, id: string): string {
	return pick(id, 'decider', DECIDER_POOLS[decider]);
}

// ── Personal nudge · friction overlay ──
const FRICTION_POOLS: Record<FunQuestionId, string[]> = {
	walking: [
		'a short auto covers the walking legs, so the swap is realistic. you keep your feet dry.',
		'the walking bits become a quick auto. nobody is asking you to hike.'
	],
	planning_slack: [
		"keep it to one transfer. the simpler the swap, the more it sticks. i've seen the alternative.",
		'one transfer, maximum. complexity is where these plans go to die.'
	],
	crowd_tolerance: [
		'crowds do not bother you, you said, so the only thing left to want is comfort. the metro has ac.',
		'you can handle a crowd, so this comes down to comfort, and the ac side wins.'
	],
	boredom: [
		'add up the dead time and it is hours a week. on the metro that idle time becomes yours again.',
		'that idle time becomes yours again. hours of it. do nothing with them, ideally.'
	]
};

const NUDGE_FALLBACK = [
	'one switch on the heaviest leg is the easiest place to start. start there.',
	'swap the worst leg first. the rest can wait, or not happen.'
];

function frictionNudge(funId: FunQuestionId | undefined, id: string): string {
	return funId ? pick(id, 'friction', FRICTION_POOLS[funId]) : pick(id, 'friction', NUDGE_FALLBACK);
}

// ── "Cleaner than you" note ──
const CLEANER_NOTE = [
	'about {x} in 10 commuters so far come in cleaner than you.',
	'roughly {x} of every 10 logged here travel cleaner. you are not among them.',
	'{x} in 10 so far beat you on this.'
];

function cleanerNoteCopy(tenths: number, id: string): string {
	return interp(pick(id, 'cleaner', CLEANER_NOTE), { x: String(tenths) });
}

// ── Clean-branch year / units (nothing to show) ──
const YEAR_CLEAN = [
	'barely a mark. this grid stays empty.',
	'hardly a smudge. this grid does not notice you.',
	"a rounding error, in the city's favour.",
	'the tally cannot be drawn. let\'s keep it that way.',
	'negligible. i left this grid blank on purpose.'
];

const UNITS_CLEAN = [
	"not enough to need a unit. i usually keep one ready; you didn't fill it.",
	'too little to convert into anything. shrugs. that\'s good though.',
	'no cylinders, no trees. nothing to translate.',
	'below the threshold for a single unit. pleasantly anticlimactic.',
	'the equivalents all come out zero. nothing to make tangible.',
	"doesn't add up to one of anything. a most excellent achievement."
];

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

function subtitleFor(funId: FunQuestionId | undefined, funAnswer: string | undefined): string {
	if (!funId) return '';
	if (funId === 'crowd_tolerance' && funAnswer === 'front') return '…who can handle a crowd anyway';
	if (funId === 'planning_slack' && funAnswer === 'many') return '…always running, always booking';
	if (funId === 'boredom' && funAnswer === 'scroll') return '…with hours to reclaim';
	if (funId === 'walking' && funAnswer === 'delivered') return '…allergic to a five-minute walk';
	return '';
}

const VERDICTS_DIRTY = [
	'{ord} dirtiest of the {tot} ways to cross town.',
	'{ord} from the bottom — the bottom being clean.',
	'{cleaner} of the {tot} options were cleaner. you passed on them.',
	'dirtier per km than all but {dirtier} of the {tot}.',
	'{ord} place out of {tot}. we count from the worst.',
	'the {ord} heaviest per km on offer here.',
	'of {tot} ways to do this, you found the {ord} worst.',
	"{ord} of {tot}. i'd give partial credit but there isn't a column."
];

const VERDICTS_DIRTIEST = [
	'the single dirtiest of the {tot}. the actual worst sorry.',
	'dead last of {tot}, and last means dirtiest.',
	'no mode here is worse per km. you found the floor.'
];

const VERDICTS_CLEAN = [
	'nothing to tally. i had a speech ready and everything dammit.',
	"there's no number here worth printing.",
	"cleanest tenth in the city. i don't even get to be disappointed.",
	'barely a smudge on the ledger.',
	'i ran the maths and it came back boring. good for you.',
	'nothing to roast. this is awkward for me, professionally.',
	'the dirty column stayed empty. unlike most people here hmmph.',
	'you have left me machine with nothing to do.',
	"clean enough that the verdict won't load."
];

function modeRankCopy(c: ComputedReceipt, id: string): string {
	const lc = c.trip.modeLabel.toLowerCase();
	const tot = c.modeRank.totalModes;
	const rank = c.modeRank.carbonRankFromDirtiest;
	const cleaner = tot - rank;
	const dirtier = rank - 1;

	const opener = interp(pick(id, 'mr-open', OPENERS), { lc });

	let verdict: string;
	if (c.modeRank.isClean) {
		verdict = pick(id, 'mr-verdict', VERDICTS_CLEAN);
	} else if (rank === 1) {
		verdict = interp(pick(id, 'mr-verdict', VERDICTS_DIRTIEST), { tot: String(tot) });
	} else {
		// Drop lines whose counts would read wrong (e.g. "0 were cleaner").
		const pool = VERDICTS_DIRTY.filter(
			(v) => (!v.includes('{dirtier}') || dirtier > 0) && (!v.includes('{cleaner}') || cleaner > 0)
		);
		verdict = interp(pick(id, 'mr-verdict', pool), {
			ord: ordinal(rank),
			tot: String(tot),
			cleaner: String(cleaner),
			dirtier: String(dirtier)
		});
	}

	return `${opener} ${verdict} ${tail(id, 'mr-tail')}`.trim();
}

// Same road, compared. The daily total lives in the section eyebrow, so the deck
// carries the comparison instead. The empty/clean/dirty branches each get a pool.
const CORRIDOR_NOYOU = [
	'you skipped the road entirely. the cabs still pay {cabG} g/km to use it.',
	"you're not on this road. the cabs on it manage {cabG} g/km regardless.",
	'no corridor row for you. the cabs idling on it: {cabG} g/km.',
	'you left the traffic to everyone else. they run {cabG} g/km all the same.'
];

const CORRIDOR_CLEAN = [
	'{youG} g/km, your {youLabel}. the cab beside you spends {cabG}.',
	'the {youLabel} does it on {youG} g/km. the cabs manage {cabG}.',
	'your {youLabel}: {youG} g/km. the cab next to it: {cabG}.'
];

const CORRIDOR_DIRTY = [
	'the bus does this road at {busG} g/km. you did {youG}.',
	'{busG} g/km gets a busload down this road. you spent {youG}.',
	'same road, same distance. the bus: {busG} g/km. you: {youG}.',
	'a bus manages {busG} g/km here. you came in at {youG}, for one person.'
];

function corridorCopy(c: ComputedReceipt, id: string): string {
	const rows = c.corridor.rows;
	const cabG = String(rows.find((r) => r.key === 'cab')?.gPerKm ?? 0);
	const busG = String(rows.find((r) => r.key === 'bus')?.gPerKm ?? 18);
	const you = rows.find((r) => r.isYou);

	let line: string;
	if (!you) {
		line = interp(pick(id, 'cor-verdict', CORRIDOR_NOYOU), { cabG });
	} else if (c.modeRank.isClean) {
		line = interp(pick(id, 'cor-verdict', CORRIDOR_CLEAN), {
			youLabel: you.label,
			youG: String(you.gPerKm),
			cabG
		});
	} else {
		line = interp(pick(id, 'cor-verdict', CORRIDOR_DIRTY), { busG, youG: String(you.gPerKm) });
	}
	return `${line} ${tail(id, 'cor-tail')}`.trim();
}

const SWAP_NONE = [
	"nothing to swap. you're the cleaner option other receipts get told to switch to.",
	"no downgrade available. you're already where i'd send everyone else.",
	"skip this part. you're the version of this trip i wish more people picked.",
	"there's nothing greener to suggest. you're it. enjoy that.",
	'the advice section has nothing for you. it is a little annoyed about that, frankly.',
	"no swap. you're the benchmark."
];

// Optional nod to the friction premise. '' lets some receipts skip the lead.
const SWAP_LEAD = [
	"you told me {premise}, so a short walk won't hurt you.",
	'given {premise}, this next bit is well within your tolerance.',
	'',
	''
];

const SWAP_MATH = [
	'move half your trips to metro-plus-a-short-auto and the year drops to about {swapKg} kg.',
	'put half these trips on the metro with an auto at each end: the year falls to ~{swapKg} kg.',
	"swap half of them onto metro and short autos and you're down to about {swapKg} kg a year."
];

const SWAP_SAVING_TREES = [
	"that's {savedKg} kg kept out of the air. about {treesSaved} trees' worth.",
	'you would save {savedKg} kg a year, roughly what {treesSaved} trees do.',
	'{savedKg} kg you do not emit. call it {treesSaved} trees working on your behalf.'
];

const SWAP_SAVING_NOTREES = [
	"that's {savedKg} kg you keep out of the air. small but it helps.",
	'{savedKg} kg saved a year. not nothing.'
];

function swapCopy(c: ComputedReceipt, a: Answers, id: string): string {
	if (c.halfSwap.savedKg <= 0) {
		return pick(id, 'swap-none', SWAP_NONE);
	}

	const premise = a.funQuestionId ? PREMISE[a.funQuestionId] : 'comfort is what you optimise for';
	const lead = interp(pick(id, 'swap-lead', SWAP_LEAD), { premise });
	const math = interp(pick(id, 'swap-math', SWAP_MATH), { swapKg: comma(c.halfSwap.annualKg) });

	const savingPool = c.halfSwap.treesSaved >= 1 ? SWAP_SAVING_TREES : SWAP_SAVING_NOTREES;
	const saving = interp(pick(id, 'swap-save', savingPool), {
		savedKg: comma(c.halfSwap.savedKg),
		treesSaved: comma(c.halfSwap.treesSaved)
	});

	return `${lead} ${math} ${saving} ${tail(id, 'swap-tail')}`.replace(/\s+/g, ' ').trim();
}

// Compact lines describing the single best cleaner alternative for this trip,
// from the OTP swap suggestion. Kept under the 48-col Font A budget (plain ASCII).
function fmtDist(m: number): string {
	return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

function swapIdeas(geo: GeoSnapshot | undefined): string[] {
	const s = geo?.swap;
	if (!s) return [];
	const head = s.mode === 'SUBWAY' ? `Metro ${s.routeName} Line` : `Bus ${s.routeName}`;
	const freq = s.headwayMin ? `, ~every ${s.headwayMin} min` : '';
	const board = s.boardName.length > 36 ? s.boardName.slice(0, 33) + '...' : s.boardName;
	const leg = (l: { meters: number; auto: boolean }) =>
		`${fmtDist(l.meters)} ${l.auto ? 'auto' : 'walk'}`;
	return [
		`  ${head}${freq}`,
		`  Board: ${board}`,
		`  ${leg(s.access)} in, ${leg(s.egress)} out`
	];
}

const PS_OWN = [
	'PS: it is not only the air. your vehicle parks on about {areaM2} m2 of the city. at {areaLabel} rates, ~{rupees} of land, sitting there for free. funded by everyone who is not parked on it.',
	'PS: the air is one thing. your parked vehicle also holds {areaM2} m2 which is roughly {rupees} of {areaLabel} at no charge. someone pays for that. not you though.'
];
const PS_CAB = [
	'PS: it is not only the air. the cab parks somewhere about {areaM2} m2, ~{rupees} of {areaLabel}, sitting idle between fares.'
];
const PS_NONE = [
	'PS: it is not only the air. while you parked nothing, the car beside you takes {areaM2} m2 — ~{rupees} of {areaLabel} used for free.'
];

function psCopy(c: ComputedReceipt, areaLabel: string, id: string): string {
	const mode = c.trip.mode;
	const vars = { areaM2: String(c.parking.areaM2), rupees: rupeesLakh(c.parking.rupees), areaLabel };
	let pool: string[];
	if (mode === 'car' || mode === 'two_wheeler') pool = PS_OWN;
	else if (mode === 'cab_solo' || mode === 'cab_shared') pool = PS_CAB;
	else pool = PS_NONE;
	return interp(pick(id, 'ps', pool), vars);
}

// A short, branch-aware deck for the parking real-estate graphic (numbers live in
// the footprint box + panel, so the prose stays out of their way).
const PARK_OWN = [
	'your parked vehicle squats on public street it never pays rent for.',
	'that vehicle sits on the kerb all day, paying nothing for the privilege.',
	'your car holds down public ground rent-free.'
];
const PARK_CAB = [
	'the cab you rode parks somewhere too, idle, rent-free, between fares.',
	'your cab is idle somewhere now, holding a kerb it pays nothing for.'
];
const PARK_NONE = [
	'you parked nothing today. the car beside you sits free, on land you help fund.',
	'nothing of yours is parked. the car next to it pays nothing for the spot. you do.'
];

function parkingCopy(c: ComputedReceipt, id: string): string {
	const mode = c.trip.mode;
	let line: string;
	if (mode === 'car' || mode === 'two_wheeler') line = pick(id, 'park-verdict', PARK_OWN);
	else if (mode === 'cab_solo' || mode === 'cab_shared') line = pick(id, 'park-verdict', PARK_CAB);
	else line = pick(id, 'park-verdict', PARK_NONE);
	return `${line} ${tail(id, 'park-tail')}`.trim();
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

export function comma(n: number): string {
	return Math.round(n).toLocaleString('en-IN');
}

// Deterministic editorial variation: pick one line from a pool using the receipt
// id + a per-beat salt. Every visitor — even one with identical answers — gets a
// different turn of phrase, and it stays stable across re-renders of the same id.
export function pick(id: string, salt: string, pool: string[]): string {
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
// (mirrors publicTransitFactor in emissionsGrid.ts) rather than the metro alone, since
// the realistic transit option is a mix of the two. Very short trips just walk.
function bestCombo(distanceKm: number): { co2Kg: number; comboLabel: string } {
	if (distanceKm < 2) {
		return { co2Kg: 0, comboLabel: 'a 15-min walk' };
	}
	const { firstMile, main, lastMile } = firstLastMileKm(distanceKm);
	const accessKm = firstMile + lastMile;
	const transitCo2 = (MODE_CO2E_G_PER_PKM.bus + MODE_CO2E_G_PER_PKM.metro) / 2;
	const co2Kg = (accessKm * MODE_CO2E_G_PER_PKM.auto + main * transitCo2) / 1000;
	return { co2Kg, comboLabel: 'public transport + a short auto' };
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
	const combo = bestCombo(distanceKm);
	const multiplier = combo.co2Kg > 0 ? perTripKg / combo.co2Kg : 0;

	// Annual CO2e (kg)
	const annualCommuteKg = perTripKg * tripsPerYear;
	const annualAllInKg = annualCommuteKg * lifestyleMul;
	const annualSwitchedKg = combo.co2Kg * tripsPerYear;
	const annualSavingKg = Math.max(0, annualCommuteKg - annualSwitchedKg);
	const twoYearSavingKg = annualSavingKg * 2;
	const treeYearsEquivalent = annualSavingKg / KG_CO2_PER_TREE_YEAR;

	const arch = assignArchetype(mode, decider);
	const subtitle = subtitleFor(a.funQuestionId, a.funAnswer);

	// No receipt id at compute time; key the pick on the answer so it stays
	// deterministic per friction (these two fields aren't surfaced in ReceiptView).
	const personalNudge = frictionNudge(a.funQuestionId, a.funQuestionId ?? 'nudge');

	// Beat 3 — mode ranking among all 8 ways to move
	const carbonValues = ALL_MODES.map((m) => MODE_CO2E_G_PER_PKM[m]);
	const carbonRankFromDirtiest = rankFromDirtiest(MODE_CO2E_G_PER_PKM[mode], carbonValues);

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
	const halfSavedKg = Math.max(0, annualCommuteKg - halfAnnualKg);

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
		bestComboPerTripKg: round(combo.co2Kg, 2),
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
		recommendation: {
			deciderHeadline: deciderHeadline(decider, decider),
			recommendedCombo: combo.comboLabel
		},
		archetype: {
			name: arch.name,
			subtitle
		},
		modeRank: {
			totalModes: ALL_MODES.length,
			carbonRankFromDirtiest,
			isClean
		},
		corridor: {
			totalPerDay,
			rows: corridorRows
		},
		cylindersYear: round(cylindersYear, 0),
		treesYear: round(treesYear, 0),
		halfSwap: {
			annualKg: round(halfAnnualKg, 0),
			savedKg: round(halfSavedKg, 0),
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
			? cleanerNoteCopy(Math.round(cleanerPct / 10), id)
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
			copy: corridorCopy(c, id)
		},
		oneTrip: { co2G: Math.round(c.perTripKg * 1000) },
		year: {
			co2Kg: c.annualCommuteKg,
			kgPerBlock: KG_PER_BLOCK,
			isClean: yearClean,
			copy: yearClean ? pick(id, 'year-clean', YEAR_CLEAN) : ''
		},
		units: {
			cylinders: c.cylindersYear,
			trees: c.treesYear,
			isClean: yearClean,
			copy: yearClean ? pick(id, 'units-clean', UNITS_CLEAN) : ''
		},
		swap: {
			show: c.halfSwap.savedKg > 0,
			nowKg: c.annualCommuteKg,
			swapKg: c.halfSwap.annualKg,
			savedKg: c.halfSwap.savedKg,
			treesSaved: c.halfSwap.treesSaved,
			copy: swapCopy(c, a, id),
			ideas: swapIdeas(geo)
		},
		archetype: {
			name: c.archetype.name.toUpperCase(),
			subtitle: c.archetype.subtitle,
			stampSeed: `${a.mode}|${a.frequency}|${a.lifestyle}|${a.decider}|${a.funAnswer ?? ''}`,
			copy: 'Generated from your four answers. No two are alike.',
			basis: archetypeBasis(c, id),
			figure: { n: figN, m: figM, darkness: dirtiness }
		},
		counter: { cityCount },
		parking: {
			areaM2: c.parking.areaM2,
			valueLabel: rupeesLakh(c.parking.rupees),
			copy: parkingCopy(c, id)
		},
		finePrint: {
			psCopy: psCopy(c, areaLabel, id),
			disclaimer: c.disclaimer,
			barcodeSeed: id
		}
	};
}
