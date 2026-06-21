// The receipt's print op-list, rendered two ways so the on-screen preview matches
// the paper exactly:
//   - opsToEscPos()      → ESC/POS bytes for the thermal printer
//   - ReceiptDoc.svelte  → HTML, same grid (80mm Font A = 48 columns, 12x24 cells)
//
// Only the Chladni stamp and route map are real graphics; they ride as `img` ops and
// are captured from the rendered DOM as small 1-bit rasters at print time.

import { domToCanvas } from 'modern-screenshot';
import type { ReceiptView } from './receipt';
import { EscPos, DOTS_80MM } from './escpos';
import {
	PRINT_COLS,
	PRINT_COLS_B,
	blockBars,
	eyebrow,
	panelRow,
	panelRule,
	kv,
	canister,
	footprintBox,
	heroSrc,
	asciiSpread,
	asciiOdometer,
	wrapText,
	ledger,
	routeColumns,
	rule as ruleStr
} from './ascii';

const inr = (n: number) => n.toLocaleString('en-IN');

type Align = 'left' | 'center' | 'right';

export type PrintOp =
	| {
		t: 'text';
		s: string;
		align?: Align;
		bold?: boolean;
		rev?: boolean;
		small?: boolean; // print in Font B (9x17) — the fine-print grid
		w?: 1 | 2 | 3 | 4;
		h?: 1 | 2 | 3 | 4;
	}
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

