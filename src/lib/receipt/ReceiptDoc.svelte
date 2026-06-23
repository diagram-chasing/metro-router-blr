<script lang="ts">
	// Faithful on-screen preview: the same op-list the printer gets (buildReceiptOps),
	// on the printer's grid (80mm Font A = 48 monospace columns, 12x24 cells). Only the
	// glyph shapes differ (printer ROM font vs web font). The Chladni stamp / route map
	// / QR render inline and are captured from here at print time.
	import type { ReceiptView } from './receipt';
	import { buildReceiptOps, qrUrl } from './receiptOps';
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
			<div
				class="ln"
				style="text-align:{op.align ?? 'left'}; height:{(op.small ? 17 : 24) * (op.h ?? 1)}px;"
			>
				<span
					class:bold={op.bold}
					class:rev={op.rev}
					class:small={op.small}
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
					<RouteMap
						segments={view.route.geo}
						origin={view.item.origin}
						dest={view.item.dest}
						width={576}
						height={220}
					/>
				{:else}
					<Stamp
						n={view.archetype.figure.n}
						m={view.archetype.figure.m}
						seed={view.archetype.stampSeed}
						darkness={view.archetype.figure.darkness}
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
	/* fine print: the printer's Font B (9x17). 15px = 20px x 48/64, so 64 small
	   columns span the same 48ch paper width; 17px line matches the shorter glyph. */
	.small {
		font-size: 15px;
		line-height: 17px;
	}
	/* reverse (white-on-black) — the inverted annual-total hero. */
	.rev {
		background: #000;
		color: #fff;
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
