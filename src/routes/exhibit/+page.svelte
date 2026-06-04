<script lang="ts">
	import { goto } from '$app/navigation';

	import MapQuestion from '$lib/exhibit/MapQuestion.svelte';
	import Panel from '$lib/exhibit/Panel.svelte';
	import QuestionFrame from '$lib/exhibit/QuestionFrame.svelte';
	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import {
		DECIDER_OPTIONS,
		FREQUENCY_OPTIONS,
		LIFESTYLE_OPTIONS,
		MODE_OPTIONS,
		pickRandomFunQuestion
	} from '$lib/exhibit/questions';
	import { answers, resetAnswers, setAnswer } from '$lib/exhibit/store.svelte';
	import type { FunQuestion } from '$lib/exhibit/types';

	// -1 = welcome, 1..6 = questions
	let step = $state(-1);
	let funQuestion = $state<FunQuestion>(pickRandomFunQuestion());
	let submitting = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (step === 6) setAnswer('funQuestionId', funQuestion.id);
	});

	function start() {
		resetAnswers();
		funQuestion = pickRandomFunQuestion();
		step = 1;
	}

	function next() {
		step += 1;
	}
	function back() {
		// From Q1, back goes to the welcome screen; answers stay so the visitor
		// can pop in/out without losing state.
		step = step === 1 ? -1 : step - 1;
	}

	async function submit() {
		if (submitting) return;
		submitting = true;
		error = null;
		try {
			const res = await fetch('/api/receipt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(answers)
			});
			if (!res.ok) throw new Error(`server returned ${res.status}`);
			const { id } = (await res.json()) as { id: string };
			await goto(`/receipt?id=${encodeURIComponent(id)}`);
		} catch (e) {
			submitting = false;
			error = e instanceof Error ? e.message : 'unknown error';
		}
	}

	const canAdvance = $derived(
		step === 1
			? !!answers.mode
			: step === 2
				? !!answers.frequency
				: step === 3
					? !!answers.origin &&
						!!answers.destination &&
						!!answers.distanceKm &&
						!!answers.chosenPreset
					: step === 4
						? !!answers.lifestyle
						: step === 5
							? !!answers.decider
							: step === 6
								? !!answers.funAnswer
								: false
	);
</script>

<Panel>
	{#if step === -1}
		<div class="welcome">
			<h1>How heavy is your everyday travel?</h1>

			<div class="cta">
				<TactileButton label="LET'S GO" size="xl" glow="green" selected onclick={start} />
			</div>
		</div>
	{:else if step === 1}
		<QuestionFrame
			step={1}
			prompt="When you make your most regular trip across the city, how do you usually get there?"
			{canAdvance}
			onBack={back}
			onNext={next}
		>
			<div class="mode-grid grid">
				{#each MODE_OPTIONS as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.mode === opt.value}
						size="lg"
						onclick={() => setAnswer('mode', opt.value)}
					/>
				{/each}
			</div>
		</QuestionFrame>
	{:else if step === 2}
		<QuestionFrame
			step={2}
			prompt="How often is that trip?"
			{canAdvance}
			onBack={back}
			onNext={next}
		>
			<div class="freq-grid grid">
				{#each FREQUENCY_OPTIONS as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.frequency === opt.value}
						size="xl"
						glow="amber"
						onclick={() => setAnswer('frequency', opt.value)}
					/>
				{/each}
			</div>
		</QuestionFrame>
	{:else if step === 3}
		<QuestionFrame
			step={3}
			prompt="Drop two pins. Then pick how you'd make this trip."
			{canAdvance}
			onBack={back}
			onNext={next}
		>
			<div class="map-host">
				<MapQuestion />
			</div>
		</QuestionFrame>
	{:else if step === 4}
		<QuestionFrame
			step={4}
			prompt="Apart from that trip, how much are you out in a normal week?"
			{canAdvance}
			onBack={back}
			onNext={next}
		>
			<div class="lifestyle-grid grid">
				{#each LIFESTYLE_OPTIONS as opt, i (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.lifestyle === opt.value}
						size="xl"
						glow={i === 0 ? 'blue' : i === 1 ? 'amber' : 'red'}
						onclick={() => setAnswer('lifestyle', opt.value)}
					/>
				{/each}
			</div>
		</QuestionFrame>
	{:else if step === 5}
		<QuestionFrame
			step={5}
			prompt="What mostly decides how you travel?"
			{canAdvance}
			onBack={back}
			onNext={next}
		>
			<div class="decider-grid grid">
				{#each DECIDER_OPTIONS as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.decider === opt.value}
						size="lg"
						onclick={() => setAnswer('decider', opt.value)}
					/>
				{/each}
			</div>
		</QuestionFrame>
	{:else if step === 6}
		<QuestionFrame
			step={6}
			prompt={funQuestion.prompt}
			{canAdvance}
			nextLabel={submitting ? 'PRINTING…' : 'PRINT RECEIPT'}
			nextDisabled={submitting}
			onBack={back}
			onNext={submit}
		>
			<div class="fun-grid grid" style="--cols: {funQuestion.options.length}">
				{#each funQuestion.options as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.funAnswer === opt.value}
						size="xl"
						glow="green"
						onclick={() => setAnswer('funAnswer', opt.value)}
					/>
				{/each}
			</div>
			{#if error}
				<p class="error">SUBMIT FAILED — {error}</p>
			{/if}
		</QuestionFrame>
	{/if}
</Panel>

<style>
	.welcome {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 28px;
		padding: 24px;
	}
	.welcome h1 {
		margin: 0;
		font-family: 'IBM Plex Sans', sans-serif;
		font-weight: 500;
		font-size: clamp(40px, 5.4vw, 80px);
		line-height: 1.05;
		letter-spacing: -0.015em;
		max-width: 16ch;
		color: #ededed;
		text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
	}
	.cta {
		margin-top: 12px;
		width: clamp(320px, 38vw, 460px);
		height: clamp(96px, 12vh, 132px);
		display: flex;
	}

	.grid {
		flex: 1;
		display: grid;
		gap: 16px;
		align-content: stretch;
		min-height: 0;
	}
	.mode-grid {
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(2, 1fr);
	}
	.freq-grid {
		grid-template-columns: repeat(2, 1fr);
		grid-template-rows: repeat(2, 1fr);
	}
	.lifestyle-grid {
		grid-template-columns: repeat(3, 1fr);
	}
	.decider-grid {
		grid-template-columns: repeat(5, 1fr);
	}
	.fun-grid {
		grid-template-columns: repeat(var(--cols), 1fr);
	}

	.map-host {
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.error {
		margin-top: 14px;
		color: #c8301c;
		font-family: 'IBM Plex Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 13px;
	}
</style>
