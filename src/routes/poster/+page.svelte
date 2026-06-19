<script lang="ts">
	// Static poster panels — square, monochrome maps of the data process, as crisp
	// SVG/canvas for print.
	//
	//   /poster                       preview all panels (small)
	//   /poster?panel=grid-actual     AQI field, as travelled
	//   /poster?panel=grid-cf         AQI field, if all by public transport
	//   /poster?panel=accumulate      every route, graded
	//   /poster?panel=grade           one route, graded leg by leg
	//
	// Params: ?size=<px>  ?bg=<css>  (e.g. ?bg=%23000000 for the dark variant)
	import { onMount } from 'svelte';
	import PanelGrid from '$lib/poster/PanelGrid.svelte';
	import PanelAccumulate from '$lib/poster/PanelAccumulate.svelte';
	import PanelGrade from '$lib/poster/PanelGrade.svelte';

	type Key = 'grid-actual' | 'grid-cf' | 'accumulate' | 'grade';
	const KEYS: Key[] = ['grid-actual', 'grid-cf', 'accumulate', 'grade'];

	let panel = $state<Key | null>(null);
	let size = $state(620);
	let bg = $state('#ffffff');

	onMount(() => {
		const p = new URLSearchParams(window.location.search);
		const sel = p.get('panel');
		panel = (KEYS as string[]).includes(sel ?? '') ? (sel as Key) : null;
		const s = Number(p.get('size'));
		size = isFinite(s) && s > 0 ? s : panel ? 1400 : 620;
		bg = p.get('bg') ?? '#ffffff';
	});

	const all: { key: Key; title: string }[] = [
		{ key: 'grid-actual', title: 'AQI field — as travelled' },
		{ key: 'grid-cf', title: 'AQI field — if half these trips shifted to public transport' },
		{ key: 'accumulate', title: 'Accumulation' },
		{ key: 'grade', title: 'Grading a route' }
	];
</script>

{#snippet render(key: Key)}
	{#if key === 'grid-actual'}
		<PanelGrid {size} {bg} variant="actual" />
	{:else if key === 'grid-cf'}
		<PanelGrid {size} {bg} variant="counterfactual" />
	{:else if key === 'accumulate'}
		<PanelAccumulate {size} {bg} />
	{:else}
		<PanelGrade {size} {bg} />
	{/if}
{/snippet}

<div class="page" class:isolated={!!panel} style="background:{panel ? bg : '#e7e7e7'}">
	{#if panel}
		{@render render(panel)}
	{:else}
		{#each all as p (p.key)}
			<figure>
				<div class="square">{@render render(p.key)}</div>
				<figcaption>{p.title} <span class="hint">?panel={p.key}</span></figcaption>
			</figure>
		{/each}
	{/if}
</div>

<style>
	.page {
		min-height: 100vh;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 28px;
		align-items: flex-start;
		justify-content: center;
		padding: 28px;
		box-sizing: border-box;
	}
	.page.isolated {
		padding: 0;
		gap: 0;
		align-items: center;
	}
	figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.square {
		background: #fff;
		box-shadow: 0 1px 0 rgba(0, 0, 0, 0.08);
	}
	figcaption {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 12px;
		letter-spacing: 0.04em;
		color: #222;
	}
	.hint {
		color: #999;
		margin-left: 8px;
	}
	:global(svg) {
		display: block;
	}
</style>
