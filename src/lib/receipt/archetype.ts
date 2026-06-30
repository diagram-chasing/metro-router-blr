import type { Mode } from '$lib/exhibit/types';
import type { ComputedReceipt } from './receipt';
import { comma, interp, pick } from './receipt';

// ── Assignment ──
// Deterministic, keyed off the mode alone. The clean / two-wheeler clusters are the
// meaningful splits; everything driving its own engine on this traffic is the default.

type Archetype = { key: string; name: string };

export function assignArchetype(mode: Mode): Archetype {
	if (mode === 'active') return { key: 'featherweight', name: 'The Featherweight' };
	if (mode === 'bus' || mode === 'metro') return { key: 'offgrid', name: 'The Off-Grid Commuter' };
	if (mode === 'two_wheeler') return { key: 'lightweight', name: 'The Lightweight' };
	return { key: 'default', name: 'The Default' };
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
	default: [
		"not a decision so much as an unbroken habit, about {mult}× heavier than the switch you haven't made.",
		'you never chose this, you just never changed it. which is the part that can still change.'
	]
};

export function archetypeBasis(c: ComputedReceipt, id: string): string {
	const { key } = assignArchetype(c.trip.mode);
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
