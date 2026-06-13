import type { OtpItinerary, OtpLeg } from '$lib/utils/otp';
import { firstWithMode, type PlanBundle } from '$lib/utils/otp';

import type { Answers, Frequency, Mode } from './types';

export type CandidateKind = 'cab' | 'auto' | 'metro' | 'bus' | 'walk';
export type Glow = 'amber' | 'blue' | 'green' | 'red';

export type LegKind = 'walk' | 'bus' | 'metro' | 'cab' | 'auto';
export type Leg = { kind: LegKind; mins?: number; note?: string };

/** A drawable stretch of the route, in [lng, lat] coordinates. */
export type RouteSegment = { coords: [number, number][]; kind: LegKind; color: string };

export type RouteCandidate = {
	id: string;
	kind: CandidateKind;
	label: string;
	etaMin: number;
	costINR: number;
	legs: Leg[];
	glow: Glow;
	/** Per-leg geometry for the map (omitted on legacy/synthetic candidates). */
	segments?: RouteSegment[];
	/** The raw OTP itinerary this candidate was built from. */
	itinerary?: OtpItinerary;
};

// Segment colours for the map overlay.
const COLOR_WALK = '#666666';
const COLOR_METRO = '#000000';
const COLOR_BUS = '#0f883b';
const COLOR_ROAD = '#1c1c1c';

const MAX_WALK_KM = 2.5; // beyond this, walk-only stops being a sensible option
const MAX_AUTO_KM = 12;

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

function legMins(seconds: number): number {
	return Math.max(1, Math.round(seconds / 60));
}

