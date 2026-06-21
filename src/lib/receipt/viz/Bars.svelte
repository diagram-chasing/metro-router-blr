<script lang="ts">
	// Horizontal bars as plain ASCII: LABEL [====      ]  annotation. Bar length
	// encodes the value; the visitor's own row goes bold with a '>' rail marker —
	// weight carries it, no box. A light run of '=' is all the ink there is, so it
	// prints fast, and because it's real monospace text it aligns on the glyph grid.
	// Used for the corridor and the swap comparison.
	type Row = { label: string; value: number; right: string; mark?: boolean };
	let {
		rows,
		labelW = 6,
		track = 18
	}: { rows: Row[]; labelW?: number; track?: number } = $props();

	const max = $derived(Math.max(1, ...rows.map((r) => r.value)));
	const lines = $derived(
		rows.map((r) => {
			const fill = Math.max(0, Math.min(track, Math.round((r.value / max) * track)));
			const bar = '[' + '='.repeat(fill) + ' '.repeat(track - fill) + ']';
			const label = r.label.toUpperCase().padEnd(labelW).slice(0, labelW);
			const rail = r.mark ? '>' : ' ';
			return { text: `${rail} ${label} ${bar}  ${r.right}`, mark: !!r.mark };
		})
	);
</script>

<div class="font-mono text-r-sm leading-relaxed" role="img" aria-label="bar chart">
	{#each lines as l, i (i)}
		<div class="overflow-hidden whitespace-pre {l.mark ? 'font-bold' : ''}">{l.text}</div>
	{/each}
</div>
