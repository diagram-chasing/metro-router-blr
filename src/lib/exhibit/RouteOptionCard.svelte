<script lang="ts">
	import type { RouteCandidate } from './routeCandidates';

	let {
		candidate,
		selected = false,
		primary = false,
		disabled = false,
		onSelect
	}: {
		candidate: RouteCandidate;
		selected?: boolean;
		// The top-ranked option renders larger; the rest are compact alternatives.
		primary?: boolean;
		disabled?: boolean;
		onSelect: () => void;
	} = $props();

	// Accent (mode dot) per candidate, tuned to read on the light XP surface.
	const ACCENT: Record<string, string> = {
		amber: '#b3760a',
		blue: '#1f6fe0',
		green: '#2e8b2e',
		red: '#cc3a28'
	};
	const accent = $derived(ACCENT[candidate.glow] ?? '#b3760a');
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
	{#if primary}
		<span class="flex items-center gap-3 p-4">
			<span class="h-3.5 w-3.5 shrink-0 rounded-full" style="background:{accent}"></span>
			<span
				class="truncate text-[26px] font-bold uppercase leading-none tracking-[0.04em] {selected
					? 'text-[#00246b]'
					: 'text-[#2a2a24]'}"
			>
				{candidate.label}
			</span>
		</span>
	{:else}
		<span class="flex items-center gap-2.5 px-3 py-3">
			<span class="h-2 w-2 shrink-0 rounded-full" style="background:{accent}"></span>
			<span
				class="min-w-0 flex-1 truncate text-[14px] font-bold uppercase tracking-[0.06em] {selected
					? 'text-[#00246b]'
					: 'text-[#3a3a32]'}"
			>
				{candidate.label}
			</span>
		</span>
	{/if}
</button>
