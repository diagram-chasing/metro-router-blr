<script lang="ts">
	// Beat 6 — the year as a slab of blocks, each ≈ kgPerBlock kg CO2. The size does
	// the talking. Clean trips render an empty grid (outlines only).
	let {
		co2Kg,
		kgPerBlock,
		isClean = false
	}: { co2Kg: number; kgPerBlock: number; isClean?: boolean } = $props();

	const W = 540;
	const cell = 22;
	const gap = 5;
	const cols = Math.floor((W + gap) / (cell + gap));
	const CAP = cols * 22; // keep the slab to a sane height

	const count = $derived(
		isClean ? cols * 2 : Math.min(CAP, Math.max(1, Math.round(co2Kg / kgPerBlock)))
	);
	const rows = $derived(Math.ceil(count / cols));
	const H = $derived(rows * (cell + gap) - gap);
	const capped = $derived(!isClean && Math.round(co2Kg / kgPerBlock) > CAP);
</script>

<svg viewBox="0 0 {W} {H}" width="100%" class="block" role="img" aria-label="annual emissions slab">
	{#each Array(count) as _, i (i)}
		{@const cx = (i % cols) * (cell + gap)}
		{@const cy = Math.floor(i / cols) * (cell + gap)}
		{#if isClean}
			<rect x={cx} y={cy} width={cell} height={cell} fill="none" stroke="#000" stroke-width="1" stroke-dasharray="2 2" shape-rendering="crispEdges" />
		{:else}
			<rect x={cx} y={cy} width={cell} height={cell} fill="#000" shape-rendering="crispEdges" />
		{/if}
	{/each}
</svg>
{#if capped}
	<p class="mt-1 font-mono text-r-xs font-bold">…and then some — each block ≈ {kgPerBlock} kg</p>
{/if}
