<script lang="ts">
	let { children } = $props();
</script>

<div class="panel">
	<span class="screw tl" aria-hidden="true"></span>
	<span class="screw tr" aria-hidden="true"></span>
	<span class="screw bl" aria-hidden="true"></span>
	<span class="screw br" aria-hidden="true"></span>
	{@render children()}
</div>

<style>
	.panel {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		padding: 36px 40px;
		background: #0c0c0c;
		color: #ededed;
		font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
		overflow: hidden;
		box-shadow:
			inset 0 0 0 2px #1c1c1c,
			inset 0 0 0 3px rgba(255, 255, 255, 0.03);
	}
	.screw {
		position: absolute;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: radial-gradient(circle at 32% 30%, #9a9a9a 0%, #3a3a3a 55%, #0a0a0a 100%);
		box-shadow:
			inset 0 -1px 2px rgba(0, 0, 0, 0.6),
			inset 0 1px 1px rgba(255, 255, 255, 0.3),
			0 1px 3px rgba(0, 0, 0, 0.8);
	}
	.screw::after {
		content: '';
		position: absolute;
		inset: 5px;
		background: linear-gradient(
			45deg,
			transparent 44%,
			#050505 44%,
			#050505 56%,
			transparent 56%
		);
		border-radius: 50%;
	}
	.tl {
		top: 9px;
		left: 9px;
	}
	.tr {
		top: 9px;
		right: 9px;
	}
	.bl {
		bottom: 9px;
		left: 9px;
	}
	.br {
		bottom: 9px;
		right: 9px;
	}
</style>
