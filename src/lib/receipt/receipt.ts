import {
	CORRIDOR_SHARE,
	MODE_CO2E_G_PER_PKM,
	journeyBaseMode,
	journeyEmissions,
	legKindToMode,
	routeEmissions,
	tripEmissions
} from '$lib/emissions';
import type { Answers, Frequency, FunQuestionId, JourneyType, Lifestyle, Mode } from '$lib/exhibit/types';
import type { GeoSnapshot } from '$lib/server/receiptStore';
import { assignArchetype, archetypeBasis } from './archetype';
import { estimateCorridorTraffic } from './corridorTraffic';
import { landValueAtPoint } from './landValue';
import { carsAddedToday } from './carsAdded';

// Transit connectivity between the trip's origin and destination, derived live
// from OpenTripPlanner (see lookupConnectivity). We plan the trip, collect the
// routes the suggested itineraries board first, then sum each route's daily trips.
// `modes` lists each public-transport class actually serving the trip, with the
// boarded route short-names and that class's total daily trips.
export type ConnectivityMode = {
	key: 'metro' | 'ac_bus' | 'bus';
	label: string;
	trips: number;
	routes: string[]; // boarded-route short-names contributing to this class
};
export type Connectivity = {
	total: number; // daily transit trips summed across the routes serving this trip
	modes: ConnectivityMode[];
};

export type ComputedReceipt = {
	// Inputs echoed back in readable form
	trip: {
		mode: Mode; // base mode the journey stands in for (corridor/archetype/valence)
		journey: JourneyType; // the door-to-door choice actually picked
		modeLabel: string; // journey label ("Metro + auto")
		gPerKm: number; // effective CO2e per pkm for this journey at this distance
		frequency: Frequency;
		frequencyLabel: string;
		distanceKm: number;
		originStation?: string;
		destinationStation?: string;
		lifestyle: Lifestyle;
		lifestyleLabel: string;
	};

	// Per-trip / per-year emissions for the chosen journey
	perTripKg: number; // CO2e, kg
	multiplier: number; // perTripKg / the cleanest journey (metro + walk) — for the archetype basis

	// Yearly CO2e (kg)
	tripsPerYear: number;
	annualCommuteKg: number; // perTripKg × tripsPerYear
	annualAllInKg: number; // annualCommuteKg × lifestyle scaler

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

	// Beat 4 — corridor traffic. The headcount/PT split/emissions are grounded in
	// nearby junction counts (traffic.json); the per-mode rows stay illustrative.
	corridor: {
		totalPerDay: number; // = peoplePerDay (people/day ≈ bottleneck junction volume)
		peoplePerDay: number;
		ptShare: number; // assumed public-transport modal split
		dailyCo2eKg: number; // estimated daily CO2e of corridor traffic over the route
		isFallback: boolean; // route touched no junction → city-wide percentile used
		rows: { key: string; label: string; countPerDay: number; gPerKm: number; isYou: boolean }[];
	};

	// Daily transit trips serving the trip's origin→destination, derived from
	// OpenTripPlanner. Filled in server-side (see lookupConnectivity); null at pure
	// compute time and when no transit reasonably serves the trip.
	connectivity: Connectivity | null;

	// Beat 7 — equivalences for the YEAR-TOTAL commute (not the saving)
	cylindersYear: number; // annualCommuteKg / 42
	treesYear: number; // annualCommuteKg / 21

	// Beat 10 — the real estate a parked car sits on
	parking: {
		areaM2: number;
		ratePerM2: number;
		rupees: number;
		areaLabel: string;
	};

	distanceBand: string; // e.g. "6-10 km"
	disclaimer: string;
};

export type Distribution = { percentile: number; n: number; values: number[] };
export type Histogram = { values: number[]; mine: number; n: number };

export type RouteSeg = { mode: Mode; lengthM: number };
export type RouteGeoLeg = { coords: [number, number][]; gPerKm: number };

