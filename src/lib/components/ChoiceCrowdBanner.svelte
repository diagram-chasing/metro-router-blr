<script lang="ts">
	import { MODE_PM25_G_PER_PKM, MODE_LABEL, PM25_MAX_G_PER_PKM } from '$lib/emissions';
	import type { Mode } from '$lib/exhibit/types';

	// The "choice crowd": one block per logged commute, sorted dirtiest→cleanest by PM2.5. The dark
	// mass (modes that had a cleaner option) is bracketed as the avoidable soot; the clean tail
	// (metro/walk, ~0 PM2.5) is drawn hollow. Blocks that joined since the last appearance flash, so
	// a participant who just printed a receipt can find themselves. Opacity is driven by the parent's
	// hero pulse; `appearance` re-keys the band so the flash replays each time it surfaces.
	let {
		counts = {},
		prevCounts = {},
		total = 0,
		actualG = 0,
		avoidableG = 0,
		opacity = 0,
		scale = 1,
		appearance = 0,
		blockCap = 300
	}: {
		counts?: Record<string, number>;
		prevCounts?: Record<string, number>;
		total?: number;
		actualG?: number;
		avoidableG?: number;
		opacity?: number;
		scale?: number;
		appearance?: number;
		blockCap?: number;
	} = $props();

	// Dirtiest→cleanest, derived from the model so it tracks the factors (car, bus, 2wh, auto, then
	// the zero-PM2.5 clean tail metro/walk).
	const ORDER = (Object.keys(MODE_PM25_G_PER_PKM) as Mode[]).sort(
		(a, b) => MODE_PM25_G_PER_PKM[b] - MODE_PM25_G_PER_PKM[a]
	);

	type Group = {
		mode: Mode;
		label: string;
		count: number;
		blocks: number;
		fresh: number; // trailing blocks that arrived since the last appearance
		clean: boolean;
		shade: number; // 0.5..1 black alpha — darker = more soot per km
	};

	const groups = $derived.by((): Group[] => {
		const sum = ORDER.reduce((s, m) => s + (counts[m] ?? 0), 0);
		const per = sum > blockCap ? sum / blockCap : 1; // journeys per block once the crowd overflows
		const out: Group[] = [];
		for (const mode of ORDER) {
			const count = counts[mode] ?? 0;
			if (count <= 0) continue;
			const blocks = Math.max(1, Math.round(count / per));
			const delta = Math.max(0, count - (prevCounts[mode] ?? 0));
			const fresh = delta <= 0 ? 0 : Math.min(blocks, Math.max(1, Math.round(delta / per)));
			const intensity = PM25_MAX_G_PER_PKM > 0 ? MODE_PM25_G_PER_PKM[mode] / PM25_MAX_G_PER_PKM : 0;
			out.push({
				mode,
				label: MODE_LABEL[mode],
				count,
				blocks,
				fresh,
				clean: MODE_PM25_G_PER_PKM[mode] <= 0,
				shade: 0.5 + 0.5 * intensity
			});
		}
		return out;
	});

	const dirty = $derived(groups.filter((g) => !g.clean));
	const clean = $derived(groups.filter((g) => g.clean));

	// Avoidable / actual in one shared unit (kg over the decade, or grams when the day is young).
	const fmt = $derived.by(() => {
		if (actualG >= 1000) {
			const f = (g: number) =>
				g / 1000 >= 100 ? Math.round(g / 1000).toLocaleString('en-IN') : (g / 1000).toFixed(1);
			return { a: f(avoidableG), b: f(actualG), unit: 'kg' };
		}
		return { a: String(Math.round(avoidableG)), b: String(Math.round(actualG)), unit: 'g' };
	});

	const range = (n: number) => Array.from({ length: n }, (_, i) => i);
</script>

