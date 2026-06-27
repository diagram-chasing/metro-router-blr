// Monospace builders for the printed receipt's ASCII charts, on the printer's fixed
// column grid (80mm Font A = 48 cols). DOM-free; dirtiness bands come from the
// carbon model so they can't drift from the wall-map grey buckets.

import { bucket, BUCKET_MAX } from '$lib/emissions';

export const PRINT_COLS = 48; // 80mm, Font A (12-dot glyphs)
export const PRINT_COLS_B = 64; // 80mm, Font B (9-dot glyphs) — the "fine print" grid

/** Greedy word-wrap to `cols` columns. */
export function wrapText(s: string, cols = PRINT_COLS): string[] {
	const lines: string[] = [];
	let cur = '';
	for (const w of s.split(/\s+/).filter(Boolean)) {
		if (!cur) cur = w;
		else if ((cur + ' ' + w).length <= cols) cur += ' ' + w;
		else {
			lines.push(cur);
			cur = w;
		}
	}
	if (cur) lines.push(cur);
	return lines;
}

/** A ledger line: LABEL left, value right, justified to `cols`. */
export function ledger(label: string, value: string, cols = PRINT_COLS): string {
	const l = label.toUpperCase();
	return l + ' '.repeat(Math.max(1, cols - l.length - value.length)) + value;
}

/** A full-width ASCII rule, e.g. dashes between sections. */
export function rule(ch = '-', cols = PRINT_COLS): string {
	return ch.repeat(cols);
}

type BarRow = { label: string; value: number; right: string; mark?: boolean };

/** Horizontal block bars: `> LABEL ███████       right`. A solid `█` run sized to the
 *  largest value; `>` + bold marks "you". `rail:true` fills the remainder with `░` for a
 *  visible track (default off — whitespace reads cleaner on thermal). Auto-fits `cols`. */
export function blockBars(
	rows: BarRow[],
	opts: { rail?: boolean; cols?: number } = {}
): { text: string; mark: boolean }[] {
	if (!rows.length) return [];
	const cols = opts.cols ?? PRINT_COLS;
	const labelW = Math.max(...rows.map((r) => r.label.length));
	const rightW = Math.max(...rows.map((r) => r.right.length));
	const max = Math.max(1, ...rows.map((r) => r.value));
	// line = rail(2) + label + ' ' + track + '  ' + right
	const track = Math.max(6, cols - (2 + labelW + 1 + 2 + rightW));
	return rows.map((r) => {
		const fill = Math.max(0, Math.min(track, Math.round((r.value / max) * track)));
		const bar = '█'.repeat(fill) + (opts.rail ? '░' : ' ').repeat(track - fill);
		const rail = r.mark ? '> ' : '  ';
		const text =
			rail + r.label.toUpperCase().padEnd(labelW) + ' ' + bar + '  ' + r.right.padStart(rightW);
		return { text, mark: !!r.mark };
	});
}

// Per-km dirtiness band labels (g CO2/km), cleanest -> dirtiest. Derived from the
// carbon model's BUCKET_MAX so the printed ranges always match the grey buckets:
//   [0-(b0-1)] [b0-(b1-1)] ... [b3+]
const SPREAD_LABELS = [
	`0-${BUCKET_MAX[0] - 1}`,
	...BUCKET_MAX.slice(1).map((hi, i) => `${BUCKET_MAX[i]}-${hi - 1}`),
	`${BUCKET_MAX[BUCKET_MAX.length - 1]}+`
];

/** A Marimekko strip of per-km dirtiness: one band per grey-bucket, segment WIDTH = how
 *  many people sit there (no counts shown — only the proportion reads). Bands are `█`
 *  runs split by `│`; the visitor's band carries a `▲ YOU` caret. Ranges sit on top. */
