<script lang="ts">
	// Beat 9 — the bracket shuts. A live clock + how many more trips registered while
	// the visitor read, shown on a mechanical odometer. On the printed bitmap this is
	// frozen at print time. The per-minute rate is a convention (flagged in the fine
	// print).
	let { cityCount }: { cityCount: number | null } = $props();

	const CARS_PER_MIN = 3;
	const DIGITS = 6;
	const startMs = Date.now();
	let elapsedSec = $state(0);
	let now = $state(new Date());

	$effect(() => {
		const t = setInterval(() => {
			now = new Date();
			elapsedSec = Math.floor((Date.now() - startMs) / 1000);
		}, 1000);
		return () => clearInterval(t);
	});

	const elapsedMin = $derived(Math.floor(elapsedSec / 60));
	const delta = $derived(Math.floor((elapsedSec / 60) * CARS_PER_MIN));
	const timeLabel = $derived(
		now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
	);
	const base = $derived(cityCount ?? 0);
	const reels = $derived(
		String(base + delta)
			.padStart(DIGITS, '0')
			.split('')
	);
</script>

<div class="font-mono text-ink">
	<p class="flex items-baseline gap-2.5">
		<span class="text-r-lg font-bold tabular-nums">{timeLabel}</span>
		<span class="text-r-sm">(+{elapsedMin} min)</span>
	</p>
	<p class="mt-1 text-r-base">+{delta} more registered while you read this. They'll get a receipt too.</p>

	{#if cityCount != null}
		<!-- odometer: fixed-width digit wheels, each split by a seam line -->
		<div class="mt-3 flex items-center gap-3">
			<div class="flex gap-[3px]">
				{#each reels as d, i (i)}
					<span
						class="relative grid h-12 w-8 place-items-center border-2 border-ink bg-paper text-r-stat font-bold leading-none tabular-nums"
					>
						<span class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-ink"></span>
						{d}
					</span>
				{/each}
			</div>
			<span class="text-r-xs uppercase tracking-label">trips<br />to date</span>
		</div>
		<p class="mt-1.5 text-r-xs">was {base.toLocaleString('en-IN')}</p>
	{/if}
</div>
