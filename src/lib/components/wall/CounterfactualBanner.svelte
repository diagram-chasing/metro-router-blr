<script lang="ts">
	// Slides in while the counterfactual is engaged. `strength` (0..1) is the eased
	// toggle value, so the banner fades in lockstep with the field/trail cross-fade.
	let {
		strength = 0,
		shiftPct = 50,
		savedPct = null
	}: { strength?: number; shiftPct?: number; savedPct?: number | null } = $props();

	const clamped = $derived(Math.max(0, Math.min(1, strength)));
</script>

<div
	class="banner"
	style:opacity={clamped}
	style:transform={`translate(-50%, ${(1 - clamped) * 18}px)`}
	aria-hidden={clamped < 0.5}
>
	<span class="tag">Counterfactual</span>
	<span class="head">If <b>{shiftPct}%</b> of these trips moved to bus&nbsp;+&nbsp;metro</span>
	{#if savedPct != null}
		<span class="save">−{savedPct}% CO₂ along these corridors</span>
	{/if}
</div>

<style>
	.banner {
		position: absolute;
		left: 50%;
		bottom: 7%;
		z-index: 20;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 16px 28px;
		border: 1px solid rgba(120, 220, 210, 0.28);
		border-radius: 14px;
		background: rgba(6, 14, 20, 0.62);
		backdrop-filter: blur(8px);
		box-shadow: 0 0 40px rgba(40, 200, 180, 0.16);
		text-align: center;
		pointer-events: none;
		will-change: opacity, transform;
	}
	.tag {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.34em;
		text-transform: uppercase;
		color: #4fd6c4;
	}
	.head {
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
		font-size: clamp(18px, 2.2vw, 34px);
		font-weight: 400;
		color: #eafffb;
		letter-spacing: 0.01em;
	}
	.head b {
		font-weight: 600;
		color: #6ff0dd;
	}
	.save {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: clamp(12px, 1.2vw, 16px);
		letter-spacing: 0.06em;
		color: #9af0e2;
		font-variant-numeric: tabular-nums;
	}
</style>
