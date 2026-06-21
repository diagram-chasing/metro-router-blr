<script lang="ts">
	// Beat 2 — where you sit among everyone who submitted today, as a light ASCII
	// column chart. Each column is a g/km band (cleaner left, dirtier right); its
	// height is how many people landed there. A caret drops on your own per-km figure.
	// Fixed 0–180 g/km domain (cab tops out ~172) so the shape is stable run to run.
	// Pure monospace text — ':' is the heaviest glyph here, so it prints almost free.
	let { values, mine }: { values: number[]; mine: number } = $props();

	const N = 12; // bands
	const MAXX = 180; // g/km
	const H = 4; // column height in rows
	const GL = ':';

	const clampI = (i: number) => Math.max(0, Math.min(N - 1, i));

	const chart = $derived.by(() => {
		const counts = Array(N).fill(0);
		for (const v of values) counts[clampI(Math.floor((v / MAXX) * N))]++;
		const maxC = Math.max(1, ...counts);
		const hgt = counts.map((c) => Math.round((c / maxC) * H));

		const bands: string[] = [];
		for (let lvl = H; lvl >= 1; lvl--) {
			bands.push(hgt.map((h) => (h >= lvl ? GL : ' ') + ' ').join('').replace(/\s+$/, ''));
		}
		const axis = '+' + '-'.repeat(N * 2 - 2) + '+'; // width 2N
		const youI = clampI(Math.floor((mine / MAXX) * N));
		const caret = ' '.repeat(youI * 2) + '^';
		const ends = 'cleaner' + ' '.repeat(N * 2 - 14) + 'dirtier';
		const scale = '0 g/km' + ' '.repeat(N * 2 - 14) + '180 g/km';
		return [...bands, axis, caret, `YOU = ${mine} g/km`, ends, scale].join('\n');
	});
</script>

<div
	class="whitespace-pre font-mono text-r-sm leading-tight"
	role="img"
	aria-label="today's distribution, you at {mine} g/km"
>{chart}</div>
