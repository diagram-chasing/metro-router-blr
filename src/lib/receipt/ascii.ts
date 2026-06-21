// Pure monospace builders for the printed receipt's ASCII charts. These mirror the
// on-screen Svelte components (Bars / Slab / Pictograph / Histogram) but are tuned to
// the printer's fixed column grid (80mm Font A = 48 cols) instead of the 576px raster
// width. Kept dependency-free and DOM-free so the print path can run anywhere.

export const PRINT_COLS = 48; // 80mm, Font A (12-dot glyphs)

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

/** An editorial section header, numbered like a bill line: `NN LABEL ──…── stat`.
 *  One line, exactly `cols` wide. This is the divider, the header and the key stat
 *  fused — so sections no longer need a separate full-width rule. */
export function eyebrow(no: string, label: string, stat = '', cols = PRINT_COLS): string {
	const left = `${no} ${label.toUpperCase()} `;
	if (!stat) return (left + '─'.repeat(Math.max(0, cols - left.length))).slice(0, cols);
	const fill = Math.max(1, cols - left.length - 1 - stat.length);
	return (left + '─'.repeat(fill) + ' ' + stat).slice(0, cols);
}

/** An instrument-panel row, both sides railed: `│ label … value │`, exactly `cols`. */
export function panelRow(label: string, value = '', cols = PRINT_COLS): string {
	const inner = cols - 4; // '│ ' + inner + ' │'
	const gap = Math.max(1, inner - label.length - value.length);
	const body = (label + ' '.repeat(gap) + value).padEnd(inner).slice(0, inner);
	return '│ ' + body + ' │';
}

/** A double-rule "subtotal" line, optionally with embedded text: `═══ mid ═══`. */
export function panelRule(mid = '', cols = PRINT_COLS): string {
	if (!mid) return '═'.repeat(cols);
	const t = ` ${mid} `;
	const total = Math.max(0, cols - t.length);
	const l = Math.floor(total / 2);
	return ('═'.repeat(l) + t + '═'.repeat(total - l)).slice(0, cols);
}

/** A colon-aligned key:value row: `LABEL    : value` (the "report" look). */
export function kv(label: string, value: string, w = 9, cols = PRINT_COLS): string {
	return (label.toUpperCase().padEnd(w) + ' : ' + value).slice(0, cols);
}

/** A drawn LPG canister, 5 lines tall (top, 3 body rows, bottom). Pair the 3 body
 *  rows with adjacent text in the caller. */
export function canister(): string[] {
	return ['┌──┐', '│██│', '│██│', '│██│', '└──┘'];
}

/** A titled, solid-filled footprint box (a plan-view "chunk of ground"): a centered
 *  title in the top border, `fillRows` of `█`, a bottom border. Each line `cols` wide. */
export function footprintBox(title: string, fillRows = 3, cols = 34): string[] {
	const inner = cols - 2;
	const t = ` ${title.toUpperCase()} `;
	const pad = Math.max(0, inner - t.length);
	const l = Math.floor(pad / 2);
	const top = '┌' + '─'.repeat(l) + t + '─'.repeat(pad - l) + '┐';
	const fill = '│ ' + '█'.repeat(Math.max(0, cols - 4)) + ' │';
	const bottom = '└' + '─'.repeat(inner) + '┘';
	return [top, ...Array.from({ length: fillRows }, () => fill), bottom];
}

/** A grouping rail (dispatch-form style): `┌ item / ├ item / └ item`. */
export function treeList(items: string[]): string[] {
	return items.map((it, i) => {
		const lead = items.length === 1 ? '└' : i === 0 ? '┌' : i === items.length - 1 ? '└' : '├';
		return `${lead} ${it}`;
	});
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

/** Distribution as a full-width ASCII column chart with a YOU caret underneath. */
export function asciiHistogram(values: number[], mine: number, cols = PRINT_COLS): string[] {
	const N = Math.floor(cols / 2); // one bin per 2 columns → fills the full width
	const MAXX = 180;
	const H = 5;
	const clampI = (i: number) => Math.max(0, Math.min(N - 1, i));

	const counts = Array(N).fill(0);
	for (const v of values) counts[clampI(Math.floor((v / MAXX) * N))]++;
	const maxC = Math.max(1, ...counts);
	const hgt = counts.map((c) => Math.round((c / maxC) * H));

	const out: string[] = [];
	for (let lvl = H; lvl >= 1; lvl--) {
		out.push(hgt.map((h) => (h >= lvl ? '[]' : '  ')).join('').replace(/\s+$/, ''));
	}
	out.push('+' + '-'.repeat(N * 2 - 2) + '+');
	const youI = clampI(Math.floor((mine / MAXX) * N));
	out.push(' '.repeat(youI * 2) + '^');
	out.push(`YOU = ${mine} g/km`);
	out.push('cleaner' + ' '.repeat(cols - 14) + 'dirtier');
	return out;
}
