// A tiny ESC/POS byte builder for a generic 80mm (576-dot) thermal printer.
//
// Why this exists: printing the receipt as a tall raster bitmap is slow (~40s) —
// the head heats every dot-row. Native ESC/POS text streams from the printer's ROM
// font at full mechanical speed (~5-8s for this receipt). Since the redesign is now
// monospace-ASCII + a QR + two small graphics, almost all of it maps to native text;
// only the Chladni stamp and route map need a small raster blit (see printReceipt.ts).
//
// Commands used are the ESC/POS standard supported by virtually all generic printers.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const DOTS_80MM = 576; // print width in dots for an 80mm head at 203 dpi

/** Map a string to bytes; anything non-ASCII becomes '?' (the receipt is all ASCII). */
function encodeAscii(s: string): number[] {
	const out: number[] = [];
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		out.push(c < 0x80 ? c : 0x3f);
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

	/** ESC @ — reset to a known state. */
	init(): this {
		return this.push(ESC, 0x40);
	}

	text(s: string): this {
		return this.raw(encodeAscii(s));
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
		const d = encodeAscii(data);
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
