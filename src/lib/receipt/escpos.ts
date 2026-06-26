// A tiny ESC/POS byte builder for a generic 80mm (576-dot) thermal printer.
//
// ESC/POS text streams from the printer's ROM font at full mechanical speed (~5-8s),
// versus ~40s to print the whole receipt as a raster bitmap (the head heats every
// dot-row). Most of the receipt is monospace-ASCII + a QR + two small graphics, so it
// maps to native text; only the Chladni stamp and route map need a small raster blit
// (see printReceipt.ts).
//
// Commands used are the ESC/POS standard supported by virtually all generic printers.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const DOTS_80MM = 576; // print width in dots for an 80mm head at 203 dpi

// Unicode -> CP437 (PC437) byte, for the box-drawing / block glyphs the receipt draws.
// CP437 is selected at init() via `ESC t 0`; only the glyphs we actually print are
// mapped — anything else degrades to '?'. If the physical printer numbers PC437
// differently, this map + the `ESC t` arg in init() are the two points to change.
const CP437: Record<string, number> = {
	// block shading + half blocks
	'░': 0xb0, '▒': 0xb1, '▓': 0xb2, '█': 0xdb,
	'▄': 0xdc, '▀': 0xdf, '▌': 0xdd, '▐': 0xde,
	'■': 0xfe, '▲': 0x1e, '²': 0xfd, '·': 0xfa, // 0xfd super-2 (for "m²"); 0xfa the centred dot
	// single-line box
	'┌': 0xda, '┐': 0xbf, '└': 0xc0, '┘': 0xd9, '─': 0xc4, '│': 0xb3,
	'├': 0xc3, '┤': 0xb4, '┬': 0xc2, '┴': 0xc1, '┼': 0xc5,
	// double-line box
	'╔': 0xc9, '╗': 0xbb, '╚': 0xc8, '╝': 0xbc, '═': 0xcd, '║': 0xba,
	'╠': 0xcc, '╣': 0xb9, '╦': 0xcb, '╩': 0xca, '╬': 0xce
};

/** Map a string to CP437 bytes; ASCII passes through, mapped glyphs use the table,
 *  anything unknown becomes '?'. Iterates code points so astral chars degrade cleanly. */
function encodeCp437(s: string): number[] {
	const out: number[] = [];
	for (const ch of s) {
		const c = ch.codePointAt(0)!;
		if (c < 0x80) out.push(c);
		else out.push(CP437[ch] ?? 0x3f);
	}
	return out;
}

export class EscPos {
	private parts: number[] = [];

	private push(...b: number[]): this {
		for (const x of b) this.parts.push(x);
		return this;
	}

	raw(bytes: ArrayLike<number>): this {
		for (let i = 0; i < bytes.length; i++) this.parts.push(bytes[i]);
		return this;
	}

	/** ESC @ — reset to a known state, then `ESC t 0` — select the PC437 code page so
	 *  the box-drawing / block glyphs print as glyphs (ESC @ resets the page, so this
	 *  must follow it). */
	init(): this {
		return this.push(ESC, 0x40).push(ESC, 0x74, 0x00);
	}

	text(s: string): this {
		return this.raw(encodeCp437(s));
	}

	line(s = ''): this {
		return this.text(s).push(LF);
	}

	/** ESC a n — 0 left, 1 center, 2 right. */
	align(a: 'left' | 'center' | 'right'): this {
		return this.push(ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0);
	}

	/** ESC E n — emphasis (bold). */
	bold(on: boolean): this {
		return this.push(ESC, 0x45, on ? 1 : 0);
	}

	/** GS B n — reverse (white-on-black). Used for the inverted annual-total hero. */
	reverse(on: boolean): this {
		return this.push(GS, 0x42, on ? 1 : 0);
	}

	/** ESC - n — underline (0 off, 1 thin, 2 thick). */
	underline(n: 0 | 1 | 2): this {
		return this.push(ESC, 0x2d, n);
	}

	/** GS ! n — character magnification (1..8 in each axis). */
	size(w: 1 | 2 | 3 | 4 = 1, h: 1 | 2 | 3 | 4 = 1): this {
		return this.push(GS, 0x21, ((w - 1) << 4) | (h - 1));
	}

	/** ESC M n — font A (0, 12x24) or B (1, 9x17). A = 48 cols, B = 64 cols on 80mm. */
	font(f: 'A' | 'B'): this {
		return this.push(ESC, 0x4d, f === 'B' ? 1 : 0);
	}

	/** ESC d n — feed n lines. */
	feed(n = 1): this {
		return this.push(ESC, 0x64, n & 0xff);
	}

	/** GS V — cut paper (full). Most heads need a few lines of feed first. */
	cut(): this {
		return this.feed(3).push(GS, 0x56, 0x00);
	}

	/** GS ( k — native QR. The printer renders it in hardware: fast and sharp. */
	qr(data: string, moduleSize = 6, ec: 'L' | 'M' | 'Q' | 'H' = 'M'): this {
		const ecByte = { L: 48, M: 49, Q: 50, H: 51 }[ec];
		const d = encodeCp437(data);
		const storeLen = d.length + 3;
		return this.push(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00) // model 2
			.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, Math.max(1, Math.min(16, moduleSize))) // size
			.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, ecByte) // error correction
			.push(GS, 0x28, 0x6b, storeLen & 0xff, (storeLen >> 8) & 0xff, 0x31, 0x50, 0x30) // store
			.raw(d)
			.push(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // print
	}

	/** GS v 0 — raster bit image. `bits` is 1bpp, MSB-first, row-padded to whole bytes. */
	image(bits: ArrayLike<number>, widthDots: number, heightDots: number): this {
		const widthBytes = Math.ceil(widthDots / 8);
		return this.push(
			GS,
			0x76,
			0x30,
			0x00,
			widthBytes & 0xff,
			(widthBytes >> 8) & 0xff,
			heightDots & 0xff,
			(heightDots >> 8) & 0xff
		).raw(bits);
	}

	bytes(): Uint8Array {
		return new Uint8Array(this.parts);
	}
}
