// GET    /api/lines?sinceId=&limit=&recent=1   — accumulated grey lines for the map
// DELETE /api/lines                             — purge all lines (test reset)
//
// The home-page accumulation map polls GET with the highest id it has seen so it
// only pulls new lines. `recent=1` returns just the latest line.

import type { RequestHandler } from '@sveltejs/kit';

import { latestLine, listLines, purgeLines, type LineRow } from '$lib/server/db';

export const prerender = false;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }
	});

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS });

// Trim the payload to what the map needs to draw.
const toWire = (l: LineRow) => ({
	id: l.id,
	createdAt: l.createdAt,
	chosenMode: l.chosenMode,
	co2PerKmG: l.co2PerKmG,
	greyBucket: l.greyBucket,
	segments: l.segments,
	originLabel: l.originLabel,
	destinationLabel: l.destinationLabel
});

export const GET: RequestHandler = async ({ url }) => {
	const recent = url.searchParams.get('recent') === '1';
	if (recent) {
		const l = latestLine();
		return json({ lines: l ? [toWire(l)] : [] });
	}
	const sinceId = Number(url.searchParams.get('sinceId') ?? 0) || 0;
	const limit = Number(url.searchParams.get('limit') ?? 5000) || 5000;
	const lines = listLines({ sinceId, limit }).map(toWire);
	return json({ lines });
};

export const DELETE: RequestHandler = async () => {
	purgeLines();
	return json({ ok: true });
};