export type ReceiptView = {
	meta: { visitorNo: string; dateLabel: string; timeLabel: string; name?: string };
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
		peoplePerDay: number;
		ptShare: number; // 0..1, assumed public-transport modal split
		co2Label: string; // estimated daily CO2e of corridor traffic, pre-formatted
		co2Equiv: string; // same figure as a count of heavy things ("~28 elephants")
		isFallback: boolean;
		rows: ComputedReceipt['corridor']['rows'];
		copy: string;
	};
	// Real transit between the two areas: the daily trip total and a per-mode list
	// (busiest route short-names first). null when the area pair has no recorded
	// transit or the origin/destination weren't dropped on the map.
	connectivity: {
		total: number;
		modes: ConnectivityMode[];
	} | null;
	oneTrip: { co2G: number };
	// modeClean: the habit itself is a clean mode (bus/metro/walk), regardless of how
	// the annual figure lands. vsCarFun: carbon dodged by not driving the same trip, as
	// a dumb-pleasure count ('' when the habit isn't cleaner than a car).
	year: {
		co2Kg: number;
		kgPerBlock: number;
		copy: string;
		isClean: boolean;
		modeClean: boolean;
		vsCarKg: number;
		vsCarFun: string;
	};
	// funLine: the annual figure as a dumb-pleasure count (the "spent" framing).
	units: { cylinders: number; trees: number; copy: string; isClean: boolean; funLine: string };
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
	// Estimated cars registered across Bangalore so far today, by the receipt's time.
	counter: { carsToday: number };
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

// The modes we rank against (beat 3, "the ways to move in this city"). Count comes
// from this list, so the verdict copy reads "{tot} ways" automatically.
const ALL_MODES: Mode[] = ['car', 'auto', 'metro', 'two_wheeler', 'bus', 'active'];

// Modeled corridor mode-share for a typical Bengaluru arterial (beat 4) now lives in $lib/emissions
// as CORRIDOR_SHARE (single source — the wall's represented-traffic model reads the same split).
const CORRIDOR_KEY_LABEL: Record<string, string> = {
	bus: 'bus',
	two_wheeler: '2wh',
	car: 'car',
	auto: 'auto',
	metro: 'metro'
};
// The CO2e g/pkm rate shown on each corridor row maps each display key back to a
// representative internal mode in MODE_CO2E_G_PER_PKM.
const CORRIDOR_KEY_MODE: Record<string, Mode> = {
	bus: 'bus',
	two_wheeler: 'two_wheeler',
	car: 'car',
	auto: 'auto',
	metro: 'metro'
};
// Real-estate beat (10): a parked car occupies ~18 m² of street; its value is that
// area x ratePerM2 (the capital land value it squats on, not rent). ratePerM2 is the
// state guidance value (₹/m²) for the zone the destination sits in (guidance_value.json),
// a conservative stand-in for market land value. PARKING_RATE_PER_M2 is the fallback
// when the destination is unknown or falls outside the dataset (~₹2 lakh/m²).
const PARKING_AREA_M2 = 18;
const PARKING_RATE_PER_M2 = 200000;

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

// The one tone decision the whole receipt keys off. The SUBJECT is the visitor's
// stated habit (Q1) — clean modes are affirmed; a dirty mode is criticised. Every
// verdict-bearing beat resolves this once and picks copy from the matching pool, so
// a positive choice can never collect a negative line.
export type Valence = 'affirm' | 'critical';

export function subjectValence(mode: Mode): Valence {
	const clean = mode === 'bus' || mode === 'metro' || mode === 'active';
	return clean ? 'affirm' : 'critical';
}

// A line is opener (frames the beat, names the mode) + verdict (the numbers) +
// tail (a short sign-off). Openers only name the mode, so they stay tone-neutral and
// shared; tails carry tone and so are keyed by valence — a deflationary tail never
// lands on an affirming verdict. At most ONE beat per receipt carries a tail
// (chooseTailedBeat), so the aside reads as a deliberate sign-off, not a per-section tic.
const OPENERS = [
	'{lc}, eh?',
	'{lc}, i see.',
	'you travel by {lc}.',
	'you, the {lc}, the whole way.',
	'let the record show: {lc}.',
	'so. {lc}.'
];

type TailBeat = 'modeRank' | 'corridor' | 'swap';

const TAILS: Record<Valence, string[]> = {
	affirm: ['credit where due.', "i'll allow it.", 'good for you.', 'no notes.'],
	critical: [
		"i wouldn't dwell on it.",
		'i checked twice.',
		"i'd hoped to be wrong.",
		'but moving on.',
		'it is what it is, i guess.',
		'make of it what you like.'
	]
};

function beatTail(id: string, beat: TailBeat, v: Valence, want: boolean): string {
	if (!want) return '';
	return pick(id, `${beat}-tail`, TAILS[v]);
}

// Pick at most one beat to carry a tail this receipt. The empty slots give a real chance of
// a tail-free receipt.
function chooseTailedBeat(id: string): TailBeat | '' {
	const candidates: string[] = ['modeRank', 'corridor', '', ''];
	return pick(id, 'tail-beat', candidates) as TailBeat | '';
}

