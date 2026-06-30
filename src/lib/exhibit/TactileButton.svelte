<script lang="ts">
	// Bare Windows XP button styled entirely by XP.css (imported globally). `selected`
	// toggles XP.css's `.active` pressed state; only sizing + the disabled look are ours,
	// since XP.css does not grey disabled buttons.
	type Glow = 'amber' | 'red' | 'green' | 'blue';
	type Size = 'md' | 'lg' | 'xl';

	let {
		label,
		selected = false,
		glow = 'amber',
		size = 'lg',
		disabled = false,
		onclick
	}: {
		label: string;
		selected?: boolean;
		// Kept for call-site compatibility; XP buttons are uniform so it is unused.
		glow?: Glow;
		size?: Size;
		disabled?: boolean;
		onclick?: () => void;
	} = $props();

	const sizeClass: Record<Size, string> = {
		md: 'text-[15px] min-h-[44px] px-4',
		lg: 'text-[clamp(16px,1.8vw,26px)] px-4 py-3',
		xl: 'text-[clamp(18px,2vw,30px)] px-4 py-4'
	};
</script>

<button
	type="button"
	{disabled}
	{onclick}
	class:active={selected}
	class="flex h-full w-full select-none items-center justify-center text-balance leading-tight [touch-action:manipulation] disabled:cursor-not-allowed disabled:bg-[#ece9d8] disabled:bg-none disabled:text-[#9a978c] disabled:shadow-none {sizeClass[
		size
	]}"
>
	{label}
</button>
