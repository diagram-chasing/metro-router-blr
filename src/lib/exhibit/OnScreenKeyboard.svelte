<script lang="ts">
	import { untrack } from 'svelte';
	import Keyboard from 'simple-keyboard';
	import 'simple-keyboard/build/css/index.css';

	let {
		value = $bindable(''),
		onEnter,
		maxLength = 24
	}: {
		value?: string;
		onEnter?: () => void;
		maxLength?: number;
	} = $props();

	let host = $state<HTMLDivElement | null>(null);
	let keyboard: Keyboard | null = null;
	// Start capitalised so a name's first letter is upper-case; drops to lower after the
	// first keypress, the way a name is normally written.
	let shifted = true;

	const LAYOUT = {
		default: [
			'q w e r t y u i o p',
			'a s d f g h j k l',
			'{shift} z x c v b n m {bksp}',
			'{space} {enter}'
		],
		shift: [
			'Q W E R T Y U I O P',
			'A S D F G H J K L',
			'{shift} Z X C V B N M {bksp}',
			'{space} {enter}'
		]
	};

	const DISPLAY = {
		'{bksp}': '⌫',
		'{shift}': '⇧',
		'{space}': 'space',
		'{enter}': 'done'
	};

	const applyLayout = () => keyboard?.setOptions({ layoutName: shifted ? 'shift' : 'default' });

	// Build once when the host mounts. Reactive reads (value/shifted/maxLength) are
	// untracked so a keypress never tears down and rebuilds the keyboard.
	$effect(() => {
		const el = host;
		if (!el) return;

		const kb = untrack(
			() =>
				new Keyboard(el, {
					layout: LAYOUT,
					display: DISPLAY,
					layoutName: shifted ? 'shift' : 'default',
					maxLength,
					onChange: (input: string) => {
						value = input;
						if (shifted && input.length > 0) {
							shifted = false;
							applyLayout();
						}
					},
					onKeyPress: (button: string) => {
						if (button === '{shift}') {
							shifted = !shifted;
							applyLayout();
						} else if (button === '{enter}') {
							onEnter?.();
						}
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

<div bind:this={host} class="kiosk-keyboard w-[min(760px,90vw)]"></div>