// ── "Cleaner than you" note ──
const CLEANER_NOTE = [
	'about {x} in 10 commuters logged here come in cleaner. the maths, not a verdict.',
	'roughly {x} of every 10 here travel lighter. this road does that to people.',
	'{x} in 10 so far land cleaner. it is a crowded club, no shame in it.'
];

// Edges read wrong with the "{x} in 10" frame: x=0 references an empty set, x=10 is clunky.
const CLEANER_NOTE_NONE = [
	'no one logged here today has come in cleaner than you. noted.',
	'so far, nobody here beats you on this. rare.'
];
const CLEANER_NOTE_ALL = [
	'just about everyone logged here so far comes in a touch cleaner. heavy day for this road.',
	'so far, near enough everyone here travels lighter. dense traffic, literally.'
];

function cleanerNoteCopy(tenths: number, id: string): string {
	if (tenths <= 0) return pick(id, 'cleaner', CLEANER_NOTE_NONE);
	if (tenths >= 10) return pick(id, 'cleaner', CLEANER_NOTE_ALL);
	return interp(pick(id, 'cleaner', CLEANER_NOTE), { x: String(tenths) });
}

// ── Clean-branch year / units (nothing to show) ──
const YEAR_CLEAN = [
	'barely a mark. awesome i guess.',
	'hardly a smudge. you are a legend.',
	"a rounding error, in the city's favour.",
	'number\'s too teeny-tiny. let\'s keep it that way.',
	'negligible. you are a legend.'
];

const UNITS_CLEAN = [
	"not enough to need a unit. i usually keep one ready; you didn't fill it.",
	'too little to convert into anything. shrugs. that\'s good though.',
	'no cylinders, no trees. nothing to translate.',
	'below the threshold for a single unit. pleasantly anticlimactic.',
	'the equivalents all come out zero. nothing to make tangible.',
	"doesn't add up to one of anything. a most excellent achievement."
];

// Neutral clean-branch copy: used when the mode-valence is critical but the annual
// happens to land tiny — state the small number plainly, neither praising nor scolding the choice.
const YEAR_NEUTRAL = [
	'small, annualised. the grid has almost nothing to draw.',
	'the yearly number lands low. not much to plot here.',
	'under the line where this chart fills in.'
];

