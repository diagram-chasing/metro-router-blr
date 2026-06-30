<script lang="ts">
	import { goto } from '$app/navigation';

	import MapQuestion from '$lib/exhibit/MapQuestion.svelte';
	import OnScreenKeyboard from '$lib/exhibit/OnScreenKeyboard.svelte';
	import QuestionFrame from '$lib/exhibit/QuestionFrame.svelte';
	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import XpTransferDialog from '$lib/exhibit/XpTransferDialog.svelte';
	import XpWindow from '$lib/exhibit/XpWindow.svelte';
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

	// Min time the XP "sending to printer" dialog stays up, regardless of how
	// fast the request resolves.
	const PRINT_ANIM_MS = 5000;

	async function submit() {
		if (submitting) return;
		submitting = true;
		error = null;
		const hold = new Promise((r) => setTimeout(r, PRINT_ANIM_MS));
		try {
			const res = await fetch('/api/receipt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(answers)
			});
			if (!res.ok) throw new Error(`server returned ${res.status}`);
			const { id } = (await res.json()) as { id: string };
			await hold;
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

<XpWindow title="The Pollution That Wasn't" icon="/xp/readme.ico">
	{#if step === -1}
		<div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-7 text-center">
			<p class="text-balance text-[clamp(22px,2.8vw,40px)] font-bold text-[#003399]">
				{COPY.namePrompt}
			</p>

			<div class="flex w-[min(960px,94vw)] items-stretch gap-4">
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
					class="font-xp !h-auto min-w-0 flex-1 !rounded-[3px] border border-[#7f9db9] bg-white !px-7 !py-5 text-center text-[clamp(28px,4vw,52px)] font-semibold !leading-none tracking-tight text-black caret-transparent shadow-[inset_1px_1px_3px_rgba(0,0,0,0.22)] outline-none placeholder:text-[#9a9a9a]"
				/>
				<div class="flex w-[clamp(200px,24vw,300px)] shrink-0">
					<TactileButton
						label={COPY.start}
						size="xl"
						disabled={!canStart}
						onclick={start}
					/>
				</div>
			</div>

			<OnScreenKeyboard bind:value={nameInput} maxLength={24} />
		</div>
	{:else if step === 1}
		<QuestionFrame step={1} prompt={PROMPTS[1]} {canAdvance} onBack={back} onNext={next}>
			<div class="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
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
		<QuestionFrame step={2} prompt={PROMPTS[2]} {canAdvance} onBack={back} onNext={next}>
			<div class="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3">
				{#each FREQUENCY_OPTIONS as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.frequency === opt.value}
						size="xl"
						onclick={() => setAnswer('frequency', opt.value)}
					/>
				{/each}
			</div>
		</QuestionFrame>
	{:else if step === 3}
		<QuestionFrame step={3} prompt={PROMPTS[3]} {canAdvance} onBack={back} onNext={next}>
			<div class="flex min-h-0 flex-1">
				<MapQuestion />
			</div>
		</QuestionFrame>
	{:else if step === 4}
		<QuestionFrame step={4} prompt={PROMPTS[4]} {canAdvance} onBack={back} onNext={next}>
			<div class="grid min-h-0 flex-1 grid-cols-3 gap-3">
				{#each LIFESTYLE_OPTIONS as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.lifestyle === opt.value}
						size="xl"
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
			<div
				class="grid min-h-0 flex-1 gap-3"
				style="grid-template-columns: repeat({funQuestion.options.length}, minmax(0, 1fr))"
			>
				{#each funQuestion.options as opt (opt.value)}
					<TactileButton
						label={opt.label}
						selected={answers.funAnswer === opt.value}
						size="xl"
						onclick={() => setAnswer('funAnswer', opt.value)}
					/>
				{/each}
			</div>
			{#if error}
				<p class="mt-3 text-[13px] font-semibold text-[#b52012]">
					{COPY.submitFailed}
					{error}
				</p>
			{/if}
		</QuestionFrame>
	{/if}
</XpWindow>

<XpTransferDialog open={submitting} durationMs={PRINT_ANIM_MS} />
