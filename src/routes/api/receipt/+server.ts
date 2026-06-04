// POST /api/receipt           — submit answers, get { id }
// GET  /api/receipt?id=...    — fetch a computed receipt
//
// The compute step is server-side so we can iterate on emission factors
// without redeploying the kiosk client.

import type { RequestHandler } from '@sveltejs/kit';

import type { Answers } from '$lib/exhibit/types';
import { computeReceipt } from '$lib/server/computeReceipt';
import { getReceipt, putReceipt } from '$lib/server/receiptStore';

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

	const computed = computeReceipt(answers as Answers);
	const id = makeId();
	putReceipt({
		id,
		createdAt: Date.now(),
		answers: answers as Answers,
		computed
	});

	return json({ id }, 201);
};

export const GET: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) return json({ error: 'missing ?id' }, 400);
	const rec = getReceipt(id);
	if (!rec) return json({ error: 'no receipt with that id' }, 404);
	return json(rec, 200, { 'Cache-Control': 'no-store' });
};
