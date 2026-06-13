// POST /api/admin  { action: 'purge-lines' | 'purge-all' }  — operator controls.
//
// purge-lines clears the accumulation map only; purge-all also wipes the
// stored submissions (full reset between test runs / before the exhibit opens).

import type { RequestHandler } from '@sveltejs/kit';

import { purgeAll, purgeLines, stats } from '$lib/server/db';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});

export const POST: RequestHandler = async ({ request }) => {
	let action: string | undefined;
	try {
		({ action } = (await request.json()) as { action?: string });
	} catch {
		return json({ error: 'invalid JSON body' }, 400);
	}
	if (action === 'purge-lines') {
		purgeLines();
		return json({ ok: true, action });
	}
	if (action === 'purge-all') {
		purgeAll();
		return json({ ok: true, action });
	}
	return json({ error: "action must be 'purge-lines' or 'purge-all'" }, 400);
};

export const GET: RequestHandler = async () => json(stats());
