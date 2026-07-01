<script lang="ts">
	import type { Snippet } from 'svelte';

	import TactileButton from './TactileButton.svelte';

	let {
		step,
		total = 5,
		prompt,
		canAdvance = false,
		canGoBack = true,
		nextLabel = 'Next',
		nextDisabled = false,
		onBack,
		onNext,
		children
	}: {
		step: number;
		total?: number;
		prompt: string;
		canAdvance?: boolean;
		canGoBack?: boolean;
		nextLabel?: string;
		nextDisabled?: boolean;
		onBack?: () => void;
		onNext?: () => void;
		children: Snippet;
	} = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<!-- ── Wizard banner ── flush to the window edges under the title bar -->
	<header
		class="-mx-4 -mt-4 mb-1 border-b border-[#aca899] bg-white px-5 py-4 sm:-mx-6 sm:-mt-6 sm:px-7 sm:py-5"
	>
		<h1
			class=" text-balance text-center text-[clamp(20px,2.6vw,34px)] font-bold leading-tight text-[#003399]"
		>
			{prompt}
		</h1>
	</header>

	<section class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</section>

	<footer class="flex items-center justify-between gap-3 pt-1">
		<div class="flex min-h-[60px] min-w-[150px] items-stretch">
			{#if canGoBack && onBack}
				<TactileButton label="← Back" size="md" onclick={onBack} />
			{/if}
		</div>

		<span class="shrink-0 text-[13px] font-bold text-[#5a564a]">
			Step {step} of {total}
		</span>

		<div class="flex min-h-[60px] min-w-[190px] items-stretch justify-end">
			<TactileButton
				label={nextLabel + ' →'}
				size="md"
				disabled={!canAdvance || nextDisabled || !onNext}
				onclick={onNext}
			/>
		</div>
	</footer>
</div>
