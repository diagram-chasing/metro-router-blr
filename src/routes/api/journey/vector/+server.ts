// GET /api/journey/vector?o=lng,lat&d=lng,lat
// Returns a TouchDesigner-friendly VectorJourney JSON for the given origin/destination.
//
// Routing comes from the OpenTripPlanner instance (multimodal). We default to the
// metro itinerary (falling back to bus, then car, then walk) and serialise it into
// the flat points/segments VectorJourney shape.
//
// Notes:
// - The project uses adapter-static; this endpoint runs only under `vite dev`.
// - event.fetch is threaded into planAllModes so the OTP request is issued from
//   the same context as the incoming request.

import type { RequestHandler } from '@sveltejs/kit';

import { planAllModes, firstWithMode } from '$lib/utils/otp';
import { buildVectorJourneyFromItinerary } from '$lib/utils/vectorExport';

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

	const bundle = await planAllModes(origin, destination, fetch);
	const itinerary =
		firstWithMode(bundle.metro, 'SUBWAY') ??
		firstWithMode(bundle.bus, 'BUS') ??
		bundle.car[0] ??
		bundle.walk[0] ??
		null;

	if (!itinerary) {
		return new Response(
			JSON.stringify({ error: 'Could not compute journey for the given coordinates.' }),
			{ status: 422, headers: { 'Content-Type': 'application/json', ...CORS } }
		);
	}

	// OTP doesn't expose fares on this instance; leave price unset for the raw export.
	const vector = buildVectorJourneyFromItinerary(origin, destination, itinerary, { priceINR: 0 });

	return new Response(JSON.stringify(vector), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...CORS
		}
	});
};
