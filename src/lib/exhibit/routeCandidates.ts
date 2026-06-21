import type { OtpItinerary, OtpLeg } from '$lib/utils/otp';
import { firstWithMode, type PlanBundle } from '$lib/utils/otp';

import type { Answers, Mode } from './types';

export type CandidateKind = 'cab' | 'auto' | 'metro' | 'bus' | 'walk';
export type Glow = 'amber' | 'blue' | 'green' | 'red';

export type LegKind = 'walk' | 'bus' | 'metro' | 'cab' | 'auto';
export type Leg = { kind: LegKind; mins?: number; note?: string };

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

// Distance limits past which an option stops being offered.
const THRESHOLDS = {
	walkKm: 2.5, // beyond this, walk-only stops being sensible
	autoKm: 12 // beyond this, auto stops being offered
};

// How the visitor's answers nudge the ranking.
const SCORING = {
	modeMatch: 30, // Q1: option matches the visitor's usual mode
	modeMap: {
		auto: 'auto',
		cab_solo: 'cab',
		cab_shared: 'cab',
		car: 'cab',
		two_wheeler: 'auto',
		bus: 'bus',
		metro: 'metro',
		active: 'walk'
	} as Record<Mode, CandidateKind>,
	// Q2: frequent trips favour cheap transit; rare trips tolerate a cab.
	frequent: { bus: 8, metro: 6, cab: -8 } as Partial<Record<CandidateKind, number>>,
	occasional: { cab: 6, metro: 3, bus: -4 } as Partial<Record<CandidateKind, number>>,
	// Q3: trip length, in km, and the nudges for each band.
	veryShortKm: 1,
	shortKm: 3,
	longKm: 12,
	veryShort: { walk: 40, auto: 4, other: -8 },
	short: { auto: 8, walk: 4 } as Partial<Record<CandidateKind, number>>,
	long: { metro: 10, cab: 6, bus: -4 } as Partial<Record<CandidateKind, number>>
};

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


function istHour(d: Date): number {
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

// App-cab fare ≈ base + per-km + per-minute
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

// Per-leg display + map geometry, derived from the OTP itinerary.
function makeCandidate(
	it: OtpItinerary,
	base: Omit<RouteCandidate, 'legs' | 'segments' | 'itinerary'>
): RouteCandidate {
	return {
		...base,
		legs: legsFromItinerary(it, base.kind),
		segments: itineraryToSegments(it, base.kind),
		itinerary: it
	};
}

/**
 * Build the ranked route options from OTP itineraries. Costs are estimated
 * locally (the OTP instance doesn't expose fare data); everything else —
 * geometry, durations, stops, routing comes from OTP. Options past their
 * distance limit (auto/walk) are simply never added.
 */
export function buildOtpCandidates(answers: Answers, bundle: PlanBundle): RouteCandidate[] {
	const all: RouteCandidate[] = [];

	// Metro (walking access on either end, plus any in-network transfer).
	const metroIt = firstWithMode(bundle.metro, 'SUBWAY');
	if (metroIt) {
		const km = kmOfMode(metroIt, ['SUBWAY', 'RAIL', 'TRAM']);
		all.push(
			makeCandidate(metroIt, {
				id: 'metro',
				kind: 'metro',
				label: 'METRO',
				etaMin: legMins(metroIt.duration),
				costINR: estimateMetroFare(km),
				glow: 'blue'
			})
		);
	}

	// Bus (walking access; OTP resolves any transfers).
	const busIt = firstWithMode(bundle.bus, 'BUS');
	if (busIt) {
		const km = kmOfMode(busIt, ['BUS']);
		all.push(
			makeCandidate(busIt, {
				id: 'bus',
				kind: 'bus',
				label: 'BUS',
				etaMin: legMins(busIt.duration),
				costINR: busFareFor(km),
				glow: 'green'
			})
		);
	}

	// Cab & auto share OTP's CAR geometry; auto only when the trip is short enough.
	const carIt = bundle.car[0] ?? null;
	if (carIt && carIt.distanceKm > 0) {
		const dist = carIt.distanceKm;
		const carMin = carMinutes(carIt);
		all.push(
			makeCandidate(carIt, {
				id: 'cab',
				kind: 'cab',
				label: 'CAB',
				etaMin: carMin,
				costINR: cabFare(dist, carMin),
				glow: 'amber'
			})
		);
		if (dist <= THRESHOLDS.autoKm) {
			all.push(
				makeCandidate(carIt, {
					id: 'auto',
					kind: 'auto',
					label: 'AUTO',
					etaMin: carMin,
					costINR: autoFare(dist),
					glow: 'amber'
				})
			);
		}
	}

	// Walk-only, sensible only for short trips.
	const walkIt = bundle.walk[0] ?? null;
	if (walkIt && walkIt.distanceKm > 0 && walkIt.distanceKm <= THRESHOLDS.walkKm) {
		all.push(
			makeCandidate(walkIt, {
				id: 'walk',
				kind: 'walk',
				label: 'WALK',
				etaMin: legMins(walkIt.duration),
				costINR: 0,
				glow: 'green'
			})
		);
	}

	return all
		.map((c) => ({ c, s: score(c, answers) }))
		.sort((a, b) => b.s - a.s || a.c.etaMin - b.c.etaMin)
		.slice(0, 3)
		.map(({ c }) => c);
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

// Rank an option against the visitor's answers; higher is better.
function score(c: RouteCandidate, a: Answers): number {
	let s = 0;

	// Q1 usual mode.
	if (a.mode && SCORING.modeMap[a.mode] === c.kind) s += SCORING.modeMatch;

	// Q2 how often the trip is made.
	if (a.frequency === 'daily' || a.frequency === 'few_weekly') s += SCORING.frequent[c.kind] ?? 0;
	else if (a.frequency === 'occasional') s += SCORING.occasional[c.kind] ?? 0;

	// Q3 trip length.
	const dist = a.distanceKm ?? 0;
	if (dist <= SCORING.veryShortKm) {
		s +=
			c.kind === 'walk'
				? SCORING.veryShort.walk
				: c.kind === 'auto'
					? SCORING.veryShort.auto
					: SCORING.veryShort.other;
	} else if (dist <= SCORING.shortKm) {
		s += SCORING.short[c.kind] ?? 0;
	} else if (dist >= SCORING.longKm) {
		s += SCORING.long[c.kind] ?? 0;
	}

	return s;
}
