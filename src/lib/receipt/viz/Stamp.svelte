<script lang="ts">
	// The commuter profile as an EMISSIONS RESONANCE — a Chladni standing-wave figure,
	// drawn in monospace ink. A vibrating plate's nodal lines (where it sits still) are
	// inked; the antinodes (where it's driven hardest) fill in as the commute gets dirtier.
	// A clean, light commute prints a sparse line-figure; a heavy one prints a dense, dark
	// mass. The darkness *is* the emissions — not decoration.
	//
	//   z(X,Y) = cos(aπX)cos(bπY) − cos(bπX)cos(aπY),   X,Y ∈ [−1,1],  a ≥ b
	//
	// PRINT NOTE: the SVG is captured to a 1-bit raster with a HARD threshold (lum<128) at
	// print time, so gray shade glyphs (░▒▓) get thresholded away and print near-blank.
	// Tone here is therefore made only of SOLID-black glyphs (`■`, `█` — both print crisp)
	// packed at varying density via an ordered (Bayer) dither. Every printed mark is pure
	// black, so nothing washes out: dirtier = denser = darker.
	//
	// n (a low→high mode) tracks per-km dirtiness, m the annual burden, `darkness` the
	// overall ink. A seeded dither varies the grain per visitor, so the same commute always
	// rings the same figure.
	let {
		n,
		m,
		seed = '',
		size = 188,
		darkness
	}: { n: number; m: number; seed?: string; size?: number; darkness?: number } = $props();

	function hash(s: string): number {
		let h = 2166136261 >>> 0;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h >>> 0;
	}

	// A small integer mixer → [0,1), for a deterministic per-cell grain dither.
	function mix(x: number): number {
		let t = (x ^ (x >>> 15)) >>> 0;
		t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35) >>> 0;
		return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
	}

	const PI = Math.PI;
	const uid = $derived(`chladni-${hash(seed)}-${n}-${m}`);

	// Overall ink: explicit when the caller passes it, else inferred from n & m (2..8).
	const dark = $derived(
		Math.max(0, Math.min(1, darkness ?? ((n - 2) / 6 + (m - 2) / 6) / 2))
	);

	// Solid-ink levels, light → dark. NO gray shades — they don't survive the 1-bit
	// threshold. Intermediate tone comes from dithering between these.
	const RAMP = [' ', '■', '█'];
	// 4x4 ordered-dither thresholds in (0,1).
	const BAYER = [
		[0, 8, 2, 10],
		[12, 4, 14, 6],
		[3, 11, 1, 9],
		[15, 7, 13, 5]
	].map((row) => row.map((v) => (v + 0.5) / 16));

	const COLS = 36;
	const ROWS = 22;
	const PAD = 12;

	const rows = $derived.by(() => {
		const a = Math.max(n, m);
		const b = Math.min(n, m);
		const field = (X: number, Y: number) =>
			Math.cos(a * PI * X) * Math.cos(b * PI * Y) - Math.cos(b * PI * X) * Math.cos(a * PI * Y);
		const grad = (X: number, Y: number): [number, number] => [
			-a * PI * Math.sin(a * PI * X) * Math.cos(b * PI * Y) +
				b * PI * Math.sin(b * PI * X) * Math.cos(a * PI * Y),
			-b * PI * Math.cos(a * PI * X) * Math.sin(b * PI * Y) +
				a * PI * Math.cos(b * PI * X) * Math.sin(a * PI * Y)
		];

		const h0 = hash(seed) || 1;
		const lineW = 0.06 + 0.1 * dark; // dirtier → thicker nodal lines
		const out: string[] = [];

		for (let r = 0; r < ROWS; r++) {
			const Y = ((r + 0.5) / ROWS) * 2 - 1;
			let line = '';
			for (let c = 0; c < COLS; c++) {
				const X = ((c + 0.5) / COLS) * 2 - 1;
				// crop the square plate to a disc so the seal reads round inside its ring
				if (X * X + Y * Y > 0.97 * 0.97) {
					line += ' ';
					continue;
				}
				const z = field(X, Y);
				const [zx, zy] = grad(X, Y);
				const gmag = Math.sqrt(zx * zx + zy * zy) + 1e-4;
				const d = Math.abs(z) / gmag; // ~distance to the nearest nodal line
				const lineInk = Math.exp(-(d * d) / (lineW * lineW)); // 1 on the node, fades off
				const zn = Math.min(1, Math.abs(z) / 2); // 0 on a node … 1 at an antinode
				const jit = mix((h0 + c * 374761393 + r * 668265263) >>> 0);

				// always draw the line-figure (a solid mark even when clean); let dirtiness
				// bolden it and flood the antinodes with denser ink.
				let ink = lineInk * (0.62 + 0.38 * dark) + dark * 0.75 * zn * zn;
				ink = Math.max(0, Math.min(1, ink + (jit - 0.5) * 0.06));

				// strong ink prints as a solid full block; mid-ink dithers between ■ and █
				// (or space and ■) so the gradient is built from pure-black marks only.
				let glyph: string;
				if (ink > 0.82) {
					glyph = '█';
				} else {
					const v = ink * (RAMP.length - 1); // 0..2
					const lo = Math.min(RAMP.length - 1, Math.floor(v));
					const up = Math.min(RAMP.length - 1, lo + (v - lo > BAYER[r & 3][c & 3] ? 1 : 0));
					glyph = RAMP[up];
				}
				line += glyph;
			}
			out.push(line);
		}
		return out;
	});

	const plot = $derived(size - 2 * PAD);
	const rowH = $derived(plot / ROWS);
	const ringR = $derived(size / 2 - 5);
</script>

<svg
	viewBox="0 0 {size} {size}"
	width={size}
	class="mx-auto block"
	role="img"
	aria-label="emissions resonance figure"
>
	<defs>
		<clipPath id={uid}>
			<circle cx={size / 2} cy={size / 2} r={ringR - 1} />
		</clipPath>
	</defs>
	<g
		clip-path="url(#{uid})"
		xml:space="preserve"
		font-family="ui-monospace, 'DejaVu Sans Mono', 'Liberation Mono', Menlo, monospace"
		font-size={rowH * 1.05}
		fill="#000"
	>
		{#each rows as line, r (r)}
			<text
				x={PAD}
				y={PAD + (r + 0.82) * rowH}
				textLength={plot}
				lengthAdjust="spacingAndGlyphs">{line}</text
			>
		{/each}
	</g>
	<circle cx={size / 2} cy={size / 2} r={ringR} fill="none" stroke="#000" stroke-width="1.4" />
</svg>