const UNITS_NEUTRAL = [
	'too small to convert into a cylinder or a tree.',
	'the equivalents round to zero. nothing physical to translate.',
	"doesn't reach one unit of anything."
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

const DISCLAIMER =
	'Estimates use India-specific operational emission factors; actual figures vary with vehicle, occupancy and traffic conditions. For a full methodology, see https://diagramchasing.fun/2026/emissions. Also, in the grand scheme of things, this is minor. A single war burns more carbon, and lives, than any commute ever will.';

function subtitleFor(funId: FunQuestionId | undefined, funAnswer: string | undefined): string {
	if (!funId) return '';
	if (funId === 'crowd_tolerance' && funAnswer === 'front') return '…who can handle a crowd anyway';
	if (funId === 'walking' && funAnswer === 'delivered') return '…allergic to a five-minute walk';
	if (funId === 'last_mile' && funAnswer === 'auto') return '…who autos the last mile anyway';
	return '';
}

const VERDICTS_DIRTY = [
	'{ord} dirtiest of the {tot} ways to cross town. someone had to be.',
	'{cleaner} of the {tot} ways run cleaner. this one does not, and the city keeps turning.',
	'dirtier per km than all but {dirtier} of the {tot}. blame the traffic, mostly.',
	'the {ord} heaviest per km on offer here. an oddly specific ranking.',
	'{ord} of {tot} on carbon per km. we had to measure something.',
	"{ord} of {tot}. i'd hand out partial credit, but the form has no column for it."
];

const VERDICTS_DIRTIEST = [
	'the heaviest per km of all {tot}. a bold, expensive way to sit in traffic.',
	'top of the {tot} for carbon per km. not the leaderboard anyone frames.',
	'nothing here runs heavier per km. impressive, in a way nobody asked for.'
];

const VERDICTS_CLEAN = [
	'nothing to tally. i had a speech ready and everything dammit.',
	"then there's no number here worth printing.",
	"cleanest tenth in the city. i don't even get to be disappointed.",
	'barely a smudge on the ledger.',
	'i ran the maths and it came back boring.',
	'nothing to roast. this is awkward for me, professionally.',
	'no big number to be snarky about. unlike for some people here hmmph.',
	'you have left me machine with nothing to do.',
	"clean enough that I don't have something smart to say."
];

function modeRankCopy(c: ComputedReceipt, id: string, wantTail: boolean): string {
	const v = subjectValence(c.trip.mode);
	const lc = c.trip.modeLabel.toLowerCase();
	const tot = c.modeRank.totalModes;
	const rank = c.modeRank.carbonRankFromDirtiest;
	const cleaner = tot - rank;
	const dirtier = rank - 1;

	const opener = interp(pick(id, 'mr-open', OPENERS), { lc });

	const vars = {
		ord: ordinal(rank),
		tot: String(tot),
		cleaner: String(cleaner),
		dirtier: String(dirtier)
	};

	let verdict: string;
	if (v === 'affirm') {
		verdict = pick(id, 'mr-verdict', VERDICTS_CLEAN);
	} else if (rank === 1) {
		verdict = interp(pick(id, 'mr-verdict', VERDICTS_DIRTIEST), { tot: String(tot) });
	} else {
		// Drop lines whose counts would read wrong (e.g. "0 were cleaner").
		const pool = VERDICTS_DIRTY.filter(
			(line) =>
				(!line.includes('{dirtier}') || dirtier > 0) && (!line.includes('{cleaner}') || cleaner > 0)
		);
		verdict = interp(pick(id, 'mr-verdict', pool), vars);
	}

	return `${opener} ${verdict} ${beatTail(id, 'modeRank', v, wantTail)}`.trim();
}

// Same road, compared. The daily total lives in the section eyebrow, so the deck
// carries the comparison instead. The empty/clean/dirty branches each get a pool.
const CORRIDOR_NOYOU = [
	'you skipped the road entirely. the cars still pay {carG} g/km to use it.',
	"you're not on this road. the cars on it manage {carG} g/km regardless.",
	'no corridor row for you. the cars idling on it: {carG} g/km.',
	'you left the traffic to everyone else. they run {carG} g/km all the same.'
];

const CORRIDOR_CLEAN = [
	'{youG} g/km, your {youLabel}. the car beside you spends {carG}.',
	'the {youLabel} does it on {youG} g/km. the cars manage {carG}.',
	'your {youLabel}: {youG} g/km. the car next to it: {carG}.',
	'{youG} g/km on your {youLabel}; the car alongside burns {carG}.'
];

const CORRIDOR_DIRTY = [
	'the bus travels this road emitting just {busG} g/km. you did {youG}.',
	'{busG} g/km gets a busload down this road. you spent {youG}.',
	'on the same road for same distance, the bus emits {busG} g/km. you: {youG}.',
	'a bus emits {busG} g/km here. you came in at {youG}, for one person.'
];

function corridorCopy(c: ComputedReceipt, id: string, wantTail: boolean): string {
	const v = subjectValence(c.trip.mode);
	const rows = c.corridor.rows;
	const carG = String(rows.find((r) => r.key === 'car')?.gPerKm ?? 0);
	const busG = String(rows.find((r) => r.key === 'bus')?.gPerKm ?? 18);
	const you = rows.find((r) => r.isYou);
	// The visitor's own figures come from the chosen journey, not the corridor row it
	// highlights: an EV or a metro combo has no exact bar, so quote its real effective
	// per-km and full label instead of the nearest base mode's.
	const youG = String(c.trip.gPerKm);
	const youLabel = c.trip.modeLabel.toLowerCase();

	let line: string;
	if (!you) {
		line = interp(pick(id, 'cor-verdict', CORRIDOR_NOYOU), { carG });
	} else if (v === 'affirm') {
		line = interp(pick(id, 'cor-verdict', CORRIDOR_CLEAN), { youLabel, youG, carG });
	} else {
		line = interp(pick(id, 'cor-verdict', CORRIDOR_DIRTY), { busG, youG });
	}
	return `${line} ${beatTail(id, 'corridor', v, wantTail)}`.trim();
}

const PS_OWN = [
	'PS: it is not only the air. a parked car sits on about {areaM2} m2 of city, roughly {rupees} of {areaLabel} land, doing nothing but existing. wild rate for a nap.',
	'PS: beyond the air, {areaM2} m2 of {areaLabel} goes under a parked car. that is about {rupees} of land, on a permanent tea break.'
];
const PS_NONE = [
	'PS: it is not only the air. a parked car nearby holds {areaM2} m2, about {rupees} of {areaLabel}, quietly out of circulation.'
];

function psCopy(c: ComputedReceipt, areaLabel: string, id: string): string {
	const mode = c.trip.mode;
	const vars = { areaM2: String(c.parking.areaM2), rupees: rupeesLakh(c.parking.rupees), areaLabel };
	const pool = mode === 'car' || mode === 'two_wheeler' ? PS_OWN : PS_NONE;
	return interp(pick(id, 'ps', pool), vars);
}

// One short generic line for the parking real-estate graphic, branching only on
// whether the visitor drove a car (the numbers live in the footprint block below,
// so the prose stays out of their way).
function parkingCopy(c: ComputedReceipt): string {
	return c.trip.mode === 'car'
		? 'Parked, a car holds public street for free. a strangely good deal, when you think about it.'
		: `When parked, a car nearby holds prime land in ${c.parking.areaLabel} for no rent. good gig if you can get it.`;
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

// Map an internal mode to the corridor display key (walk has no corridor row).
function corridorKeyFor(mode: Mode): string | null {
	if (mode === 'active') return null;
	return mode; // 'car' | 'auto' | 'bus' | 'metro' | 'two_wheeler'
}

function ordinal(n: number): string {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// Daily corridor emissions, spelled out: tonnes once it clears ~1 t, else kg.
function co2DailyLabel(kg: number): string {
	if (kg >= 1000) {
		const t = Math.round(kg / 1000);
		return `${t.toLocaleString('en-IN')} tonne${t === 1 ? '' : 's'}`;
	}
	return `${Math.round(kg).toLocaleString('en-IN')} kg`;
}

// CO2 has mass too — so render the daily corridor figure as a playful count of heavy
// things (rough live weights, kg). The pick is deterministic per receipt so it holds
// still between renders.
const CO2_CRITTERS: { mass: number; noun: string }[] = [
	{ mass: 5000, noun: 'elephants' },
	{ mass: 2300, noun: 'rhinos' },
	{ mass: 1500, noun: 'hippos' },

	{ mass: 680, noun: 'cows' }
];
function co2EquivLabel(kg: number, id: string): string {
	const idx = Number(pick(id, 'co2-critter', CO2_CRITTERS.map((_, i) => String(i))));
	const c = CO2_CRITTERS[idx];
	const n = Math.max(2, Math.round(kg / c.mass));
	return `${n.toLocaleString('en-IN')} ${c.noun}`;
}

// Carbon as a budget of dumb pleasures. Same kg, two framings: spent (a heavy
// commute already cashed out) and banked (a saving you get to blow on something
// silly). {n} is the count. mass = kg CO2e per unit, web-verified July 2026 — the
// two soft ones (delivery, chatbot) are flagged; the receipt carries a methodology link.
const FUN_UNITS: { mass: number; spent: string; banked: string }[] = [
	// WHO/ACS: ~14 g full lifecycle of one cigarette.
	{
		mass: 0.014,
		spent: '{n} cigarettes, lit for no one',
		banked: '{n} cigarettes you could light for no reason'
	},
	// ~300 g draught to ~900 g imported bottle; 0.5 kg is the middle.
	{
		mass: 0.5,
		spent: '{n} pints of beer, and no party',
		banked: '{n} pints of beer, on the house'
	},
	// BLR to Goa is ~600 km x ~0.22 kg CO2/pkm (ICAO/DEFRA short-haul).
	{
		mass: 130,
		spent: '{n} weekend flights to Goa, and you did not even get a beach',
		banked: '{n} weekend flights to Goa, guilt left at home'
	},
	// ~100-215 g CO2 last-mile per parcel (Statista/industry); dark stores shorten the
	// hop. ~0.2 kg covers a short scooter round trip plus packaging.
	{
		mass: 0.2,
		spent: '{n} ten-minute deliveries of things that were downstairs',
		banked: '{n} ten-minute deliveries you can order without flinching'
	},
	// IEA 36 g, Carbon Trust 55 g per hour of streaming; 50 g mid.
	{
		mass: 0.05,
		spent: '{n} hours of doomscrolling in 4K',
		banked: '{n} hours of streaming you can pretend are fine'
	},
	// Contested: estimates run 0.16 to 23.7 g; ~3 g is the consensus mid.
	{
		mass: 0.003,
		spent: '{n} pointless questions asked to a chatbot',
		banked: '{n} more pointless questions for a chatbot'
	},
	// 1.5-ton AC over ~8 h is ~10-14 kWh x 0.70 kg/kWh India grid (CEA); ~8 kg.
	{
		mass: 8,
		spent: '{n} nights of running the AC till morning',
		banked: '{n} nights of AC, no notes'
	}
];

// Pick a unit whose HONEST count is >= 3, so a small kg never gets floored up to a
// misleading "2 weekend flights" (14 kg is not two Goa trips). Heavy units drop out
// for small figures; the lightest unit is the floor for near-zero kg.
function funUnit(kg: number, id: string): { u: (typeof FUN_UNITS)[number]; n: number } {
	const eligible = FUN_UNITS.filter((u) => Math.round(kg / u.mass) >= 3);
	const pool = eligible.length ? eligible : [FUN_UNITS.reduce((a, b) => (a.mass < b.mass ? a : b))];
	const u = pool[Number(pick(id, 'fun-unit', pool.map((_, i) => String(i))))];
	return { u, n: Math.max(2, Math.round(kg / u.mass)) };
}

// The dry annual figure, in a currency that lands: what the commute already spent.
function funEquivSpent(kg: number, id: string): string {
	const { u, n } = funUnit(kg, id);
	return interp(u.spent, { n: n.toLocaleString('en-IN') });
}

// The saving, reframed as pleasure you can now afford.
function funEquivBanked(kg: number, id: string): string {
	const { u, n } = funUnit(kg, id);
	return interp(u.banked, { n: n.toLocaleString('en-IN') });
}

export function comma(n: number): string {
	return Math.round(n).toLocaleString('en-IN');
}

// First name as entered, tidied for the receipt greeting: first word only, capitalised,
// length-capped so it never blows past the 48-col line. undefined when nothing usable.
function formatName(raw: string | undefined): string | undefined {
	const first = (raw ?? '').trim().split(/\s+/)[0]?.slice(0, 20);
	if (!first) return undefined;
	return first.charAt(0).toUpperCase() + first.slice(1);
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

export function computeReceipt(a: Answers): ComputedReceipt {
	// One reading of one trip. The visitor picks a single JOURNEY (Q2) — it drives the
	// headline, the rank, the corridor row, the seal and the archetype. The map (Q1) is
	// GEOMETRY ONLY: it supplies the distance, the drawn line and the corridor location,
	// never a second mode to compare against.
	const legs = a.route?.segments;
	const hasRoute = !!(legs && legs.length);
	const frequency: Frequency = a.frequency ?? 'few_weekly';
	const lifestyle: Lifestyle = a.lifestyle ?? 'moderate';
	const tripsPerYear = TRIPS_PER_YEAR[frequency];
	const lifestyleMul = LIFESTYLE_MULTIPLIER[lifestyle];

	const journey: JourneyType = a.mode ?? 'car';
	// Distance comes from the drawn geometry when present (its great-circle length),
	// falling back to the OTP-reported distance.
	const routeKm = hasRoute ? routeEmissions(legs!).km : 0;
	const distanceKm = routeKm > 0 ? routeKm : (a.distanceKm ?? 0);

	// The base Mode the journey stands in for (corridor row, archetype, valence).
	const tripMode: Mode = journeyBaseMode(journey);
	const emissions = journeyEmissions(journey, distanceKm);

	// Per-trip
	const perTripKg = emissions.kgPerTrip;
	// How much heavier than the cleanest realistic journey (metro + walk), for the
	// archetype basis line. ~1 for a clean journey; large for a private car.
	const cleanestKg = journeyEmissions('metro_walk', distanceKm).kgPerTrip;
	const multiplier = cleanestKg > 0 ? perTripKg / cleanestKg : 0;

	// Annual CO2e (kg)
	const annualCommuteKg = perTripKg * tripsPerYear;
	const annualAllInKg = annualCommuteKg * lifestyleMul;

	const arch = assignArchetype(tripMode);
	const subtitle = subtitleFor(a.funQuestionId, a.funAnswer);

	// Beat 3 — mode ranking: where this journey's effective g/pkm sits among the base modes
	const carbonValues = ALL_MODES.map((m) => MODE_CO2E_G_PER_PKM[m]);
	const carbonRankFromDirtiest = rankFromDirtiest(emissions.gPerKm, carbonValues);

	// Beat 4 — corridor traffic, grounded in nearby junction counts (traffic.json).
	// The per-mode g/km bars stay modeled (CORRIDOR_SHARE); only the headcount, the
	// public-transport split and the emissions line come from the real data.
	const corridorTraffic = estimateCorridorTraffic(a.route?.segments, distanceKm);
	const totalPerDay = corridorTraffic.peoplePerDay;
	// Pure single-mode journeys sit exactly on a traffic bar, so highlight it. Journeys
	// with no traffic slice (EV, the metro combos) get their OWN bar at their real
	// effective g/km instead of being dumped onto the nearest generic mode's bar.
	const YOU_BAR: Partial<Record<JourneyType, string>> = {
		car_ev: 'ev',
		metro_auto: 'm+auto',
		metro_walk: 'm+walk'
	};
	const ownBarLabel = YOU_BAR[journey];
	const youKey = ownBarLabel ? null : corridorKeyFor(tripMode);
	const trafficRows = Object.keys(CORRIDOR_SHARE).map((key) => ({
		key,
		label: CORRIDOR_KEY_LABEL[key],
		countPerDay: Math.round(totalPerDay * CORRIDOR_SHARE[key]),
		gPerKm: Math.round(MODE_CO2E_G_PER_PKM[CORRIDOR_KEY_MODE[key]]),
		isYou: key === youKey
	}));
	const corridorRows = (
		ownBarLabel
			? [
				...trafficRows,
				{ key: 'you', label: ownBarLabel, countPerDay: 0, gPerKm: Math.round(emissions.gPerKm), isYou: true }
			]
			: trafficRows
	).sort((x, y) => y.gPerKm - x.gPerKm); // dirtiest first — bar length encodes g/km

	// Beat 7 — year-total equivalences
	const cylindersYear = annualCommuteKg / KG_CO2_PER_LPG_CYLINDER;
	const treesYear = annualCommuteKg / KG_CO2_PER_TREE_YEAR;

	// Beat 10 — parking footprint as real estate, priced at the destination's
	// guidance value when we have a drop pin; the city-wide constant otherwise.
	const destRate = a.destination ? landValueAtPoint(a.destination) : null;
	const parkingRatePerM2 = destRate && destRate > 0 ? destRate : PARKING_RATE_PER_M2;
	const parkingRupees = PARKING_AREA_M2 * parkingRatePerM2;
	const parkingAreaLabel = a.destinationStation ?? a.originStation ?? 'this part of the city';

	const isClean = tripMode === 'bus' || tripMode === 'metro' || tripMode === 'active';

	return {
		trip: {
			mode: tripMode,
			journey,
			modeLabel: emissions.label,
			gPerKm: round(emissions.gPerKm, 0),
			frequency,
			frequencyLabel: FREQUENCY_LABEL[frequency],
			distanceKm: round(distanceKm, 2),
			originStation: a.originStation,
			destinationStation: a.destinationStation,
			lifestyle,
			lifestyleLabel: LIFESTYLE_LABEL[lifestyle]
		},
		perTripKg: round(perTripKg, 2),
		multiplier: round(multiplier, 1),
		tripsPerYear,
		annualCommuteKg: round(annualCommuteKg, 0),
		annualAllInKg: round(annualAllInKg, 0),
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
			peoplePerDay: corridorTraffic.peoplePerDay,
			ptShare: corridorTraffic.ptShare,
			dailyCo2eKg: corridorTraffic.dailyCo2eKg,
			isFallback: corridorTraffic.isFallback,
			rows: corridorRows
		},
		// Pure compute makes no network calls; the server endpoint fills this from
		// OpenTripPlanner before the receipt is stored.
		connectivity: null,
		cylindersYear: round(cylindersYear, 0),
		treesYear: round(treesYear, 0),
		parking: {
			areaM2: PARKING_AREA_M2,
			ratePerM2: parkingRatePerM2,
			rupees: parkingRupees,
			areaLabel: parkingAreaLabel
		},
		distanceBand: distanceBand(distanceKm),
		disclaimer: DISCLAIMER
	};
}

export function buildReceiptView(
	c: ComputedReceipt,
	a: Answers,
	geo: GeoSnapshot | undefined,
	dist: Distribution | undefined,
	hist: Histogram | undefined,
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
	const greetingName = formatName(a.name);

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

	// For a clean habit the interesting number isn't the (tiny) footprint, it's the
	// footprint DODGED by not driving the same trip. Positive only when the habit beats
	// a car; small trips still make big, fun counts via the lightest units.
	const modeClean = c.modeRank.isClean;
	const carAnnualKg = tripEmissions('car', c.trip.distanceKm).kgPerTrip * c.tripsPerYear;
	const avoidedVsCarKg = Math.max(0, carAnnualKg - c.annualCommuteKg);
	const showVsCar = modeClean && avoidedVsCarKg >= 2;
	const vsCarFun = showVsCar
		? `not driving it keeps ~${comma(avoidedVsCarKg)} kg out of the air, same as ${funEquivBanked(avoidedVsCarKg, id)}.`
		: '';

	// One tone decision, reused for the tail budget (≤1 beat carries a sign-off) and for the
	// clean-year copy (a criticised receipt shouldn't congratulate a tiny number).
	const tailV = subjectValence(c.trip.mode);
	const tailedBeat = chooseTailedBeat(id);

	// Emissions "resonance": the profile seal is a Chladni standing-wave figure.
	// n (a low→high mode) tracks how dirty the trip is per km; m tracks the total
	// annual burden. Clean, light commutes ring calm figures; heavy ones get busy,
	// agitated ones — the pattern *is* the pollution, not decoration.
	const co2Vals = Object.values(MODE_CO2E_G_PER_PKM);
	const cMin = Math.min(...co2Vals);
	const cMax = Math.max(...co2Vals);
	const co2PerKm = c.trip.gPerKm;
	const nNorm = cMax > cMin ? (co2PerKm - cMin) / (cMax - cMin) : 0;
	const figN = SEAL.modeMin + Math.round(nNorm * SEAL.modeRange); // 2..8
	const mNorm = Math.min(1, Math.sqrt(c.annualCommuteKg / SEAL.annualNormKg));
	let figM = SEAL.modeMin + Math.round(mNorm * SEAL.modeRange); // 2..8
	if (figN === figM) figM = figM < 8 ? figM + 1 : figM - 1; // n==m → blank plate
	// Overall seal darkness: mostly per-km dirtiness, with annual burden adding weight.
	const dirtiness = Math.max(0, Math.min(1, SEAL.perKmWeight * nNorm + SEAL.annualWeight * mNorm));

	return {
		meta: { visitorNo, dateLabel, timeLabel, name: greetingName },
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
			copy: modeRankCopy(c, id, tailedBeat === 'modeRank'),
			histogram: hist ? { values: hist.values, mine: hist.mine } : null,
			cleanerNote
		},
		corridor: {
			totalPerDay: c.corridor.totalPerDay,
			peoplePerDay: c.corridor.peoplePerDay,
			ptShare: c.corridor.ptShare,
			co2Label: co2DailyLabel(c.corridor.dailyCo2eKg),
			co2Equiv: co2EquivLabel(c.corridor.dailyCo2eKg, id),
			isFallback: c.corridor.isFallback,
			rows: c.corridor.rows,
			copy: corridorCopy(c, id, tailedBeat === 'corridor')
		},
		connectivity: c.connectivity ? { total: c.connectivity.total, modes: c.connectivity.modes } : null,
		oneTrip: { co2G: Math.round(c.perTripKg * 1000) },
		year: {
			co2Kg: c.annualCommuteKg,
			kgPerBlock: KG_PER_BLOCK,
			isClean: yearClean,
			modeClean,
			vsCarKg: Math.round(avoidedVsCarKg),
			vsCarFun,
			copy: yearClean ? pick(id, 'year-clean', tailV === 'affirm' ? YEAR_CLEAN : YEAR_NEUTRAL) : ''
		},
		units: {
			cylinders: c.cylindersYear,
			trees: c.treesYear,
			isClean: yearClean,
			copy: yearClean ? pick(id, 'units-clean', tailV === 'affirm' ? UNITS_CLEAN : UNITS_NEUTRAL) : '',
			// The "spent" line: shown for dirty habits even when tiny (small kg still
			// makes a big, fun count). Clean habits show the vs-car line instead.
			funLine: modeClean ? '' : funEquivSpent(c.annualCommuteKg, id)
		},
		archetype: {
			name: c.archetype.name.toUpperCase(),
			subtitle: c.archetype.subtitle,
			stampSeed: `${a.mode}|${a.frequency}|${a.lifestyle}|${a.funAnswer ?? ''}`,
			copy: 'Generated from your four answers. No two are alike.',
			basis: archetypeBasis(c, id),
			figure: { n: figN, m: figM, darkness: dirtiness }
		},
		counter: { carsToday: carsAddedToday(createdAt) },
		parking: {
			areaM2: c.parking.areaM2,
			valueLabel: rupeesLakh(c.parking.rupees),
			copy: parkingCopy(c)
		},
		finePrint: {
			psCopy: psCopy(c, areaLabel, id),
			disclaimer: c.disclaimer,
			barcodeSeed: id
		}
	};
}
