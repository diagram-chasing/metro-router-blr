// GET /api/stats — running aggregates over all accumulated lines.
// Feeds the optional map HUD and the admin page.

import type { RequestHandler } from '@sveltejs/kit';

import { stats } from '$lib/server/db';

export const prerender = false;

export const GET: RequestHandler = async () =>
	new Response(JSON.stringify(stats()), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			'Access-Control-Allow-Origin': '*'
		}
	});
