<script lang="ts">
	// Beat 7 — one compact cluster: a big count, a short caption, and a tight strip
	// of icons. Sized to sit two-up in a column, so cylinders and trees pack into a
	// fraction of the old footprint.
	type Props = { count: number; kind: 'cylinder' | 'tree'; caption: string };
	let { count, kind, caption }: Props = $props();

	const shown = $derived(Math.min(Math.max(count, 0), 24));
</script>

<div class="flex flex-col gap-1">
	<div class="font-mono text-r-stat font-bold leading-none">{count}</div>
	<div class="font-mono text-r-xs uppercase tracking-label">{caption}</div>
	<div class="mt-1 flex flex-wrap gap-[3px]">
		{#each Array(shown) as _, i (i)}
			{#if kind === 'cylinder'}
				<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
					<rect x="5" y="0" width="2" height="3" fill="#000" />
					<path d="M2,5 q0,-3 4,-3 t4,3 v9 q0,2 -2,2 h-4 q-2,0 -2,-2 z" fill="#000" />
				</svg>
			{:else}
				<svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
					<circle cx="6" cy="6" r="5" fill="#000" />
					<rect x="5" y="10" width="2" height="6" fill="#000" />
				</svg>
			{/if}
		{/each}
	</div>
</div>
