// Monospace builders for the printed receipt's ASCII charts, on the printer's fixed
// column grid (80mm Font A = 48 cols). DOM-free; dirtiness bands come from the
// carbon model so they can't drift from the wall-map grey buckets.

import { BUCKET_MAX } from '$lib/emissions';

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

// Per-km dirtiness axis, capped at the top bucket threshold (`N+`). Derived from the
// carbon model's BUCKET_MAX so the printed scale can't drift from the wall-map grey buckets.
const AXIS_CAP = BUCKET_MAX[BUCKET_MAX.length - 1];

/** An honest linear number line of per-km dirtiness (g CO2/km): 0 -> the top bucket
 *  threshold (capped `N+`), ticked at each BUCKET_MAX, with a `▲` marker under the axis at
 *  the visitor's exact value and a one-line percentile of where they land in the crowd.
 *  Bar length is deliberately gone — the axis is the only spatial variable, so distance
 *  finally means dirtiness and nothing else. */
export function asciiSpread(values: number[], mine: number, cols = PRINT_COLS): string[] {
	// Linear map a g/km value to a column, clamped to the axis.
	const posOf = (v: number) =>
		Math.max(0, Math.min(cols - 1, Math.round((Math.min(v, AXIS_CAP) / AXIS_CAP) * (cols - 1))));

	// Drop a label into a `cols`-wide row at `col`, shifted left if it would run off the
	// right edge (keeps the top `N+` tick and a right-pinned YOU value on the paper).
	const place = (row: string[], col: number, label: string) => {
		const start = Math.max(0, Math.min(col, cols - label.length));
		for (let i = 0; i < label.length && start + i < cols; i++) row[start + i] = label[i];
	};

	// Tick numbers above the axis: 0, each interior threshold, then the capped top (`N+`).
	const tickRow = Array(cols).fill(' ');
	place(tickRow, 0, '0');
	for (const t of BUCKET_MAX.slice(0, -1)) place(tickRow, posOf(t), String(t));
	place(tickRow, cols - 1, `${AXIS_CAP}+`);

	// The axis itself: ╠═══╦═══…═══╣, a ╦ at every interior threshold. Double box-drawing
	// reads bolder than the single rule and prints just as cleanly (half-blocks don't).
	const axis = Array(cols).fill('═');
	axis[0] = '╠';
	axis[cols - 1] = '╣';
	for (const t of BUCKET_MAX.slice(0, -1)) axis[posOf(t)] = '╦';

	// YOU marker below the axis, pointing up (▲ is the printer-safe caret), the exact value
	// centered under it.
	const caret = posOf(mine);
	const markRow = Array(cols).fill(' ');
	markRow[caret] = '▲';
	const youLabel = `YOU ${Math.round(mine)}`;
	const youRow = Array(cols).fill(' ');
	place(youRow, caret - Math.floor(youLabel.length / 2), youLabel);

	const ends = 'clean'.padEnd(cols - 'dirty'.length) + 'dirty';

	// Where the visitor lands: share of the logged audience dirtier than them.
	const n = values.length || 1;
	const dirtier = values.filter((v) => v > mine).length;
	const pct = Math.round((dirtier / n) * 100);

	const trim = (a: string[]) => a.join('').replace(/\s+$/, '');
	return [
		trim(tickRow),
		axis.join(''),
		trim(markRow),
		trim(youRow),
		ends,
		'',
		`Cleaner than ${pct}% of today's travellers.`
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

/** A boxed "cleaner ways" timetable: one ruled row per transit mode with its daily
 *  frequency and route numbers, columns aligned and routes clamped with a trailing `+`
 *  when they overflow. Fills `cols` as a full-width box. */
export function transitTable(
	modes: { label: string; trips: number; routes: string[] }[],
	cols = PRINT_COLS
): string[] {
	if (!modes.length) return [];
	const rows = modes.map((m) => ({
		mode: m.label.toUpperCase(),
		freq: `${m.trips}/day`,
		routes: m.routes.join(' ')
	}));
	const w1 = Math.max(...rows.map((r) => r.mode.length));
	const w2 = Math.max(...rows.map((r) => r.freq.length));
	const w3 = Math.max(6, cols - 10 - w1 - w2); // total = w1 + w2 + w3 + 10 = cols
	const seg = (n: number) => '─'.repeat(n + 2);
	const clamp = (s: string) =>
		s.length > w3 ? s.slice(0, Math.max(0, w3 - 1)).trimEnd() + '+' : s;
	return [
		`┌${seg(w1)}┬${seg(w2)}┬${seg(w3)}┐`,
		...rows.map(
			(r) => `│ ${r.mode.padEnd(w1)} │ ${r.freq.padStart(w2)} │ ${clamp(r.routes).padEnd(w3)} │`
		),
		`└${seg(w1)}┴${seg(w2)}┴${seg(w3)}┘`
	];
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

/** A to-scale footprint isotype: `areaM2` unit squares (`■` = 1 m²) laid out `perRow`
 *  wide, one glyph per square, space-separated. Returns the rows ready to center
 *  (18 m² -> a 3x6 block). */
export function footprintGrid(areaM2: number, perRow = 6): string[] {
	const n = Math.max(0, Math.round(areaM2));
	const rows: string[] = [];
	for (let i = 0; i < n; i += perRow) {
		rows.push(Array(Math.min(perRow, n - i)).fill('■').join(' '));
	}
	return rows;
}
