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
	panelRow,
	panelPair,
	panelRule,
	heroSrc,
	asciiSpread,
	asciiOdometer,
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
	| { t: 'img'; id: 'map' | 'stamp' | 'car' }
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
	T('A commute emissions receipt', { align: 'center', small: true });

	T(ruleStr('═'));
	T(ledger(`${view.meta.dateLabel}  ${view.meta.timeLabel}`, `Order no. ${view.meta.visitorNo}`), { small: true });
	gap();

	// 01 your route — the map is the route the visitor DREW (Q3); the Mode line is
	// their stated habit (Q1, the receipt's subject). When they differ, name the
	// drawn route so the map and the verdict can't be mistaken for the same thing.
	eyebrowOp("Let's start your travel");
	if (view.route.geo.some((g) => g.coords?.length >= 2)) {
		ops.push({ t: 'img', id: 'map' });
	}
	gap();
	const yearKm = Math.round(view.item.distanceKm * view.item.tripsPerYear);
	deck(`~${inr(yearKm)} km a year by ${view.item.modeLabel.toLowerCase()}, ${view.item.freqLabel}`);
	gap();
	T(ruleStr('-'));
	gap();

	// 02 your mode
	eyebrowOp("Compared to today's audience?");
	gap();
	deck(view.modeRank.copy);

	if (view.modeRank.histogram) {
		gap();
		T('DIRTINESS PER KM (g C02/km)', { bold: true });
		asciiSpread(view.modeRank.histogram.values, view.modeRank.histogram.mine).forEach((l) => T(l));
	}
	if (view.modeRank.cleanerNote) {
		gap();
		deck(view.modeRank.cleanerNote);
	}
	gap();
	T(ruleStr('-'));
	gap();

	// 03 your corridor — the headcount, the public-transport split and the emissions
	// line come from nearby junction counts (traffic.json); the g/km bars below stay
	// an illustrative mode model.
	eyebrowOp('But more people also use this route...');
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
	const peopleApprox = Math.round(view.corridor.peoplePerDay / 1000) * 1000;
	const estSuffix = view.corridor.isFallback ? ' (est)' : '';
	const ptPct = Math.round(view.corridor.ptShare * 100);
	T(`${inr(peopleApprox)}/day here${estSuffix} · ${ptPct}% on transit`);
	T(`${view.corridor.co2Label} CO2/day  (${view.corridor.co2Equiv})`);
	gap();
	T(ruleStr('-'));
	gap();

	// 04 the damage -> annual total (the centerpiece). The headline is the HABIT.
	eyebrowOp('Over one year, this adds up.');
	gap();
	// T(panelRow('CO2', `${inr(view.oneTrip.co2G)} g`));
	// T(panelRule(`x ${inr(view.item.tripsPerYear)} trips / year`));
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
	deck("What does that mean? You can think of it as");

	if (view.units.isClean) {
		deck(view.units.copy);
	} else {
		gap();

		const cyl = view.units.cylinders === 1 ? 'gas cylinder' : 'gas cylinders';
		const tree = view.units.trees === 1 ? 'tree' : 'trees';

		ind(`${view.units.cylinders}  ${cyl}, burned`);

		ind(`${view.units.trees} ${tree}, a full year to undo it`);
	}
	gap();
	T(ruleStr('-'));
	gap();

	// 06 what if — when the drawn route (Q3) differs from the habit (Q1), this is the
	// gap between them (usual vs this trip). Otherwise it's the generic half-swap.
	if (view.comparison.show) {
		const c = view.comparison;
		eyebrowOp(
			'Can you do better?'
		);
		gap();
		deck(c.copy);
		gap();
		T(panelPair(c.usualLabel, inr(c.usualKg), c.pickedLabel, inr(c.pickedKg), 'kg/yr'));
		// T(
		// 	panelRule(
		// 		c.direction === 'cleaner'
		// 			? `the gap: ${inr(c.savedKg)} kg/yr`
		// 			: `+${inr(c.savedKg)} kg/yr the way you drew it`
		// 	)
		// );
	} else {
		eyebrowOp('What if...', view.swap.show ? `-${inr(view.swap.savedKg)} kg/yr` : '');
		deck(view.swap.copy);
		if (view.swap.show) {
			if (view.connectivity && view.connectivity.modes.length) {
				const conn = view.connectivity;
				gap();
				T('A cleaner way to make this trip:');
				deck(`Any of the ${inr(conn.total)} daily transit trips on this route`);
				conn.modes.forEach((m) => {
					const routes = m.routes.length
						? ' on ' + m.routes.map((r) => `[${r}]`).join(', ')
						: '';
					deck(`${inr(m.trips)} ${m.label} trips${routes}`);
				});
			}
			gap();

			T(panelPair('Today', `${inr(view.swap.nowKg)}`, 'Better', `${inr(view.swap.swapKg)}`, 'kg'));
			const trees = view.swap.treesSaved === 1 ? 'tree' : 'trees';
			T(panelRule(`saves ${inr(view.swap.savedKg)} kg/yr  ~${view.swap.treesSaved} ${trees}`));
		}
	}
	// the profile seal (Chladni resonance)
	// ops.push({ t: 'img', id: 'stamp' });
	// T(view.archetype.name.toUpperCase(), { align: 'center', bold: true });
	// if (view.archetype.subtitle) T(view.archetype.subtitle, { align: 'center' });
	gap();
	T(ruleStr('-'));
	gap();

	// by the way — parking as real-estate: a footprint diagram + an itemized
	// "land you use free" panel, then the city's live car-registration odometer.
	eyebrowOp('A car costs the city even switched off.');
	gap();
	deck(view.parking.copy);
	gap();
	ops.push({ t: 'img', id: 'car' });
	T(`one car = ${view.parking.areaM2} m² wasted public space`, { align: 'center' });
	gap();
	T(panelRow(`Land ~${view.parking.valueLabel} · rent paid ₹0`));
	// T(panelRule('Paid for by everyone else!'));
	gap();
	deck(
		`The city keeps adding more everyday. The more we add, the more crowded and expensive the city gets for everyone.`
	);
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
	T('https://diagramchasing.fun', { align: 'center' });
	gap();
	ops.push({ t: 'cut' });
	return ops;
}

export { PRINT_COLS };
