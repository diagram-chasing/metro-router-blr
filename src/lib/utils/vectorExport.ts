// Builds a TouchDesigner-friendly "vector journey" from a completed OTP itinerary.
//
// Output shape: a single polyline expressed as two flat arrays — `points` (geometry)
// and `segments` (per-stretch styling/metadata). Adjacent segments do not share point
// indices; the polyline is rendered by visiting points in order.

import type { OtpItinerary, OtpLeg } from './otp';

export type SegmentKind = 'walk' | 'metro';

export interface VectorPoint {
	i: number;
	x: number;
	y: number;
	lng: number;
	lat: number;
	t: number;
	seg: number;
}

export interface VectorSegment {
	id: number;
	kind: SegmentKind;
	label: string;
	lineColor: string;
	fromIndex: number;
	toIndex: number;
	lengthM: number;
	durationMin: number;
	meta: Record<string, unknown>;
}

export interface VectorJourney {
	version: 1;
	origin: { lng: number; lat: number };
	destination: { lng: number; lat: number };
	bbox: [number, number, number, number];
	ref: { lng: number; lat: number };
	summary: {
		totalTimeMin: number;
		totalDistanceKm: number;
		priceINR: number;
		requiresTransfer: boolean;
	};
	points: VectorPoint[];
	segments: VectorSegment[];
}

const WALK = '#9CA3AF';
const METRO_FALLBACK = '#000000';

const EARTH_R = 6378137;
const D2R = Math.PI / 180;

function project(lng: number, lat: number, refLng: number, refLat: number): [number, number] {
	const x = EARTH_R * (lng - refLng) * D2R * Math.cos(refLat * D2R);
	const y = EARTH_R * (lat - refLat) * D2R;
	return [x, y];
}

function isMetroLeg(mode: OtpLeg['mode']): boolean {
	return mode === 'SUBWAY' || mode === 'RAIL' || mode === 'TRAM';
}

function legColor(leg: OtpLeg): string {
	if (isMetroLeg(leg.mode)) return leg.route?.color ? `#${leg.route.color}` : METRO_FALLBACK;
	return WALK;
}

function legLabel(leg: OtpLeg): string {
	if (isMetroLeg(leg.mode)) {
		const line = leg.route?.shortName ?? leg.route?.longName ?? 'Metro';
		return `${line}: ${leg.from.name} → ${leg.to.name}`;
	}
	if (leg.mode === 'BUS') {
		const line = leg.route?.shortName ?? 'Bus';
		return `Bus ${line}: ${leg.from.name} → ${leg.to.name}`;
	}
	if (leg.mode === 'CAR') return `Drive to ${leg.to.name}`;
	return `Walk to ${leg.to.name}`;
}

/**
 * Build a VectorJourney from an OTP itinerary. `priceINR` is supplied by the
 * caller (OTP doesn't expose fares on this instance).
 */
export function buildVectorJourneyFromItinerary(
	origin: [number, number],
	destination: [number, number],
	itinerary: OtpItinerary,
	opts: { priceINR: number; distanceKm?: number }
): VectorJourney {
	type RawSeg = {
		kind: SegmentKind;
		label: string;
		color: string;
		coords: [number, number][];
		meta: Record<string, unknown>;
		durationMin: number;
	};

	const raw: RawSeg[] = itinerary.legs
		.filter((l) => l.coords.length >= 2)
		.map((l) => ({
			kind: isMetroLeg(l.mode) ? 'metro' : 'walk',
			label: legLabel(l),
			color: legColor(l),
			coords: l.coords,
			meta: {
				mode: l.mode,
				route: l.route?.shortName ?? l.route?.longName ?? null,
				headsign: l.headsign ?? null,
				fromStation: l.from.name,
				toStation: l.to.name,
				distanceM: Math.round(l.distance),
				transit: l.transitLeg,
				intermediateStops: l.intermediateStops.map((s) => s.name)
			},
			durationMin: l.duration / 60
		}));

	const transitLegCount = itinerary.legs.filter((l) => l.transitLeg).length;

	// Flatten into points + segments. Adjacent segments don't share point indices;
	// the duplicated boundary point keeps the polyline contiguous.
	const points: VectorPoint[] = [];
	const segments: VectorSegment[] = [];
	for (const r of raw) {
		if (r.coords.length === 0) continue;
		const fromIndex = points.length;
		for (const [lng, lat] of r.coords) {
			points.push({ i: points.length, x: 0, y: 0, lng, lat, t: 0, seg: segments.length });
		}
		segments.push({
			id: segments.length,
			kind: r.kind,
			label: r.label,
			lineColor: r.color,
			fromIndex,
			toIndex: points.length,
			lengthM: 0,
			durationMin: r.durationMin,
			meta: r.meta
		});
	}

	let minLng = Infinity,
		minLat = Infinity,
		maxLng = -Infinity,
		maxLat = -Infinity;
	for (const p of points) {
		if (p.lng < minLng) minLng = p.lng;
		if (p.lat < minLat) minLat = p.lat;
		if (p.lng > maxLng) maxLng = p.lng;
		if (p.lat > maxLat) maxLat = p.lat;
	}
	const refLng = points.length ? (minLng + maxLng) / 2 : origin[0];
	const refLat = points.length ? (minLat + maxLat) / 2 : origin[1];

	for (const p of points) {
		const [x, y] = project(p.lng, p.lat, refLng, refLat);
		p.x = x;
		p.y = y;
	}

	const cumLen: number[] = new Array(points.length);
	if (points.length > 0) cumLen[0] = 0;
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x;
		const dy = points[i].y - points[i - 1].y;
		cumLen[i] = cumLen[i - 1] + Math.sqrt(dx * dx + dy * dy);
	}
	const totalLen = points.length ? cumLen[cumLen.length - 1] || 1 : 1;
	for (let i = 0; i < points.length; i++) points[i].t = cumLen[i] / totalLen;

	for (const seg of segments) {
		if (seg.toIndex > seg.fromIndex) {
			seg.lengthM = cumLen[seg.toIndex - 1] - cumLen[seg.fromIndex];
		}
	}

	return {
		version: 1,
		origin: { lng: origin[0], lat: origin[1] },
		destination: { lng: destination[0], lat: destination[1] },
		bbox: [minLng, minLat, maxLng, maxLat],
		ref: { lng: refLng, lat: refLat },
		summary: {
			totalTimeMin: Math.round(itinerary.duration / 60),
			totalDistanceKm: opts.distanceKm ?? itinerary.distanceKm,
			priceINR: opts.priceINR,
			requiresTransfer: transitLegCount > 1
		},
		points,
		segments
	};
}
