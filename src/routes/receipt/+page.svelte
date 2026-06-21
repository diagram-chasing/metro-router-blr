<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import type { StoredReceipt } from '$lib/server/receiptStore';
	import ReceiptDoc from '$lib/receipt/ReceiptDoc.svelte';
	import { buildReceiptView, type Distribution, type Histogram } from '$lib/receipt/receipt';
	import { downloadReceipt, openReceipt } from '$lib/receipt/rasterize';
	import { printReceipt } from '$lib/receipt/printReceipt';

	type ReceiptResponse = StoredReceipt & {
		distribution?: Distribution;
		histogram?: Histogram;
		cityCount?: number;
	};

	let loading = $state(true);
	let error = $state<string | null>(null);
	let receipt = $state<ReceiptResponse | null>(null);
	let node = $state<HTMLElement | null>(null);
	let busy = $state(false);
	let printMsg = $state<string | null>(null);

	const view = $derived(
		receipt
			? buildReceiptView(
					receipt.computed,
					receipt.answers,
					receipt.geo,
					receipt.distribution,
					receipt.histogram,
					receipt.cityCount ?? null,
					receipt.id,
					receipt.createdAt
				)
			: null
	);

	$effect(() => {
		const id = $page.url.searchParams.get('id');
		if (!id) {
			error = 'no receipt id in url';
			loading = false;
			return;
		}
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/receipt?id=${encodeURIComponent(id)}`);
			if (!res.ok) throw new Error(`status ${res.status}`);
			receipt = (await res.json()) as ReceiptResponse;
		} catch (e) {
			error = e instanceof Error ? e.message : 'fetch failed';
		} finally {
			loading = false;
		}
	}

	async function save() {
		if (!node || busy) return;
		busy = true;
		try {
			await downloadReceipt(node, `commute-receipt-${receipt?.id ?? 'x'}.png`);
		} finally {
			busy = false;
		}
	}

	async function preview() {
		if (!node || busy) return;
		busy = true;
		try {
			await openReceipt(node);
		} finally {
			busy = false;
		}
	}

	// Fast path: encode to native ESC/POS and stream to the thermal printer service.
	async function printFast() {
		if (!node || !view || busy) return;
		busy = true;
		printMsg = null;
		try {
			await printReceipt(view, node);
			printMsg = 'Sent to printer';
		} catch (e) {
			printMsg = e instanceof Error ? e.message : 'print failed';
		} finally {
			busy = false;
		}
	}

	function startOver() {
		goto('/exhibit');
	}
</script>

<main class="page">
	<div class="toolbar">
		<TactileButton label="NEW VISITOR →" size="md" glow="amber" onclick={startOver} />
		{#if view}
			<TactileButton
				label={busy ? 'PRINTING…' : 'PRINT'}
				size="md"
				glow="amber"
				onclick={printFast}
			/>
			<TactileButton label="SAVE IMAGE" size="md" glow="amber" onclick={save} />
			<TactileButton label="PREVIEW" size="md" glow="amber" onclick={preview} />
		{/if}
	</div>
	{#if printMsg}
		<p class="status" class:err={printMsg !== 'Sent to printer'}>{printMsg}</p>
	{/if}

	{#if loading}
		<p class="status">Printing your year…</p>
	{:else if error}
		<p class="status err">Failed to load: {error}</p>
	{:else if view}
		<div class="paper-wrap">
			<ReceiptDoc {view} bind:node />
		</div>
	{/if}
</main>

<style>
	.page {
		min-height: 100vh;
		background: #0c0c0c;
		padding: 32px 16px 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 28px;
	}

	.toolbar {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		justify-content: center;
		min-height: 56px;
	}

	.status {
		color: #ededed;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 16px;
		padding: 60px 0;
		letter-spacing: 0.12em;
	}
	.status.err {
		color: #ff7058;
	}

	/* The receipt itself is a fixed 576 px; show it on a soft shadow so the kiosk
	   operator sees exactly what prints. Scrollable on narrow screens. */
	.paper-wrap {
		max-width: 100%;
		overflow-x: auto;
		box-shadow:
			0 30px 80px rgba(0, 0, 0, 0.55),
			0 8px 24px rgba(0, 0, 0, 0.35);
	}
</style>
