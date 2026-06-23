// Render the receipt op-list (buildReceiptOps, in receiptOps.ts) to the thermal
// printer. opsToEscPos() emits ESC/POS bytes, capturing the `img` ops (the Chladni
// stamp + route map) from the rendered DOM as small 1-bit rasters at print time.
// The op-list itself is built in the DOM-free receiptOps.ts; this module is the
// browser-only half (modern-screenshot + ESC/POS).

import { domToCanvas } from 'modern-screenshot';
import type { ReceiptView } from './receipt';
import { EscPos, DOTS_80MM } from './escpos';
import { rule as ruleStr } from './ascii';
import { buildReceiptOps, type PrintOp } from './receiptOps';
import { loadBasemap } from './viz/braille';

// Re-export the layout surface so existing importers of this module keep working.
export { buildReceiptOps, qrUrl, PRINT_COLS } from './receiptOps';
export type { PrintOp } from './receiptOps';

/** Render a DOM node to a 1bpp raster (MSB-first, row-padded), capped to the head width. */
async function nodeToBits(
	el: HTMLElement,
	maxWidth = DOTS_80MM
): Promise<{ bits: Uint8Array; w: number; h: number } | null> {
	const canvas = await domToCanvas(el, { backgroundColor: '#ffffff', scale: 1 });
	let src: HTMLCanvasElement = canvas;
	let width = canvas.width;
	let height = canvas.height;
	if (!width || !height) return null;

	if (width > maxWidth) {
		const k = maxWidth / width;
		const w2 = Math.round(width * k);
		const h2 = Math.round(height * k);
		const c2 = document.createElement('canvas');
		c2.width = w2;
		c2.height = h2;
		const cx = c2.getContext('2d')!;
		cx.fillStyle = '#ffffff';
		cx.fillRect(0, 0, w2, h2);
		cx.drawImage(canvas, 0, 0, w2, h2);
		src = c2;
		width = w2;
		height = h2;
	}

	const data = src.getContext('2d')!.getImageData(0, 0, width, height).data;
	const widthBytes = Math.ceil(width / 8);
	const bits = new Uint8Array(widthBytes * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const a = data[i + 3];
			const lum = a < 16 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			if (lum < 128) bits[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
		}
	}
	return { bits, w: width, h: height };
}

/** Render an op-list to ESC/POS bytes, capturing `img` ops from the rendered `node`. */
export async function opsToEscPos(ops: PrintOp[], node: HTMLElement): Promise<Uint8Array> {
	// Make sure the route map's basemap is fetched + painted before we screenshot it; a
	// failure just yields a route-only map (never blocks the print).
	await loadBasemap().catch(() => null);

	const p = new EscPos();
	p.init().font('A');
	for (const op of ops) {
		switch (op.t) {
			case 'text': {
				const big = (op.w ?? 1) > 1 || (op.h ?? 1) > 1;
				p.align(op.align ?? 'left');
				if (op.small) p.font('B');
				if (op.rev) p.reverse(true);
				if (op.bold) p.bold(true);
				if (big) p.size(op.w ?? 1, op.h ?? 1);
				p.line(op.s);
				if (big) p.size(1, 1);
				if (op.bold) p.bold(false);
				if (op.rev) p.reverse(false);
				if (op.small) p.font('A');
				break;
			}
			case 'rule':
				p.align('left').line(ruleStr('-'));
				break;
			case 'gap':
				p.feed(op.n ?? 1);
				break;
			case 'img': {
				const el = node.querySelector<HTMLElement>(`[data-print="${op.id}"]`);
				if (el) {
					try {
						const im = await nodeToBits(el);
						if (im) p.align('center').image(im.bits, im.w, im.h).feed(1);
					} catch {
						/* a failed capture must never block the (fast) text print */
					}
				}
				break;
			}
			case 'qr':
				p.align('center').qr(op.data, 6, 'M').feed(1);
				break;
			case 'cut':
				p.cut();
				break;
		}
	}
	return p.bytes();
}

/** Build the bytes and POST them to the print service (via /api/print). */
export async function printReceipt(view: ReceiptView, node: HTMLElement): Promise<void> {
	const bytes = await opsToEscPos(buildReceiptOps(view), node);
	const res = await fetch('/api/print', {
		method: 'POST',
		body: new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' })
	});
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw new Error(`print failed (${res.status})${msg ? `: ${msg}` : ''}`);
	}
}
