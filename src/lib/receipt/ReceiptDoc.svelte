<script lang="ts">
	// Faithful on-screen preview of the PRINTED receipt. It renders the exact same
	// op-list the printer gets (buildReceiptOps), on the printer's grid: 80mm Font A =
	// 48 monospace columns, 12x24 cells (double-height/width handled via transforms).
	// So what you see here is what the thermal head lays down — only the glyph shapes
	// differ (the printer uses its built-in ROM font, not a web font). The Chladni
	// stamp / route map / QR render inline and are captured from here at print time.
	import type { ReceiptView } from './model';
	import { buildReceiptOps, qrUrl } from './printReceipt';
	import RouteMap from './viz/RouteMap.svelte';
	import Stamp from './viz/Stamp.svelte';
	import QR from './viz/QR.svelte';

	let { view, node = $bindable(null) }: { view: ReceiptView; node?: HTMLElement | null } = $props();

	const ops = $derived(buildReceiptOps(view));
	const originX = (a?: string) => (a === 'center' ? 'center' : a === 'right' ? 'right' : 'left');
</script>

<div class="paper" bind:this={node}>
	{#each ops as op, i (i)}
		{#if op.t === 'text'}
			<div class="ln" style="text-align:{op.align ?? 'left'}; height:{24 * (op.h ?? 1)}px;">
				<span
					class:bold={op.bold}
					style="display:inline-block; transform:scale({op.w ?? 1},{op.h ?? 1}); transform-origin:{originX(op.align)} top;"
					>{op.s || ' '}</span
				>
			</div>
		{:else if op.t === 'rule'}
			<div class="ln">{'-'.repeat(48)}</div>
		{:else if op.t === 'gap'}
			<div style="height:{24 * (op.n ?? 1)}px"></div>
		{:else if op.t === 'img'}
			<div class="img" data-print={op.id}>
				{#if op.id === 'map'}
					<RouteMap segments={view.route.geo} width={520} height={210} />
				{:else}
					<Stamp
						n={view.archetype.figure.n}
						m={view.archetype.figure.m}
						seed={view.archetype.stampSeed}
					/>
				{/if}
			</div>
		{:else if op.t === 'qr'}
			<div class="img"><QR data={qrUrl(view)} size={140} /></div>
		{/if}
	{/each}
</div>

<style>
	/* 48ch wide = exactly the printer's 48-column line; the font size only changes the
	   absolute size, never the column count, so wrapping/alignment always match paper. */
	.paper {
		width: 48ch;
		box-sizing: content-box;
		background: #fff;
		color: #000;
		padding: 16px;
		font-family: ui-monospace, 'Liberation Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo,
			'Courier New', monospace;
		font-size: 20px;
		line-height: 24px;
		-webkit-font-smoothing: none;
		font-smooth: never;
	}
	.ln {
		white-space: pre;
		overflow: hidden;
	}
	.bold {
		font-weight: 700;
	}
	.img {
		display: flex;
		justify-content: center;
		padding: 4px 0;
	}
	.img :global(svg) {
		max-width: 100%;
		height: auto;
	}
</style>
