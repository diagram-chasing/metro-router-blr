<script lang="ts">
	import { PM25_BUCKET_MAX, pm25Bucket } from '$lib/emissions';

	// The soot-per-km distribution — a DOM port of the receipt's asciiSpread (src/lib/receipt/ascii.ts):
	// the population split into mg-PM2.5/km bands, each band's width ∝ how many commutes sit in it, with
	// a ▲ YOU caret on the spotlighted route's band. `mine` is that route's g/pkm; pass mine < 0 (idle)
	// to show the spread with no caret. `appearance` re-keys the strip so the materialize-in replays.
	let {
		bands = [],
		mine = -1,
		total = 0,
		opacity = 0,
		scale = 2,
		appearance = 0,
		stagger = 0.06,
		drawIn = 0.5
	}: {
		bands?: number[];
		mine?: number;
		total?: number;
		opacity?: number;
		scale?: number;
		appearance?: number;
		stagger?: number;
		drawIn?: number;
	} = $props();

	const N = PM25_BUCKET_MAX.length + 1; // number of bands (0..N-1)
	const MIN_W = 0.12; // floored flex-grow so a lone band stays visible (asciiSpread's Math.max(2,…))

	// Dot-matrix geometry. Width is still flex-grow (responsive-safe, same data encoding as before);
	// each bar is just *filled* with a dot grid sized to overshoot its rendered width, then clipped —
	// so a bar always reaches its right edge no matter the viewport/scale.
	const ROWS = 15; // dot rows per bar — keep in sync with the bar's h-[calc(var(--dot-pitch)*4)] below
	const STRIP_COLS = 210; // nominal dot-columns across the whole strip (intentionally generous)
	const COL_PAD = 1; // a few spare columns per bar so the clip never reveals a gap on the right

	const bandRange = (i: number): string => {
		const lo = i === 0 ? 0 : PM25_BUCKET_MAX[i - 1];
		if (i >= PM25_BUCKET_MAX.length) return `${lo}+`;
		return `${lo}–${PM25_BUCKET_MAX[i] - 1}`;
	};

	const youBand = $derived(mine >= 0 ? pm25Bucket(mine) : -1);

	// Stable pseudo-random in [0,1) per (band, dot) — deterministic so the scatter is identical
	// across reactive re-derives but fresh on each {#key appearance} remount.
	const rand = (a: number, b: number): number => {
		let h = (Math.imul(a + 1, 73856093) ^ Math.imul(b + 1, 19349663)) >>> 0;
		h ^= h >>> 13;
		return (h >>> 0) / 4294967295;
	};

	// Per-dot entrance delay. Scatter-dominated (rand) so the bar *develops* dot-by-dot like a print
	// rather than wiping; a faint per-column term keeps a soft left→right undertow underneath.
	const dotDelay = (segIdx: number, k: number): number => {
		const col = Math.floor(k / ROWS);
		return segIdx * stagger + col * 0.008 + rand(segIdx, k) * drawIn;
	};

	type Seg = { i: number; w: number; range: string; isYou: boolean; cols: number };
	const vis = $derived.by((): Seg[] => {
		const counts = Array.from({ length: N }, (_, i) => bands[i] ?? 0);
		const sum = counts.reduce((s, c) => s + c, 0) || 1;

		const raw: { i: number; w: number }[] = [];
		for (let i = 0; i < N; i++) {
			if (counts[i] <= 0 && i !== youBand) continue; // drop empty bands, but never the YOU band
			raw.push({ i, w: Math.max(MIN_W, counts[i] / sum) });
		}
		const wSum = raw.reduce((s, r) => s + r.w, 0) || 1;

		return raw.map(({ i, w }) => ({
			i,
			w,
			range: bandRange(i),
			isYou: i === youBand,
			cols: Math.max(1, Math.round((STRIP_COLS * w) / wSum)) + COL_PAD
		}));
	});
</script>

