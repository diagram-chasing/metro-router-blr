// POST /api/print — receive a ready-made ESC/POS byte stream and forward it to the
// Python printer service that owns the physical thermal printer.
//
// The receipt is encoded to ESC/POS in the browser (see lib/receipt/printReceipt.ts);
// this endpoint is a thin, same-origin proxy so the printer service URL stays
// server-side and the client never needs CORS or direct device access.
//
// Configure the target with PRINT_SERVICE_URL (defaults to a local service).

import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

export const prerender = false;

const serviceUrl = () => env.PRINT_SERVICE_URL ?? 'http://127.0.0.1:8000/print';

export const POST: RequestHandler = async ({ request }) => {
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.length === 0) return new Response('empty print payload', { status: 400 });

	const url = serviceUrl();
	try {
		const r = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/octet-stream' },
			body
		});
		if (!r.ok) {
			const detail = await r.text().catch(() => '');
			return new Response(`print service ${r.status}${detail ? `: ${detail}` : ''}`, { status: 502 });
		}
		return new Response(null, { status: 204 });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return new Response(`cannot reach print service at ${url}: ${msg}`, { status: 502 });
	}
};
