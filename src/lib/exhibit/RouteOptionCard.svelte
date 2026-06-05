<script lang="ts">
	import type { Leg, RouteCandidate } from './routeCandidates';

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

	function legText(l: Leg): string {
		const verb =
			l.kind === 'walk'
				? 'WALK'
				: l.kind === 'metro'
					? 'METRO'
					: l.kind === 'bus'
						? 'BUS'
						: l.kind === 'auto'
							? 'AUTO'
							: 'CAB';
		if (l.note) return `${verb} ${l.note}`;
		if (l.mins != null) return `${verb} ${l.mins} MIN`;
		return verb;
	}

	const showLegs = $derived(candidate.legs.length > 1);
</script>

<button
	type="button"
	class="card glow-{candidate.glow}"
	class:selected
	{disabled}
	onclick={onSelect}
>
	<div class="row">
		<span class="eta">{candidate.etaMin}<em>MIN</em></span>
		<span class="cost">{candidate.costINR === 0 ? 'FREE' : `₹${candidate.costINR}`}</span>
	</div>

	<span class="via">{candidate.label}</span>

	{#if showLegs}
		<div class="legs">
			{#each candidate.legs as l, i (i)}
				{#if i > 0}<span class="sep" aria-hidden="true">›</span>{/if}
				<span class="leg">{legText(l)}</span>
			{/each}
		</div>
	{/if}
</button>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		padding: 14px 16px 14px;
		background: #161616;
		border: 1px solid #050505;
		border-radius: 8px;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		color: #b0b0b0;
		text-align: left;
		cursor: pointer;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			0 2px 0 #050505;
		transition:
			transform 80ms ease,
			box-shadow 140ms ease,
			color 140ms ease,
			border-color 160ms ease;
	}
	.card:hover:not(:disabled) {
		color: #d4d4d4;
		border-color: #2a2a2a;
	}
	.card:active:not(:disabled) {
		transform: translateY(1px);
		box-shadow:
			inset 0 2px 4px rgba(0, 0, 0, 0.5),
			0 0 0 #050505;
	}
	.card:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.card.selected {
		color: #ededed;
		border-color: var(--glow);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 0 0 1px var(--glow),
			0 0 14px rgba(var(--glow-rgb), 0.35);
	}

	.glow-amber {
		--glow: #f59e0b;
		--glow-rgb: 245, 158, 11;
	}
	.glow-blue {
		--glow: #4faaff;
		--glow-rgb: 79, 170, 255;
	}
	.glow-green {
		--glow: #6ee787;
		--glow-rgb: 110, 231, 135;
	}
	.glow-red {
		--glow: #ff7058;
		--glow-rgb: 255, 112, 88;
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.eta {
		font-size: 30px;
		font-weight: 700;
		line-height: 1;
		color: #ededed;
		letter-spacing: -0.01em;
	}
	.eta em {
		font-style: normal;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.2em;
		color: #6a6a6a;
		margin-left: 5px;
	}
	.cost {
		font-size: 15px;
		font-weight: 600;
		color: var(--glow);
		letter-spacing: 0.02em;
	}

	.via {
		font-size: 11px;
		letter-spacing: 0.22em;
		color: #ededed;
		font-weight: 600;
	}

	.legs {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 6px;
		margin-top: 4px;
		font-size: 11px;
		letter-spacing: 0.12em;
		color: #8a8a8a;
		font-weight: 500;
	}
	.sep {
		color: #4a4a4a;
		font-size: 13px;
	}
	.card.selected .via {
		color: #9a9a9a;
	}
</style>
