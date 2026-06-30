<script lang="ts">
	import { goto } from '$app/navigation';

	import MapQuestion from '$lib/exhibit/MapQuestion.svelte';
	import OnScreenKeyboard from '$lib/exhibit/OnScreenKeyboard.svelte';
	import Panel from '$lib/exhibit/Panel.svelte';
	import QuestionFrame from '$lib/exhibit/QuestionFrame.svelte';
	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import {
		COPY,
		FREQUENCY_OPTIONS,
		LIFESTYLE_OPTIONS,
		MODE_OPTIONS,
		PROMPTS,
		pickRandomFunQuestion
	} from '$lib/exhibit/questions';
	import { answers, resetAnswers, setAnswer } from '$lib/exhibit/store.svelte';
	import type { FunQuestion } from '$lib/exhibit/types';

	// -1 = welcome / name entry, 1..5 = questions
	let step = $state(-1);
	let funQuestion = $state<FunQuestion>(pickRandomFunQuestion());
	let nameInput = $state(answers.name ?? '');
	let submitting = $state(false);
	let error = $state<string | null>(null);

	const canStart = $derived(nameInput.trim().length > 0);

	$effect(() => {
		if (step === 5) setAnswer('funQuestionId', funQuestion.id);
	});

	function start() {
		if (!canStart) return;
		const name = nameInput.trim();
		resetAnswers();
		setAnswer('name', name);
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
						!!answers.chosenRouteId
					: step === 4
						? !!answers.lifestyle
						: step === 5
							? !!answers.funAnswer
							: false
	);
</script>

<Panel>
	{#if step === -1}
		<div class="welcome">
			<p class="name-prompt">{COPY.namePrompt}</p>

			<div class="flex w-[min(960px,94vw)] items-stretch gap-5">
				<input
					bind:value={nameInput}
					type="text"
					inputmode="none"
					autocomplete="off"
					autocapitalize="words"
					autocorrect="off"
					spellcheck="false"
					maxlength="24"
					readonly
					placeholder={COPY.namePlaceholder}
					aria-label={COPY.namePrompt}
					class="min-w-0 flex-1 rounded-2xl border-2 border-[#2a2a2a] bg-[#141414] px-8 py-6 text-center text-[clamp(30px,4.4vw,56px)] font-medium tracking-tight text-[#ededed] caret-transparent shadow-[inset_0_2px_10px_rgba(0,0,0,0.6)] outline-none transition-colors placeholder:text-[#555]"
				/>
				<div class="flex w-[clamp(220px,26vw,320px)] shrink-0">
					<TactileButton
						label={COPY.start}
						size="xl"
						glow="green"
						selected={canStart}
						disabled={!canStart}
						onclick={start}
					/>
				</div>
			</div>

			<OnScreenKeyboard bind:value={nameInput} onEnter={start} maxLength={24} />
		</div>
	{:else if step === 1}
		<QuestionFrame
			step={1}
			prompt={PROMPTS[1]}
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
			prompt={PROMPTS[2]}
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
			prompt={PROMPTS[3]}
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
			prompt={PROMPTS[4]}
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
			prompt={funQuestion.prompt}
			{canAdvance}
			nextLabel={submitting ? COPY.printing : COPY.print}
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
				<p class="error">{COPY.submitFailed} {error}</p>
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
		gap: 22px;
		padding: 24px;
	}
	.name-prompt {
		margin: 0;
		font-family: 'IBM Plex Sans', sans-serif;
		font-weight: 400;
		font-size: clamp(26px, 3vw, 44px);
		line-height: 1.15;
		color: #cfcfcf;
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
