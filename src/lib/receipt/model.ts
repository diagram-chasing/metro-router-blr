// Pure view-model for the printable commute receipt.
//
// buildReceiptView() turns the stored receipt (server-computed numbers) plus the
// live distribution / city count into the exact per-beat data and copy the
// layout renders. No DOM, no side effects — every string the visitor reads is
// decided here, including the clean / two-wheeler branches. Keep the copy tight:
// the receipt has no superfluous text.

import type { Answers, FunQuestionId, Mode } from '$lib/exhibit/types';
import { MODE_CO2E_G_PER_PKM } from '$lib/exhibit/emissions';
import { legKindToMode } from '$lib/exhibit/grey';
import type { ComputedReceipt } from '$lib/server/computeReceipt';
import type { GeoSnapshot } from '$lib/server/receiptStore';

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
		// Chladni "resonance" figure: n from per-km dirtiness, m from annual burden.
		figure: { n: number; m: number };
	};
	counter: { cityCount: number | null };
	finePrint: { psCopy: string; disclaimer: string; barcodeSeed: string };
};

// Below this annual figure (kg CO2e) the "year" and "units" beats switch to their
// empty-grid / no-unit clean branch — walk/cycle and the lightest trips.
const CLEAN_YEAR_KG = 25;
const KG_PER_BLOCK = 10;

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

// The "you told us …" premise for the swap beat, drawn from the Q6 friction answer.
const PREMISE: Record<FunQuestionId, string> = {
	walking: "you'd happily walk for a good coffee",
	time_pressure: 'the cab app is your panic button',
	planning_slack: 'you cut it fine most mornings',
	crowd_tolerance: "crowds don't faze you",
	boredom: 'your commute is mostly dead time'
};

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
		`${modeLabel}. Per km, the ${ord} dirtiest of ${tot} ways this city gets around. Congratulations are not in order.`,
		`You move by ${lc} — ${ord} dirtiest per km of ${tot} options. You had ${tot} doors; you took that one.`,
		`${modeLabel}, per kilometre, ranks ${ord} dirtiest of ${tot}. The leaderboard is not flattering.`,
		`Of the ${tot} ways to cross this city, ${lc} is the ${ord} dirtiest per km. Noted.`,
		`Per km, ${lc} is the ${ord} dirtiest of ${tot} here. A choice was made — by you.`,
		`You travel by ${lc}: ${ord} dirtiest per km among ${tot} modes. The city offers cleaner; you declined.`
	]);
}

function corridorCopy(c: ComputedReceipt, id: string): string {
	const rows = c.corridor.rows;
	const bus = rows.find((r) => r.key === 'bus');
	const you = rows.find((r) => r.isYou);
	const total = comma(c.corridor.totalPerDay);
	if (!you) {
		return `About ${total} people run your corridor every day. You're not on the road for it — the cabs beside you pay ${
			rows.find((r) => r.key === 'cab')?.gPerKm ?? 0
		} g/km.`;
	}
	if (c.modeRank.isClean) {
		return `About ${total} people run your corridor every day. You're on the ${you.label} at ${you.gPerKm} g/km — the cheap seats, environmentally. The cabs beside you pay ${
			rows.find((r) => r.key === 'cab')?.gPerKm ?? 0
		}.`;
	}
	const kicker = pick(id, 'corridor-kick', [
		`You're on the premium plan and nobody upsold you.`,
		`Same tarmac, premium fare — environmentally speaking.`,
		`You bought the deluxe seat to the same destination.`,
		`The bus got there too, cheaper for the air.`,
		`You're paying first-class emissions for an economy trip.`,
		`Same road, same city, fancier carbon footprint.`,
		`Everyone else carpooled the atmosphere; you expensed it.`
	]);
	return `About ${total} people run your corridor every day. ${comma(
		bus?.countPerDay ?? 0
	)} are on the bus at ${bus?.gPerKm ?? 18} g/km, on the same road you pay ${
		you.gPerKm
	} for. ${kicker}`;
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

const FINE_PRINT_CONVENTIONS =
	'';

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
	let figN = 2 + Math.round(nNorm * 6); // 2..8
	const mNorm = Math.min(1, Math.sqrt(c.annualCommuteKg / 800));
	let figM = 2 + Math.round(mNorm * 6); // 2..8
	if (figN === figM) figM = figM < 8 ? figM + 1 : figM - 1; // n==m → blank plate

	const DECIDER_WORD: Record<string, string> = {
		habit: 'habit',
		comfort: 'comfort',
		speed: 'speed',
		cost: 'cost',
		no_option: 'no real alternative'
	};
	const deciderWord = DECIDER_WORD[a.decider ?? 'habit'] ?? 'habit';

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
		corridor: { totalPerDay: c.corridor.totalPerDay, rows: c.corridor.rows, copy: corridorCopy(c, id) },
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
			basis: `Assigned from your mode (${c.trip.modeLabel.toLowerCase()}) and why you ride it — ${deciderWord}.`,
			figure: { n: figN, m: figM }
		},
		counter: { cityCount },
		finePrint: {
			psCopy: psCopy(c, areaLabel),
			disclaimer: `${FINE_PRINT_CONVENTIONS} ${c.disclaimer}`,
			barcodeSeed: id
		}
	};
}
