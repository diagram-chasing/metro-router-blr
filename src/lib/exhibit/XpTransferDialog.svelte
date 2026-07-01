<script lang="ts">
	import XpProgress from './XpProgress.svelte';

	let {
		open = false,
		durationMs = 5000,
		title = 'Sending to printer',
		fileName = 'receipt.escpos'
	}: {
		open?: boolean;
		durationMs?: number;
		title?: string;
		fileName?: string;
	} = $props();

	let progress = $state(0);

	// Drive a determinate 0..1 fill over durationMs whenever the dialog is open,
	// so the bar visibly marches to the end across the hold.
	$effect(() => {
		if (!open) {
			progress = 0;
			return;
		}
		const start = performance.now();
		let raf = 0;
		const tick = (now: number) => {
			progress = Math.min(1, (now - start) / durationMs);
			if (progress < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	const status = $derived(
		progress < 0.2
			? 'Getting printer information...'
			: progress < 0.95
				? `Sending ${fileName} to Receipt Printer...`
				: 'Transfer complete'
	);
</script>

{#if open}
	<div
		class="font-xp fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
		role="dialog"
		aria-modal="true"
		aria-label={title}
	>
		<div
			class="flex w-[min(560px,94vw)] flex-col overflow-hidden rounded-t-[6px] border-[3px] border-[#0054e3] bg-[#ece9d8] shadow-[6px_6px_24px_rgba(0,0,0,0.55)]"
		>
			<!-- ── Title bar ── -->
			<div
				class="flex shrink-0 items-center gap-2 rounded-t-[3px] border-b border-[#003ad6] bg-gradient-to-b from-[#0e6fff] via-[#1f60e5] to-[#0a53d6] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
			>
				<span
					class="grid h-5 w-5 shrink-0 place-items-center rounded-[2px] bg-white/15 text-white"
					aria-hidden="true"
				>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor">
						<path d="M4 6V2h8v4M4 12H2V6h12v6h-2M4 10h8v4H4z" stroke-width="1.3" />
					</svg>
				</span>
				<span
					class="flex-1 truncate text-[15px] font-bold text-white drop-shadow-[1px_1px_1px_rgba(0,0,0,0.55)]"
				>
					{title}
				</span>
			</div>

			<!-- ── Body ── -->
			<div class="flex flex-col gap-5 px-7 py-6">
				<!-- Source → flying papers → printer -->
				<div class="relative flex items-center justify-between px-6">
					<div class="z-10 flex flex-col items-center gap-1.5">
						<svg width="46" height="46" viewBox="0 0 32 32" aria-hidden="true">
							<rect x="3" y="5" width="26" height="17" rx="1.5" fill="#5aa9f5" stroke="#1f4e8a" />
							<rect x="5" y="7" width="22" height="13" fill="#cfe6ff" />
							<path d="M11 25h10l1.5 3H9.5z" fill="#9bb0c4" stroke="#5a6b7d" stroke-width="0.8" />
						</svg>
						<span class="text-[12px] font-bold text-[#3a3a32]">This computer</span>
					</div>

					<div class="absolute left-1/2 top-2 h-9 w-[42%] -translate-x-1/2 overflow-hidden">
						{#each [0, 0.5, 1] as delay (delay)}
							<div
								class="absolute left-0 top-1.5"
								style="--xp-fly-x:130px; animation: xp-fly 1.5s linear {delay}s infinite"
							>
								<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
									<path
										d="M5 2h9l5 5v15H5z"
										fill="#ffffff"
										stroke="#1f6fe0"
										stroke-width="1.4"
									/>
									<path d="M14 2v5h5" fill="none" stroke="#1f6fe0" stroke-width="1.4" />
									<path d="M8 12h8M8 15h8M8 18h5" stroke="#7fb0ee" stroke-width="1.2" />
								</svg>
							</div>
						{/each}
					</div>

					<div class="z-10 flex flex-col items-center gap-1.5">
						<svg width="46" height="46" viewBox="0 0 32 32" aria-hidden="true">
							<rect x="7" y="4" width="18" height="9" fill="#d8d4c4" stroke="#8a8676" />
							<rect x="4" y="12" width="24" height="11" rx="1.5" fill="#ece9d8" stroke="#8a8676" />
							<rect x="8" y="20" width="16" height="8" fill="#ffffff" stroke="#8a8676" />
							<path d="M10 22h12M10 24.5h12" stroke="#b8b4a4" stroke-width="0.9" />
							<circle cx="24" cy="16" r="1.2" fill="#2e8b2e" />
						</svg>
						<span class="text-[12px] font-bold text-[#3a3a32]">Receipt printer</span>
					</div>
				</div>

				<div class="flex flex-col gap-2">
					<span class="text-[13px] text-[#3a3a32]">{status}</span>
					<XpProgress value={progress} />
				</div>
			</div>
		</div>
	</div>
{/if}
