// POST /api/receipt           — submit answers, get { id }
// GET  /api/receipt?id=...    — fetch a computed receipt
//
// The compute step is server-side so we can iterate on emission factors
// without redeploying the kiosk client.

import type { RequestHandler } from '@sveltejs/kit';

import type { Answers } from '$lib/exhibit/types';
import { computeReceipt } from '$lib/server/computeReceipt';
import { getCurrent } from '$lib/server/journeyCache';
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
	putReceipt({
		id,
		createdAt: Date.now(),
		answers: a,
		computed,
		geo
	});

	return json({ id }, 201);
};

async function buildGeoSnapshot(a: Answers): Promise<GeoSnapshot> {
	const segments = pickSegments(a);
	const originLabel = await resolveLabel(a.originStation, a.origin);
	const destinationLabel = await resolveLabel(a.destinationStation, a.destination);
	return { originLabel, destinationLabel, segments };
}

function pickSegments(a: Answers): GeoSnapshot['segments'] {
	// Multi-leg trip (metro mixed, etc.): use the journey the browser POSTed.
	// The cache holds one segment per station-to-station hop, so collapse
	// consecutive same-mode runs into a single leg.
	const cached = getCurrent();
	const cachedSegs = cached?.data?.segments;
	if (cachedSegs && cachedSegs.length > 0) {
		const collapsed: { mode: 'metro' | 'active'; lengthM: number }[] = [];
		for (const s of cachedSegs) {
			const mode = s.kind === 'metro' ? 'metro' : 'active';
			const last = collapsed[collapsed.length - 1];
			if (last && last.mode === mode) {
				last.lengthM += Math.max(1, Math.round(s.lengthM));
			} else {
				collapsed.push({ mode, lengthM: Math.max(1, Math.round(s.lengthM)) });
			}
		}
		return collapsed;
	}
	// Single mode: synthesize a one-segment breakdown so the strip still renders.
	if (a.mode && a.distanceKm) {
		return [{ mode: a.mode, lengthM: Math.round(a.distanceKm * 1000) }];
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

export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'missing ?id' }, 400);
	const rec = getReceipt(id);
	if (!rec) return json({ error: 'no receipt with that id' }, 404);
	return json(rec, 200, { 'Cache-Control': 'no-store' });
};
