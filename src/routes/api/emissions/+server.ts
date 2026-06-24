// GET /api/emissions?grid=raw|diff|cf&decay=<km>&shift=<0..1>
//
// Returns the accumulating CO₂e emissions field as a normalised grid the /emissions
// page draws as a grayscale raster. See emissionsGrid.ts.

import type { RequestHandler } from '@sveltejs/kit';

import { buildField, type GridType } from '$lib/server/emissionsGrid';

export const prerender = false;

export const GET: RequestHandler = async ({ url }) => {
	const gridParam = url.searchParams.get('grid');
	const type: GridType = gridParam === 'diff' || gridParam === 'cf' ? gridParam : 'raw';
	const decayParam = Number(url.searchParams.get('decay'));
	const decayKm = isFinite(decayParam) && decayParam > 0 ? decayParam : undefined;
	const shiftRaw = url.searchParams.get('shift');
	const shiftParam = shiftRaw === null ? NaN : Number(shiftRaw);
	const shift = isFinite(shiftParam) && shiftParam >= 0 && shiftParam <= 1 ? shiftParam : undefined;
	const cellParam = Number(url.searchParams.get('cell'));
	const cell = isFinite(cellParam) && cellParam >= 0.0025 && cellParam <= 0.02 ? cellParam : undefined;

	const field = buildField({ type, decayKm, shift, cell });

	return new Response(JSON.stringify({ grid: type, ...field }), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*'
		}
	});
};
