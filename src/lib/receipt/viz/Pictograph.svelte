<script lang="ts">
	// Beat 7 — one compact cluster: a big count, a short caption, and a tight strip of
	// ASCII icons. Cylinders read as '8', trees as '^' — light single glyphs instead of
	// filled shapes, so a whole row costs almost no ink. Sized to sit two-up in a column.
	type Props = { count: number; kind: 'cylinder' | 'tree'; caption: string };
	let { count, kind, caption }: Props = $props();

	const shown = $derived(Math.min(Math.max(count, 0), 24));
	const glyph = $derived(kind === 'cylinder' ? '8' : '^');
	const icons = $derived(Array.from({ length: shown }, () => glyph).join(' '));
</script>

<div class="flex flex-col gap-1">
	<div class="font-display text-r-stat leading-none">{count}</div>
	<div class="font-mono text-r-2xs uppercase tracking-label">{caption}</div>
	<div class="mt-0.5 whitespace-pre-wrap break-all font-mono text-r-base leading-snug">{icons}</div>
</div>
