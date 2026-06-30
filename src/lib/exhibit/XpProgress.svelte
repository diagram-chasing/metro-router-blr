<script lang="ts">
	// Classic XP green chunked progress bar. Determinate via `value` (0..1), or a sweeping
	// block when `indeterminate`.
	let { value = 0, indeterminate = false }: { value?: number; indeterminate?: boolean } = $props();

	const pct = $derived(Math.max(0, Math.min(1, value)) * 100);

	// White separators every ~11px over a vertical green gradient = the segmented blocks.
	const FILL =
		'repeating-linear-gradient(90deg, rgba(255,255,255,0) 0 9px, rgba(255,255,255,0.55) 9px 11px), linear-gradient(180deg, #d2ffd2 0%, #00e400 45%, #00c000 100%)';
</script>

<div
	class="h-[18px] w-full overflow-hidden rounded-[2px] border border-[#828790] bg-white p-[1px] shadow-inner"
>
	{#if indeterminate}
		<div
			class="h-full w-[40%] animate-[xp-marquee_1.1s_linear_infinite] rounded-[1px]"
			style="background-image:{FILL}"
		></div>
	{:else}
		<div
			class="h-full rounded-[1px] transition-[width] duration-200"
			style="width:{pct}%; background-image:{FILL}"
		></div>
	{/if}
</div>
