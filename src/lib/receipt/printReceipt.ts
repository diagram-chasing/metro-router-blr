// Single source of truth for the printed receipt.
//
// buildReceiptOps() turns the view-model into an ordered list of print operations on
// the printer's real grid (80mm Font A = 48 columns, 12x24 cells). That op-list is
// rendered two ways so the on-screen preview matches the paper exactly:
//   - opsToEscPos()  → ESC/POS bytes for the thermal printer
//   - ReceiptDoc.svelte → HTML, same 48-col monospace grid (a faithful preview)
//
// Only the Chladni stamp and route map are real graphics; they ride as `img` ops and
// are captured from the rendered DOM as small 1-bit rasters at print time.

import { domToCanvas } from 'modern-screenshot';
import type { ReceiptView } from './model';
import { EscPos, DOTS_80MM } from './escpos';
import {
	PRINT_COLS,
	asciiBars,
	asciiSlab,
	asciiPictoRow,
	asciiHistogram,
	wrapText,
	ledger,
	rule as ruleStr
} from './ascii';

const inr = (n: number) => n.toLocaleString('en-IN');

type Align = 'left' | 'center' | 'right';

export type PrintOp =
	| { t: 'text'; s: string; align?: Align; bold?: boolean; w?: 1 | 2; h?: 1 | 2 }
	| { t: 'rule' }
	| { t: 'gap'; n?: number }
	| { t: 'img'; id: 'map' | 'stamp' }
	| { t: 'qr'; data: string }
	| { t: 'cut' };

export function qrUrl(view: ReceiptView): string {
	return typeof location !== 'undefined'
		? `${location.origin}/receipt?id=${view.finePrint.barcodeSeed}`
		: `https://pollution.receipt/${view.finePrint.barcodeSeed}`;
}

