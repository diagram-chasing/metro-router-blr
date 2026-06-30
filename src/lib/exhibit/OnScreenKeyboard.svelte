<script lang="ts">
	import { untrack } from 'svelte';
	import Keyboard from 'simple-keyboard';
	import 'simple-keyboard/build/css/index.css';

	let {
		value = $bindable(''),
		maxLength = 24
	}: {
		value?: string;
		maxLength?: number;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let keyboard: Keyboard | null = null;

	// Single always-uppercase layout: no shift key, names are entered in caps.
	const LAYOUT = {
		default: ['Q W E R T Y U I O P', 'A S D F G H J K L', 'Z X C V B N M {bksp}', '{space}']
	};

	const DISPLAY = {
		'{bksp}': '⌫',
		'{space}': 'space'
	};

	// Build once when the host mounts. Reactive reads (value/maxLength) are untracked so a
	// keypress never tears down and rebuilds the keyboard.
	$effect(() => {
		const el = host;
		if (!el) return;

		const kb = untrack(
			() =>
				new Keyboard(el, {
					layout: LAYOUT,
					display: DISPLAY,
					// simple-keyboard overwrites the host className on render, so inject our
					// styling hook through the theme option (it is preserved).
					theme: 'hg-theme-default kiosk-keyboard',
					maxLength,
					onChange: (input: string) => {
						value = input;
					}
				})
		);
		untrack(() => kb.setInput(value));
		keyboard = kb;

		return () => {
			kb.destroy();
			keyboard = null;
		};
	});

	// Keep the keyboard's buffer in step when the value is changed from outside (reset).
	$effect(() => {
		const v = value;
		if (keyboard && v !== untrack(() => keyboard!.getInput())) keyboard.setInput(v);
	});
</script>

<div class="mx-auto w-[min(760px,90vw)]">
	<!-- simple-keyboard needs a class on the host to derive its keyboardDOMClass. -->
	<div bind:this={host} class="kiosk-keyboard"></div>
</div>
