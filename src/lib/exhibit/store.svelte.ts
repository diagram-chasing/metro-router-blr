import type { Answers } from './types';

// In-memory only. This is a single-visitor kiosk flow: a reload (or the next
// visitor) should always start blank, so there's deliberately no persistence.
export const answers = $state<Answers>({});

export function setAnswer<K extends keyof Answers>(key: K, value: Answers[K]) {
	answers[key] = value;
}

export function resetAnswers() {
	for (const k of Object.keys(answers) as (keyof Answers)[]) delete answers[k];
}
