<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import XpMapPrompt from '$lib/exhibit/XpMapPrompt.svelte';
	import XpProgress from '$lib/exhibit/XpProgress.svelte';
	import XpWindow from '$lib/exhibit/XpWindow.svelte';
	import type { StoredReceipt } from '$lib/server/receiptStore';
	import ReceiptDoc from '$lib/receipt/ReceiptDoc.svelte';
	import { buildReceiptView, type Distribution, type Histogram } from '$lib/receipt/receipt';
	import { downloadReceipt, openReceipt } from '$lib/receipt/rasterize';
	import { printReceipt } from '$lib/receipt/printReceipt';
	import { resetAnswers } from '$lib/exhibit/store.svelte';
	import { playDing } from '$lib/exhibit/sound';

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
	// Silent auto-print status, surfaced only softly (the map prompt narrates it).
	let printState = $state<'idle' | 'printing' | 'printed' | 'failed'>('idle');
	// "Add myself to the map" is now an explicit action (POST /api/lines), not an
	// automatic side effect of computing the receipt.
	let added = $state(false);
	let adding = $state(false);
	let addError = $state<string | null>(null);

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

	let dinged = false;
	// Ring once the moment the finished receipt first renders.
	$effect(() => {
		if (view && !dinged) {
			dinged = true;
			playDing();
		}
	});

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
	async function doPrint() {
		if (!node || !view || busy) return;
		busy = true;
		printMsg = null;
		printState = 'printing';
		try {
			await printReceipt(view, node);
			printState = 'printed';
			printMsg = 'Sent to printer';
		} catch (e) {
			printState = 'failed';
			printMsg = e instanceof Error ? e.message : 'print failed';
		} finally {
			busy = false;
		}
	}

	// Silently try the printer as soon as the finished receipt is on screen. Fires
	// once; the manual Reprint button is the fallback if the printer is offline.
	let autoPrinted = false;
	$effect(() => {
		if (view && node && !autoPrinted) {
			autoPrinted = true;
			void doPrint();
		}
	});

	// Explicit "add myself to the map": posts this receipt's route to the wall.
	async function addToMap() {
		if (!receipt || added || adding) return;
		adding = true;
		addError = null;
		try {
			const res = await fetch('/api/lines', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: receipt.id })
			});
			if (!res.ok) throw new Error(`server returned ${res.status}`);
			added = true;
		} catch (e) {
			addError = e instanceof Error ? e.message : 'unknown error';
		} finally {
			adding = false;
		}
	}

	function startOver() {
		// Wipe the previous visitor's answers (name included) so the welcome screen
		// starts blank instead of prefilling the last name.
		resetAnswers();
		goto('/exhibit');
	}

	// Debug view: hide the dialog + scrim to inspect the raw receipt as it renders.
	// Toggled with the `D` key (kiosk operators only; no on-screen affordance).
	let debug = $state(false);
	function onKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement | null;
		if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
		if (e.key === 'd' || e.key === 'D') {
			debug = !debug;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<XpWindow title="Your Receipt" icon="/xp/readme.ico">
	<div class="relative flex min-h-0 flex-1 flex-col">
		{#if loading}
			<div class="flex flex-1 items-center justify-center">
				<div
					class="flex w-[min(420px,90%)] flex-col gap-3 rounded-[3px] border border-[#aca899] bg-[#ece9d8] p-5 shadow-[2px_2px_8px_rgba(0,0,0,0.45)]"
				>
					<span class="text-[14px] font-bold text-[#003366]">Printing your year...</span>
					<XpProgress indeterminate />
					<span class="text-[12px] text-[#5a564a]">Please wait while your receipt is prepared.</span
					>
				</div>
			</div>
		{:else if error}
			<div class="flex flex-1 items-center justify-center">
				<div
					class="flex w-[min(420px,90%)] flex-col gap-2 rounded-[3px] border border-[#aca899] bg-[#ece9d8] p-5 shadow-[2px_2px_8px_rgba(0,0,0,0.45)]"
				>
					<span class="text-[14px] font-bold text-[#b52012]">Could not load receipt</span>
					<span class="text-[12px] text-[#5a564a]">{error}</span>
				</div>
			</div>
		{:else if view}
			<!-- Receipt layer: the finished paper, glimpsed behind the dialog (top edge
			     peeks out above it). Always mounted so auto-print + Reprint have `node`. -->
			<div class="absolute inset-0 flex justify-center overflow-y-auto px-4 pb-40 pt-6">
				<div
					class="h-max max-w-2xl overflow-x-clip border border-[#aca899] bg-white shadow-[4px_4px_14px_rgba(0,0,0,0.45)]"
				>
					<ReceiptDoc {view} bind:node />
				</div>
			</div>

			{#if debug}
				<div
					class="pointer-events-none absolute right-3 top-3 rounded-[3px] border border-[#aca899] bg-[#ffffcc] px-2 py-1 text-[12px] font-bold text-[#5a564a] shadow-[1px_1px_4px_rgba(0,0,0,0.3)]"
				>
					debug · press D to exit
				</div>
			{:else}
				<!-- Scrim dims the receipt so the dialog is the focus. -->
				<div class="absolute inset-0 bg-black/30"></div>

				<!-- Modal: the map prompt, centered over the receipt. -->
				<div class="absolute inset-0 flex flex-col items-center justify-center p-4">
					<div class="w-full max-w-3xl">
						<XpMapPrompt
							{added}
							{adding}
							{printState}
							printing={busy}
							error={addError}
							onAdd={addToMap}
							onPrint={doPrint}
						/>
					</div>
				</div>

				<!-- Kiosk reset, pinned to the bottom-right corner. -->
				<div class="absolute bottom-4 right-4 h-[44px] w-[clamp(160px,26vw,240px)]">
					<TactileButton label="New visitor →" size="md" onclick={startOver} />
				</div>
			{/if}
		{/if}
	</div>
</XpWindow>
