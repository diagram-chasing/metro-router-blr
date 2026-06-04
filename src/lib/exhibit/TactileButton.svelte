<script lang="ts">
	// Inspired by the "button-82" pushable button pattern: three stacked layers
	// (shadow, edge, front) so the front face can lift off the edge with a
	// smooth cubic-bezier motion and press down on tap.

	type Glow = 'amber' | 'red' | 'green' | 'blue';
	type Size = 'md' | 'lg' | 'xl';

	let {
		label,
		selected = false,
		glow = 'amber',
		size = 'lg',
		disabled = false,
		onclick
	}: {
		label: string;
		selected?: boolean;
		glow?: Glow;
		size?: Size;
		disabled?: boolean;
		onclick?: () => void;
	} = $props();
</script>

<button
	type="button"
	class="tbtn glow-{glow} size-{size}"
	class:selected
	class:dim={!selected}
	{disabled}
	{onclick}
>
	<span class="shadow" aria-hidden="true"></span>
	<span class="edge" aria-hidden="true"></span>
	<span class="front">{label}</span>
</button>

<style>
	.tbtn {
		position: relative;
		display: flex;
		width: 100%;
		height: 100%;
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		outline-offset: 4px;
		user-select: none;
		-webkit-user-select: none;
		touch-action: manipulation;
		transition: filter 250ms;
		/* Off-state is neutral dark across all variants. Only the lit (selected)
		 * face carries the hue, so the panel reads as "unlit / lit" instead of
		 * "dim tinted / bright tinted". */
		--edge-top: #1c1c1c;
		--edge-bot: #050505;
		--off-bg: #161616;
		--off-text: #5a5a5a;
		--on-bg-top: hsl(40deg 100% 60%);
		--on-bg-bot: hsl(28deg 100% 46%);
		--on-text: hsl(28deg 100% 7%);
		--halo: rgba(255, 160, 40, 0.55);
		/* Radius scales with size so the corner roundness reads consistently
		 * across small nav buttons and the big grid buttons. */
		--radius: 14px;
	}
	.glow-red {
		--on-bg-top: hsl(8deg 100% 62%);
		--on-bg-bot: hsl(0deg 90% 44%);
		--on-text: hsl(0deg 100% 6%);
		--halo: rgba(255, 80, 50, 0.6);
	}
	.glow-green {
		--on-bg-top: hsl(120deg 80% 60%);
		--on-bg-bot: hsl(130deg 90% 32%);
		--on-text: hsl(130deg 100% 6%);
		--halo: rgba(70, 240, 90, 0.55);
	}
	.glow-blue {
		--on-bg-top: hsl(200deg 100% 65%);
		--on-bg-bot: hsl(212deg 95% 44%);
		--on-text: hsl(212deg 100% 8%);
		--halo: rgba(90, 170, 255, 0.6);
	}

	.shadow {
		position: absolute;
		inset: 0;
		border-radius: var(--radius);
		background: hsl(0deg 0% 0% / 0.55);
		filter: blur(1px);
		will-change: transform;
		transform: translateY(4px);
		transition: transform 600ms cubic-bezier(0.3, 0.7, 0.4, 1);
	}

	.edge {
		position: absolute;
		inset: 0;
		border-radius: var(--radius);
		background: var(--edge-bot);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.6);
	}

	.front {
		position: relative;
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 18px 14px;
		border-radius: var(--radius);
		background: var(--off-bg);
		color: var(--off-text);
		font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-align: center;
		line-height: 1.05;
		text-transform: uppercase;
		text-wrap: balance;
		will-change: transform, background, color, box-shadow;
		transform: translateY(-7px);
		transition:
			transform 600ms cubic-bezier(0.3, 0.7, 0.4, 1),
			background 220ms ease,
			color 220ms ease,
			box-shadow 220ms ease;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			inset 0 -2px 0 rgba(0, 0, 0, 0.5);
	}

	.tbtn.selected .front {
		background: linear-gradient(180deg, var(--on-bg-top) 0%, var(--on-bg-bot) 100%);
		color: var(--on-text);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.55),
			inset 0 -3px 0 rgba(0, 0, 0, 0.22),
			0 0 14px var(--halo);
	}

	.tbtn:hover:not(:disabled) {
		filter: brightness(112%);
	}
	.tbtn:hover:not(:disabled) .front {
		transform: translateY(-9px);
		transition: transform 250ms cubic-bezier(0.3, 0.7, 0.4, 1.5);
	}
	.tbtn:hover:not(:disabled) .shadow {
		transform: translateY(6px);
		transition: transform 250ms cubic-bezier(0.3, 0.7, 0.4, 1.5);
	}

	.tbtn:active:not(:disabled) .front {
		transform: translateY(-2px);
		transition: transform 34ms;
	}
	.tbtn:active:not(:disabled) .shadow {
		transform: translateY(1px);
		transition: transform 34ms;
	}

	.tbtn:disabled {
		cursor: not-allowed;
		filter: grayscale(0.4) brightness(0.55);
	}
	.tbtn:focus:not(:focus-visible) {
		outline: none;
	}

	.size-md {
		--radius: 8px;
	}
	.size-lg {
		--radius: 12px;
	}
	.size-xl {
		--radius: 16px;
	}

	.size-md .front {
		font-size: clamp(14px, 1.4vw, 18px);
		padding: 14px 16px;
	}
	.size-lg .front {
		font-size: clamp(22px, 2.6vw, 36px);
		padding: 20px 16px;
	}
	.size-xl .front {
		font-size: clamp(28px, 3.4vw, 48px);
		padding: 26px 18px;
	}
</style>
