<script lang="ts">
	import TactileButton from './TactileButton.svelte';

	// The deliberate "add myself to the map" moment on the receipt screen. Adding a
	// route to the wall is no longer automatic (see POST /api/lines) — this XP
	// message box is what triggers it, and spells out the chain the wall then draws:
	// the commute becomes PM2.5, which the AQLI turns into months of life.
	let {
		added = false,
		adding = false,
		printState = 'idle',
		printing = false,
		error = null,
		onAdd,
		onPrint
	}: {
		added?: boolean;
		adding?: boolean;
		printState?: 'idle' | 'printing' | 'printed' | 'failed';
		printing?: boolean;
		error?: string | null;
		onAdd?: () => void;
		onPrint?: () => void;
	} = $props();

	const printLine = $derived(
		printState === 'printing'
			? 'Printing your receipt…'
			: printState === 'printed'
				? 'Your receipt is printing. Take it with you.'
				: printState === 'failed'
					? 'Printer is offline. Use Reprint to try again.'
					: ''
	);
	const printLabel = $derived(
		printing
			? 'PRINTING…'
			: printState === 'printed'
				? 'PRINTED'
				: printState === 'failed'
					? 'REPRINT'
					: 'PRINT'
	);
	// Lock the button once it prints; only a failure reopens it (as Reprint).
	const printDisabled = $derived(printing || printState === 'printed');

	// Classic sunken XP field bevel (light bottom/right, dark top/left).
	const sunken =
		'border border-[#808080] bg-white shadow-[inset_-1px_-1px_#ffffff,inset_1px_1px_#7f7f7f]';

	// Success surfaces the XP way: a tray balloon in the corner, not inline text.
	let dismissed = $state(false);
</script>

<div
	class="font-xp w-full overflow-hidden rounded-t-[5px] border-[3px] border-[#0054e3] bg-[#ece9d8] shadow-[2px_2px_10px_rgba(0,0,0,0.35)]"
>
	<!-- ── Title bar (matches XpWindow) ── -->
	<div
		class="flex items-center gap-2 rounded-t-[2px] border-b border-[#003ad6] bg-gradient-to-b from-[#0e6fff] via-[#1f60e5] to-[#0a53d6] px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
	>
		<img
			src="/xp/readme.ico"
			alt=""
			class="h-5 w-5 shrink-0 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]"
		/>
		<span
			class="flex-1 truncate text-[17px] font-bold tracking-[0.01em] text-white drop-shadow-[1px_1px_1px_rgba(0,0,0,0.55)]"
		>
			Add yourself to the map
		</span>
		<div class="flex items-center gap-1.5" aria-hidden="true">
			<span
				class="grid h-[22px] w-[22px] place-items-center rounded-[3px] border border-white/40 bg-[#2c6af7] text-[12px] font-bold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
				>_</span
			>
			<span
				class="grid h-[22px] w-[22px] place-items-center rounded-[3px] border border-white/40 bg-[#e94d3d] text-[14px] font-bold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
				>×</span
			>
		</div>
	</div>

	<!-- ── Body: classic message-box (icon column + text) ── -->
	<div class="flex gap-4 px-6 py-5">
		<img src="/xp/readme.ico" alt="" class="mt-0.5 h-11 w-11 shrink-0" />

		<div class="flex min-w-0 flex-1 flex-col gap-5">
			<div class="flex flex-col gap-3.5">
				<p class="text-[21px] font-bold text-[#003399]">
					Your receipt is ready, add yourself to the map.
				</p>
				<p class=" text-balance text-[16px] leading-[1.5] text-[#2a2a22]">
					Those kilometres become fine pollutants in the air we call PM2.5, and the Air Quality Life
					Index turns that into years of life the city loses. Watch it happen on the map.
				</p>
			</div>

			<!-- The chain the wall draws, as a sunken read-out -->
			<div class="{sunken} flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
				<span class="text-[15px] font-bold text-[#003399]">YOUR COMMUTE</span>
				<span class="text-[15px] font-bold text-[#7a7668]">&rsaquo;</span>
				<span class="text-[15px] font-bold text-[#003399]">PM2.5</span>
				<span class="text-[15px] font-bold text-[#7a7668]">&rsaquo;</span>
				<span class="text-[15px] font-bold text-[#c23a1e]">MONTHS OF LIFE</span>
			</div>

			{#if printLine}
				<p class="text-[13px] {printState === 'failed' ? 'text-[#b52012]' : 'text-[#5a564a]'}">
					{printLine}
				</p>
			{/if}
			{#if error}
				<p class="text-[13px] font-bold text-[#b52012]">Could not add to map: {error}</p>
			{/if}

			<!-- Footer: secondary Print + primary CTA, right-aligned like an XP dialog -->
			<div class="flex items-center justify-end gap-3 pt-1">
				<div class="h-[52px] w-[clamp(140px,18vw,180px)]">
					<TactileButton label={printLabel} size="md" disabled={printDisabled} onclick={onPrint} />
				</div>
				<div class="relative h-[56px] w-[clamp(240px,36vw,320px)]">
					<!-- ── XP tray balloon: floats above the button once you're on the wall ── -->
					{#if added && !dismissed}
						<div
							class="font-xp absolute bottom-[calc(100%+11px)] left-1/2 z-50 w-[320px] max-w-[92vw] -translate-x-1/2"
						>
							<div
								class="relative rounded-[4px] border border-[#c8b560] bg-[#ffffe1] px-3 pb-3 pt-2.5 shadow-[2px_2px_10px_rgba(0,0,0,0.4)]"
							>
								<div class="flex items-start gap-2.5">
									<span
										class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-b from-[#4a9bff] to-[#0055ea] text-[15px] font-bold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
										>i</span
									>
									<div class="min-w-0 flex-1 pr-4 text-left">
										<p class="text-[20px] font-bold text-[#003399]">Your trip is on the wall</p>
										<p class="mt-0.5 text-balance text-[16px] leading-[1.4] text-[#2a2a22]">
											Look up to find your line on the map.
										</p>
									</div>
								</div>
								<!-- Tail pointing down toward the button -->
								<div
									class="absolute -bottom-[7px] left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[#c8b560] bg-[#ffffe1]"
								></div>
							</div>
						</div>
					{/if}
					<TactileButton
						label={added ? 'ADDED TO MAP' : adding ? 'ADDING…' : 'ADD ME TO THE MAP'}
						size="md"
						disabled={added || adding}
						onclick={onAdd}
					/>
				</div>
			</div>
		</div>
	</div>
</div>
