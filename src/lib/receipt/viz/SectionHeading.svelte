<script lang="ts">
	// A numbered section heading: title (wrapping to two lines) on the left, a repeating
	// isotype row of SOLID icons on the right with the visitor's unit boxed. Rendered as
	// one node and captured to a single raster blit at print time (an image can't share a
	// print line with ROM text, so icon-beside-title must be one image).
	//
	// Icons are filled (fill=#000) so they print as solid silhouettes — outline/thin
	// strokes wash out under the 1-bit capture threshold (lum<128). The "you" box is a
	// filled frame (black cell, white inner, black icon), all solid for the same reason.
	import { User, Car } from '@lucide/svelte';

	let {
		kind,
		num,
		label,
		count,
		youIndex = -1
	}: {
		kind: 'audience' | 'corridor' | 'parking';
		num: string;
		label: string;
		count?: number;
		youIndex?: number;
	} = $props();

	const Unit = $derived(kind === 'audience' ? User : Car);
	const n = $derived(kind === 'parking' ? 1 : (count && count > 0 ? count : kind === 'audience' ? 5 : 4));
	const cells = $derived(Array.from({ length: n }, (_, i) => i));
</script>

<div class="head">
	<div class="txt"><span class="num">{num}</span> {label.toUpperCase()}</div>
	<div class="icons">
		{#each cells as i (i)}
			<div class="cell" class:you={i === youIndex}>
				<div class="chip"><Unit size={18} color="#000" fill="#000" /></div>
			</div>
		{/each}
	</div>
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
	}
	.txt {
		flex: 0 1 28ch; /* narrow enough to wrap the title to two lines */
		min-width: 0;
		box-sizing: border-box;
		/* hanging indent: wrapped lines line up under the text after "NN " (3 cols) */
		padding-left: 3ch;
		text-indent: -3ch;
		text-wrap: balance; /* even out the two lines — no lone-word widow */
		font-weight: 700;
		font-size: 20px;
		line-height: 22px;
		text-transform: uppercase;
	}
	.num {
		font-weight: 700;
	}
	.icons {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 3px;
	}
	.cell {
		display: flex;
		padding: 0;
		border-radius: 4px;
	}
	.chip {
		display: flex;
		padding: 0;
		border-radius: 2px;
	}
	/* boxed "you": solid black frame + white inner knockout, icon stays black */
	.cell.you {
		padding: 3px;
		background: #000;
	}
	.cell.you .chip {
		padding: 1px 2px;
		background: #fff;
	}
</style>
