import type { NearestBusStop } from '$lib/utils/busStops';

import type { Answers, Frequency, Mode } from './types';

export type CandidateKind = 'cab' | 'auto' | 'metro' | 'bus' | 'walk';
export type Glow = 'amber' | 'blue' | 'green' | 'red';

export type LegKind = 'walk' | 'bus' | 'metro' | 'cab' | 'auto';
export type Leg = { kind: LegKind; mins?: number; note?: string };

export type RouteCandidate = {
	id: string;
	kind: CandidateKind;
	label: string;
	etaMin: number;
	costINR: number;
	legs: Leg[];
	glow: Glow;
};

export type MetroLegInfo = {
	originStation?: string;
	destinationStation?: string;
	totalMetroMin?: number;
	originWalkMeters?: number;
	destinationWalkMeters?: number;
};

const MAX_WALK_M = 1200;
const SHORT_AUTO_MIN = 5;
const LONG_AUTO_MIN = 12;
const SHORT_AUTO_COST = 50;
const LONG_AUTO_COST = 120;
const BUS_WAIT_MIN = 8;
const WALK_MPM = 80;

function walkMin(meters: number): number {
	return Math.max(1, Math.round(meters / WALK_MPM));
}

function busFareFor(km: number): number {
	if (km <= 2) return 5;
	if (km <= 5) return 10;
	if (km <= 10) return 18;
	if (km <= 18) return 25;
	return 35;
}

function estimateMetroFare(km: number): number {
	if (km <= 2) return 20;
	if (km <= 5) return 30;
	if (km <= 10) return 45;
	if (km <= 18) return 55;
	return 65;
}

export function buildCandidates(
	answers: Answers,
	metro: MetroLegInfo,
	originBus: NearestBusStop | null,
	destBus: NearestBusStop | null
): RouteCandidate[] {
	const dist = answers.distanceKm ?? 0;
	const all: (RouteCandidate & { feasible: boolean })[] = [];

	all.push({
		id: 'cab_direct',
		kind: 'cab',
		label: 'CAB',
		etaMin: Math.max(8, Math.round(dist * 3)),
		costINR: Math.round(dist * 15 + 40),
		legs: [{ kind: 'cab' }],
		glow: 'amber',
		feasible: dist > 0
	});

	all.push({
		id: 'auto_direct',
		kind: 'auto',
		label: 'AUTO',
		etaMin: Math.max(8, Math.round(dist * 3.5)),
		costINR: Math.round(dist * 18 + 30),
		legs: [{ kind: 'auto' }],
		glow: 'amber',
		feasible: dist > 0 && dist <= 12
	});

	const metroOk =
		!!metro.originStation && !!metro.destinationStation && (metro.totalMetroMin ?? 0) > 0;

	const oWalk = metro.originWalkMeters ?? 0;
	const dWalk = metro.destinationWalkMeters ?? 0;

	if (metroOk) {
		const metroMin = metro.totalMetroMin ?? 0;
		const oFar = oWalk > MAX_WALK_M;
		const dFar = dWalk > MAX_WALK_M;

		// Pure walk both ends
		all.push({
			id: 'metro_walk',
			kind: 'metro',
			label: 'METRO',
			etaMin: walkMin(oWalk) + metroMin + walkMin(dWalk),
			costINR: estimateMetroFare(dist),
			legs: [
				{ kind: 'walk', mins: walkMin(oWalk) },
				{ kind: 'metro', mins: metroMin },
				{ kind: 'walk', mins: walkMin(dWalk) }
			],
			glow: 'blue',
			feasible: !oFar && !dFar
		});

		// Mixed: auto on whichever leg(s) are too far to walk. We keep this
		// available even when the feeder auto is long — better to surface
		// metro+auto than to drop metro entirely and confuse the user when
		// the map is still showing the metro polyline.
		const oLong = oWalk > 2500;
		const dLong = dWalk > 2500;
		const oLeg: Leg = oFar
			? { kind: 'auto', mins: oLong ? LONG_AUTO_MIN : SHORT_AUTO_MIN }
			: { kind: 'walk', mins: walkMin(oWalk) };
		const dLeg: Leg = dFar
			? { kind: 'auto', mins: dLong ? LONG_AUTO_MIN : SHORT_AUTO_MIN }
			: { kind: 'walk', mins: walkMin(dWalk) };
		const oCost = oFar ? (oLong ? LONG_AUTO_COST : SHORT_AUTO_COST) : 0;
		const dCost = dFar ? (dLong ? LONG_AUTO_COST : SHORT_AUTO_COST) : 0;
		const mixedLabel = oFar && dFar ? 'AUTO + METRO + AUTO' : 'METRO + AUTO';

		all.push({
			id: 'metro_mixed',
			kind: 'metro',
			label: mixedLabel,
			etaMin: (oLeg.mins ?? 0) + metroMin + (dLeg.mins ?? 0),
			costINR: estimateMetroFare(dist) + oCost + dCost,
			legs: [oLeg, { kind: 'metro', mins: metroMin }, dLeg],
			glow: 'blue',
			feasible: oFar || dFar
		});
	}

	const busOk =
		!!originBus && !!destBus && originBus.walkMeters <= 800 && destBus.walkMeters <= 800;

	if (originBus && destBus) {
		const headway = Math.max(originBus.headwayMin, destBus.headwayMin);
		const busTime = Math.round(dist * 4) + BUS_WAIT_MIN;

		all.push({
			id: 'bus_direct',
			kind: 'bus',
			label: 'BUS',
			etaMin: walkMin(originBus.walkMeters) + busTime + walkMin(destBus.walkMeters),
			costINR: busFareFor(dist),
			legs: [
				{ kind: 'walk', mins: walkMin(originBus.walkMeters) },
				{ kind: 'bus', note: `~${headway}m` },
				{ kind: 'walk', mins: walkMin(destBus.walkMeters) }
			],
			glow: 'green',
			feasible: busOk && dist > 0
		});
	}

	all.push({
		id: 'walk_only',
		kind: 'walk',
		label: 'WALK',
		etaMin: Math.round((dist * 1000) / WALK_MPM),
		costINR: 0,
		legs: [{ kind: 'walk', mins: Math.round((dist * 1000) / WALK_MPM) }],
		glow: 'green',
		feasible: dist > 0 && dist <= 1.5
	});

	const feasible = all.filter((c) => c.feasible);
	const scored = feasible
		.map((c) => ({ c, score: scoreCandidate(c, answers) }))
		.sort((a, b) => b.score - a.score || a.c.etaMin - b.c.etaMin);

	return scored.slice(0, 3).map(({ c }) => stripFeasible(c));
}

