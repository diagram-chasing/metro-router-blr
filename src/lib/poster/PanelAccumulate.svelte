<script lang="ts">
	// PANEL — "Accumulation".
	// Every visitor route stored in the DB, overlaid on the city. Each route is
	// drawn in the single grey shade it earned from its blended CO2 intensity
	// (grey.ts buckets) — the crisp SVG twin of AccumulationMap.svelte's output.
	import { onMount } from 'svelte';
	import { VIEW_BBOX, makeProjector, shadesFor } from './project';
	import MetroBase from './MetroBase.svelte';

	let { size = 1400, bg = '#ffffff' }: { size?: number; bg?: string } = $props();

	const margin = $derived(size * 0.03);
	const projector = $derived(makeProjector(VIEW_BBOX, size, margin));
	const shades = $derived(shadesFor(bg));
	const width = $derived(Math.max(2.5, size / 200));

	type WireLine = {
		greyBucket: number;
		segments: { coords: [number, number][] }[];
	};
	let lines = $state<WireLine[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/api/lines');
			lines = ((await res.json()) as { lines: WireLine[] }).lines;
		} catch (err) {
			console.warn('PanelAccumulate: /api/lines failed', err);
		}
	});

	const points = (coords: [number, number][]) =>
		coords.map(([lng, lat]) => projector.project(lng, lat).join(',')).join(' ');
	const shadeFor = (b: number) => shades[Math.max(0, Math.min(shades.length - 1, b))];
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" style="background:{bg}">
	<MetroBase {projector} {bg} />
	<g opacity="0.9">
		{#each lines as line, li (li)}
			{#each line.segments as seg, si (si)}
				{#if seg.coords.length >= 2}
					<polyline
						points={points(seg.coords)}
						fill="none"
						stroke={shadeFor(line.greyBucket)}
						stroke-width={width}
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
				{/if}
			{/each}
		{/each}
	</g>
</svg>