{#if total > 0}
	<div class="banner slip" style="opacity:{opacity}; --wall-scale:{scale}">
		<div class="head">
			<span class="title">HOW WE MOVED TODAY</span>
			<span class="sub">{total.toLocaleString('en-IN')} JOURNEYS · EACH BLOCK = ONE COMMUTE</span>
		</div>
		<div class="rule"></div>

		{#key appearance}
			<div class="band">
				<div class="avoidable">
					<div class="row">
						{#each dirty as g (g.mode)}
							<div class="group">
								<div class="blocks">
									{#each range(g.blocks) as i (i)}
										<span
											class="block"
											class:fresh={i >= g.blocks - g.fresh}
											style="background: rgba(0,0,0,{g.shade})"
										></span>
									{/each}
								</div>
								<div class="glabel">{g.label}<b>{g.count}</b></div>
							</div>
						{/each}
					</div>
					{#if dirty.length}
						<div class="bracket"><span>avoidable — had a cleaner option</span></div>
					{/if}
				</div>

				{#if clean.length}
					<div class="cleanwrap">
						<div class="row">
							{#each clean as g (g.mode)}
								<div class="group">
									<div class="blocks">
										{#each range(g.blocks) as i (i)}
											<span class="block hollow" class:fresh={i >= g.blocks - g.fresh}></span>
										{/each}
									</div>
									<div class="glabel">{g.label}<b>{g.count}</b></div>
								</div>
							{/each}
						</div>
						<div class="bracket clean"><span>already clean</span></div>
					</div>
				{/if}
			</div>
		{/key}

		<div class="rule"></div>
		<div class="foot">
			<span class="rev">{fmt.a} of {fmt.b} {fmt.unit}</span>
			<span class="note">PM2.5 over 10 years came from trips that had a cleaner option</span>
		</div>
	</div>
{/if}

<style>
	/* Receipt-slip surface — white paper, mono, crisp 1-bit; same language as the wall hero and
	   src/lib/receipt/ReceiptDoc. A wide band across the top of the wall, centred, inset off the
	   keystoned/vignetted projector edges. Only opacity animates (driven by the parent pulse). */
	.banner {
		position: absolute;
		top: clamp(20px, 4.5%, 84px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 17;
		pointer-events: none;
		max-width: calc(100% - 2 * clamp(20px, 4.5%, 84px));
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 12px);
		padding: calc(var(--wall-scale) * 16px) calc(var(--wall-scale) * 20px);
		will-change: opacity;
	}
	.slip {
		background: #fff;
		color: #000;
		font-family: ui-monospace, 'Liberation Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo,
			'Courier New', monospace;
		-webkit-font-smoothing: none;
		font-smooth: never;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: calc(var(--wall-scale) * 24px);
	}
	.head .title {
		font-size: calc(var(--wall-scale) * clamp(18px, 1.7vw, 32px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.head .sub {
		font-size: calc(var(--wall-scale) * clamp(11px, 1vw, 17px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.75;
	}
	.rule {
		border-top: 2px dashed #000;
	}
	.band {
		display: flex;
		align-items: flex-end;
		gap: calc(var(--wall-scale) * 40px);
		flex-wrap: wrap;
	}
	.avoidable,
	.cleanwrap {
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 8px);
	}
	.row {
		display: flex;
		align-items: flex-end;
		gap: calc(var(--wall-scale) * 22px);
	}
	.group {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: calc(var(--wall-scale) * 8px);
	}
	/* Waffle of unit blocks, ~8 columns wide, growing in rows. */
	.blocks {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-end;
		justify-content: center;
		gap: calc(var(--wall-scale) * 3px);
		width: calc(var(--wall-scale) * 128px);
	}
	.block {
		width: calc(var(--wall-scale) * 13px);
		height: calc(var(--wall-scale) * 13px);
		background: #000;
	}
	.block.hollow {
		background: transparent !important;
		border: calc(var(--wall-scale) * 2px) solid #000;
		box-sizing: border-box;
	}
	/* Blocks that joined since the last appearance — the "you're one of these" beat. */
	.block.fresh {
		box-shadow: 0 0 0 calc(var(--wall-scale) * 2px) #ff5a36;
		position: relative;
		z-index: 1;
		animation: freshIn 0.55s cubic-bezier(0.2, 0.9, 0.25, 1) both;
	}
	@keyframes freshIn {
		from {
			transform: scale(0.2);
			box-shadow: 0 0 0 calc(var(--wall-scale) * 4px) #ff5a36;
		}
		to {
			transform: scale(1);
		}
	}
	.glabel {
		display: flex;
		align-items: baseline;
		gap: calc(var(--wall-scale) * 6px);
		font-size: calc(var(--wall-scale) * clamp(12px, 0.95vw, 18px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.glabel b {
		font-size: 1.55em;
		font-variant-numeric: tabular-nums;
	}
	/* Bracket under a mode cluster — a top rule with a centred caption. */
	.bracket {
		border-top: calc(var(--wall-scale) * 3px) solid #000;
		padding-top: calc(var(--wall-scale) * 5px);
		text-align: center;
		font-size: calc(var(--wall-scale) * clamp(11px, 0.95vw, 16px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.bracket.clean {
		border-top-style: dotted;
		opacity: 0.7;
	}
	.foot {
		display: flex;
		align-items: baseline;
		gap: calc(var(--wall-scale) * 14px);
		flex-wrap: wrap;
	}
	/* Reverse hero figure (white-on-black), after ReceiptDoc's .rev. */
	.foot .rev {
		background: #000;
		color: #fff;
		font-size: calc(var(--wall-scale) * clamp(26px, 3vw, 46px));
		font-weight: 700;
		line-height: 1;
		letter-spacing: 0.01em;
		padding: calc(var(--wall-scale) * 7px) calc(var(--wall-scale) * 12px);
		font-variant-numeric: tabular-nums;
	}
	.foot .note {
		font-size: calc(var(--wall-scale) * clamp(13px, 1.1vw, 20px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
</style>
