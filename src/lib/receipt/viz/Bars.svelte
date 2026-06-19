<script lang="ts">
	// Horizontal bars: a left label, a solid ink bar over a faint track, a right
	// annotation. The visitor's own row goes bold with a ◀ marker — no box, weight
	// carries it. Used for the corridor and the swap comparison.
	import { scaleLinear } from 'd3-scale';

	type Row = { label: string; value: number; right: string; mark?: boolean };
	let {
		rows,
		labelW = 56,
		rightW = 150
	}: { rows: Row[]; labelW?: number; rightW?: number } = $props();

	const INK = '#000000';
	const W = 540;
	const rowH = 30;
	const barX0 = $derived(labelW + 12);
	const barMaxW = $derived(W - barX0 - rightW);
	const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
	const x = $derived(scaleLinear().domain([0, max]).range([0, barMaxW]));
	const H = $derived(rows.length * rowH);
</script>

<svg viewBox="0 0 {W} {H}" width="100%" class="block" role="img" aria-label="bar chart">
	{#each rows as r, i (i)}
		{@const cy = i * rowH}
		<text
			x={labelW}
			y={cy + rowH / 2 + 4}
			text-anchor="end"
			class="fill-ink font-mono text-r-base {r.mark ? 'font-bold' : ''}"
		>
			{r.label}
		</text>
		<!-- hollow track shows the full extent; solid fill is the value. Pure B/W. -->
		<rect
			x={barX0}
			y={cy + rowH / 2 - 5}
			width={barMaxW}
			height="10"
			fill="none"
			stroke={INK}
			stroke-width="1"
			shape-rendering="crispEdges"
		/>
		<rect
			x={barX0}
			y={cy + rowH / 2 - 5}
			width={Math.max(2, x(r.value))}
			height="10"
			fill={INK}
			shape-rendering="crispEdges"
		/>
		<text
			x={W}
			y={cy + rowH / 2 + 4}
			text-anchor="end"
			class="fill-ink font-mono text-r-base {r.mark ? 'font-bold' : ''}"
		>
			{r.right}{r.mark ? '  ◀' : ''}
		</text>
	{/each}
</svg>
