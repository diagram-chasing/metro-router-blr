// POST /api/journey/current  — store the latest browser-computed VectorJourney
// GET  /api/journey/current  — return the latest, or 404 if nothing posted yet
//
// Browser posts after each pick; TouchDesigner polls GET on a timer.

import type { RequestHandler } from '@sveltejs/kit';
import { getCurrent, setCurrent } from '$lib/server/journeyCache';
import type { VectorJourney } from '$lib/utils/vectorExport';

export const prerender = false;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS });

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...CORS }
		});
	}
	// Loose validation — trust internal callers (the browser app), but reject obvious garbage.
	const v = body as Partial<VectorJourney>;
	if (!v || typeof v !== 'object' || !Array.isArray(v.points) || !Array.isArray(v.segments)) {
		return new Response(JSON.stringify({ error: 'body is not a VectorJourney' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...CORS }
		});
	}
	setCurrent(body as VectorJourney);
	return new Response(null, { status: 204, headers: CORS });
};

export const GET: RequestHandler = async () => {
	const cur = getCurrent();
	if (!cur) {
		return new Response(JSON.stringify({ error: 'no current journey — pick origin/destination in browser first' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json', ...CORS }
		});
	}
	return new Response(JSON.stringify(cur.data), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'X-Updated-At': String(cur.updatedAt),
			...CORS
		}
	});
};