function stripFeasible(c: RouteCandidate & { feasible: boolean }): RouteCandidate {
	return {
		id: c.id,
		kind: c.kind,
		label: c.label,
		etaMin: c.etaMin,
		costINR: c.costINR,
		legs: c.legs,
		glow: c.glow
	};
}

// Mode preference is a soft +30 nudge. Decider is collected after this step,
// so don't read it here.
function scoreCandidate(c: RouteCandidate, a: Answers): number {
	let score = 0;
	score += modeBonus(c.kind, a.mode);
	score += frequencyBonus(c, a.frequency);
	score += distanceBonus(c, a.distanceKm ?? 0);
	return score;
}

function modeBonus(kind: CandidateKind, mode: Mode | undefined): number {
	if (!mode) return 0;
	const map: Record<Mode, CandidateKind[]> = {
		auto: ['auto'],
		cab_solo: ['cab'],
		cab_shared: ['cab'],
		car: ['cab'],
		two_wheeler: ['auto'],
		bus: ['bus'],
		metro: ['metro'],
		active: ['walk']
	};
	return (map[mode] ?? []).includes(kind) ? 30 : 0;
}

function frequencyBonus(c: RouteCandidate, freq: Frequency | undefined): number {
	if (!freq) return 0;
	if (freq === 'daily' || freq === 'few_weekly') {
		if (c.kind === 'bus') return 8;
		if (c.kind === 'metro') return 6;
		if (c.kind === 'cab') return -8;
	}
	if (freq === 'occasional') {
		if (c.kind === 'cab') return 6;
		if (c.kind === 'metro') return 3;
		if (c.kind === 'bus') return -4;
	}
	return 0;
}

function distanceBonus(c: RouteCandidate, dist: number): number {
	if (dist <= 1) {
		if (c.kind === 'walk') return 40;
		if (c.kind === 'auto') return 4;
		return -8;
	}
	if (dist <= 3) {
		if (c.kind === 'auto') return 8;
		if (c.kind === 'walk') return 4;
	}
	if (dist >= 12) {
		if (c.kind === 'metro') return 10;
		if (c.kind === 'cab') return 6;
		if (c.kind === 'bus') return -4;
	}
	return 0;
}
