// GET /api/aqi?metric=pm25|co2&grid=raw|diff&base=0|1&decay=<km>
//
// Returns the accumulating emissions field as a normalised grid the /aqi page
// draws as a grayscale raster (and TouchDesigner captures). See aqiGrid.ts.

import type { RequestHandler } from '@sveltejs/kit';

import { buildField, type GridType, type Metric } from '$lib/server/aqiGrid';

export const prerender = false;

export const GET: RequestHandler = async ({ url }) => {
	const metric: Metric = url.searchParams.get('metric') === 'co2' ? 'co2' : 'pm25';
	const type: GridType = url.searchParams.get('grid') === 'diff' ? 'diff' : 'raw';
	const base = url.searchParams.get('base') === '1';
	const decayParam = Number(url.searchParams.get('decay'));
	const decayKm = isFinite(decayParam) && decayParam > 0 ? decayParam : undefined;

	const field = buildField({ metric, type, base, decayKm });

	return new Response(JSON.stringify({ metric, grid: type, ...field }), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*'
		}
	});
};