export function buildReceiptOps(view: ReceiptView): PrintOp[] {
	const ops: PrintOp[] = [];
	const T = (s: string, o: Omit<Extract<PrintOp, { t: 'text' }>, 't' | 's'> = {}) =>
		ops.push({ t: 'text', s, ...o });
	const gap = (n = 1) => ops.push({ t: 'gap', n });
	const deck = (s: string) => wrapText(s, PRINT_COLS - 3).forEach((l) => T('   ' + l));
	const ind = (s: string) => T('   ' + s);
	let sec = 0;
	const eyebrowOp = (label: string, stat = '') =>
		T(eyebrow(String(++sec).padStart(2, '0'), label, stat), { bold: true });

	// masthead
	T(ruleStr('═'));
	T('THE POLLUTION', { align: 'center', bold: true, w: 2, h: 2 });
	T("THAT WASN'T", { align: 'center', bold: true, w: 2, h: 2 });
	T(ruleStr('═'));
	T('A commute emissions receipt', { align: 'center' });
	T(ledger(`${view.meta.dateLabel}  ${view.meta.timeLabel}`, `Order no. ${view.meta.visitorNo}`));
	gap();

	// 01 your route
	eyebrowOp('Your Route');
	routeColumns(view.item.origin, view.item.dest, PRINT_COLS - 3).forEach((l) => ind(l));
	if (view.route.geo.some((g) => g.coords?.length >= 2)) {
		ops.push({ t: 'img', id: 'map' });
		ind('.... cleaner leg     ■ ■ ■ dirtier leg');
	}
	gap();
	ind(kv('Distance', `${view.item.distanceKm.toFixed(1)} km each way`));
	ind(kv('Frequency', `${inr(view.item.tripsPerYear)} trips / yr`));
	ind(kv('Mode', `${view.item.modeLabel}, ${view.item.freqLabel}`));
	gap();

	// 02 your mode
	eyebrowOp(
		'Compared to people here',
		view.modeRank.histogram ? `` : ''
	);
	gap();
	deck(view.modeRank.copy);

	if (view.modeRank.histogram) {
	gap();
		T('DIRTINESS PER KM (g C02/km)', { bold: true });
		asciiSpread(view.modeRank.histogram.values, view.modeRank.histogram.mine).forEach((l) => T(l));
	}
	gap();
	if (view.modeRank.cleanerNote) deck(view.modeRank.cleanerNote);
	gap();

	// 03 your corridor
	eyebrowOp('Compared to route', `~${inr(view.corridor.totalPerDay)}/day`);
	gap();
	deck(view.corridor.copy);
	gap();
	T('   '.padEnd(PRINT_COLS - 'g/km'.length) + 'g/km');
	blockBars(
		view.corridor.rows.map((r) => ({
			label: r.label,
			value: r.gPerKm,
			right: `${r.gPerKm}`,
			mark: r.isYou
		}))
	).forEach((l) => {
		T(l.text, { bold: l.mark });
	});
	gap();

	// 04 the damage -> annual total (the centerpiece)
	eyebrowOp('The Damage', 'per trip');
	T(panelRow('CO2', `${inr(view.oneTrip.co2G)} g`));
	T(panelRule(`x ${inr(view.item.tripsPerYear)} trips / year`));
	if (view.year.isClean) {
		T(panelRow('ANNUAL', `${inr(view.year.co2Kg)} kg CO2`));
		if (view.year.copy) deck(view.year.copy);
	} else {
		const heroText = `${inr(view.year.co2Kg)} KG CO2`;
		const w: 1 | 2 = heroText.length > PRINT_COLS / 2 ? 1 : 2;
		T(' '.repeat(PRINT_COLS), { rev: true });
		T(heroSrc(heroText, w === 2 ? PRINT_COLS / 2 : PRINT_COLS), { rev: true, w, h: 3 });
		T(' '.repeat(PRINT_COLS), { rev: true });
	}
	gap();

	// 05 in things
	eyebrowOp('In Things', `${inr(view.year.co2Kg)} kg =`);
	if (view.units.isClean) {
		deck(view.units.copy);
	} else {
		const can = canister();
		const div = '─'.repeat(PRINT_COLS - 9);
		T('   ' + can[0]);
		T('   ' + can[1] + '  ' + `${view.units.cylinders}  gas cylinders, burned`);
		T('   ' + can[2] + '  ' + div);
		T('   ' + can[3] + '  ' + `▲ ${view.units.trees} trees, a full year to undo it`);
		T('   ' + can[4]);
	}
	gap();

	// 06 suggested swap
	eyebrowOp('What if...', view.swap.show ? `-${inr(view.swap.savedKg)} kg/yr` : '');
	deck(view.swap.copy);
	if (view.swap.show) {
		if (view.swap.ideas.length) {
			gap();
			T('A cleaner way to make this trip:');
			view.swap.ideas.forEach((line) => T(line));
		}
		gap();

		T(panelRow('Today', `${inr(view.swap.nowKg)} kg`));
		T(panelRow('Better', `${inr(view.swap.swapKg)} kg`));
		T(panelRule(`saves ${inr(view.swap.savedKg)} kg/yr  ~${view.swap.treesSaved} trees`));
	}
	gap();

	// the profile seal (Chladni resonance)
	ops.push({ t: 'img', id: 'stamp' });
	T(view.archetype.name.toUpperCase(), { align: 'center', bold: true });
	if (view.archetype.subtitle) T(view.archetype.subtitle, { align: 'center' });
	gap();

	// by the way — parking as real-estate: a footprint diagram + an itemized
	// "land you use free" panel, then the city's live car-registration odometer.
	eyebrowOp('Not just the air though...');
	deck(view.parking.copy);
	gap();
	footprintBox('one parked car').forEach((l, i) =>
		T('   ' + l + (i === 2 ? `  ${view.parking.areaM2} m²` : ''))
	);
	ind(`= standing room for ~${Math.round(view.parking.areaM2)} people`);
	gap();
	T(panelRow('Market value of that land', `~${view.parking.valueLabel}`));
	T(panelRow('Rent the driver pays', '₹0'));
	T(panelRule('Paid for by everyone else!'));
	if (view.counter.cityCount != null) {
		gap();
		T('cars newly registered in BLR today', { align: 'center' });
		asciiOdometer(view.counter.cityCount).forEach((l) => T(l, { align: 'center' }));
	}
	gap();

	// fine print + footer
	wrapText(view.finePrint.disclaimer, PRINT_COLS_B).forEach((l) => T(l, { small: true }));
	gap();
	T(ruleStr('*'));
	gap();
	T('An experiment by Diagram Chasing', { align: 'center' });
	T('https://diagramchasing.fun', { align: 'center' });
	gap();
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

export { PRINT_COLS };

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
