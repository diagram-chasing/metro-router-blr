// GET    /api/lines?sinceId=&limit=&recent=1   — accumulated grey lines for the map
// POST   /api/lines   { id }                    — add a stored receipt's route to the map
// DELETE /api/lines                             — purge all lines (test reset)
//
// The home-page accumulation map polls GET with the highest id it has seen so it
// only pulls new lines. `recent=1` returns just the latest line.
//
// POST is the explicit "add myself to the map" trigger from the receipt screen:
// the receipt is computed/persisted at submit time (POST /api/receipt) WITHOUT
// touching the wall, and only lands on the wall when the visitor asks for it here.

import type { RequestHandler } from '@sveltejs/kit';

import { journeyBaseMode, journeyEmissions } from '$lib/emissions';
import {
	hasLineForSubmission,
	insertLine,
	latestLine,
	listLines,
	purgeLines,
	type LineRow
} from '$lib/server/db';
import { getReceipt } from '$lib/server/receiptStore';

export const prerender = false;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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
	tripsPerYear: l.tripsPerYear, // wall needs this to compute grams-of-PM2.5-over-10-years
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

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, 400);
	}
	const id = (body as { id?: unknown })?.id;
	if (typeof id !== 'string' || !id) return json({ error: 'missing id' }, 400);

	const rec = getReceipt(id);
	if (!rec) return json({ error: 'no receipt with that id' }, 404);

	// Idempotent: a double-tap or reload must not stack the same route on the wall.
	if (hasLineForSubmission(id)) return json({ ok: true, alreadyOnMap: true });

	const a = rec.answers;
	if (!a.mode || !a.route?.segments?.length) {
		return json({ error: 'receipt has no drawable route' }, 422);
	}

	// Emissions come from the picked JOURNEY (not the drawn geometry, which is just
	// the canonical road path) so the wall map matches the receipt headline. The
	// drawn segments still supply the line's shape.
	const e = journeyEmissions(a.mode, rec.computed.trip.distanceKm);
	insertLine({
		submissionId: id,
		createdAt: rec.createdAt,
		chosenMode: journeyBaseMode(a.mode),
		distanceKm: rec.computed.trip.distanceKm,
		co2PerTripKg: e.kgPerTrip,
		co2PerKmG: e.gPerKm,
		greyBucket: e.bucket,
		tripsPerYear: rec.computed.tripsPerYear,
		corridorPeoplePerDay: rec.computed.corridor.peoplePerDay,
		segments: a.route.segments
	});

	return json({ ok: true }, 201);
};

export const DELETE: RequestHandler = async () => {
	purgeLines();
	return json({ ok: true });
};
