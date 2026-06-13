// POST /api/receipt           — submit answers, get { id }
// GET  /api/receipt?id=...    — fetch a computed receipt (+ live distribution)
//
// The compute step is server-side so we can iterate on emission factors
// without redeploying the kiosk client. The submission and its drawable route
// are persisted to the local SQLite store (see db.ts).

import type { RequestHandler } from '@sveltejs/kit';

import type { Answers, Mode } from '$lib/exhibit/types';
import { blendedCo2PerKm, greyBucket, legKindToMode } from '$lib/exhibit/grey';
import { computeReceipt, distanceBand } from '$lib/server/computeReceipt';
import { allTripStats, insertLine } from '$lib/server/db';
import { reverseGeocodeArea } from '$lib/server/reverseGeocode';
import { getReceipt, putReceipt, type GeoSnapshot } from '$lib/server/receiptStore';

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

export const POST: RequestHandler = async ({ request }) => {
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
	if (!answers.mode || !answers.frequency || !answers.lifestyle || !answers.decider) {
		return json({ error: 'missing required answers' }, 400);
	}
	if (typeof answers.distanceKm !== 'number' || answers.distanceKm <= 0) {
		return json({ error: 'distanceKm missing — map question incomplete' }, 400);
	}

	const a = answers as Answers;
	const computed = computeReceipt(a);
	const geo = await buildGeoSnapshot(a);
	const id = makeId();
	const createdAt = Date.now();

	putReceipt({ id, createdAt, answers: a, computed, geo });

	// Add the visitor's chosen route to the accumulation map, in its grey bucket.
	if (a.route?.segments?.length) {
		const co2PerKmG = blendedCo2PerKm(a.route.segments);
		insertLine({
			submissionId: id,
			createdAt,
			chosenMode: a.route.chosenKind,
			distanceKm: a.distanceKm,
			co2PerTripKg: computed.perTripKg,
			co2PerKmG,
			pm25PerTripMg: computed.perTripPm25Mg,
			greyBucket: greyBucket(co2PerKmG),
			tripsPerYear: computed.tripsPerYear,
			segments: a.route.segments
		});
	}

	return json({ id }, 201);
};

async function buildGeoSnapshot(a: Answers): Promise<GeoSnapshot> {
	const segments = pickSegments(a);
	const originLabel = await resolveLabel(a.originStation, a.origin);
	const destinationLabel = await resolveLabel(a.destinationStation, a.destination);
	return { originLabel, destinationLabel, segments };
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
			const lengthM = Math.max(1, Math.round(polylineM(leg.coords)));
			const last = collapsed[collapsed.length - 1];
			if (last && last.mode === mode) last.lengthM += lengthM;
			else collapsed.push({ mode, lengthM });
		}
		return collapsed;
	}
	// Single mode: synthesize a one-segment breakdown so the strip still renders.
	if (a.mode && a.distanceKm) {
		return [{ mode: a.mode, lengthM: Math.round(a.distanceKm * 1000) }];
	}
	return undefined;
}

function polylineM(coords: [number, number][]): number {
	if (coords.length < 2) return 0;
	const R = 6371000;
	const d2r = Math.PI / 180;
	let m = 0;
	for (let i = 1; i < coords.length; i++) {
		const [lng1, lat1] = coords[i - 1];
		const [lng2, lat2] = coords[i];
		const dLat = (lat2 - lat1) * d2r;
		const dLng = (lng2 - lng1) * d2r;
		const h =
			Math.sin(dLat / 2) ** 2 +
			Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
		m += 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
	}
	return m;
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

	return json({ ...rec, distribution }, 200, { 'Cache-Control': 'no-store' });
};
