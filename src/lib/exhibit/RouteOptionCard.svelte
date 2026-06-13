<script lang="ts">
	import type { LegKind, RouteCandidate } from './routeCandidates';

	let {
		candidate,
		selected = false,
		disabled = false,
		onSelect
	}: {
		candidate: RouteCandidate;
		selected?: boolean;
		disabled?: boolean;
		onSelect: () => void;
	} = $props();

	// Split-bar fill colour per leg kind, in step with the map overlay.
	const KIND_COLOR: Record<LegKind, string> = {
		walk: '#8b94a3',
		metro: '#5aa9f5',
		bus: '#52c785',
		cab: '#f7a73a',
		auto: '#f7a73a'
	};

	// Proportional, ordered legs for the split bar — only when modes actually mix.
	const legs = $derived.by(() => {
		const ls = candidate.legs.filter((l) => (l.mins ?? 0) > 0);
		if (ls.length < 2 || new Set(ls.map((l) => l.kind)).size < 2) return [];
		return ls.map((l) => ({ mins: l.mins ?? 0, color: KIND_COLOR[l.kind] }));
	});
</script>

<button
	type="button"
	class="card glow-{candidate.glow}"
	class:selected
	{disabled}
	onclick={onSelect}
>
	<span class="shadow" aria-hidden="true"></span>
	<span class="edge" aria-hidden="true"></span>
	<span class="front">
		<span class="head">
			<span class="mode">
				<span class="dot"></span>
				<span class="label">{candidate.label}</span>
			</span>
			<span class="cost">{candidate.costINR === 0 ? 'FREE' : `₹${candidate.costINR}`}</span>
		</span>

		<span class="eta">
			<span class="num">{candidate.etaMin}</span>
			<span class="unit">min</span>
		</span>

		{#if legs.length > 0}
			<span class="route" aria-hidden="true">
				{#each legs as l, i (i)}
					<span class="fill" style="flex-grow:{l.mins}; background:{l.color}"></span>
				{/each}
			</span>
		{/if}
	</span>
</button>

<style>
	/* Pushable three-layer button (shadow / edge / front), matching TactileButton:
	   the front face floats above the edge and presses down on tap. */
	.card {
		position: relative;
		display: block;
		width: 100%;
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		outline-offset: 4px;
		user-select: none;
		-webkit-user-select: none;
		touch-action: manipulation;
		transition: filter 250ms;
		--radius: 14px;
		--off-bg: #161618;
		--accent: #f7a73a;
	}
	.glow-blue {
		--accent: #5aa9f5;
	}
	.glow-green {
		--accent: #52c785;
	}
	.glow-red {
		--accent: #ff7058;
	}

	.shadow {
		position: absolute;
		inset: 0;
		border-radius: var(--radius);
		background: hsl(0deg 0% 0% / 0.55);
		filter: blur(1px);
		will-change: transform;
		transform: translateY(4px);
		transition: transform 600ms cubic-bezier(0.3, 0.7, 0.4, 1);
	}
	.edge {
		position: absolute;
		inset: 0;
		border-radius: var(--radius);
		background: #050505;
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.6);
	}

	.front {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 13px;
		padding: 16px 18px;
		border-radius: var(--radius);
		background: var(--off-bg);
		text-align: left;
		will-change: transform, background, box-shadow;
		transform: translateY(-7px);
		transition:
			transform 600ms cubic-bezier(0.3, 0.7, 0.4, 1),
			background 220ms ease,
			box-shadow 220ms ease;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.045),
			inset 0 -2px 0 rgba(0, 0, 0, 0.5);
	}
	.card.selected .front {
		background: #1b1b1e;
		box-shadow:
			inset 0 0 0 1.5px var(--accent),
			inset 0 -2px 0 rgba(0, 0, 0, 0.5);
	}

	.card:hover:not(:disabled) .front {
		transform: translateY(-9px);
		transition: transform 250ms cubic-bezier(0.3, 0.7, 0.4, 1.5);
	}
	.card:hover:not(:disabled) .shadow {
		transform: translateY(6px);
		transition: transform 250ms cubic-bezier(0.3, 0.7, 0.4, 1.5);
	}
	.card:active:not(:disabled) .front {
		transform: translateY(-2px);
		transition: transform 34ms;
	}
	.card:active:not(:disabled) .shadow {
		transform: translateY(1px);
		transition: transform 34ms;
	}
	.card:disabled {
		cursor: not-allowed;
		filter: grayscale(0.4) brightness(0.55);
	}
	.card:focus:not(:focus-visible) {
		outline: none;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
	}
	.mode {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		min-width: 0;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		flex-shrink: 0;
	}
	.label {
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.2em;
		color: #d3d3d7;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.card.selected .label {
		color: #f3f3f5;
	}
	.cost {
		font-size: 16px;
		font-weight: 700;
		color: var(--accent);
		letter-spacing: 0.01em;
		flex-shrink: 0;
	}

	.eta {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.num {
		font-size: 42px;
		font-weight: 700;
		color: #ffffff;
		letter-spacing: -0.03em;
	}
	.unit {
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: #7a7a80;
	}

	/* Cohesive split bar: one rounded track, gapless coloured fills with hairline
	   notches between segments. */
	.route {
		display: flex;
		height: 7px;
		border-radius: 4px;
		overflow: hidden;
		background: #0d0d0f;
	}
	.fill {
		height: 100%;
		flex-basis: 0;
		min-width: 7px;
	}
	.fill:not(:last-child) {
		box-shadow: inset -1.5px 0 0 #0d0d0f;
	}
</style>
