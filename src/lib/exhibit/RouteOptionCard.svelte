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

	// Accent (mode dot + cost) per candidate, tuned to read on the light XP surface.
	const ACCENT: Record<string, string> = {
		amber: '#b3760a',
		blue: '#1f6fe0',
		green: '#2e8b2e',
		red: '#cc3a28'
	};
	const accent = $derived(ACCENT[candidate.glow] ?? '#b3760a');

	// Proportional, ordered legs for the split bar — only when modes actually mix.
	const legs = $derived.by(() => {
		const ls = candidate.legs.filter((l) => (l.mins ?? 0) > 0);
		if (ls.length < 2 || new Set(ls.map((l) => l.kind)).size < 2) return [];
		return ls.map((l) => ({ mins: l.mins ?? 0, color: KIND_COLOR[l.kind] }));
	});
</script>

<button
	type="button"
	{disabled}
	onclick={onSelect}
	class="font-xp w-full rounded-[3px] border text-left transition-colors {selected
		? 'border-[#0a53d6] bg-[#cfe0f5]'
		: 'border-[#c2bdac] bg-[#f7f6f0] hover:bg-[#eceadf]'} {disabled
		? 'cursor-not-allowed opacity-50'
		: 'cursor-pointer active:bg-[#d4d4d4]'}"
>
	<span class="flex flex-col gap-3 p-3.5">
		<span class="flex items-center justify-between gap-3">
			<span class="flex min-w-0 items-center gap-2">
				<span class="h-2 w-2 shrink-0 rounded-full" style="background:{accent}"></span>
				<span
					class="truncate text-[12px] font-bold uppercase tracking-[0.08em] {selected
						? 'text-[#00246b]'
						: 'text-[#3a3a32]'}"
				>
					{candidate.label}
				</span>
			</span>
			<span class="shrink-0 text-[15px] font-bold" style="color:{accent}">
				{candidate.costINR === 0 ? 'FREE' : `₹${candidate.costINR}`}
			</span>
		</span>

		<span class="flex items-baseline gap-2 [font-variant-numeric:tabular-nums]">
			<span class="text-[40px] font-bold leading-none text-black">{candidate.etaMin}</span>
			<span class="text-[13px] font-medium text-[#6a6a5e]">min</span>
		</span>

		{#if legs.length > 0}
			<span class="flex h-[8px] overflow-hidden rounded-[2px] border border-[#b8b4a4] bg-white">
				{#each legs as l, i (i)}
					<span
						class="h-full"
						style="flex-grow:{l.mins}; flex-basis:0; min-width:7px; background:{l.color}"
					></span>
				{/each}
			</span>
		{/if}
	</span>
</button>