{#if total > 0 && vis.length}
	<div
		class="pointer-events-none absolute left-1/2 top-[clamp(20px,4.5%,84px)] z-[17] flex w-[min(90%,calc(var(--wall-scale)*1020px))] -translate-x-1/2 flex-col gap-[calc(var(--wall-scale)*12px)] border-2 border-black bg-paper px-[calc(var(--wall-scale)*20px)] py-[calc(var(--wall-scale)*16px)] font-mono text-ink shadow-[0_8px_30px_rgba(0,0,0,0.5)] [-webkit-font-smoothing:none] [font-smooth:never]"
		style="opacity:{opacity}; --wall-scale:{scale}; --draw:{drawIn}s; --dot-pitch:calc(var(--wall-scale)*6px); --dot-size:calc(var(--wall-scale)*5px)"
	>
		<div
			class="flex items-baseline justify-center gap-[calc(var(--wall-scale)*24px)] bg-black text-center text-white"
		>
			<span class="text-[length:calc(var(--wall-scale)*clamp(18px,1.7vw,32px))] font-bold uppercase"
				>GRAMS OF PM2.5 GENERATED PER KM</span
			>
		</div>

		{#key appearance}
			<div class="mt-4 flex flex-col gap-[calc(var(--wall-scale)*10px)]">
				<div class="flex w-full items-end">
					{#each vis as b (b.i)}
						<div
							class="basis-0 text-center text-[length:calc(var(--wall-scale)*clamp(11px,1.95vw,27px))] font-bold tabular-nums tracking-[0.02em] opacity-80"
							style="flex-grow:{b.w}"
						>
							{b.range}
						</div>
					{/each}
				</div>

				<div class="flex w-full items-end">
					{#each vis as b, idx (b.i)}
						<div
							class="relative ml-0.5 h-[calc(var(--dot-pitch)*8)] basis-0 overflow-hidden border-l-[calc(var(--wall-scale)*4px)] border-ink first:border-l-0"
							style="flex-grow:{b.w}"
						>
							{#if b.isYou}
								<div
									class="absolute inset-[calc(var(--wall-scale)*2px)] origin-bottom animate-[bar-rise_0.42s_cubic-bezier(0.34,1.4,0.64,1)_both] bg-ink motion-reduce:animate-none"
									style="animation-delay:{idx * stagger + drawIn * 0.8}s"
								></div>
							{:else}
								<div
									class="grid h-full place-items-center"
									style="grid-template-rows:repeat(10,var(--dot-pitch));grid-auto-flow:column;grid-auto-columns:var(--dot-pitch)"
								>
									{#each Array(b.cols * ROWS) as _, k (k)}
										<span
											class="block h-[var(--dot-size)] w-[var(--dot-size)] animate-[dot-in_0.34s_cubic-bezier(0.215,0.61,0.355,1)_both] rounded-full bg-ink motion-reduce:animate-none"
											style="animation-delay:{dotDelay(idx, k)}s"
										></span>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<!-- YOU caret -->
				<div class="flex min-h-[calc(var(--wall-scale)*20px)] w-full items-end">
					{#each vis as b (b.i)}
						<div class="basis-0 text-center" style="flex-grow:{b.w}">
							{#if b.isYou}
								<span
									class="inline-block animate-[caret-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both] text-[length:calc(var(--wall-scale)*clamp(15px,1.3vw,34px))] font-bold tracking-[0.08em] motion-reduce:animate-none"
									style="animation-delay:{drawIn + 0.1}s">YOU</span
								>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/key}
	</div>
{/if}

<style>
	@keyframes -global-dot-in {
		from {
			opacity: 0;
			transform: scale(0.2);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}
	/* YOU's solid bar rises up into place after the field settles. */
	@keyframes -global-bar-rise {
		from {
			opacity: 0;
			transform: scaleY(0.18);
		}
		to {
			opacity: 1;
			transform: scaleY(1);
		}
	}
	@keyframes -global-caret-pop {
		from {
			opacity: 0;
			transform: translateY(calc(var(--wall-scale) * 6px));
		}
		60% {
			opacity: 1;
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
