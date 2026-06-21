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

/** Horizontal bars: `> LABEL [==== ]  right`. Widths auto-fit to `cols`. */
export function asciiBars(rows: BarRow[], cols = PRINT_COLS): { text: string; mark: boolean }[] {
	if (!rows.length) return [];
	const labelW = Math.max(...rows.map((r) => r.label.length));
	const rightW = Math.max(...rows.map((r) => r.right.length));
	const max = Math.max(1, ...rows.map((r) => r.value));
	// line = rail(2) + label + ' ' + bar + '  ' + right ; bar = '[' + inner + ']'
	const track = Math.max(6, cols - (2 + labelW + 1 + 2 + rightW));
	const inner = track - 2;
	return rows.map((r) => {
		const fill = Math.max(0, Math.min(inner, Math.round((r.value / max) * inner)));
		const bar = '[' + '='.repeat(fill) + ' '.repeat(inner - fill) + ']';
		const rail = r.mark ? '> ' : '  ';
		const text = rail + r.label.toUpperCase().padEnd(labelW) + ' ' + bar + '  ' + r.right.padStart(rightW);
		return { text, mark: !!r.mark };
	});
}

/** The year as a field of light 'o' marks (each ~ kgPerBlock), '.' when clean. */
export function asciiSlab(
	co2Kg: number,
	kgPerBlock: number,
	isClean = false,
	cols = PRINT_COLS
): string[] {
	const perRow = Math.floor((cols + 1) / 2); // 'o ' pairs
	const cap = perRow * 16;
	const raw = Math.max(1, Math.round(co2Kg / kgPerBlock));
	const count = isClean ? perRow * 2 : Math.min(cap, raw);
	const glyph = isClean ? '.' : 'o';
	const rows: string[] = [];
	for (let i = 0; i < count; i += perRow) {
		rows.push(Array.from({ length: Math.min(perRow, count - i) }, () => glyph).join(' '));
	}
	if (!isClean && raw > cap) rows.push('...and then some');
	return rows;
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

/** A row of ASCII icons: '8' cylinders, '^' trees, capped. */
export function asciiPictoRow(count: number, kind: 'cylinder' | 'tree'): string {
	const shown = Math.min(Math.max(count, 0), 24);
	const glyph = kind === 'cylinder' ? '8' : '^';
	return Array.from({ length: shown }, () => glyph).join(' ');
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
