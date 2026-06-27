// GET /api/emissions?grid=raw|diff|cf&decay=<km>&shift=<0..1>&halfLife=<days>
//
// Returns the accumulating tailpipe-PM2.5 field as a normalised grid the homepage
// choropleth (CollectiveMap) draws. Rebuilt live from the stored routes on every request
// (no cache), so re-costing the modes only changes emissionsGrid.ts — existing data needs
// no migration. See emissionsGrid.ts. `halfLife` (days) tunes the slow rolling decay; 0
// disables it (pure accumulation).

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
	const halfLifeRaw = url.searchParams.get('halfLife');
	const halfLifeParam = halfLifeRaw === null ? NaN : Number(halfLifeRaw);
	const halfLifeDays = isFinite(halfLifeParam) && halfLifeParam >= 0 ? halfLifeParam : undefined;

	const field = buildField({ type, decayKm, shift, cell, halfLifeDays });

	return new Response(JSON.stringify({ grid: type, ...field }), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*'
		}
	});
};
