// Builds a TouchDesigner-friendly "vector journey" from a completed JourneyDetails
// + the metro FeatureCollection produced by computeMetroSegments().
//
// Output shape: a single polyline expressed as two flat arrays — `points` (geometry)
// and `segments` (per-stretch styling/metadata). Adjacent segments do not share point
// indices; the polyline is rendered by visiting points in order.

import type { JourneyDetails } from './JourneyCalculator';
import { stations } from '$lib/config/stations';
import pkg from '@mapbox/polyline';
const { decode } = pkg;

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

const PURPLE = '#951A74';
const GREEN = '#0F883B';
const WALK = '#9CA3AF';
const MAJESTIC = 'Nadaprabhu Kempegowda Station, Majestic';

const EARTH_R = 6378137;
const D2R = Math.PI / 180;

function project(lng: number, lat: number, refLng: number, refLat: number): [number, number] {
	const x = EARTH_R * (lng - refLng) * D2R * Math.cos(refLat * D2R);
	const y = EARTH_R * (lat - refLat) * D2R;
	return [x, y];
}

function projectOntoPolyline(coords: [number, number][], point: [number, number]) {
	let best = { segIdx: 0, t: 0, point: coords[0], distSq: Infinity };
	for (let i = 0; i < coords.length - 1; i++) {
		const [x1, y1] = coords[i];
		const [x2, y2] = coords[i + 1];
		const dx = x2 - x1;
		const dy = y2 - y1;
		const len2 = dx * dx + dy * dy;
		const t =
			len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - x1) * dx + (point[1] - y1) * dy) / len2));
		const pp: [number, number] = [x1 + t * dx, y1 + t * dy];
		const ddx = pp[0] - point[0];
		const ddy = pp[1] - point[1];
		const distSq = ddx * ddx + ddy * ddy;
		if (distSq < best.distSq) best = { segIdx: i, t, point: pp, distSq };
	}
	return best;
}

// Slice a polyline at each cut station's nearest point, producing one sub-polyline per hop.
function subdivideAtStations(
	legCoords: [number, number][],
	cuts: { name: string; coords: [number, number] }[]
): { coords: [number, number][] }[] {
	if (legCoords.length < 2) return [{ coords: legCoords }];
	if (cuts.length === 0) return [{ coords: legCoords }];

	const projections = cuts
		.map((c) => projectOntoPolyline(legCoords, c.coords))
		.sort((a, b) => a.segIdx - b.segIdx || a.t - b.t);

	const result: { coords: [number, number][] }[] = [];
	let cursor = 0;
	let prevPoint: [number, number] = legCoords[0];
	for (const proj of projections) {
		const middle = legCoords.slice(cursor + 1, proj.segIdx + 1);
		result.push({ coords: [prevPoint, ...middle, proj.point] });
		cursor = proj.segIdx;
		prevPoint = proj.point;
	}
	result.push({ coords: [prevPoint, ...legCoords.slice(cursor + 1)] });
	return result;
}

// @mapbox/polyline decode returns [[lat, lng], ...]; we want [[lng, lat], ...].
function decodePolylineLngLat(encoded: string): [number, number][] {
	if (!encoded) return [];
	return (decode(encoded) as [number, number][]).map((p) => [p[1], p[0]] as [number, number]);
}

function stationsBetween(
	fromName: string,
	toName: string,
	color: 'purple' | 'green'
): { name: string; coordinates: [number, number] }[] {
	const sameColor = stations.filter((s) => s.color === color);
	const fromIdx = sameColor.findIndex((s) => s.name === fromName);
	const toIdx = sameColor.findIndex((s) => s.name === toName);
	if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return [];
	const [a, b] = fromIdx < toIdx ? [fromIdx + 1, toIdx] : [toIdx + 1, fromIdx];
	const slice = sameColor.slice(a, b).map((s) => ({ name: s.name, coordinates: s.coordinates }));
	return fromIdx < toIdx ? slice : slice.reverse();
}

function lineColorOf(color: string | undefined): string {
	return color === 'purple' ? PURPLE : GREEN;
}

function lineNameOf(color: string | undefined): 'Purple' | 'Green' {
	return color === 'purple' ? 'Purple' : 'Green';
}

