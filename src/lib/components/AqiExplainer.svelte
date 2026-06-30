<script lang="ts">
	// The intermittent one-liner that states the wall's chain in plain words: soot -> the AQI you
	// breathe -> months of life. Rotates with the avoidable-soot call-to-action (which=1). A "statement"
	// overlay rendered as the photo-negative of the receipt-slip banners: same 1-bit system, inverted
	// ground (ink panel, paper type, paper-block chips), so it reads as part of the receipt/terminal
	// family rather than a separate scrim. Only opacity animates (parent pulse).
	let {
		which = 0,
		actualG = 0,
		avoidableG = 0,
		opacity = 0,
		scale = 1
	}: {
		which?: 0 | 1;
		actualG?: number;
		avoidableG?: number;
		opacity?: number;
		scale?: number;
	} = $props();

	// Avoidable / actual in one shared unit (kg over the decade, or grams when the day is young) —
	// same switch as ChoiceCrowdBanner's footer.
	const fmt = $derived.by(() => {
		if (actualG >= 1000) {
			const f = (g: number) =>
				g / 1000 >= 100 ? Math.round(g / 1000).toLocaleString('en-IN') : (g / 1000).toFixed(1);
			return { a: f(avoidableG), b: f(actualG), unit: 'kg' };
		}
		return { a: String(Math.round(avoidableG)), b: String(Math.round(actualG)), unit: 'g' };
	});

	// One shared panel — the inverted receipt slip: ink ground, paper hairline frame, paper type,
	// the same hard 1-bit shadow as the data banners. No blur glow, no italics.
	const panel =
		'm-0 inline-block border-[calc(var(--wall-scale)*2px)] border-paper bg-ink/90 px-[calc(var(--wall-scale)*28px)] py-[calc(var(--wall-scale)*20px)] font-mono text-[length:calc(var(--wall-scale)*clamp(28px,2vw,56px))] font-bold leading-[1.35] tracking-[0.01em] text-paper shadow-[0_8px_30px_rgba(0,0,0,0.5)] [-webkit-font-smoothing:none] [font-smooth:never] [text-wrap:balance]';

	// Inverted data chip — paper block, ink type — matches the receipt banners' reverse motif.
	const chip = 'whitespace-nowrap bg-paper px-[calc(var(--wall-scale)*8px)] text-ink tabular-nums';
</script>

<div
	class="pointer-events-none absolute left-1/2 top-1/2 z-[17] w-[min(90%,calc(var(--wall-scale)*1080px))] -translate-x-1/2 -translate-y-1/2 text-center will-change-[opacity]"
	style="opacity:{opacity}; --wall-scale:{scale}"
>
	{#if which === 0}
		<p class={panel}>
			The particle pollution our commutes leave in the air is the
			<span class={chip}>AQI</span>, which costs us
			<span class="text-[#ff5a36]">years of life</span>
		</p>
	{:else}
		<p class={panel}>
			When we add today's <span class={chip}>{fmt.a} {fmt.unit} of PM2.5</span>
			over the next decade, it costs us in
			<span class="text-[#ff5a36]">years of life</span>
		</p>
	{/if}
</div>
