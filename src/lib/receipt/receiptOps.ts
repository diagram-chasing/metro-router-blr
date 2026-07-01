// The receipt's print op-list — the single source of receipt layout, rendered two
// ways: opsToEscPos() (printReceipt.ts) emits ESC/POS bytes for the thermal printer,
// and ReceiptDoc.svelte renders the same ops to HTML on the same grid.
//
// Pure (DOM-free) on purpose: the harness and any server context can build the ops
// without pulling the browser-only capture path that lives in printReceipt.ts.

import type { ReceiptView } from './receipt';
import {
	PRINT_COLS,
	PRINT_COLS_B,
	blockBars,
	eyebrow,
	heroSrc,
	asciiSpread,
	asciiOdometer,
	footprintGrid,
	wrapText,
	ledger,
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
	| { t: 'img'; id: 'map' | 'stamp' | 'car' | 'slope' }
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
	let sec = 0;
	const eyebrowOp = (label: string, stat = '') =>
		T(eyebrow(String(++sec).padStart(2, '0'), label, stat), { bold: true });

	// masthead
	T(ruleStr('═'));
	T('THE POLLUTION', { align: 'center', bold: true, w: 2, h: 2 });
	T("THAT WASN'T", { align: 'center', bold: true, w: 2, h: 2 });
	T('A commute emissions receipt', { align: 'center', small: true });

	T(ruleStr('═'));
	T(ledger(`${view.meta.dateLabel}  ${view.meta.timeLabel}`, `Order no. ${view.meta.visitorNo}`), { small: true });
	if (view.meta.name) {
		gap();
		T(`Prepared for ${view.meta.name}`, { align: 'center', bold: true });
	}
	gap();

	// 01 your route — the map draws the trip's geometry; the line below names the
	// journey the visitor picked, which drives every figure on the receipt.
	eyebrowOp("Let's start your travel");
	if (view.route.geo.some((g) => g.coords?.length >= 2)) {
		ops.push({ t: 'img', id: 'map' });
	}
	gap();
	const yearKm = Math.round(view.item.distanceKm * view.item.tripsPerYear);
	deck(`~${inr(yearKm)} km a year by ${view.item.modeLabel.toLowerCase()}, every ${view.item.freqLabel}`);
	gap();
	T(ruleStr('-'));
	gap();

	// 02 your mode
	eyebrowOp("Comparing you to today's audience");
	gap();
	deck(view.modeRank.copy);

	if (view.modeRank.histogram) {
		gap();
		T('HOW DIRTY WAS YOUR KM?  (g CO2/km)', { bold: true });
		gap();
		asciiSpread(view.modeRank.histogram.values, view.modeRank.histogram.mine).forEach((l) => T(l));
	} else if (view.modeRank.cleanerNote) {
		// No histogram to plot -> the crowd comparison falls back to the prose note. When the
		// chart IS shown, its own percentile footer carries this, so the two never double up.
		gap();
		deck(view.modeRank.cleanerNote);
	}
	gap();
	T(ruleStr('-'));
	gap();

	// 03 your corridor — the headcount, the public-transport split and the emissions
	// line come from nearby junction counts (traffic.json); the g/km bars below stay
	// an illustrative mode model.
	eyebrowOp('You are part of a larger crowd...');
	gap();
	const peopleApprox = Math.round(view.corridor.peoplePerDay / 1000) * 1000;
	const estSuffix = view.corridor.isFallback ? ' (est)' : '';
	deck(`${inr(peopleApprox)} people travel through here every day${estSuffix}`);
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

	deck(`Total: ${view.corridor.co2Label} CO2/day  or ${view.corridor.co2Equiv}`);
	gap();
	T(ruleStr('-'));
	gap();

	// 04 the damage -> annual total (the centerpiece), for the chosen journey.
	eyebrowOp('Over one year, this adds up to...');
	gap();
	const heroText = `${inr(view.year.co2Kg)} KG CO2`;
	const heroW: 1 | 2 = heroText.length > PRINT_COLS / 2 ? 1 : 2;
	T(' '.repeat(PRINT_COLS), { rev: true });
	T(heroSrc(heroText, heroW === 2 ? PRINT_COLS / 2 : PRINT_COLS), { rev: true, w: heroW, h: 3 });
	T(' '.repeat(PRINT_COLS), { rev: true });
	gap();

	if (view.year.modeClean) {
		// A clean habit: the small footprint, then the fun WIN (what driving would cost).
		if (view.year.copy) deck(view.year.copy);
		if (view.year.vsCarFun) {
			gap();
			deck(view.year.vsCarFun);
		}
	} else {
		// A dirty habit: the footprint in a currency that lands, then the trees. Shown
		// even when the number is small, since the fun count still reads big.
		deck('What does that mean? Think of it as');
		gap();
		deck(view.units.funLine + '.');
		if (view.units.trees >= 1) {
			const tree = view.units.trees === 1 ? 'tree' : 'trees';
			deck(`or ${view.units.trees} ${tree} working a full year to soak it back up.`);
		}
	}
	gap();
	T(ruleStr('-'));
	gap();

	// by the way — parking as real-estate: a to-scale footprint isotype (one ■ per m²
	// of street the car sits on) + its land value, then the city's live car odometer.
	eyebrowOp('A car costs the city even switched off.');
	gap();
	deck(view.parking.copy);
	gap();
	T('ONE CAR TAKES', { align: 'center', bold: true });
	gap();
	footprintGrid(view.parking.areaM2).forEach((l) => T(l, { align: 'center' }));
	gap();
	T(`${view.parking.areaM2} m², worth ~${view.parking.valueLabel}`, { align: 'center' });
	if (view.counter.carsToday > 0) {
		gap();
		T(`cars Bangalore has added today, as of ${view.meta.timeLabel}`, { align: 'center' });
		asciiOdometer(view.counter.carsToday).forEach((l) => T(l, { align: 'center' }));
		// T('each one needs somewhere to park', { align: 'center' });
	}
	gap();

	// fine print + footer
	wrapText(view.finePrint.disclaimer, PRINT_COLS_B).forEach((l) => T(l, { small: true }));
	gap();
	T(ruleStr('*'));
	gap();
	T('An experiment by Diagram Chasing', { align: 'center' });
	T('diagramchasing.fun', { align: 'center' });
	gap();
	ops.push({ t: 'cut' });
	return ops;
}

export { PRINT_COLS };
