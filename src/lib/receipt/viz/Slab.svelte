<script lang="ts">
	// Beat 6 — the year as a field of marks, each ≈ kgPerBlock kg CO2. The size does
	// the talking, but in light ASCII now: a run of 'o' (a hollow ring, almost no ink)
	// instead of solid blocks. Clean trips render a sparse '.' field. The caption that
	// says what one mark is worth lives in Receipt.svelte, so this is grid-only.
	let {
		co2Kg,
		kgPerBlock,
		isClean = false
	}: { co2Kg: number; kgPerBlock: number; isClean?: boolean } = $props();

	const COLS = 22;
	const CAP = COLS * 16; // keep the field to a sane height

	const raw = $derived(Math.max(1, Math.round(co2Kg / kgPerBlock)));
	const count = $derived(isClean ? COLS * 2 : Math.min(CAP, raw));
	const glyph = $derived(isClean ? '.' : 'o');

	const grid = $derived.by(() => {
		const rows: string[] = [];
		for (let i = 0; i < count; i += COLS) {
			rows.push(Array.from({ length: Math.min(COLS, count - i) }, () => glyph).join(' '));
		}
		return rows.join('\n');
	});
	const capped = $derived(!isClean && raw > CAP);
</script>

<div class="font-mono text-r-sm" role="img" aria-label="annual emissions field">
	<div class="whitespace-pre leading-tight">{grid}</div>
	{#if capped}
		<div class="mt-1 text-r-xs font-bold">...and then some -- each o ~ {kgPerBlock} kg</div>
	{/if}
</div>
