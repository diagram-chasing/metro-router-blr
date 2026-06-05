<script lang="ts">
	import { COLS } from './ascii';

	type Props = {
		text: string;
		cols?: number;
		align?: 'left' | 'center';
		emphasis?: 'normal' | 'bold';
	};
	let { text, cols = COLS, align = 'left', emphasis = 'normal' }: Props = $props();
</script>

<pre class="block {align} {emphasis}" style="--cols: {cols};">{text}</pre>

<style>
	.block {
		margin: 4px 0;
		padding: 0;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		color: #14110d;
		line-height: 1.05;
		letter-spacing: 0;
		white-space: pre;
		display: block;
		width: 100%;
		/* mono char width ≈ 0.6 × font-size. The receipt container is the .receipt
		   element with 30px side padding (so 60px subtracted from inline size). */
		font-size: clamp(
			11px,
			calc((100cqi - 60px) / var(--cols) / 0.6),
			22px
		);
	}
	.bold {
		font-weight: 700;
	}
	.center {
		text-align: center;
	}
	.left {
		text-align: left;
	}
</style>
