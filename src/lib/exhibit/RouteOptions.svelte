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
	class="font-xp flex min-h-0 w-full flex-col gap-3 rounded-[3px] border border-[#aca899] bg-[#ece9d8]/95 p-3 shadow-[3px_3px_10px_rgba(0,0,0,0.4)] backdrop-blur-sm"
>
	<header class="border-b border-[#c9c4b4] pb-2">
		<span class="text-[13px] font-bold uppercase tracking-[0.08em] text-[#003366]">
			{COPY.routeTitle}
		</span>
	</header>

	{#if locked}
		<div
			class="rounded-[3px] border border-dashed border-[#b8b4a4] bg-white/40 px-4 py-5 text-center text-[12px] font-bold uppercase tracking-[0.06em] text-[#7a7666]"
		>
			{COPY.routeDropPins}
		</div>
	{:else if candidates.length === 0}
		<div
			class="rounded-[3px] border border-dashed border-[#b8b4a4] bg-white/40 px-4 py-5 text-center text-[12px] font-bold uppercase tracking-[0.06em] text-[#7a7666]"
		>
			{COPY.routeNoOptions}
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto">
			{#each candidates as c, i (c.id)}
				<RouteOptionCard
					candidate={c}
					selected={selectedId === c.id}
					primary={i === 0}
					onSelect={() => onSelect(c.id)}
				/>
			{/each}
		</div>
	{/if}
</aside>
