import { browser } from '$app/environment';

import clickUrl from '$lib/assets/click.mp3';
import dingUrl from '$lib/assets/ding.mp3';

// Kiosk feedback sounds. Click is cloned per play so rapid taps overlap instead
// of cutting each other off; ding is a one-shot so it just rewinds.
const preload = new Map<string, HTMLAudioElement>();

function base(url: string) {
	let a = preload.get(url);
	if (!a) {
		a = new Audio(url);
		a.preload = 'auto';
		preload.set(url, a);
	}
	return a;
}

export function playClick() {
	if (!browser) return;
	const node = base(clickUrl).cloneNode() as HTMLAudioElement;
	void node.play().catch(() => {});
}

export function playDing() {
	if (!browser) return;
	const a = base(dingUrl);
	a.currentTime = 0;
	void a.play().catch(() => {});
}