/** Build the ordered print op-list. Pure: no DOM, no side effects. */
export function buildReceiptOps(view: ReceiptView): PrintOp[] {
	const ops: PrintOp[] = [];
	const T = (s: string, o: Omit<Extract<PrintOp, { t: 'text' }>, 't' | 's'> = {}) =>
		ops.push({ t: 'text', s, ...o });
	const heading = (title: string, right = '') =>
		T(right ? ledger(title, right) : title.toUpperCase(), { bold: true, h: 2 });
	const body = (s: string) => wrapText(s).forEach((l) => T(l));
	const gap = (n = 1) => ops.push({ t: 'gap', n });
	const rule = () => ops.push({ t: 'rule' });
	const statPair = (a: string, b: string) => T(ledger(a, b), { bold: true, h: 2 });

	// masthead
	T('THE POLLUTION', { align: 'center', bold: true, w: 2, h: 2 });
	T("THAT WASN'T", { align: 'center', bold: true, w: 2, h: 2 });
	T('- a commute emissions receipt -', { align: 'center' });
	T(`${view.meta.dateLabel} / ${view.meta.timeLabel}`, { align: 'center' });
	T(`Order no. ${view.meta.visitorNo}`, { align: 'center' });
	gap();
	rule();

	// where you go
	heading('Where you go');
	T(view.item.origin.toUpperCase());
	T('-> ' + view.item.dest.toUpperCase());
	if (view.route.geo.some((g) => g.coords?.length >= 2)) {
		ops.push({ t: 'img', id: 'map' });
		T('.... cleaner leg     ==== dirtier leg');
	}
	T(ledger('Distance', `${view.item.distanceKm.toFixed(1)} km each way`));
	T(ledger('Frequency', `${inr(view.item.tripsPerYear)} trips / yr`));
	T(ledger('Mode', `${view.item.modeLabel}, ${view.item.freqLabel}`));
	rule();

	// your mode
	heading('Your mode', view.modeRank.histogram ? "today's commuters" : '');
	body(view.modeRank.copy);
	if (view.modeRank.histogram) {
		gap();
		asciiHistogram(view.modeRank.histogram.values, view.modeRank.histogram.mine).forEach((l) => T(l));
	}
	if (view.modeRank.cleanerNote) body(view.modeRank.cleanerNote);
	rule();

	// your corridor
	heading('Your corridor', `~${inr(view.corridor.totalPerDay)}/day`);
	body(view.corridor.copy);
	gap();
	asciiBars(
		view.corridor.rows.map((r) => ({
			label: r.label,
			value: r.gPerKm,
			right: `${r.gPerKm} g/km`,
			mark: r.isYou
		}))
	).forEach((l) => T(l.text, { bold: l.mark }));
	rule();

	// the damage
	heading('The damage', 'per trip');
	statPair(`${inr(view.oneTrip.co2G)} g CO2`, `${inr(view.oneTrip.pm25Mg)} mg PM2.5`);
	T(`x ${inr(view.item.tripsPerYear)} trips / year`);
	gap();
	T(ledger('Total / one year', `each o ~ ${view.year.kgPerBlock} kg`), { bold: true });
	statPair(`${inr(view.year.co2Kg)} kg CO2`, `${inr(view.year.pm25G)} g PM2.5`);
	asciiSlab(view.year.co2Kg, view.year.kgPerBlock, view.year.isClean).forEach((l) => T(l));
	if (view.year.copy) body(view.year.copy);
	rule();

	// that much, in things
	heading('That much, in things', `${inr(view.year.co2Kg)} kg =`);
	if (view.units.isClean) {
		body(view.units.copy);
	} else {
		T(`${view.units.cylinders}  gas cylinders`, { bold: true });
		T(asciiPictoRow(view.units.cylinders, 'cylinder'));
		T(`${view.units.trees}  trees, full-time`, { bold: true });
		T(asciiPictoRow(view.units.trees, 'tree'));
	}
	rule();

	// suggested swap
	heading('Suggested swap');
	body(view.swap.copy);
	if (view.swap.show) {
		gap();
		T('[ ] Shift half your trips to metro');
		T('[ ] Walk the first & last mile');
		T(`[ ] Keep ~${inr(view.swap.savedKg)} kg CO2 out of the air`);
		gap();
		asciiBars([
			{ label: 'now', value: view.swap.nowKg, right: `${inr(view.swap.nowKg)} kg` },
			{ label: 'swap', value: view.swap.swapKg, right: `${inr(view.swap.swapKg)} kg` }
		]).forEach((l) => T(l.text));
		statPair(`-${inr(view.swap.savedKg)} kg/yr`, `~${view.swap.treesSaved} trees`);
		body(`PM2.5 ${inr(view.swap.nowPm25G)} -> ${inr(view.swap.swapPm25G)} g/yr`);
	}
	rule();

	// emissions resonance
	T('EMISSIONS RESONANCE', { align: 'center', bold: true, h: 2 });
	ops.push({ t: 'img', id: 'stamp' });
	T(`Figure ${view.archetype.figure.n}x${view.archetype.figure.m}`, { align: 'center' });
	T(view.archetype.name.toUpperCase(), { align: 'center', bold: true });
	if (view.archetype.subtitle) T(view.archetype.subtitle, { align: 'center' });
	gap();
	body(`Your commute drawn as a Chladni resonance. ${view.archetype.basis}`);
	rule();

	// while you read
	if (view.counter.cityCount != null) {
		heading('While you read');
		T(ledger('Trips to date', inr(view.counter.cityCount)));
		rule();
	}

	// fine print
	heading('The fine print');
	body(view.finePrint.psCopy);
	gap();
	body(view.finePrint.disclaimer);
	rule();

	// QR + footer
	T('Scan to keep this receipt', { align: 'center' });
	gap();
	ops.push({ t: 'qr', data: qrUrl(view) });
	gap();
	T(`No. ${view.meta.visitorNo}`, { align: 'center' });
	gap();
	T('>> RETAIN FOR YOUR RECORDS <<', { align: 'center' });
	ops.push({ t: 'cut' });

	return ops;
}

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
	const p = new EscPos();
	p.init().font('A');
	for (const op of ops) {
		switch (op.t) {
			case 'text': {
				const big = (op.w ?? 1) > 1 || (op.h ?? 1) > 1;
				p.align(op.align ?? 'left');
				if (op.bold) p.bold(true);
				if (big) p.size(op.w ?? 1, op.h ?? 1);
				p.line(op.s);
				if (big) p.size(1, 1);
				if (op.bold) p.bold(false);
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

export { PRINT_COLS };

/** Build the bytes and POST them to the print service (via /api/print). */
export async function printReceipt(view: ReceiptView, node: HTMLElement): Promise<void> {
	const bytes = await opsToEscPos(buildReceiptOps(view), node);
	const res = await fetch('/api/print', {
		method: 'POST',
		headers: { 'content-type': 'application/octet-stream' },
		body: bytes
	});
	if (!res.ok) {
		const msg = await res.text().catch(() => '');
		throw new Error(`print failed (${res.status})${msg ? `: ${msg}` : ''}`);
	}
}
