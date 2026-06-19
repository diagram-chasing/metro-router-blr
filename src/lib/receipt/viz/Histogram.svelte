<script lang="ts">
	// Beat 2 — where you sit among everyone who submitted today. Bars are the count
	// of people in each g/km band (cleaner on the left, dirtier on the right); the
	// marker drops on your own per-km figure. Fixed 0–180 g/km domain (cab tops out
	// ~172) so the shape is stable run to run.
	import { bin } from 'd3-array';
	import { scaleLinear } from 'd3-scale';

	let { values, mine }: { values: number[]; mine: number } = $props();

	const W = 540;
	const H = 150;
	const mL = 8;
	const mR = 8;
	const mT = 24;
	const mB = 28;
	const innerW = W - mL - mR;
	const innerH = H - mT - mB;
	const maxX = 180;

	const x = scaleLinear().domain([0, maxX]).range([0, innerW]);
	const bins = $derived(bin().domain([0, maxX]).thresholds(12)(values));
	const maxCount = $derived(Math.max(1, ...bins.map((b) => b.length)));
	const y = $derived(scaleLinear().domain([0, maxCount]).range([innerH, 0]));
	const mineX = $derived(x(Math.max(0, Math.min(maxX, mine))));
</script>

<svg viewBox="0 0 {W} {H}" width="100%" class="block" role="img" aria-label="today's distribution">
	<g transform="translate({mL} {mT})">
		<!-- bars -->
		{#each bins as b, i (i)}
			{@const bx = x(b.x0 ?? 0)}
			{@const bw = Math.max(1, x(b.x1 ?? 0) - x(b.x0 ?? 0) - 2)}
			{@const bh = innerH - y(b.length)}
			{#if b.length > 0}
				<rect x={bx} y={y(b.length)} width={bw} height={bh} fill="#000" shape-rendering="crispEdges" />
			{/if}
		{/each}
		<!-- baseline -->
		<line x1="0" y1={innerH} x2={innerW} y2={innerH} stroke="#000" stroke-width="1.5" />
		<!-- you marker -->
		<line x1={mineX} y1={-14} x2={mineX} y2={innerH} stroke="#000" stroke-width="2" stroke-dasharray="3 3" />
		<path d="M{mineX - 5},{-14} L{mineX + 5},{-14} L{mineX},{-6} Z" fill="#000" />
		<text x={mineX} y={-18} text-anchor="middle" class="fill-ink font-mono text-r-xs font-bold">YOU · {mine} g/km</text>
	</g>
	<!-- axis ends -->
	<text x={mL} y={H - 8} text-anchor="start" class="fill-ink font-mono text-r-2xs uppercase tracking-label">cleaner</text>
	<text x={W - mR} y={H - 8} text-anchor="end" class="fill-ink font-mono text-r-2xs uppercase tracking-label">dirtier · {maxX} g/km</text>
</svg>
