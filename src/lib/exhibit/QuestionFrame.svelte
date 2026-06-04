<script lang="ts">
	import type { Snippet } from 'svelte';

	import TactileButton from './TactileButton.svelte';

	let {
		step,
		total = 6,
		prompt,
		canAdvance = false,
		canGoBack = true,
		nextLabel = 'NEXT',
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

<div class="frame">
	<header class="head">
		<h1 class="prompt">{prompt}</h1>
	</header>

	<section class="content">
		{@render children()}
	</section>

	<footer class="foot">
		<div class="nav-slot">
			{#if canGoBack && onBack}
				<TactileButton label="← BACK" size="md" glow="amber" onclick={onBack} />
			{/if}
		</div>

		<div class="dots" aria-hidden="true">
			{#each Array(total) as _x, i (i)}
				<span class="dot" class:done={i < step - 1} class:current={i === step - 1}></span>
			{/each}
		</div>

		<div class="nav-slot next">
			<TactileButton
				label={nextLabel + ' →'}
				size="md"
				glow="green"
				selected={canAdvance && !nextDisabled}
				disabled={!canAdvance || nextDisabled || !onNext}
				onclick={onNext}
			/>
		</div>
	</footer>
</div>

<style>
	.frame {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		gap: 22px;
	}

	.head {
		display: flex;
		justify-content: center;
		padding: 8px 0 4px;
	}

	.prompt {
		margin: 0;
		font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
		font-weight: 500;
		font-size: clamp(28px, 3.4vw, 50px);
		line-height: 1.08;
		color: #f5f5f5;
		letter-spacing: -0.005em;
		text-align: center;
		text-wrap: balance;
		max-width: 48ch;
	}

	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding-top: 6px;
	}
	.nav-slot {
		display: flex;
		min-width: 200px;
		min-height: 62px;
	}
	.nav-slot.next {
		justify-content: flex-end;
		min-width: 260px;
	}

	.dots {
		display: flex;
		gap: 12px;
	}
	.dot {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background: #1a1a1a;
		box-shadow: inset 0 0 3px rgba(0, 0, 0, 0.7);
	}
	.dot.done {
		background: radial-gradient(circle at 35% 35%, #d0d0d0, #6a6a6a);
	}
	.dot.current {
		background: radial-gradient(circle at 35% 35%, #ffffff, #b0b0b0);
		box-shadow: 0 0 10px rgba(255, 255, 255, 0.45);
	}
</style>
