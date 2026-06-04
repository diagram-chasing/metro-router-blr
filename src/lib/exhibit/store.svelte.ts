import { browser } from '$app/environment';
import type { Answers } from './types';

const KEY = 'exhibit_answers_v1';

function load(): Answers {
	if (!browser) return {};
	try {
		const raw = sessionStorage.getItem(KEY);
		return raw ? (JSON.parse(raw) as Answers) : {};
	} catch {
		return {};
	}
}

export const answers = $state<Answers>(load());

function persist() {
	if (!browser) return;
	try {
		sessionStorage.setItem(KEY, JSON.stringify(answers));
	} catch {
		// quota / private mode — ignore
	}
}

export function setAnswer<K extends keyof Answers>(key: K, value: Answers[K]) {
	answers[key] = value;
	persist();
}

export function resetAnswers() {
	for (const k of Object.keys(answers) as (keyof Answers)[]) delete answers[k];
	if (browser) sessionStorage.removeItem(KEY);
}
