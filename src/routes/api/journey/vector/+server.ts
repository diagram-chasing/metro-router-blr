// GET /api/journey/vector?o=lng,lat&d=lng,lat
// Returns a TouchDesigner-friendly VectorJourney JSON for the given origin/destination.
//
// Notes:
// - The project uses adapter-static; this endpoint runs only under `vite dev`
//   (i.e. the dev server). For exhibition/installation use, run `pnpm dev` on
//   the same machine that hosts TouchDesigner and point TD's Web Client DAT at
//   http://localhost:5173/api/journey/vector
// - event.fetch is threaded into JourneyCalculator/computeMetroSegments so that
//   their relative-URL fetches (/voronoi.geojson, /points.geojson, /bmrcl.geojson)
//   resolve against this request's origin.

import type { RequestHandler } from '@sveltejs/kit';
import { JourneyCalculator } from '$lib/utils/JourneyCalculator';
import { computeMetroSegments } from '$lib/utils/mapHelpers';
import { buildVectorJourney } from '$lib/utils/vectorExport';

export const prerender = false;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

function parseLngLat(raw: string | null): [number, number] | null {
	if (!raw) return null;
	const parts = raw.split(',').map((s) => Number(s.trim()));
	if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
	return [parts[0], parts[1]];
}

export const OPTIONS: RequestHandler = async () => new Response(null, { status: 204, headers: CORS });

export const GET: RequestHandler = async ({ url, fetch }) => {
	const origin = parseLngLat(url.searchParams.get('o'));
	const destination = parseLngLat(url.searchParams.get('d'));

	if (!origin || !destination) {
		return new Response(
			JSON.stringify({
				error: 'Missing or malformed query params. Expected o=lng,lat and d=lng,lat.'
			}),
			{ status: 400, headers: { 'Content-Type': 'application/json', ...CORS } }
		);
	}

	const calc = new JourneyCalculator(false, fetch);
	await Promise.all([calc.loadVoronoiData(), calc.loadStationPoints()]);

	const [journey, segments] = await Promise.all([
		calc.calculateJourney(origin, destination),
		computeMetroSegments({ coordinates: origin }, { coordinates: destination }, fetch)
	]);

	if (!journey || !segments) {
		return new Response(
			JSON.stringify({ error: 'Could not compute journey for the given coordinates.' }),
			{ status: 422, headers: { 'Content-Type': 'application/json', ...CORS } }
		);
	}

	const vector = buildVectorJourney(origin, destination, journey, segments);

	return new Response(JSON.stringify(vector), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...CORS
		}
	});
};
