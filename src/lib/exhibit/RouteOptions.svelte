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

<aside
	class="font-xp flex w-[340px] shrink-0 flex-col gap-3 rounded-[3px] border border-[#aca899] bg-[#ece9d8] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
>
	<header class="border-b border-[#c9c4b4] pb-2">
		<span class="text-[13px] font-bold uppercase tracking-[0.08em] text-[#003366]">
			{COPY.routeTitle}
		</span>
	</header>

	{#if locked}
		<div
			class="rounded-[3px] border border-dashed border-[#b8b4a4] bg-white/40 px-4 py-5 text-center text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a7666]"
		>
			{COPY.routeDropPins}
		</div>
	{:else if candidates.length === 0}
		<div
			class="rounded-[3px] border border-dashed border-[#b8b4a4] bg-white/40 px-4 py-5 text-center text-[12px] font-semibold uppercase tracking-[0.06em] text-[#7a7666]"
		>
			{COPY.routeNoOptions}
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
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
