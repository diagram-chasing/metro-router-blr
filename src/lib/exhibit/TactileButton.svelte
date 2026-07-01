<script lang="ts">
	import type { Snippet } from 'svelte';

	// Bare Windows XP button styled entirely by XP.css (imported globally). `selected`
	// toggles XP.css's `.active` pressed state; only sizing + the disabled look are ours,
	// since XP.css does not grey disabled buttons.
	type Glow = 'amber' | 'red' | 'green' | 'blue';
	type Size = 'md' | 'lg' | 'xl';

	let {
		label,
		sub,
		selected = false,
		glow = 'amber',
		size = 'lg',
		disabled = false,
		onclick,
		children
	}: {
		label: string;
		// Small caption under the label (e.g. "car or cab").
		sub?: string;
		selected?: boolean;
		// Kept for call-site compatibility; XP buttons are uniform so it is unused.
		glow?: Glow;
		size?: Size;
		disabled?: boolean;
		onclick?: () => void;
		// Optional glyph rendered above the label; grows to fill the button.
		children?: Snippet;
	} = $props();

	const sizeClass: Record<Size, string> = {
		md: 'text-[15px] min-h-[44px] px-4 py-2',
		lg: 'text-[clamp(16px,1.8vw,26px)] px-4 py-3',
		xl: 'text-[clamp(18px,2vw,30px)] px-4 py-4'
	};
</script>

<button
	type="button"
	{disabled}
	{onclick}
	class:active={selected}
	class="flex h-full w-full select-none flex-col items-center justify-center gap-[0.35em] text-balance leading-tight [touch-action:manipulation] disabled:cursor-not-allowed disabled:bg-[#ece9d8] disabled:bg-none disabled:text-[#9a978c] disabled:shadow-none {sizeClass[
		size
	]}"
>
	{#if children}
		<span class="flex h-12 items-center justify-center gap-10">
			{@render children()}
		</span>
	{/if}
	<span>{label}</span>
	{#if sub}
		<span class="text-[0.62em] font-normal normal-case tracking-normal opacity-55">{sub}</span>
	{/if}
</button>
