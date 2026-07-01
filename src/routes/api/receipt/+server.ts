// POST /api/receipt           — submit answers, get { id }
// GET  /api/receipt?id=...    — fetch a computed receipt (+ live distribution)
//
// The compute step is server-side so we can iterate on emission factors
// without redeploying the kiosk client. The submission and its drawable route
// are persisted to the local SQLite store (see db.ts).

import type { RequestHandler } from '@sveltejs/kit';

import type { Answers, Mode } from '$lib/exhibit/types';
import { journeyBaseMode, legKindToMode, lengthKm } from '$lib/emissions';
import { computeReceipt, distanceBand } from '$lib/receipt/receipt';
import { lookupConnectivity } from '$lib/server/connectivity';
import { allTripStats, allPerKmStats } from '$lib/server/db';
import { reverseGeocodeArea } from '$lib/server/reverseGeocode';
import { getReceipt, putReceipt, type GeoSnapshot } from '$lib/server/receiptStore';
import { swapSuggestion } from '$lib/utils/otp';

export const prerender = false;

const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type'
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...CORS, ...extra }
	});

export const OPTIONS: RequestHandler = async () =>
	new Response(null, { status: 204, headers: CORS });

function makeId(): string {
	// Short, readable id for the kiosk URL — not security-sensitive.
	const ts = Date.now().toString(36);
	const rand = Math.random().toString(36).slice(2, 8);
	return `${ts}-${rand}`;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, 400);
	}

	const answers = body as Partial<Answers>;
	if (!answers || typeof answers !== 'object') {
		return json({ error: 'body must be an Answers object' }, 400);
	}
	if (!answers.mode || !answers.frequency || !answers.lifestyle) {
		return json({ error: 'missing required answers' }, 400);
	}
	if (typeof answers.distanceKm !== 'number' || answers.distanceKm <= 0) {
		return json({ error: 'distanceKm missing — map question incomplete' }, 400);
	}

	const a = answers as Answers;
	const computed = computeReceipt(a);
	// Real transit serving the drawn trip — planned live via OpenTripPlanner and
	// stored on the receipt so the client never has to.
	computed.connectivity = await lookupConnectivity(a.origin, a.destination, fetch);
	const geo = await buildGeoSnapshot(a, fetch);
	const id = makeId();
	const createdAt = Date.now();

	putReceipt({ id, createdAt, answers: a, computed, geo });

	// Note: the visitor's route is NOT added to the accumulation (wall) map here.
	// Adding to the map is now an explicit visitor action on the receipt screen
	// (POST /api/lines) so the receipt can be seen/printed without polluting the
	// wall, and so the "watch your commute turn to soot" moment is deliberate.
	return json({ id }, 201);
};

async function buildGeoSnapshot(a: Answers, fetcher: typeof fetch): Promise<GeoSnapshot> {
	const segments = pickSegments(a);
	const originLabel = await resolveLabel(a.originStation, a.origin);
	const destinationLabel = await resolveLabel(a.destinationStation, a.destination);
	// Best viable cleaner alternative for this trip — feeds the swap section.
	const swap =
		a.origin && a.destination
			? ((await swapSuggestion(a.origin, a.destination, { fetcher })) ?? undefined)
			: undefined;
	return { originLabel, destinationLabel, segments, swap };
}

function pickSegments(a: Answers): GeoSnapshot['segments'] {
	// Multi-leg trip: collapse the chosen route's per-leg geometry into a
	// mode→length breakdown the receipt strip can render. Lengths are the
	// great-circle length of each leg's polyline.
	const legs = a.route?.segments;
	if (legs && legs.length > 0) {
		const collapsed: { mode: Mode; lengthM: number }[] = [];
		for (const leg of legs) {
			const mode = legKindToMode(leg.legKind);
			const lengthM = Math.max(1, Math.round(lengthKm(leg.coords) * 1000));
			const last = collapsed[collapsed.length - 1];
			if (last && last.mode === mode) last.lengthM += lengthM;
			else collapsed.push({ mode, lengthM });
		}
		return collapsed;
	}
	// Single mode: synthesize a one-segment breakdown so the strip still renders.
	if (a.mode && a.distanceKm) {
		return [{ mode: journeyBaseMode(a.mode), lengthM: Math.round(a.distanceKm * 1000) }];
	}
	return undefined;
}

async function resolveLabel(
	station: string | undefined,
	coord: [number, number] | undefined
): Promise<string | undefined> {
	if (station) return station;
	if (!coord) return undefined;
	const [lng, lat] = coord;
	const area = await reverseGeocodeArea(lat, lng);
	return area ?? undefined;
}

// Minimum same-band sample before we trust a real distribution over the synthetic one.
const MIN_DISTRIBUTION_N = 8;

export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'missing ?id' }, 400);
	const rec = getReceipt(id);
	if (!rec) return json({ error: 'no receipt with that id' }, 404);

	// Live distribution: where this visitor sits among everyone in the same
	// distance band so far. Falls back silently when there isn't enough data.
	const band = distanceBand(rec.computed.trip.distanceKm);
	const sameBand = allTripStats()
		.filter((t) => distanceBand(t.distanceKm) === band)
		.map((t) => t.co2PerTripKg);
	let distribution: { percentile: number; n: number; values: number[] } | undefined;
	if (sameBand.length >= MIN_DISTRIBUTION_N) {
		const mine = rec.computed.perTripKg;
		const below = sameBand.filter((v) => v < mine).length;
		distribution = {
			percentile: Math.round((below / sameBand.length) * 100),
			n: sameBand.length,
			values: sameBand
		};
	}

	// Histogram (beat 2): per-km dirtiness of everyone who has submitted so far, and
	// where this visitor lands on it. Per-km so distance doesn't confound the spread.
	// The marker is the visitor's HABIT (computed.perTripKg, Q1) — matching the beat's
	// verdict copy — measured against the population of drawn routes on the wall map.
	const allPerKm = allPerKmStats();
	const minePerKm =
		rec.computed.trip.distanceKm > 0
			? (rec.computed.perTripKg * 1000) / rec.computed.trip.distanceKm
			: 0;
	const histogram =
		allPerKm.length >= 5
			? { values: allPerKm, mine: Math.round(minePerKm * 10) / 10, n: allPerKm.length }
			: undefined;

	return json({ ...rec, distribution, histogram }, 200, {
		'Cache-Control': 'no-store'
	});
};
