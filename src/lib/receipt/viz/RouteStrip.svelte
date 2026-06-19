<script lang="ts">
	// The route as a strip, not a map: two stops, the line, km ticks. Drawn in ink
	// on paper so it reads as part of the printed ledger.
	import { scaleLinear } from 'd3-scale';

	let { distanceKm }: { distanceKm: number } = $props();

	const INK = '#000000';
	const W = 540;
	const H = 46;
	const padX = 10;
	const lineY = 16;

	const x = $derived(
		scaleLinear()
			.domain([0, Math.max(0.1, distanceKm)])
			.range([padX, W - padX])
	);
	const ticks = $derived(x.ticks(Math.min(6, Math.max(2, Math.round(distanceKm / 2.5)))));
</script>

<svg viewBox="0 0 {W} {H}" width="100%" class="block" role="img" aria-label="route strip">
	<line x1={x(0)} y1={lineY} x2={x(distanceKm)} y2={lineY} stroke={INK} stroke-width="2" />
	<circle cx={x(0)} cy={lineY} r="5" fill="#fff" stroke={INK} stroke-width="2" />
	<circle cx={x(distanceKm)} cy={lineY} r="5" fill={INK} stroke={INK} stroke-width="2" />
	{#each ticks as t (t)}
		<line
			x1={x(t)}
			y1={lineY + 6}
			x2={x(t)}
			y2={lineY + 11}
			stroke={INK}
			stroke-width="1.5"
			shape-rendering="crispEdges"
		/>
		<text x={x(t)} y={H - 4} text-anchor="middle" class="fill-ink font-mono text-r-xs font-bold">{t}</text>
	{/each}
	<text x={W - padX} y={H - 4} text-anchor="end" class="fill-ink font-mono text-r-2xs">km</text>
</svg>