export function asciiSpread(values: number[], mine: number, cols = PRINT_COLS): string[] {
	const counts = [0, 0, 0, 0, 0];
	for (const v of values) counts[bucket(v)]++;
	const total = values.length || 1;
	const youB = bucket(mine);

	// Bands with anyone in them (YOU's band always shows), cleanest -> dirtiest.
	const vis = counts
		.map((count, band) => ({ band, count }))
		.filter((b) => b.count > 0 || b.band === youB);
	const k = vis.length;

	// Widths ∝ share, floored at 2 so a lone commuter stays visible, then the rounding
	// remainder handed to the largest fractions so the runs + dividers fill `cols` exactly.
	const fillTotal = cols - (k - 1); // one column per `│` divider
	const raw = vis.map((b) => (b.count / total) * fillTotal);
	const w = raw.map((x) => Math.max(2, Math.floor(x)));
	let leftover = fillTotal - w.reduce((a, b) => a + b, 0);
	const byFrac = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
	for (let j = 0; leftover > 0 && byFrac.length; j++, leftover--) w[byFrac[j % byFrac.length].i]++;
	while (leftover < 0) {
		const mi = w.indexOf(Math.max(...w));
		if (w[mi] <= 2) break;
		w[mi]--;
		leftover++;
	}

	// YOU's band prints solid; everyone else is a light, perforated fill. Shade means
	// "is this you", not dirtiness — that's carried by the cleanest -> dirtiest order.
	const strip = vis.map((b, i) => (b.band === youB ? '█' : '░').repeat(w[i])).join('│');

	// First column of each band's run (account for the `│` between runs).
	const starts: number[] = [];
	for (let i = 0, c = 0; i < k; i++) {
		starts.push(c);
		c += w[i] + 1;
	}

	// Ranges on top, each left-aligned over its band; nudge right on a collision.
	const labelRow = Array(cols).fill(' ');
	for (let i = 0, cursor = 0; i < k; i++) {
		const lab = SPREAD_LABELS[vis[i].band];
		const pos = Math.max(starts[i], cursor);
		for (let c = 0; c < lab.length && pos + c < cols; c++) labelRow[pos + c] = lab[c];
		cursor = pos + lab.length + 1;
	}

	const youI = vis.findIndex((b) => b.band === youB);
	const caretPos = Math.min(cols - 1, starts[youI] + Math.floor(w[youI] / 2));
	const ends = 'cleaner'.padEnd(cols - 'dirtier'.length) + 'dirtier';

	return [
		labelRow.join('').replace(/\s+$/, ''),

		strip,
		(' '.repeat(caretPos) + '▲ YOU').slice(0, cols),
		ends
	];
}

/** An editorial section header, numbered like a bill line: `NN LABEL ──…── stat`.
 *  One line, exactly `cols` wide. This is the divider, the header and the key stat
 *  fused — so sections no longer need a separate full-width rule. */
export function eyebrow(no: string, label: string, stat = '', cols = PRINT_COLS): string {
	const left = `${no} ${label.toUpperCase()} `;
	if (!stat) return left;
	const fill = Math.max(1, cols - left.length - 1 - stat.length);
	return (left + ' '.repeat(fill) + ' ' + stat).slice(0, cols);
}

/** An instrument-panel row, both sides railed: `│ label … value │`, exactly `cols`. */
export function panelRow(label: string, value = '', cols = PRINT_COLS): string {
	const inner = cols - 4; // '│ ' + inner + ' │'
	const gap = Math.max(1, inner - label.length - value.length);
	const body = (label + ' '.repeat(gap) + value).padEnd(inner).slice(0, inner);
	return '│ ' + body + ' │';
}

/** A railed panel line carrying a before→after comparison on one row:
 *  `│ aLabel aVal -> bLabel bVal  unit │`. ASCII `->` (CP437-safe); reuses panelRow's
 *  boxing and width clamp, so an over-long pair degrades by truncation, not overflow. */
export function panelPair(
	aLabel: string,
	aVal: string,
	bLabel: string,
	bVal: string,
	unit = '',
	cols = PRINT_COLS
): string {
	const left = `${aLabel} ${aVal} -> ${bLabel} ${bVal}`.trim();
	return panelRow(left, unit, cols);
}

/** A double-rule "subtotal" line, optionally with embedded text: `═══ mid ═══`. */
export function panelRule(mid = '', cols = PRINT_COLS): string {
	if (!mid) return '═'.repeat(cols);
	const t = ` ${mid} `;
	const total = Math.max(0, cols - t.length);
	const l = Math.floor(total / 2);
	return ('═'.repeat(l) + t + '═'.repeat(total - l)).slice(0, cols);
}

/** Center text in a 24-char source field, so at width-2 magnification it spans the
 *  full 48-col line as a single full-bleed band (used for the reverse hero number). */
export function heroSrc(text: string, srcCols = PRINT_COLS / 2): string {
	const t = text.length > srcCols ? text.slice(0, srcCols) : text;
	const pad = srcCols - t.length;
	const l = Math.floor(pad / 2);
	return ' '.repeat(l) + t + ' '.repeat(pad - l);
}

/** A boxed-digit odometer: count -> 3 lines (border, digits, border). */
export function asciiOdometer(count: number, digits = 6): string[] {
	const s = String(Math.max(0, Math.floor(count)))
		.padStart(digits, '0')
		.slice(-digits);
	const border = '+' + '---+'.repeat(s.length);
	const cells = '|' + [...s].map((d) => ` ${d} |`).join('');
	return [border, cells, border];
}
