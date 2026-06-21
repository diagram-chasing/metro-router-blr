<script lang="ts">
	import { COPY } from './questions';
	import type { RouteCandidate } from './routeCandidates';
	import RouteOptionCard from './RouteOptionCard.svelte';

	let {
		candidates,
		selectedId,
		locked = false,
		onSelect
	}: {
		candidates: RouteCandidate[];
		selectedId: string | undefined;
		locked?: boolean;
		onSelect: (id: string) => void;
	} = $props();
</script>

<aside class="panel">
	<header class="head">
		<span class="title">{COPY.routeTitle}</span>
	</header>

	{#if locked}
		<div class="placeholder">{COPY.routeDropPins}</div>
	{:else if candidates.length === 0}
		<div class="placeholder">{COPY.routeNoOptions}</div>
	{:else}
		<div class="list">
			{#each candidates as c (c.id)}
				<RouteOptionCard
					candidate={c}
					selected={selectedId === c.id}
					onSelect={() => onSelect(c.id)}
				/>
			{/each}
		</div>
	{/if}
</aside>

<style>
	.panel {
		flex: 0 0 340px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px 16px 18px;
		background: #161616;
		border: 1px solid #050505;
		border-radius: 12px;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			inset 0 -1px 0 rgba(0, 0, 0, 0.6);
	}

	.head {
		padding: 2px 2px 10px;
	}
	.title {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 12px;
		letter-spacing: 0.24em;
		color: #ededed;
		font-weight: 600;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 0;
		flex: 1;
	}

	.placeholder {
		padding: 18px 14px;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 11px;
		letter-spacing: 0.16em;
		color: #5a5a5a;
		text-align: center;
		border: 1px dashed #2a2a2a;
		border-radius: 8px;
	}
</style>