// OTP's CAR routing is free-flow; Bengaluru traffic rarely is. Scale driving
// time up by a congestion factor that depends on the current time of day
// (the kiosk always plans a trip for "now").
function istHour(d: Date): number {
	// IST is UTC+5:30 — derive the hour from UTC so the machine's timezone
	// doesn't matter.
	const istMinutes = (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
	return Math.floor(istMinutes / 60);
}

function carTrafficFactor(hour: number): number {
	if (hour >= 8 && hour < 11) return 1.65; // morning peak
	if (hour >= 17 && hour < 21) return 1.85; // evening peak (worst)
	if (hour >= 11 && hour < 17) return 1.4; // midday
	if (hour >= 21 && hour < 23) return 1.35; // evening wind-down
	if (hour >= 6 && hour < 8) return 1.3; // early morning ramp
	return 1.15; // night / pre-dawn
}

function carMinutes(it: OtpItinerary, now: Date = new Date()): number {
	const factor = carTrafficFactor(istHour(now));
	return Math.max(1, Math.round((it.duration / 60) * factor));
}

// App-cab fare ≈ base + per-km + per-minute (Ola/Uber-style, Bengaluru).
function cabFare(km: number, minutes: number): number {
	return Math.max(80, Math.round(50 + 14 * km + 1.5 * minutes));
}

// Auto-rickshaw ≈ ₹30 flagdown (first ~2 km) then ~₹15/km.
function autoFare(km: number): number {
	return Math.max(40, Math.round(35 + 15 * km));
}

function kmOfMode(it: OtpItinerary, modes: OtpLeg['mode'][]): number {
	return it.legs.filter((l) => modes.includes(l.mode)).reduce((s, l) => s + l.distance, 0) / 1000;
}

function legKindFor(mode: OtpLeg['mode'], candidateKind: CandidateKind): LegKind {
	switch (mode) {
		case 'SUBWAY':
		case 'RAIL':
		case 'TRAM':
			return 'metro';
		case 'BUS':
			return 'bus';
		case 'CAR':
			return candidateKind === 'auto' ? 'auto' : 'cab';
		default:
			return 'walk';
	}
}

function colorFor(leg: OtpLeg, kind: LegKind): string {
	if (kind === 'metro') return leg.route?.color ? `#${leg.route.color}` : COLOR_METRO;
	if (kind === 'bus') return leg.route?.color ? `#${leg.route.color}` : COLOR_BUS;
	if (kind === 'cab' || kind === 'auto') return COLOR_ROAD;
	return COLOR_WALK;
}

// Card leg list: one entry per OTP leg, in order.
function legsFromItinerary(it: OtpItinerary, candidateKind: CandidateKind): Leg[] {
	return it.legs.map((l) => {
		const kind = legKindFor(l.mode, candidateKind);
		const leg: Leg = { kind, mins: legMins(l.duration) };
		if ((kind === 'bus' || kind === 'metro') && l.route?.shortName) {
			leg.note = l.route.shortName;
		}
		return leg;
	});
}

// Map geometry: one drawable stretch per OTP leg.
export function itineraryToSegments(
	it: OtpItinerary,
	candidateKind: CandidateKind = 'cab'
): RouteSegment[] {
	return it.legs
		.filter((l) => l.coords.length >= 2)
		.map((l) => {
			const kind = legKindFor(l.mode, candidateKind);
			return { coords: l.coords, kind, color: colorFor(l, kind) };
		});
}

function transitStationNames(it: OtpItinerary): { origin?: string; destination?: string } {
	const transit = it.legs.filter((l) => l.transitLeg);
	if (transit.length === 0) return {};
	return {
		origin: transit[0].from.name,
		destination: transit[transit.length - 1].to.name
	};
}

type ScoredCandidate = RouteCandidate & { feasible: boolean };

/**
 * Build the ranked route options from OTP itineraries. Costs are estimated
 * locally (the OTP instance doesn't expose fare data); everything else —
 * geometry, durations, stops, routing — comes from OTP.
 */
export function buildOtpCandidates(answers: Answers, bundle: PlanBundle): RouteCandidate[] {
	const all: ScoredCandidate[] = [];

	// Metro (with walking access on either end, plus any in-network transfer).
	const metroIt = firstWithMode(bundle.metro, 'SUBWAY');
	if (metroIt) {
		const km = kmOfMode(metroIt, ['SUBWAY', 'RAIL', 'TRAM']);
		all.push({
			id: 'metro',
			kind: 'metro',
			label: 'METRO',
			etaMin: legMins(metroIt.duration),
			costINR: estimateMetroFare(km),
			legs: legsFromItinerary(metroIt, 'metro'),
			glow: 'blue',
			segments: itineraryToSegments(metroIt, 'metro'),
			itinerary: metroIt,
			feasible: true
		});
	}

	// Bus (with walking access; OTP resolves any transfers).
	const busIt = firstWithMode(bundle.bus, 'BUS');
	if (busIt) {
		const km = kmOfMode(busIt, ['BUS']);
		all.push({
			id: 'bus',
			kind: 'bus',
			label: 'BUS',
			etaMin: legMins(busIt.duration),
			costINR: busFareFor(km),
			legs: legsFromItinerary(busIt, 'bus'),
			glow: 'green',
			segments: itineraryToSegments(busIt, 'bus'),
			itinerary: busIt,
			feasible: true
		});
	}

	// Cab & auto share the same driving geometry from OTP's CAR plan.
	const carIt = bundle.car[0] ?? null;
	if (carIt && carIt.distanceKm > 0) {
		const dist = carIt.distanceKm;
		const carMin = carMinutes(carIt);
		all.push({
			id: 'cab',
			kind: 'cab',
			label: 'CAB',
			etaMin: carMin,
			costINR: cabFare(dist, carMin),
			legs: legsFromItinerary(carIt, 'cab'),
			glow: 'amber',
			segments: itineraryToSegments(carIt, 'cab'),
			itinerary: carIt,
			feasible: true
		});
		all.push({
			id: 'auto',
			kind: 'auto',
			label: 'AUTO',
			etaMin: carMin,
			costINR: autoFare(dist),
			legs: legsFromItinerary(carIt, 'auto'),
			glow: 'amber',
			segments: itineraryToSegments(carIt, 'auto'),
			itinerary: carIt,
			feasible: dist <= MAX_AUTO_KM
		});
	}

	// Walk-only (only sensible for short trips).
	const walkIt = bundle.walk[0] ?? null;
	if (walkIt && walkIt.distanceKm > 0) {
		all.push({
			id: 'walk',
			kind: 'walk',
			label: 'WALK',
			etaMin: legMins(walkIt.duration),
			costINR: 0,
			legs: legsFromItinerary(walkIt, 'walk'),
			glow: 'green',
			segments: itineraryToSegments(walkIt, 'walk'),
			itinerary: walkIt,
			feasible: walkIt.distanceKm <= MAX_WALK_KM
		});
	}

	const feasible = all.filter((c) => c.feasible);
	const scored = feasible
		.map((c) => ({ c, score: scoreCandidate(c, answers) }))
		.sort((a, b) => b.score - a.score || a.c.etaMin - b.c.etaMin);

	return scored.slice(0, 3).map(({ c }) => stripFeasible(c));
}

/** Representative trip distance (km) for emissions/HUD, mode-independent. */
export function tripDistanceKm(bundle: PlanBundle): number {
	const primary =
		firstWithMode(bundle.metro, 'SUBWAY') ??
		firstWithMode(bundle.bus, 'BUS') ??
		bundle.car[0] ??
		bundle.walk[0] ??
		null;
	return primary ? primary.distanceKm : 0;
}

/** Origin/destination transit station names, taken from the metro itinerary. */
export function stationNames(bundle: PlanBundle): { origin?: string; destination?: string } {
	const metroIt = firstWithMode(bundle.metro, 'SUBWAY');
	return metroIt ? transitStationNames(metroIt) : {};
}

function stripFeasible(c: ScoredCandidate): RouteCandidate {
	return {
		id: c.id,
		kind: c.kind,
		label: c.label,
		etaMin: c.etaMin,
		costINR: c.costINR,
		legs: c.legs,
		glow: c.glow,
		segments: c.segments,
		itinerary: c.itinerary
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
