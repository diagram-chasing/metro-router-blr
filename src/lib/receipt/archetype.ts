import type { Decider, Mode } from '$lib/exhibit/types';
import type { ComputedReceipt } from './receipt';
import { comma, interp, pick } from './receipt';

// ── Assignment ──
// Deterministic. The clean / two-wheeler clusters and the no_option fork are the
// meaningful splits; the chosen-dirty branch is named by motive, because that's
// what the visitor is trading the air for.

type Archetype = { key: string; name: string };

export function assignArchetype(mode: Mode, decider: Decider): Archetype {
	if (mode === 'active') return { key: 'featherweight', name: 'The Featherweight' };
	if (mode === 'bus' || mode === 'metro') return { key: 'offgrid', name: 'The Off-Grid Commuter' };
	if (mode === 'two_wheeler') return { key: 'lightweight', name: 'The Lightweight' };
	switch (decider) {
		case 'no_option':
			return { key: 'stranded', name: 'The Stranded' };
		case 'speed':
			return { key: 'minute', name: 'The Minute-Buyer' };
		case 'comfort':
			return { key: 'comfort', name: 'The Climate-Controlled' };
		case 'cost':
			return { key: 'economy', name: 'The False Economy' };
		case 'habit':
		default:
			return { key: 'default', name: 'The Default' };
	}
}

// ── Basis lines ──
// Slots: {mult} {cRank} {tot} {kg} {savedKg}. Each dirty-premium type keeps a
// {mult}-free variant so the line still works when the multiplier is too small to
// quote (very short trips, where switching saves little).

const BASIS: Record<string, string[]> = {
	featherweight: [
		"you travel under your own power. there's almost nothing here to weigh.",
		'no engine, no fuel, no real footprint. about {kg} kg for the whole year, if that.'
	],
	offgrid: [
		"you ride what's already running. your slice of the air is a fraction of what the cab beside you spends.",
		'shared transit, shared engine. the bus was making that trip with or without you on it.'
	],
	lightweight: [
		'carbon rank {cRank} of {tot}, lighter than the cars and autos around you, but still your own engine, your own fuel.',
		'low carbon per km, for a private vehicle. that is the kind reading. it is still petrol, still this traffic.'
	],
	stranded: [
		"no transit line reaches you. the {kg} kg a year is the network's gap, not a choice you were given.",
		'the footprint is real, but nothing cleaner runs your route yet. this one is not on you.'
	],
	minute: [
		'you spend emissions to save time, about {mult}× the cleaner route, for minutes this traffic mostly takes back.',
		'faster on paper. on this road the time saved and the carbon spent rarely balance.'
	],
	comfort: [
		'comfort, at roughly {mult}× the emissions of the cleaner option.',
		'door to door and climate-controlled, and heavier on the air than the route you skipped.'
	],
	economy: [
		'you chose this to spend less. the shared route costs less and emits less, about {mult}× less here.',
		'cheaper was available, and it was also cleaner. it usually is.'
	],
	default: [
		"not a decision so much as an unbroken habit, about {mult}× heavier than the switch you haven't made.",
		'you never chose this, you just never changed it. which is the part that can still change.'
	]
};

export function archetypeBasis(c: ComputedReceipt, id: string): string {
	const { key } = assignArchetype(c.trip.mode, c.trip.decider);
	const mult = c.multiplier;
	const vars = {
		mult: String(Math.round(mult)),
		cRank: String(c.modeRank.carbonRankFromDirtiest),
		tot: String(c.modeRank.totalModes),
		kg: comma(c.annualCommuteKg),
		savedKg: comma(c.halfSwap.savedKg)
	};

	let pool = BASIS[key];
	if (!isFinite(mult) || mult < 1.8) pool = pool.filter((l) => !l.includes('{mult}'));
	if (pool.length === 0) pool = BASIS[key]; // safety; every premium type has a {mult}-free line

	return interp(pick(id, 'arch-basis', pool), vars);
}
