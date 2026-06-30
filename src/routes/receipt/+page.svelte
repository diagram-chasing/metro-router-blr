<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import XpProgress from '$lib/exhibit/XpProgress.svelte';
	import XpWindow from '$lib/exhibit/XpWindow.svelte';
	import type { StoredReceipt } from '$lib/server/receiptStore';
	import ReceiptDoc from '$lib/receipt/ReceiptDoc.svelte';
	import { buildReceiptView, type Distribution, type Histogram } from '$lib/receipt/receipt';
	import { downloadReceipt, openReceipt } from '$lib/receipt/rasterize';
	import { printReceipt } from '$lib/receipt/printReceipt';
	import { resetAnswers } from '$lib/exhibit/store.svelte';

	type ReceiptResponse = StoredReceipt & {
		distribution?: Distribution;
		histogram?: Histogram;
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
		// Wipe the previous visitor's answers (name included) so the welcome screen
		// starts blank instead of prefilling the last name.
		resetAnswers();
		goto('/exhibit');
	}
</script>

<XpWindow title="Your 2025 Receipt" icon="/xp/readme.ico">
	<div class="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto py-2">
		<div class="flex w-full max-w-2xl justify-center gap-3">
			<div class="h-[56px] w-full">
				<TactileButton label="New visitor →" size="md" onclick={startOver} />
			</div>
			{#if view}
				<div class="h-[56px] w-full">
					<TactileButton label={busy ? 'Printing…' : 'Print'} size="md" onclick={printFast} />
				</div>
				<!-- <div class="h-[56px] w-[clamp(130px,17vw,180px)]">
					<TactileButton label="Save image" size="md" onclick={save} />
				</div>
				<div class="h-[56px] w-[clamp(120px,16vw,170px)]">
					<TactileButton label="Preview" size="md" onclick={preview} />
				</div> -->
			{/if}
		</div>

		{#if printMsg}
			<p
				class="text-[13px] font-semibold {printMsg === 'Sent to printer'
					? 'text-[#1a7a1a]'
					: 'text-[#b52012]'}"
			>
				{printMsg}
			</p>
		{/if}

		{#if loading}
			<div
				class="mt-8 flex w-[min(420px,90%)] flex-col gap-3 rounded-[3px] border border-[#aca899] bg-[#ece9d8] p-5 shadow-[2px_2px_8px_rgba(0,0,0,0.45)]"
			>
				<span class="text-[14px] font-bold text-[#003366]">Printing your year...</span>
				<XpProgress indeterminate />
				<span class="text-[12px] text-[#5a564a]">Please wait while your receipt is prepared.</span>
			</div>
		{:else if error}
			<div
				class="mt-8 flex w-[min(420px,90%)] flex-col gap-2 rounded-[3px] border border-[#aca899] bg-[#ece9d8] p-5 shadow-[2px_2px_8px_rgba(0,0,0,0.45)]"
			>
				<span class="text-[14px] font-bold text-[#b52012]">Could not load receipt</span>
				<span class="text-[12px] text-[#5a564a]">{error}</span>
			</div>
		{:else if view}
			<!-- The receipt is a fixed 576px paper facsimile; frame it like a print preview. -->
			<div
				class="max-w-2xl overflow-x-clip border border-[#aca899] bg-white shadow-[4px_4px_14px_rgba(0,0,0,0.45)]"
			>
				<ReceiptDoc {view} bind:node />
			</div>
		{/if}
	</div>
</XpWindow>