export function buildVectorJourney(
	origin: [number, number],
	destination: [number, number],
	journey: JourneyDetails,
	metroFC: GeoJSON.FeatureCollection
): VectorJourney {
	const originStationObj = stations.find((s) => s.name === journey.originStation);
	const destStationObj = stations.find((s) => s.name === journey.destinationStation);

	const walk1 = decodePolylineLngLat(journey.firstLegWalkRoute);
	const walk2 = decodePolylineLngLat(journey.secondLegWalkRoute);

	const metroLegs: [number, number][][] = metroFC.features.map(
		(f) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][]
	);

	type RawSeg = {
		kind: SegmentKind;
		label: string;
		color: string;
		coords: [number, number][];
		meta: Record<string, unknown>;
		durationMin: number;
	};
	const raw: RawSeg[] = [];

	raw.push({
		kind: 'walk',
		label: `Walk to ${journey.originStation}`,
		color: WALK,
		coords: walk1,
		meta: {
			exitGate: journey.firstLegExit,
			distanceM: journey.firstLegWalkDistance,
			toStation: journey.originStation
		},
		durationMin: journey.firstLegWalkTime
	});

	if (metroLegs[0] && metroLegs[0].length >= 2 && originStationObj) {
		const lineName = lineNameOf(originStationObj.color);
		const lineColor = lineColorOf(originStationObj.color);
		const endStationName = journey.requiresTransfer ? MAJESTIC : journey.destinationStation;
		const intermediate = stationsBetween(
			journey.originStation,
			endStationName,
			originStationObj.color as 'purple' | 'green'
		);
		const subsegs = subdivideAtStations(metroLegs[0], intermediate.map((s) => ({ name: s.name, coords: s.coordinates })));
		const namesInOrder = [journey.originStation, ...intermediate.map((s) => s.name), endStationName];
		const hopDuration =
			journey.firstLegMetroStops > 0
				? journey.firstLegMetroTime / journey.firstLegMetroStops
				: journey.firstLegMetroTime;
		subsegs.forEach((sub, k) => {
			raw.push({
				kind: 'metro',
				label: `${lineName} Line: ${namesInOrder[k]} → ${namesInOrder[k + 1]}`,
				color: lineColor,
				coords: sub.coords,
				meta: {
					lineName,
					platform: journey.firstLegPlatform,
					direction: journey.firstLegDirectionName,
					fromStation: namesInOrder[k],
					toStation: namesInOrder[k + 1],
					hopIndex: k
				},
				durationMin: hopDuration
			});
		});
	}

	if (journey.requiresTransfer && metroLegs[1] && metroLegs[1].length >= 2 && destStationObj) {
		const lineName = lineNameOf(destStationObj.color);
		const lineColor = lineColorOf(destStationObj.color);
		const intermediate = stationsBetween(
			MAJESTIC,
			journey.destinationStation,
			destStationObj.color as 'purple' | 'green'
		);
		const subsegs = subdivideAtStations(metroLegs[1], intermediate.map((s) => ({ name: s.name, coords: s.coordinates })));
		const namesInOrder = [MAJESTIC, ...intermediate.map((s) => s.name), journey.destinationStation];
		const hopDuration =
			journey.secondLegMetroStops > 0
				? journey.secondLegMetroTime / journey.secondLegMetroStops
				: journey.secondLegMetroTime;
		subsegs.forEach((sub, k) => {
			raw.push({
				kind: 'metro',
				label: `${lineName} Line: ${namesInOrder[k]} → ${namesInOrder[k + 1]}`,
				color: lineColor,
				coords: sub.coords,
				meta: {
					lineName,
					platform: journey.secondLegPlatform,
					direction: journey.secondLegDirectionName,
					fromStation: namesInOrder[k],
					toStation: namesInOrder[k + 1],
					hopIndex: k
				},
				durationMin: hopDuration
			});
		});
	}

	raw.push({
		kind: 'walk',
		label: `Walk to destination`,
		color: WALK,
		coords: walk2,
		meta: {
			exitGate: journey.secondLegExit,
			distanceM: journey.secondLegWalkDistance,
			fromStation: journey.destinationStation
		},
		durationMin: journey.secondLegWalkTime
	});

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
			totalTimeMin: journey.totalTime,
			totalDistanceKm: journey.totalDistanceKm,
			priceINR: journey.price,
			requiresTransfer: journey.requiresTransfer
		},
		points,
		segments
	};
}
