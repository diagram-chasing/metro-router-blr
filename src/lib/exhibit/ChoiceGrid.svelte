<script lang="ts">
	import type { Snippet } from 'svelte';

	import TactileButton from './TactileButton.svelte';

	type Size = 'md' | 'lg' | 'xl';
	type Option = { value: string; label: string; sub?: string };

	let {
		options,
		value,
		onSelect,
		size = 'xl',
		showSub = false,
		icon
	}: {
		options: Option[];
		value?: string;
		onSelect: (value: string) => void;
		size?: Size;
		showSub?: boolean;
		// Optional per-option glyph, rendered above the label. Receives the option value.
		icon?: Snippet<[string]>;
	} = $props();

	// Split the options into balanced rows so the choices always tile the frame
	// edge-to-edge with no empty cells, whatever the count (step 2 filters its
	// options down to whatever OTP found feasible for the drawn trip).
	function rowCountFor(n: number): number {
		if (n <= 3) return 1;
		if (n <= 6) return 2;
		return 3;
	}

	const rows = $derived.by(() => {
		const r = rowCountFor(options.length);
		const base = Math.floor(options.length / r);
		const extra = options.length % r;
		const out: Option[][] = [];
		let i = 0;
		for (let k = 0; k < r; k++) {
			const count = base + (k < extra ? 1 : 0);
			out.push(options.slice(i, i + count));
			i += count;
		}
		return out.filter((row) => row.length > 0);
	});
</script>

<div class="flex min-h-0 flex-1 flex-col gap-3">
	{#each rows as row, ri (ri)}
		<div class="flex min-h-0 flex-1 gap-3">
			{#each row as opt (opt.value)}
				<div class="flex min-w-0 flex-1">
					{#if icon}
						<TactileButton
							label={opt.label}
							sub={showSub ? opt.sub : undefined}
							selected={value === opt.value}
							{size}
							onclick={() => onSelect(opt.value)}
						>
							{@render icon(opt.value)}
						</TactileButton>
					{:else}
						<TactileButton
							label={opt.label}
							sub={showSub ? opt.sub : undefined}
							selected={value === opt.value}
							{size}
							onclick={() => onSelect(opt.value)}
						/>
					{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>
