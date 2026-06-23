// Shared lng/lat → pixel projection for the wall flow field. Same projection
// family as the receipt's RouteMap (d3 geoMercator + fitExtent), so the dot-matrix
// context layer and the flow art register over one another exactly.

import { geoMercator } from 'd3-geo';

export type Bbox = [number, number, number, number]; // [lonMin, latMin, lonMax, latMax]
export type Projector = {
	width: number;
	height: number;
	project: (lng: number, lat: number) => [number, number];
	unproject: (x: number, y: number) => [number, number];
};

// A whole-network fallback extent so the context can draw before /api/emissions
// returns. Covers the Namma Metro Green + Purple corridors with margin.
export const BENGALURU_BBOX: Bbox = [77.46, 12.82, 77.76, 13.12];

// Fit `bbox` into width×height (minus pad) preserving aspect, north-up. d3 handles
// the mercator math + latitude correction; we just wrap it in a stable interface.
export function makeProjector(bbox: Bbox, width: number, height: number, pad = 12): Projector {
	const [x0, y0, x1, y1] = bbox;
	const frame = {
		type: 'Feature' as const,
		properties: {},
		geometry: {
			type: 'LineString' as const,
			coordinates: [
				[x0, y0],
				[x1, y0],
				[x1, y1],
				[x0, y1]
			]
		}
	};
	const m = geoMercator().fitExtent(
		[
			[pad, pad],
			[width - pad, height - pad]
		],
		frame
	);
	const project = (lng: number, lat: number): [number, number] => {
		const p = m([lng, lat]);
		return p ? [p[0], p[1]] : [0, 0];
	};
	const unproject = (x: number, y: number): [number, number] => {
		const p = m.invert?.([x, y]);
		return p ? [p[0], p[1]] : [0, 0];
	};
	return { width, height, project, unproject };
}
